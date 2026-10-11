"""The deterministic provider on its own, below the HTTP layer.

These cases are about extraction rather than routing. The name bug that reached the
browser (a capitalised "Under Jean Ben" at the start of a sentence was ignored,
while "my name is jean" mid-sentence worked) was invisible from the API tests,
because they only ever asserted that a slot was empty, never which turn lost it.
"""

from __future__ import annotations

from datetime import date

import pytest

from app.config import build_restaurant
from app.fake_provider import FakeProvider
from app.schemas import ChatMessage, SlotValues

RESTAURANT = build_restaurant("Mario's")
TODAY = date(2026, 10, 10)


async def turn(text: str, state: SlotValues | None = None):
    provider = FakeProvider(RESTAURANT)
    return await provider.complete(
        "",
        [ChatMessage(role="user", content=text)],
        {},
        state=state if state is not None else SlotValues(),
        today=TODAY,
    )


@pytest.mark.parametrize(
    "text",
    [
        "Under Jean Ben",
        "under Jean Ben",
        "my name is Jean Ben",
        "I'm Jean Ben",
        "This is Jean Ben",
        "name is Jean Ben",
    ],
)
async def test_a_name_is_captured_whatever_the_case_of_the_trigger(text: str) -> None:
    output = await turn(text)
    assert output.slots.name == "Jean Ben"


async def test_a_capitalised_trigger_does_not_flatten_the_name() -> None:
    """Case-insensitive matching of the trigger must not lowercase the value."""
    output = await turn("UNDER Aoife O'Brien")
    assert output.slots.name == "Aoife O'Brien"


@pytest.mark.parametrize(
    "text",
    ["I'm looking for a table", "This is for my birthday", "under the weather"],
)
async def test_a_sentence_after_a_trigger_is_not_a_name(text: str) -> None:
    output = await turn(text)
    assert output.slots.name is None


async def test_acceptance_4_no_slot_information_changes_nothing() -> None:
    output = await turn("hello there")

    assert output.slots.model_dump() == {key: None for key in output.slots.model_dump()}
    assert output.changed == []
    assert output.submit is False


async def test_acceptance_5_an_off_topic_question_fills_nothing() -> None:
    output = await turn("do you have a patio?")

    assert output.slots.type is None
    assert "patio" in output.reply.lower()


async def test_a_general_question_is_answered_from_facts_not_invention() -> None:
    output = await turn("what time do you close?")

    assert "9pm" in output.reply or "21" in output.reply
    assert output.slots.model_dump(exclude_none=True) == {}


async def test_a_correction_is_flagged_so_the_merge_can_overwrite() -> None:
    output = await turn("actually make it 6", state=SlotValues(party_size=4))

    assert output.slots.party_size == 6
    assert "party_size" in output.changed


async def test_a_correction_number_is_not_mistaken_for_a_time() -> None:
    """The bare-number rule only exists for corrections, so it must not fire on the
    sentence "actually make it 7pm", where 7 is a clock and not a head count."""
    output = await turn(
        "actually make it 7pm", state=SlotValues(date="2026-10-11", time="18:00")
    )

    assert output.slots.party_size is None
    assert output.slots.time == "19:00"
    assert "time" in output.changed


async def test_a_repeated_value_is_not_reported_as_a_change() -> None:
    """Filling an empty slot is not a correction, and calling it one would let any
    turn overwrite anything."""
    output = await turn("table for 4", state=SlotValues(party_size=4))

    assert output.slots.party_size == 4
    assert output.changed == []


async def test_submit_needs_confirmation_and_a_complete_booking() -> None:
    complete = SlotValues(
        date="2026-10-11",
        time="19:00",
        party_size=4,
        name="Jean Ben",
        email="jean@example.com",
        phone="4169999999",
    )

    assert (await turn("yes book it", state=complete)).submit is True
    assert (await turn("yes book it", state=SlotValues(name="Jean"))).submit is False
    assert (await turn("thanks", state=complete)).submit is False


async def test_a_booking_request_extracts_date_time_and_party_together() -> None:
    output = await turn("table for 4 on 2026-10-17 at 7pm")

    assert output.slots.date == "2026-10-17"
    assert output.slots.time == "19:00"
    assert output.slots.party_size == 4


async def test_a_bare_evening_hour_is_read_as_dinner_service() -> None:
    output = await turn("table for two at 7")
    assert output.slots.time == "19:00"


async def test_a_time_that_is_not_on_the_grid_is_left_for_validation_to_drop() -> None:
    """The provider does not silently round. Inventing 19:30 from "7:20" would be
    the model choosing a seating the customer never asked for."""
    output = await turn("table for two at 7:20")
    assert output.slots.time == "19:20"


async def test_special_requests_are_captured_by_keyword() -> None:
    output = await turn("it's my wife's birthday")
    assert output.slots.special_requests == "birthday"
