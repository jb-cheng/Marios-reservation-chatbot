"""The HTTP surface.

Thin on purpose. Slot extraction, validation, availability and persistence all
live in their own modules, and this file's job is to sequence them and translate
the result into a status code the browser can act on.

`create_app` is a factory so tests can build an app against a temporary database
and an injected provider, rather than monkeypatching module globals.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse, Response, StreamingResponse

from .availability import (
    AVAILABLE,
    BOOKED,
    NO_TABLE,
    NotAServiceSlot,
    Opening,
    SlotStatus,
    alternatives as compute_alternatives,
    openings as compute_openings,
    service_slots,
    status as compute_status,
)
from .config import SLOT_KEYS, Settings, load_settings
from .email import EmailTransport, receipt_email, rejection_email, transport_for
from .floor_plan import LARGEST_TABLE
from .guardrails import REFUSAL, check_inbound, check_outbound
from .llm import ChatProvider, agent_output_schema, complete_turn, provider_chain
from .prompts import (
    asks_about_availability,
    conflict_reply,
    openings_reply,
    system_prompt,
)
from .schemas import (
    AvailabilityOut,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ConfigResponse,
    OpeningOut,
    QueueResponse,
    ReservationOut,
    SlotValues,
    SubmitRequest,
    SubmitResponse,
    TtsRequest,
)
from .speech import stt_available, synthesize, transcribe
from .storage import Store
from .validate import parse_iso_date, sanitize

logger = logging.getLogger("reservation.api")

# Bounds the prompt. A conversation longer than this is a customer who has been
# talking for a very long time, and the oldest turns are the least useful ones.
MAX_HISTORY = 40

SSE_HEARTBEAT_SECONDS = 15


class Broker:
    """Fan-out for the admin queue.

    Criterion 8 asks for a new pending row to appear within a second. Polling
    cannot promise that, so submission publishes here and the admin page listens.
    """

    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[str]] = []

    def subscribe(self) -> asyncio.Queue[str]:
        queue: asyncio.Queue[str] = asyncio.Queue(maxsize=64)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[str]) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    async def publish(self, event: str, data: dict[str, Any]) -> None:
        payload = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(payload)
            except asyncio.QueueFull:
                # A slow consumer loses an update rather than blocking submission.
                # The admin page refetches on focus, so nothing is lost for long.
                logger.warning("dropping an event for a slow subscriber")


@dataclass
class Services:
    settings: Settings
    store: Store
    providers: list[ChatProvider]
    email: EmailTransport
    broker: Broker = field(default_factory=Broker)
    schema: dict[str, Any] = field(default_factory=agent_output_schema)


def create_app(settings: Settings | None = None, store: Store | None = None) -> FastAPI:
    resolved = settings or load_settings()
    resolved_store = store or Store(resolved.database_path)

    services = Services(
        settings=resolved,
        store=resolved_store,
        providers=provider_chain(resolved),
        email=transport_for(resolved),
        # Built with the restaurant so the decoder can enforce the seating types and
        # party range that this restaurant actually has.
        schema=agent_output_schema(resolved.restaurant),
    )

    app = FastAPI(title="Reservation Agent", version="0.1.0")
    app.state.services = services
    restaurant = resolved.restaurant

    # -- restaurant facts and health ---------------------------------------

    @app.get("/api/config", response_model=ConfigResponse)
    async def get_config() -> dict[str, Any]:
        """The browser's validation rules read from here.

        One source for opening hours rather than a constant in each language, so
        the client cannot reject a time the availability engine considers open.
        """
        return restaurant.as_payload()

    @app.get("/api/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "provider_chain": [provider.name for provider in services.providers],
            "email_transport": services.email.name,
            "guardrails": resolved.guardrails_enabled,
        }

    # -- conversation -------------------------------------------------------

    @app.post("/api/chat", response_model=ChatResponse)
    async def chat(payload: ChatRequest, request: Request) -> Any:
        today = _server_today(payload.current_date)

        # The state arrives from a browser, which is trusted with memory but not
        # with validity. Sanitising on the way in means a hand-edited localStorage
        # cannot smuggle a past date into the prompt or into a submission.
        trusted = sanitize(payload.state.model_dump(), today=today, restaurant=restaurant)
        state = _slots_from(trusted)

        guard = await check_inbound(payload.message, resolved)
        if guard.blocked:
            # State is returned unchanged and `changed` is empty, so the browser's
            # merge is a no-op. A blocked turn must never cost the customer their
            # draft.
            return ChatResponse(
                reply=REFUSAL,
                slots=state,
                changed=[],
                submit=False,
                availability=None,
                provider="guardrails",
            )

        computed, note = _resolve_availability(trusted, today, services)
        day_openings, openings_date, openings_party = _resolve_openings(
            trusted, today, services
        )

        history = list(payload.messages)[-MAX_HISTORY:]
        history.append(ChatMessage(role="user", content=payload.message))

        system = system_prompt(
            restaurant=restaurant,
            slots=state,
            availability=computed,
            today=today,
            now=datetime.now(),
            availability_note=note,
            openings=day_openings,
            openings_date=openings_date,
            openings_party=openings_party,
        )

        output, provider_name = await complete_turn(
            services.providers,
            system=system,
            messages=history,
            schema=services.schema,
            timeout_ms=resolved.llm_timeout_ms,
            state=state,
            availability=computed,
            openings=day_openings,
            today=today,
        )

        outbound = await check_outbound(output.reply, resolved)
        cleaned = sanitize(output.slots.model_dump(), today=today, restaurant=restaurant)

        reply = REFUSAL if outbound.blocked else output.reply
        changed = [key for key in output.changed if key in SLOT_KEYS]
        reported = computed

        # A turn that first learns the date and time cannot have had availability in
        # its prompt, because the prompt is built before the model reads the message.
        # Resolve the room against what the model just extracted, so the customer
        # hears "that time is full" now instead of after handing over an email
        # address.
        if reported is None and not outbound.blocked:
            discovered, _ = _resolve_availability(
                {**trusted, **cleaned}, today, services
            )
            if discovered is not None and discovered.state in (BOOKED, NO_TABLE):
                reported = discovered
                reply = conflict_reply(discovered, restaurant)
                # A time the room cannot honour is never stored. Dropping it here
                # rather than trusting the model to omit it is what makes that
                # guarantee hold for every provider, including a disobedient one.
                cleaned.pop("time", None)
                changed = [key for key in changed if key != "time"]

        # Openings are resolved against the merged slots too, so the turn where a
        # date first appears can still answer "what do you have free that evening".
        reported_openings, reported_date, reported_party = _resolve_openings(
            {**trusted, **cleaned}, today, services
        )
        if reported_openings is None:
            reported_openings = day_openings
            reported_date = openings_date
            reported_party = openings_party

        if (
            day_openings is None
            and reported_openings is not None
            and not outbound.blocked
            and asks_about_availability(payload.message)
        ):
            reply = openings_reply(
                reported_date or "",
                reported_openings,
                reported_party,
                cleaned.get("type") or trusted.get("type"),
            )

        return ChatResponse(
            reply=reply,
            slots=_slots_from(cleaned),
            changed=changed,
            # Never let a turn book a slot the room cannot honour, whatever the
            # model thinks the customer agreed to.
            submit=bool(
                output.submit
                and not outbound.blocked
                and (reported is None or reported.state == AVAILABLE)
            ),
            availability=_availability_out(reported),
            openings=[
                OpeningOut(**opening.as_dict())
                for opening in (reported_openings or ())
            ],
            provider=provider_name,
        )

    @app.get("/api/availability")
    async def availability_endpoint(
        request: Request,
        date_text: str,
        time_text: str,
        party_size: int,
        type_text: str | None = None,
    ) -> Any:
        today = date.today()
        day = parse_iso_date(date_text)
        if day is None:
            return JSONResponse(status_code=422, content=_rejection(["date"]))
        if day < today:
            return JSONResponse(status_code=422, content=_rejection(["date"]))
        if not 1 <= party_size <= restaurant.party_max:
            return JSONResponse(status_code=422, content=_rejection(["party_size"]))

        try:
            computed = compute_status(
                day=day,
                time=time_text,
                party_size=party_size,
                type_=type_text,
                occupied_at=services.store.occupied_at(),
                restaurant=restaurant,
            )
        except NotAServiceSlot:
            return JSONResponse(status_code=422, content=_rejection(["time"]))

        return _availability_out(computed).model_dump()

    # -- submission ---------------------------------------------------------

    @app.post("/api/submit")
    async def submit(payload: SubmitRequest) -> Any:
        today = date.today()
        raw = payload.model_dump(exclude={"session_id"})
        present = {key: value for key, value in raw.items() if value not in (None, "")}
        slots = sanitize(present, today=today, restaurant=restaurant)

        missing = [key for key in restaurant.required_slots if key not in present]
        if missing:
            return JSONResponse(
                status_code=422, content={"error": "incomplete", "missing": missing}
            )

        # A slot that was given and rejected is not the same as one never given.
        # "You did not tell me a date" and "that date is not bookable" need
        # different sentences, and the browser cannot tell them apart from a
        # single incomplete error.
        dropped = [
            key
            for key in restaurant.required_slots
            if key in present and key not in slots
        ]
        if dropped:
            return JSONResponse(status_code=422, content=_rejection(dropped))

        # Idempotent by session. The browser has a latch, and this is the second
        # line of defence for a double click or a retried request.
        existing = services.store.find_active_by_session(payload.session_id)
        if existing is not None:
            return SubmitResponse(
                submission_id=existing.submission_id,
                table_id=existing.table_id,
                state="already_submitted",
            )

        day = parse_iso_date(str(slots["date"]))
        if day is None or day < today:
            return JSONResponse(status_code=422, content=_rejection(["date"]))

        occupied_at = services.store.occupied_at()
        try:
            computed = compute_status(
                day=day,
                time=str(slots["time"]),
                party_size=int(slots["party_size"]),
                type_=slots.get("type"),
                occupied_at=occupied_at,
                restaurant=restaurant,
            )
        except NotAServiceSlot:
            return JSONResponse(status_code=422, content=_rejection(["time"]))

        if computed.state == NO_TABLE:
            return JSONResponse(
                status_code=422,
                content={"error": "no_table", "largest_table": LARGEST_TABLE},
            )

        if computed.state == BOOKED or computed.table_id is None:
            # Re-checked here rather than trusted from the last chat turn, because
            # someone else may have taken the table in between.
            return JSONResponse(
                status_code=409,
                content={
                    "error": "slot_taken",
                    "alternatives": [item.as_dict() for item in computed.alternatives],
                },
            )

        submission_id = uuid.uuid4().hex
        reservation = services.store.insert_pending(
            submission_id=submission_id,
            session_id=payload.session_id,
            slots=slots,
            table_id=computed.table_id,
        )

        # The receipt is what makes the booking real for the customer, so it is
        # sent before the response rather than queued behind it.
        services.email.send(receipt_email(restaurant, reservation))

        await services.broker.publish(
            "reservation",
            {"type": "submitted", "submission_id": submission_id},
        )

        return SubmitResponse(
            submission_id=submission_id,
            table_id=computed.table_id,
            state="pending",
        )

    # -- staff queue --------------------------------------------------------

    @app.get("/api/admin/queue", response_model=QueueResponse)
    async def admin_queue() -> dict[str, Any]:
        return {
            "pending": [item.as_dict() for item in services.store.list_pending()],
            "official": [item.as_dict() for item in services.store.list_official()],
            "double_booked": services.store.double_booked(),
        }

    @app.get("/api/admin/stream")
    async def admin_stream(request: Request) -> StreamingResponse:
        queue = services.broker.subscribe()

        async def events():
            try:
                yield "retry: 3000\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        payload = await asyncio.wait_for(
                            queue.get(), timeout=SSE_HEARTBEAT_SECONDS
                        )
                    except asyncio.TimeoutError:
                        # Keeps proxies and load balancers from closing an idle
                        # stream, and proves the connection is alive.
                        yield ": heartbeat\n\n"
                        continue
                    yield payload
            finally:
                services.broker.unsubscribe(queue)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.post("/api/admin/approve/{submission_id}")
    async def admin_approve(submission_id: str) -> Any:
        reservation = services.store.approve(submission_id)
        if reservation is None:
            return JSONResponse(status_code=404, content={"error": "not_found_or_decided"})

        # No email here, deliberately. The customer was told at submission that the
        # table was theirs, so approval changes nothing they need to hear.
        await services.broker.publish(
            "reservation",
            {"type": "approved", "submission_id": submission_id},
        )
        return reservation.as_dict()

    @app.post("/api/admin/reject/{submission_id}")
    async def admin_reject(submission_id: str) -> Any:
        reservation = services.store.reject(submission_id)
        if reservation is None:
            return JSONResponse(status_code=404, content={"error": "not_found_or_decided"})

        # Computed after the release, so the alternatives are genuinely free now.
        # The rejected time is excluded by the engine, which is right: staff just
        # said it does not work.
        day = parse_iso_date(reservation.date)
        offers = ()
        if day is not None:
            offers = compute_alternatives(
                day=day,
                requested=reservation.time,
                party_size=reservation.party_size,
                type_=reservation.table_type,
                occupied_at=services.store.occupied_at(),
                restaurant=restaurant,
            )

        services.email.send(rejection_email(restaurant, reservation, offers))

        await services.broker.publish(
            "reservation",
            {"type": "rejected", "submission_id": submission_id},
        )
        return reservation.as_dict()

    @app.post("/api/admin/reset")
    async def admin_reset() -> dict[str, Any]:
        """Wipes both tables. For demo reruns, and not linked from the UI."""
        services.store.reset()
        await services.broker.publish("reservation", {"type": "reset"})
        return {"cleared": True}

    # -- speech -------------------------------------------------------------

    @app.get("/api/speech/capabilities")
    async def speech_capabilities() -> dict[str, Any]:
        """What the browser should use for voice mode.

        Asked for rather than assumed, because whether ElevenLabs is configured is a
        server-side fact and the client must not ship a key to find out. With no key
        the recorder path is unavailable and voice mode falls back to the browser's
        own speech recognition.
        """
        premium = bool(resolved.elevenlabs_api_key)
        return {
            "elevenlabs": premium,
            "tts_provider": "elevenlabs" if premium else "edge-tts",
            "server_stt": stt_available(resolved),
        }

    @app.post("/api/tts")
    async def text_to_speech(payload: TtsRequest) -> Any:
        audio = await synthesize(payload.text, resolved)
        if audio is None:
            return JSONResponse(status_code=502, content={"error": "tts_unavailable"})

        return Response(
            content=audio.data,
            media_type=audio.media_type,
            headers={
                "X-TTS-Provider": audio.provider,
                "Cache-Control": "no-store",
            },
        )

    @app.post("/api/stt")
    async def speech_to_text(file: UploadFile = File(...)) -> Any:
        blob = await file.read()
        text = await transcribe(
            blob,
            file.filename or "utterance.webm",
            file.content_type or "audio/webm",
            resolved,
        )
        if text is None:
            return JSONResponse(status_code=502, content={"error": "stt_unavailable"})

        return {"text": text}

    return app


# -- helpers ---------------------------------------------------------------


def _slots_from(values: dict[str, Any]) -> SlotValues:
    return SlotValues(**{key: values.get(key) for key in SLOT_KEYS})


def _rejection(dropped: list[str]) -> dict[str, Any]:
    """Name the reason a slot that was supplied got refused.

    One error string per kind of mistake, because the browser turns these directly
    into a sentence for the customer. `slots` carries every rejected key so a
    message can mention more than one.
    """
    if "date" in dropped:
        error = "date_invalid"
    elif "time" in dropped:
        error = "not_a_seating_time"
    elif "party_size" in dropped:
        error = "party_size_invalid"
    else:
        error = "invalid_slot"

    return {"error": error, "slots": dropped}


def _availability_out(computed: SlotStatus | None) -> AvailabilityOut | None:
    if computed is None:
        return None
    return AvailabilityOut(**computed.as_dict())


def _server_today(client_date: str) -> date:
    """Today, from the server's clock.

    The browser sends its own date, and it is worth having for diagnosing a device
    with a wrong clock, but it is a claim rather than a fact. Validation uses the
    server's date so a manipulated client cannot book a table in the past.
    """
    today = date.today()
    sent = parse_iso_date(client_date)
    if sent is not None and sent != today:
        logger.warning(
            "client sent current_date %s but the server date is %s", client_date, today
        )
    return today


def _resolve_openings(
    slots: dict[str, Any], today: date, services: Services
) -> tuple[tuple[Opening, ...] | None, str | None, int | None]:
    """The day's free seatings, when the draft has a date.

    Computed for one date rather than a week: a week of openings is a wall of text
    the model will skim, and prompt cost nobody benefits from.

    Deliberately not filtered by seating type, so the model can see how many booth,
    patio and standard tables are open at each time and answer "is a booth free at
    seven" without a second round trip. Filtering by party size is correct though,
    because a table that cannot seat the party is not an opening for them.
    """
    date_text = slots.get("date")
    if not isinstance(date_text, str):
        return None, None, None

    day = parse_iso_date(date_text)
    if day is None or day < today:
        return None, None, None

    party = slots.get("party_size")
    size = party if isinstance(party, int) and not isinstance(party, bool) else None

    return (
        compute_openings(
            day=day,
            occupied_at=services.store.occupied_at(),
            restaurant=services.settings.restaurant,
            party_size=size,
        ),
        day.isoformat(),
        size,
    )


def _resolve_availability(
    slots: dict[str, Any], today: date, services: Services
) -> tuple[SlotStatus | None, str | None]:
    """Compute availability for the current draft, if it has enough to check.

    Returns the status plus an optional note for the prompt. A note is used instead
    of a fabricated status whenever the request is not a real seating, so the model
    is told the truth rather than being handed an empty block it might fill in.
    """
    date_text = slots.get("date")
    time_text = slots.get("time")
    party_size = slots.get("party_size")

    if not isinstance(date_text, str) or not isinstance(time_text, str):
        return None, None
    if not isinstance(party_size, int) or isinstance(party_size, bool):
        return None, None

    day = parse_iso_date(date_text)
    if day is None:
        return None, None
    if day < today:
        return None, "The requested date is in the past. Ask for another date."

    restaurant = services.settings.restaurant
    try:
        computed = compute_status(
            day=day,
            time=time_text,
            party_size=party_size,
            type_=slots.get("type"),
            occupied_at=services.store.occupied_at(),
            restaurant=restaurant,
        )
        return computed, None
    except NotAServiceSlot:
        offered = ", ".join(service_slots(day, restaurant)) or "none, the restaurant is closed that day"
        return None, (
            f"{time_text} on {date_text} is not a seating time. "
            f"The seating times that day are: {offered}. "
            "Offer only from that list, and ask the user to choose."
        )


app = create_app()
