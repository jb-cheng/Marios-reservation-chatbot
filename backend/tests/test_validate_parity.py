"""Parity with the browser's copy of the same rules.

The rules exist in two languages on purpose. This suite is what makes that safe:
it asserts the Python implementation against the same shared table the TypeScript
suite asserts against, so a change to one side that is not mirrored breaks a test
rather than silently diverging in production.
"""

from __future__ import annotations

from datetime import date

from app.config import build_restaurant
from app.validate import coerce, is_valid, parse_iso_date, sanitize


def test_backend_matches_the_shared_case_table(shared: dict) -> None:
    restaurant = build_restaurant("Mario's")
    today = date.fromisoformat(shared["today"])

    failures: list[str] = []
    for case in shared["cases"]:
        value = coerce(case["key"], case["value"])
        slot_date = parse_iso_date(case["date"]) if case.get("date") else None
        actual = is_valid(
            case["key"],
            value,
            today=today,
            slot_date=slot_date,
            restaurant=restaurant,
        )
        if actual is not case["valid"]:
            failures.append(
                f"{case['key']}={case['value']!r} date={case.get('date')!r}: "
                f"expected {case['valid']}, got {actual} ({case.get('note', '')})"
            )

    assert not failures, "\n".join(failures)


def test_shared_config_still_describes_the_real_restaurant(shared: dict) -> None:
    """Guards the table itself.

    If someone edits the hours in config.py and not in the shared JSON, every
    parity assertion would keep passing against a stale fixture. This is the test
    that catches that.
    """
    restaurant = build_restaurant()
    config = shared["config"]

    assert restaurant.slot_minutes == config["slot_minutes"]
    assert restaurant.max_days_ahead == config["max_days_ahead"]
    assert restaurant.party_min == config["party_min"]
    assert restaurant.party_max == config["party_max"]
    assert restaurant.open_hours[config["closed_weekday"]] is None

    window = restaurant.open_hours["sat"]
    assert window is not None
    assert window.open == config["open"]
    assert window.last_seating == config["last_seating"]


def test_sanitize_drops_invalid_slots_and_keeps_valid_ones() -> None:
    restaurant = build_restaurant()
    today = date(2026, 10, 10)

    cleaned = sanitize(
        {
            "date": "2026-10-11",
            "time": "19:00",
            "party_size": 4,
            "type": "  BOOTH ",
            "name": "  jean   ben ",
            "email": "not an address",
            "phone": "+1 (416) 999-9999",
            "special_requests": "birthday",
            "is_vip": True,
        },
        today=today,
        restaurant=restaurant,
    )

    assert cleaned == {
        "date": "2026-10-11",
        "time": "19:00",
        "party_size": 4,
        "type": "booth",
        "name": "jean ben",
        "phone": "14169999999",
        "special_requests": "birthday",
    }


def test_sanitize_checks_a_time_against_the_date_in_the_same_payload() -> None:
    """Date is processed before time, so a Monday 19:00 arriving in one turn is
    still refused rather than slipping through for lack of a weekday.
    """
    restaurant = build_restaurant()
    today = date(2026, 10, 10)

    monday = sanitize(
        {"date": "2026-10-12", "time": "19:00"}, today=today, restaurant=restaurant
    )
    assert monday == {"date": "2026-10-12"}

    saturday = sanitize(
        {"date": "2026-10-10", "time": "19:00"}, today=today, restaurant=restaurant
    )
    assert saturday == {"date": "2026-10-10", "time": "19:00"}


def test_a_boolean_is_not_a_party_of_one() -> None:
    restaurant = build_restaurant()
    cleaned = sanitize({"party_size": True}, today=date(2026, 10, 10), restaurant=restaurant)
    assert cleaned == {}
