from __future__ import annotations

from datetime import date

import pytest

from app.availability import (
    AVAILABLE,
    BOOKED,
    NO_TABLE,
    NotAServiceSlot,
    alternatives,
    choose_table,
    openings,
    service_slots,
    status,
)
from app.config import build_restaurant
from app.floor_plan import LARGEST_TABLE, candidates
from app.storage import Store

RESTAURANT = build_restaurant("Mario's")
SATURDAY = date(2026, 10, 10)
MONDAY = date(2026, 10, 12)


def nothing(day: date, time: str) -> set[str]:
    return set()


def occupying(*table_ids: str):
    def lookup(day: date, time: str) -> set[str]:
        return set(table_ids)

    return lookup


def resolve(day, time, party_size, type_=None, occupied=nothing):
    return status(
        day=day,
        time=time,
        party_size=party_size,
        type_=type_,
        occupied_at=occupied,
        restaurant=RESTAURANT,
    )


# -- the slot grid ---------------------------------------------------------


def test_service_slots_cover_opening_to_last_seating_on_the_grid() -> None:
    slots = service_slots(SATURDAY, RESTAURANT)

    assert slots[0] == "16:00"
    assert slots[-1] == "21:00"
    # 16:00 to 21:00 inclusive in half hour steps.
    assert len(slots) == 11
    assert "19:30" in slots


def test_a_closed_day_has_no_slots_at_all() -> None:
    assert service_slots(MONDAY, RESTAURANT) == ()


def test_a_time_that_is_not_a_seating_is_an_error_not_a_booking() -> None:
    with pytest.raises(NotAServiceSlot):
        resolve(SATURDAY, "19:07", 2)

    with pytest.raises(NotAServiceSlot):
        resolve(MONDAY, "19:00", 2)

    with pytest.raises(NotAServiceSlot):
        resolve(SATURDAY, "23:00", 2)


# -- table choice ----------------------------------------------------------


def test_an_unprefixed_party_is_offered_a_standard_table_first() -> None:
    """Booths and patio are what customers ask for by name, so an unprefixed
    party should not spend them."""
    assert candidates(2, None)[0].id == "S1"
    assert candidates(4, None)[0].id == "S2"


def test_the_smallest_fitting_table_wins() -> None:
    assert choose_table(2, None, set()).id == "S1"
    assert choose_table(6, None, set()).seats == 6
    assert choose_table(8, None, set()).id == "S5"


def test_a_requested_type_is_honoured_strictly() -> None:
    assert choose_table(4, "booth", set()).type == "booth"
    assert choose_table(4, "patio", set()).type == "patio"


def test_a_party_bigger_than_every_table_has_no_alternatives_to_offer() -> None:
    assert candidates(LARGEST_TABLE + 1, None) == ()

    result = resolve(SATURDAY, "19:00", LARGEST_TABLE + 1)
    assert result.state == NO_TABLE
    assert result.table_id is None
    assert result.alternatives == ()


def test_a_type_that_cannot_seat_the_party_is_no_table_not_booked() -> None:
    """Six people on the patio: the largest patio table seats four. Saying
    "booked" would imply another time could work, and none can."""
    result = resolve(SATURDAY, "19:00", 6, "patio")

    assert result.state == NO_TABLE
    assert result.alternatives == ()


# -- booking and alternatives ---------------------------------------------


def test_a_free_slot_resolves_to_a_specific_table() -> None:
    result = resolve(SATURDAY, "19:00", 4)

    assert result.state == AVAILABLE
    assert result.table_id == "S2"


def test_a_bigger_table_can_serve_a_smaller_party() -> None:
    """`seats >= party`, not `seats == party`.

    A party of two is not confined to the two tops. Holding the three smallest
    tables therefore does not book a slot, and pretending otherwise would make the
    engine refuse bookings the room could plainly serve.
    """
    result = resolve(SATURDAY, "19:00", 2, occupied=occupying("S1", "B1", "P1"))

    assert result.state == AVAILABLE
    assert result.table_id == "S2"


def test_a_slot_is_booked_only_when_every_fitting_table_is_held() -> None:
    # Only the eight top seats eight, so holding it books the slot outright.
    free = resolve(SATURDAY, "19:00", 8)
    assert free.state == AVAILABLE
    assert free.table_id == "S5"

    # Held at 19:00 only, so the rest of the evening can still seat eight.
    full = resolve(
        SATURDAY,
        "19:00",
        8,
        occupied=lambda day, time: {"S5"} if time == "19:00" else set(),
    )
    assert full.state == BOOKED
    assert full.table_id is None
    assert [item.time for item in full.alternatives][:2] == ["19:30", "18:30"]


def test_alternatives_are_the_nearest_times_in_either_direction() -> None:
    offers = alternatives(
        day=SATURDAY,
        requested="19:00",
        party_size=8,
        type_=None,
        occupied_at=lambda day, time: {"S5"} if time == "19:00" else set(),
        restaurant=RESTAURANT,
    )

    times = [item.time for item in offers]
    assert times[:3] == ["19:30", "18:30", "20:00"]
    assert "19:00" not in times


def test_alternatives_stop_at_the_limit() -> None:
    offers = alternatives(
        day=SATURDAY,
        requested="19:00",
        party_size=2,
        type_=None,
        occupied_at=lambda day, time: {"S1", "B1", "P1"} if time == "19:00" else set(),
        restaurant=RESTAURANT,
        limit=3,
    )

    assert len(offers) == 3
    assert all(item.table_id for item in offers)


def test_alternatives_skip_times_that_are_also_full() -> None:
    def occupied(day: date, time: str) -> set[str]:
        return {"S5"} if time in {"19:00", "19:30"} else set()

    offers = alternatives(
        day=SATURDAY,
        requested="19:00",
        party_size=8,
        type_=None,
        occupied_at=occupied,
        restaurant=RESTAURANT,
    )

    times = [item.time for item in offers]
    assert "19:30" not in times
    assert times[0] == "18:30"


def test_a_booked_evening_offers_nothing_rather_than_inventing_a_time() -> None:
    every_slot = set(service_slots(SATURDAY, RESTAURANT))

    def occupied(day: date, time: str) -> set[str]:
        return {"S5"} if time in every_slot else set()

    result = resolve(SATURDAY, "19:00", 8, occupied=occupied)

    assert result.state == BOOKED
    assert result.alternatives == ()


# -- occupancy from the queue ---------------------------------------------


def test_a_pending_row_occupies_its_table(store: Store, saturday: date) -> None:
    """The customer was told the table was theirs at submission, so a row that
    nobody has approved yet still has to block the next customer."""
    slots = {
        "date": saturday.isoformat(),
        "time": "19:00",
        "party_size": 4,
        "name": "A",
        "email": "a@example.com",
        "phone": "4169999999",
    }
    first = store.insert_pending(
        submission_id="sub-1", session_id="session-1", slots=slots, table_id="S2"
    )
    assert first.status == "pending"

    taken = resolve(saturday, "19:00", 4, occupied=store.occupied_at())
    assert taken.state == AVAILABLE
    assert taken.table_id == "S3", "S2 is held, so the next fitting table is offered"

    # Only the eight top seats eight, so one pending row books that slot outright.
    store.insert_pending(
        submission_id="sub-2",
        session_id="session-2",
        slots={**slots, "party_size": 8},
        table_id="S5",
    )
    assert resolve(saturday, "19:00", 8, occupied=store.occupied_at()).state == BOOKED


def test_rejecting_releases_the_table(store: Store, saturday: date) -> None:
    store.insert_pending(
        submission_id="sub-1",
        session_id="session-1",
        slots={
            "date": saturday.isoformat(),
            "time": "19:00",
            "party_size": 8,
            "name": "A",
            "email": "a@example.com",
            "phone": "4169999999",
        },
        table_id="S5",
    )

    # Booked at this time, not unseatable: eight could still dine at 19:30.
    assert resolve(saturday, "19:00", 8, occupied=store.occupied_at()).state == BOOKED

    rejected = store.reject("sub-1")
    assert rejected is not None and rejected.status == "rejected"

    freed = resolve(saturday, "19:00", 8, occupied=store.occupied_at())
    assert freed.state == AVAILABLE
    assert freed.table_id == "S5"


def test_an_approved_row_keeps_occupying_through_official(store: Store, saturday: date) -> None:
    store.insert_pending(
        submission_id="sub-1",
        session_id="session-1",
        slots={
            "date": saturday.isoformat(),
            "time": "19:00",
            "party_size": 8,
            "name": "A",
            "email": "a@example.com",
            "phone": "4169999999",
        },
        table_id="S5",
    )
    approved = store.approve("sub-1")
    assert approved is not None and approved.status == "approved"

    # The row now lives in both relations, and must be counted once, not twice.
    assert store.occupied_tables(saturday, "19:00") == {"S5"}
    assert resolve(saturday, "19:00", 8, occupied=store.occupied_at()).state == BOOKED
    assert len(store.list_official()) == 1


def test_double_booking_is_detected_when_it_should_be_impossible(
    store: Store, saturday: date
) -> None:
    """Availability gates submission, so this list should stay empty. It exists
    because a table appearing here means something bypassed the gate."""
    slots = {
        "date": saturday.isoformat(),
        "time": "19:00",
        "party_size": 2,
        "name": "A",
        "email": "a@example.com",
        "phone": "4169999999",
    }
    store.insert_pending(submission_id="sub-1", session_id="s1", slots=slots, table_id="S1")
    assert store.double_booked() == []

    store.insert_pending(submission_id="sub-2", session_id="s2", slots=slots, table_id="S1")
    conflicts = store.double_booked()
    assert len(conflicts) == 1
    assert conflicts[0]["table_id"] == "S1"
    assert conflicts[0]["claims"] == 2


# -- what the room has free, for the "what do you have?" question ----------


def test_openings_cover_every_seating_of_an_open_day() -> None:
    result = openings(day=SATURDAY, occupied_at=nothing, restaurant=RESTAURANT)

    assert [item.time for item in result] == list(service_slots(SATURDAY, RESTAURANT))


def test_openings_can_be_read_by_seating_type() -> None:
    """The counts are what lets the agent answer "is a booth free at seven"
    without a second lookup, and without naming a table."""
    result = openings(
        day=SATURDAY, occupied_at=nothing, restaurant=RESTAURANT, party_size=4
    )

    assert result[0].by_type() == {"booth": 3, "patio": 2, "standard": 4}
    assert len(result[0].free) == 9


def test_openings_shrink_as_tables_are_held() -> None:
    result = openings(
        day=SATURDAY,
        occupied_at=occupying("S5"),
        restaurant=RESTAURANT,
        party_size=8,
    )

    assert result == (), "only the eight top seats eight, so holding it empties the day"


def test_openings_ignore_tables_that_cannot_seat_the_party() -> None:
    result = openings(
        day=SATURDAY, occupied_at=nothing, restaurant=RESTAURANT, party_size=8
    )

    assert len(result[0].free) == 1
    assert result[0].free[0].id == "S5"


def test_a_closed_day_has_no_openings() -> None:
    assert openings(day=MONDAY, occupied_at=nothing, restaurant=RESTAURANT) == ()


def test_openings_respect_what_the_queue_already_holds(
    store: Store, saturday: date
) -> None:
    """The same occupancy the submission gate reads, so the agent cannot offer a
    time that the queue has already taken."""
    store.insert_pending(
        submission_id="sub-1",
        session_id="session-1",
        slots={
            "date": saturday.isoformat(),
            "time": "19:00",
            "party_size": 8,
            "name": "A",
            "email": "a@example.com",
            "phone": "4169999999",
        },
        table_id="S5",
    )

    result = openings(
        day=saturday,
        occupied_at=store.occupied_at(),
        restaurant=RESTAURANT,
        party_size=8,
    )

    assert "19:00" not in [item.time for item in result]
    assert "19:30" in [item.time for item in result]
