"""The room's answer, on the turn it is discovered.

Two complaints produced this file, and they are one conversation. Asked for a booth
for eight, the agent said the largest table seats eight and so it could not seat
eight: the room's limit quoted for a constraint that was really the booth's. Told
"ok 6 guests then", it answered "Let me check if a booth is available then" and
nothing followed, because the time had been deleted and the server only spoke when
the answer was a conflict.

The provider is a stub where a turn is involved, because the behaviour under test is
what the server does with a reply that promises rather than reports.
"""

from __future__ import annotations

from datetime import date

import pytest

from app import main as main_module
from app.availability import NO_TABLE, status
from app.config import build_restaurant
from app.floor_plan import LARGEST_TABLE
from app.prompts import available_reply, conflict_reply, render_availability
from app.schemas import AgentOutput, SlotValues

RESTAURANT = build_restaurant("Mario's")
SATURDAY = date(2026, 10, 10)

EMPTY_STATE = {
    "date": None, "time": None, "party_size": None, "type": None,
    "name": None, "email": None, "phone": None, "special_requests": None,
}


def resolve(party_size: int, type_: str | None = None, occupied=(), day: date = SATURDAY):
    taken = set(occupied)
    return status(
        day=day,
        time="19:00",
        party_size=party_size,
        type_=type_,
        occupied_at=lambda day, time: taken,
        restaurant=RESTAURANT,
    )


def stub_provider(monkeypatch, reply: str, *, slots: dict, changed=()) -> None:
    async def fake(providers, **kwargs):
        return (
            AgentOutput(
                reply=reply, slots=SlotValues(**slots),
                changed=list(changed), submit=False,
            ),
            "stub",
        )

    monkeypatch.setattr(main_module, "complete_turn", fake)


def post(client, message: str, state: dict):
    return client.post(
        "/api/chat",
        json={
            "state": state,
            "messages": [],
            "message": message,
            "current_date": date.today().isoformat(),
        },
    ).json()


# -- which limit actually binds ---------------------------------------------


def test_a_booth_for_eight_is_the_booths_limit_not_the_rooms() -> None:
    """The observed contradiction. Eight fits S5, so the room is not the problem."""
    result = resolve(8, "booth")

    assert result.state == NO_TABLE
    assert result.capacity == 6, "the largest booth, not the largest table"

    reply = conflict_reply(result, RESTAURANT)
    assert f"The largest booth at {RESTAURANT.name} seats 6" in reply
    assert f"largest table at {RESTAURANT.name} seats {LARGEST_TABLE}" not in reply


def test_the_prompt_block_names_the_same_limit_as_the_reply() -> None:
    block = render_availability(resolve(8, "booth"))

    assert "NO_TABLE" in block
    assert "The largest booth seats 6" in block
    assert f"The largest single table seats {LARGEST_TABLE}" not in block


def test_a_patio_constraint_reads_as_a_table_on_the_patio() -> None:
    assert "The largest table on the patio seats 4" in render_availability(
        resolve(6, "patio")
    )


def test_a_party_bigger_than_the_room_still_quotes_the_room() -> None:
    """The case the original sentence was written for has to keep working."""
    result = resolve(LARGEST_TABLE + 1)

    assert result.capacity == LARGEST_TABLE
    assert (
        f"largest table at {RESTAURANT.name} seats {LARGEST_TABLE}"
        in conflict_reply(result, RESTAURANT)
    )


def test_a_type_too_small_for_a_party_the_room_could_seat_offers_the_way_out() -> None:
    """Telling this customer to phone about arranging the room sends them away
    when a standard table seats them tonight."""
    reply = conflict_reply(resolve(8, "booth"), RESTAURANT)

    assert "8" in reply, "the party the room can seat"
    assert "6" in reply, "the party the booth can seat"


# -- the turn that discovers the answer -------------------------------------


def test_a_no_table_turn_keeps_the_time_the_customer_gave(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """The time was never the problem: 19:00 seats six in a booth perfectly well.
    Deleting it is what left the next turn with nothing to check."""
    stub_provider(
        monkeypatch,
        "Let me look at that.",
        slots={
            "date": saturday.isoformat(), "time": "19:00",
            "party_size": 8, "type": "booth",
        },
        changed=("date", "time", "party_size", "type"),
    )

    body = post(client, "8 guests, booth, 7pm", EMPTY_STATE)

    assert body["availability"]["state"] == "no_table"
    assert body["slots"]["time"] == "19:00"


def test_a_booked_turn_still_drops_the_time(
    client, store, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """Here the time is the problem, so the rule that drops it still applies."""
    store.insert_pending(
        submission_id="held", session_id="other",
        slots={
            "date": saturday.isoformat(), "time": "19:00", "party_size": 8,
            "name": "Someone Else", "email": "else@example.com",
        },
        table_id="S5",
    )
    stub_provider(
        monkeypatch,
        "Let me look at that.",
        slots={
            "date": saturday.isoformat(), "time": "19:00", "party_size": 8,
        },
        changed=("date", "time", "party_size"),
    )

    body = post(client, "8 guests at 7pm", EMPTY_STATE)

    assert body["availability"]["state"] == "booked"
    assert body["slots"]["time"] is None


def test_a_free_slot_discovered_after_extraction_is_reported(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """The server computed AVAILABLE and said nothing, so the model's promise was
    the last thing the customer heard."""
    stub_provider(
        monkeypatch,
        "Got it, 6 guests at 19:00. Let me check if a booth is available then.",
        slots={"party_size": 6, "time": "19:00"},
        changed=("party_size", "time"),
    )
    state = {
        **EMPTY_STATE, "date": saturday.isoformat(),
        "party_size": 8, "type": "booth",
    }

    body = post(client, "ok 6 guests then", state)

    assert body["availability"]["state"] == "available"
    assert "19:00" in body["reply"]
    assert available_reply(resolve(6, "booth", day=saturday)) in body["reply"]


def test_the_reported_answer_does_not_claim_a_booking(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    stub_provider(
        monkeypatch,
        "Let me check that for you.",
        slots={"party_size": 6, "time": "19:00"},
        changed=("party_size", "time"),
    )
    state = {
        **EMPTY_STATE, "date": saturday.isoformat(),
        "party_size": 8, "type": "booth",
    }

    body = post(client, "ok 6 guests then", state)

    assert "free" in body["reply"]
    assert "confirmed" not in body["reply"].lower()
    assert body["submit"] is False


def test_the_observed_conversation_ends_with_an_answer(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """Both complaints in sequence, with the model changing only the party the
    second time, which is what the merge rule asks of it."""
    stub_provider(
        monkeypatch,
        "Let me look at that.",
        slots={
            "date": saturday.isoformat(), "time": "19:00",
            "party_size": 8, "type": "booth",
        },
        changed=("date", "time", "party_size", "type"),
    )
    turn1 = post(client, "8 guests, booth, 7pm", EMPTY_STATE)
    assert turn1["availability"]["state"] == "no_table"

    stub_provider(
        monkeypatch,
        "Got it, 6 guests at 19:00. Let me check if a booth is available then.",
        slots={"party_size": 6},
        changed=("party_size",),
    )
    turn2 = post(client, "ok 6 guests then", {**EMPTY_STATE, **turn1["slots"]})

    assert turn2["availability"]["state"] == "available"
    assert "19:00" in turn2["reply"]
    assert "free" in turn2["reply"]