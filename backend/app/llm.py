"""The provider abstraction, the output schema, and the fallback chain.

Everything above this module talks to `complete_turn` and never to a vendor. That
is what makes swapping Cohere for Groq, or running the whole demo against the
deterministic provider, a configuration change rather than an edit.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Any, Protocol

from .availability import Opening, SlotStatus, service_slots
from .config import SLOT_KEYS, Settings
from .fake_provider import FakeProvider
from .schemas import AgentOutput, ChatMessage, SlotValues

logger = logging.getLogger("reservation.llm")

CANNED_REPLY = "Sorry, I did not catch that. Could you repeat it?"

def _service_times(restaurant: Any) -> list[str]:
    """Every seating time the restaurant offers on any day.

    Seven consecutive days cover every weekday, so each service window contributes
    its slots without this function needing to know which days are open.
    """
    seen: set[str] = set()
    today = date.today()
    for offset in range(7):
        seen.update(service_slots(today + timedelta(days=offset), restaurant))
    return sorted(seen)


def agent_output_schema(restaurant: Any | None = None) -> dict[str, Any]:
    """The one output contract, sent to every provider.

    Deliberately restricted to the intersection of what the providers accept,
    because two schemas that mean the same thing drift, and the drift shows up as
    one provider silently allowing what another forbids. Verified against the live
    APIs on 2026-10-11:

    - Cohere rejected `pattern` ("unsupported patterns: '^, $, ?=, ?!'") and then
      rejected `minimum` on an integer.
    - Groq accepts this shape under `strict=True` constrained decoding.

    So formats are carried by enums where an enum is possible, which is stronger
    than a pattern anyway: the decoder cannot emit "7pm" for a time because "7pm" is
    not in the list. `date` is the exception, since enumerating ninety days would
    make the schema depend on today's date; it is stated in the prompt and checked by
    server-side validation, which is where an out-of-range date was always caught.

    Email and phone are unconstrained on purpose. A customer says "+1 (416)
    999-9999" and the model should pass that through for coercion and validation to
    judge, rather than being forced by the decoder to invent digits or return null.
    """
    slots: dict[str, Any] = {
        "date": {"type": ["string", "null"]},
        "time": {"type": ["string", "null"]},
        "party_size": {"type": ["integer", "null"]},
        "type": {"type": ["string", "null"]},
        "name": {"type": ["string", "null"]},
        "email": {"type": ["string", "null"]},
        "phone": {"type": ["string", "null"]},
        "special_requests": {"type": ["string", "null"]},
    }

    if restaurant is not None:
        slots["time"]["enum"] = [*_service_times(restaurant), None]
        slots["type"]["enum"] = [*restaurant.table_types, None]

    return {
        "type": "object",
        "properties": {
            "reply": {"type": "string"},
            "slots": {
                "type": "object",
                "properties": slots,
                "required": list(slots),
                "additionalProperties": False,
            },
            "changed": {
                "type": "array",
                "items": {"type": "string", "enum": list(SLOT_KEYS)},
            },
            "submit": {"type": "boolean"},
        },
        "required": ["reply", "slots", "changed", "submit"],
        "additionalProperties": False,
    }


class ChatProvider(Protocol):
    """The brief's protocol, with the context a deterministic provider needs.

    `system`, `messages` and `schema` are positional exactly as specified. The
    keyword arguments carry the current state, the computed availability and
    today's date, which the real providers ignore because all three are already
    rendered into `system`, and which the fake provider needs because it does not
    parse its own prompt.
    """

    name: str

    async def complete(
        self,
        system: str,
        messages: list[ChatMessage],
        schema: dict[str, Any],
        *,
        state: SlotValues | None = None,
        availability: SlotStatus | None = None,
        openings: tuple[Opening, ...] | None = None,
        today: date | None = None,
    ) -> AgentOutput: ...


def provider_chain(settings: Settings) -> list[ChatProvider]:
    """Providers in fallback order, skipping any whose package is not installed.

    The brief's order is Cohere, then Groq, then Gemini. `LLM_PROVIDER` promotes
    one of them to the front rather than replacing the chain, so a misconfigured
    primary degrades to the backup instead of failing the turn.
    """
    preferred = settings.llm_provider
    chain: list[ChatProvider] = []

    if preferred == "fake":
        return [FakeProvider(settings.restaurant)]

    builders: list[tuple[str, Any]] = [
        ("cohere", _build_cohere),
        ("groq", _build_groq),
        ("gemini", _build_gemini),
    ]

    ordered = [entry for entry in builders if entry[0] == preferred]
    ordered += [entry for entry in builders if entry[0] != preferred]

    for name, build in ordered:
        provider = build(settings)
        if provider is not None:
            chain.append(provider)

    if not chain:
        logger.warning(
            "no configured provider could be built, falling back to the deterministic provider"
        )
        chain.append(FakeProvider(settings.restaurant))

    return chain


def _build_cohere(settings: Settings) -> ChatProvider | None:
    if not settings.cohere_api_key:
        return None
    try:
        from .providers.cohere_provider import CohereProvider
    except ImportError as error:
        logger.warning("cohere provider unavailable: %s", error)
        return None
    return CohereProvider(settings)


def _build_groq(settings: Settings) -> ChatProvider | None:
    if not settings.groq_api_key:
        return None
    try:
        from .providers.groq_provider import GroqProvider
    except ImportError as error:
        logger.warning("groq provider unavailable: %s", error)
        return None
    return GroqProvider(settings)


def _build_gemini(settings: Settings) -> ChatProvider | None:
    if not settings.gemini_api_key:
        return None
    try:
        from .providers.gemini_provider import GeminiProvider
    except ImportError as error:
        logger.warning("gemini provider unavailable: %s", error)
        return None
    return GeminiProvider(settings)


def noop_output(state: SlotValues | None) -> AgentOutput:
    """The response used when every provider fails.

    `slots` echoes back the state that arrived and `changed` is empty, which makes
    the browser's merge provably a no-op. No provider being reachable must never be
    able to corrupt memory, and this is the line that guarantees it.
    """
    return AgentOutput(
        reply=CANNED_REPLY,
        slots=state if state is not None else SlotValues(),
        changed=[],
        submit=False,
    )


async def complete_turn(
    providers: list[ChatProvider],
    *,
    system: str,
    messages: list[ChatMessage],
    schema: dict[str, Any],
    timeout_ms: int,
    state: SlotValues | None = None,
    availability: SlotStatus | None = None,
    openings: tuple[Opening, ...] | None = None,
    today: date | None = None,
    retry_malformed: bool = True,
) -> tuple[AgentOutput, str | None]:
    """Walk the chain until a provider returns valid output.

    Two failure modes are handled the same way, because both must produce the
    no-op: a timeout or transport error, and output that does not validate. The
    brief allows one retry for malformed output, which is what `retry_malformed`
    does per provider rather than across the whole chain.
    """
    timeout = timeout_ms / 1000
    attempts = 2 if retry_malformed else 1

    for provider in providers:
        for attempt in range(attempts):
            try:
                output = await asyncio.wait_for(
                    provider.complete(
                        system,
                        messages,
                        schema,
                        state=state,
                        availability=availability,
                        openings=openings,
                        today=today,
                    ),
                    timeout=timeout,
                )
            except asyncio.TimeoutError:
                logger.warning("provider %s timed out after %sms", provider.name, timeout_ms)
                break
            except Exception:
                logger.exception("provider %s failed", provider.name)
                break

            validated = _coerce_output(output)
            if validated is not None:
                return validated, provider.name

            logger.warning(
                "provider %s returned output that did not validate (attempt %d)",
                provider.name,
                attempt + 1,
            )

    return noop_output(state), None


def _coerce_output(output: Any) -> AgentOutput | None:
    """Accept an AgentOutput or the plain dict the brief's protocol describes.

    Validation happens here rather than in each provider, so a malformed shape is
    a retry on the next attempt or the next provider instead of an exception that
    escapes the chain.
    """
    if isinstance(output, AgentOutput):
        return output
    if isinstance(output, dict):
        try:
            return AgentOutput.model_validate(output)
        except Exception:
            logger.debug("dict output failed validation: %r", output)
            return None
    return None
