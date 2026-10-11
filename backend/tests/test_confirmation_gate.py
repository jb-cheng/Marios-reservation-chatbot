"""Nothing books, and nothing distracts, while the summary is on screen.

Two complaints produced this file, and they are the same failure in different
clothes. The agent told a customer they were booked before the card had appeared.
Then, with every required field filled and the customer saying "yes", it asked which
seating type they wanted instead of asking them to confirm. Either way the
conversation moves somewhere other than the one action that creates a reservation.

The provider here is a stub, because the behaviour under test is what the server
does about a disobedient model, and a cooperative one cannot provoke it.
"""

from __future__ import annotations

from datetime import date

import pytest

from app import main as main_module
from app.config import load_settings
from app.prompts import CONFIRM_ASK, redirects_from_the_summary
from app.schemas import AgentOutput, SlotValues
from app.validate import is_complete

RESTAURANT = load_settings().restaurant

COMPLETE = {
    "date": "2026-10-17",
    "time": "19:00",
    "party_size": 4,
    "name": "Jean Ben",
    "email": "jean@example.com",
}


def post(client, message: str, state: dict, today: date | None = None):
    return client.post(
        "/api/chat",
        json={
            "state": state,
            "messages": [],
            "message": message,
            "current_date": (today or date.today()).isoformat(),
        },
    )


def stub_provider(
    monkeypatch: pytest.MonkeyPatch,
    reply: str,
    *,
    slots: dict,
    submit: bool = False,
    changed: tuple[str, ...] = (),
) -> None:
    """Answer every turn with a fixed reply, the way a model that ignored the prompt would."""

    async def fake(providers, **kwargs):
        return (
            AgentOutput(
                reply=reply,
                slots=SlotValues(**slots),
                changed=list(changed),
                submit=submit,
            ),
            "stub",
        )

    monkeypatch.setattr(main_module, "complete_turn", fake)


# -- completeness -----------------------------------------------------------


def test_a_complete_state_has_every_field_the_restaurant_insists_on() -> None:
    assert is_complete(COMPLETE, RESTAURANT) is True

    for key in RESTAURANT.required_slots:
        assert is_complete({**COMPLETE, key: None}, RESTAURANT) is False, key

    assert is_complete({**COMPLETE, "email": ""}, RESTAURANT) is False
    # Optional fields never hold a summary back, which is the point of making phone
    # one of them.
    assert is_complete({**COMPLETE, "phone": None, "type": None}, RESTAURANT) is True


# -- the predicate ----------------------------------------------------------


def test_an_invented_question_after_the_summary_is_spotted() -> None:
    assert redirects_from_the_summary(
        "yes",
        "What type of seating would you prefer: booth, patio, or standard?",
        complete=True,
    )
    assert redirects_from_the_summary("thanks", "Anything else I can help with?", complete=True)


def test_a_reply_that_leaves_the_card_alone_is_left_alone() -> None:
    assert not redirects_from_the_summary(
        "yes",
        "The details are on screen: please check them and confirm there.",
        complete=True,
    )


def test_collecting_is_still_the_job_before_the_summary_exists() -> None:
    assert not redirects_from_the_summary("yes", "What date were you thinking?", complete=False)


def test_a_long_message_is_a_question_that_deserves_an_answer() -> None:
    assert not redirects_from_the_summary(
        "can we bring a birthday cake for my mother",
        "Of course. Would you like it on the patio?",
        complete=True,
    )


def test_a_question_about_the_room_is_answered_by_the_engine() -> None:
    assert not redirects_from_the_summary(
        "what times are free",
        "I have 20:00 and 20:30 free. Which works?",
        complete=True,
    )


# -- through the endpoint ---------------------------------------------------


def test_a_model_that_keeps_collecting_is_cut_off(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """The observed failure, reproduced with a stub that always commits it."""
    slots = {**COMPLETE, "date": saturday.isoformat()}
    stub_provider(
        monkeypatch,
        "What type of seating would you prefer: booth, patio, or standard?",
        slots=slots,
    )

    body = post(client, "yes", slots).json()

    assert body["reply"] == CONFIRM_ASK
    assert body["submit"] is False


def test_a_reported_confirmation_is_not_overwritten(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """The reply and the flag have to keep agreeing, or voice mode books a table
    while saying "please check the details"."""
    slots = {**COMPLETE, "date": saturday.isoformat()}
    stub_provider(monkeypatch, "Shall I take that as a yes?", slots=slots, submit=True)

    body = post(client, "yes", slots).json()

    assert body["reply"] == "Shall I take that as a yes?"
    assert body["submit"] is True, "the room is free, so the flag survives"


def test_a_correction_keeps_its_own_reply(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    """A turn that changed something is a turn that is still working, even when it
    ends in a question and the message is short."""
    slots = {**COMPLETE, "date": saturday.isoformat()}
    stub_provider(
        monkeypatch,
        "Noted, 20:00 it is. Anything else?",
        slots={**slots, "time": "20:00"},
        changed=("time",),
    )

    body = post(client, "make it 8", slots).json()

    assert body["reply"] == "Noted, 20:00 it is. Anything else?"
    assert body["slots"]["time"] == "20:00"


def test_a_long_question_keeps_its_answer(
    client, monkeypatch: pytest.MonkeyPatch, saturday: date
) -> None:
    slots = {**COMPLETE, "date": saturday.isoformat()}
    answer = "Of course, we can bring a cake out with candles. Would you like that?"
    stub_provider(monkeypatch, answer, slots=slots)

    body = post(client, "can we bring a birthday cake for my mother", slots).json()

    assert body["reply"] == answer
