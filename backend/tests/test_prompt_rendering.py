"""What the AVAILABILITY block tells the model about the rest of the room.

A live run was asked whether anybody else had booked the same time. The block said
only `AVAILABLE`, so the model had no occupancy data at all and answered "there are
no other bookings at that exact time" while a pending row held a booth at it. These
pin the facts the block now carries, and the one case where it stays silent.
"""

from __future__ import annotations

from datetime import date

from app.availability import status
from app.config import build_restaurant
from app.prompts import render_availability

RESTAURANT = build_restaurant("Mario's")
SATURDAY = date(2026, 10, 10)


def resolve(party_size: int, type_: str | None = None, occupied=()) -> "object":
    taken = set(occupied)
    return status(
        day=SATURDAY,
        time="19:00",
        party_size=party_size,
        type_=type_,
        occupied_at=lambda day, time: taken,
        restaurant=RESTAURANT,
    )


def test_an_available_slot_says_how_many_tables_are_held_and_never_which() -> None:
    block = render_availability(resolve(3, "booth", occupied=("B2",)))

    assert "Tables already held at this time: booth 1." in block
    assert "B2" not in block, "the model may not be told which table, only how many"


def test_held_counts_are_grouped_by_type_in_a_stable_order() -> None:
    block = render_availability(resolve(2, occupied=("S1", "B4", "P1", "B2")))

    assert "Tables already held at this time: booth 2, patio 1, standard 1." in block


def test_an_empty_room_says_none_rather_than_omitting_the_line() -> None:
    """An absent line is ambiguous. The model cannot tell "nothing is held" from
    "occupancy was never looked up", and only the second one may stay silent."""
    block = render_availability(resolve(3, "booth"))

    assert "Tables already held at this time: none." in block


def test_a_booked_slot_reports_the_tables_holding_it() -> None:
    block = render_availability(resolve(4, "booth", occupied=("B1", "B2", "B3", "B4")))

    assert "BOOKED" in block
    assert "Tables already held at this time: booth 4." in block


def test_no_table_omits_the_line_because_occupancy_was_never_read() -> None:
    """A party no table in the room can seat is answered before occupancy is
    queried. Printing a zero here would state a fact the engine never checked."""
    block = render_availability(resolve(12, occupied=("B2", "S1")))

    assert "NO_TABLE" in block
    assert "Tables already held" not in block
