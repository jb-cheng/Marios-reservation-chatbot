"""Live provider checks. Skipped unless the key exists.

    .venv/Scripts/python.exe -m pytest -m live

These cost real API calls, so there are few of them and each one asserts an
acceptance criterion rather than a code path. The offline suite already covers the
routing, merge and validation logic; what only a live model can tell us is whether
it invents slot values, and whether it respects the availability block it was given.
"""

from __future__ import annotations

import re
from datetime import date, timedelta

import pytest

from app.availability import Alternative, SlotStatus
from app.config import load_settings
from app.llm import agent_output_schema, complete_turn, provider_chain
from app.prompts import system_prompt
from app.schemas import ChatMessage, SlotValues

settings = load_settings()

needs_cohere = pytest.mark.skipif(
    not settings.cohere_api_key, reason="COHERE_API_KEY is not set"
)


def next_open_day(offset: int = 1) -> date:
    """A bookable day a few days out, skipping Mondays."""
    day = date.today() + timedelta(days=offset)
    while settings.restaurant.open_hours[
        ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[day.weekday()]
    ] is None:
        day += timedelta(days=1)
    return day


ORDINAL_RE = re.compile(r"\b\d{1,2}(?:st|nd|rd|th)\b", re.I)
ISO_DATE_RE = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
TIME_TOKEN_RE = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", re.I)


def times_mentioned(reply: str) -> set[str]:
    """Every clock time in a reply, normalised to HH:MM.

    Models phrase times for people, so "6:30, 7:30, or 8pm" is a correct answer to
    an engine that said 18:30, 19:30 and 20:00. Asserting on 24 hour strings alone
    fails a model that was right, which is how the first version of this test failed.

    A token only counts as a time when it carries minutes or a meridiem. An earlier
    version accepted bare numbers, and so read the 13 in "Oct 13" as 13:00 and the
    party size in "a table for 4" as four o'clock, which the evening heuristic then
    turned into 16:00. Both looked like times the model had invented.
    """
    text = ISO_DATE_RE.sub(" ", ORDINAL_RE.sub(" ", reply))

    found: set[str] = set()
    for hour, minute, meridiem in TIME_TOKEN_RE.findall(text):
        if not minute and not meridiem:
            continue

        parsed_hour = int(hour)
        parsed_minute = int(minute or 0)

        if meridiem:
            marker = meridiem.lower()
            if marker == "pm" and parsed_hour < 12:
                parsed_hour += 12
            elif marker == "am" and parsed_hour == 12:
                parsed_hour = 0
        elif parsed_hour <= 11 and 16 <= parsed_hour + 12 <= 21:
            # No meridiem, and the hour only makes sense as an evening seating.
            parsed_hour += 12

        if parsed_hour > 23 or parsed_minute > 59:
            continue
        found.add(f"{parsed_hour:02d}:{parsed_minute:02d}")

    return found


async def ask(
    message: str,
    *,
    state: SlotValues | None = None,
    availability: SlotStatus | None = None,
    openings=None,
    openings_date: str | None = None,
    history: list[ChatMessage] | None = None,
):
    providers = [p for p in provider_chain(settings) if p.name == "cohere"]
    assert providers, "the cohere provider did not build; check the install"

    slots = state if state is not None else SlotValues()
    today = date.today()
    system = system_prompt(
        restaurant=settings.restaurant,
        slots=slots,
        availability=availability,
        today=today,
        openings=openings,
        openings_date=openings_date,
        openings_party=slots.party_size,
    )

    messages = list(history or [])
    messages.append(ChatMessage(role="user", content=message))

    output, provider = await complete_turn(
        providers,
        system=system,
        messages=messages,
        schema=agent_output_schema(),
        # Measured separately by scripts/latency.py. Generous here so a slow answer
        # is reported as a slow answer rather than silently falling back to the
        # deterministic provider and passing the test for the wrong reason.
        timeout_ms=30000,
        state=slots,
        availability=availability,
        openings=openings,
        today=today,
    )
    return output, provider


@needs_cohere
@pytest.mark.live
async def test_cohere_extracts_what_was_said_and_nothing_else() -> None:
    day = next_open_day()
    output, provider = await ask(f"I would like a table for 4 on {day.isoformat()} at 7pm")

    assert provider == "cohere"
    assert output.slots.date == day.isoformat()
    assert output.slots.time == "19:00"
    assert output.slots.party_size == 4
    # Criterion 4. The customer said nothing about these, so a value here is
    # invented, and an invented email ends up on a receipt.
    assert output.slots.email is None
    assert output.slots.name is None
    assert output.slots.phone is None
    assert output.slots.special_requests is None
    assert output.submit is False


@needs_cohere
@pytest.mark.live
async def test_cohere_does_not_invent_slots_from_small_talk() -> None:
    state = SlotValues(party_size=4, name="Jean Ben")
    output, provider = await ask("hello there", state=state)

    assert provider == "cohere"
    assert output.changed == []
    assert output.slots.date is None
    assert output.slots.time is None
    assert output.slots.email is None
    assert output.slots.phone is None
    assert output.slots.party_size == 4
    assert output.slots.name == "Jean Ben"


@needs_cohere
@pytest.mark.live
async def test_cohere_answers_a_general_question_without_touching_state() -> None:
    state = SlotValues(party_size=4)
    output, provider = await ask("do you have a patio?", state=state)

    assert provider == "cohere"
    assert "patio" in output.reply.lower()
    assert output.slots.party_size == 4
    assert output.slots.date is None
    assert output.changed == []


@needs_cohere
@pytest.mark.live
async def test_cohere_offers_only_the_alternatives_the_engine_computed() -> None:
    """The claim the whole availability design rests on.

    Given a booked slot and three real openings, the reply must mention one of the
    openings and must not present the requested time as bookable. A model that
    invents a fourth time here would be exactly the failure the injection exists to
    prevent.
    """
    day = next_open_day()
    offered = ("19:30", "18:30", "20:00")
    availability = SlotStatus(
        date=day.isoformat(),
        time="19:00",
        party_size=4,
        type=None,
        state="booked",
        table_id=None,
        alternatives=tuple(
            Alternative(time=t, table_id="S2", seats=4, type="standard") for t in offered
        ),
    )

    output, provider = await ask(
        f"table for 4 on {day.isoformat()} at 7pm",
        state=SlotValues(date=day.isoformat(), time="19:00", party_size=4),
        availability=availability,
    )

    assert provider == "cohere"
    assert output.submit is False, "a booked slot must never be submitted"

    mentioned = times_mentioned(output.reply)
    assert mentioned & set(offered), (
        f"the reply offers none of the engine's alternatives {offered}: {output.reply!r}"
    )
    invented = mentioned - set(offered) - {"19:00"}
    assert not invented, f"the model offered times the engine did not: {invented}"
