"""Server-side mirror of the browser's slot rules.

The duplication is deliberate and the two files are `frontend/src/state/validation.ts`
and this one. The browser's copy protects memory from a hallucinated slot; this
copy protects the queue and the availability engine from a request that was never
validated, because neither can be assumed to have run.

What keeps the copies honest is `shared/validation-cases.json`: one table of
inputs and expected outcomes that both test suites assert against. A rule that
drifts in one language fails in the other.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Mapping

from .config import Restaurant

ISO_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
HHMM = re.compile(r"^(\d{1,2}):(\d{2})$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")


def parse_iso_date(value: Any) -> date | None:
    """Strict calendar parsing. `2026-02-30` is not a date, it is a hallucination."""
    if not isinstance(value, str):
        return None
    match = ISO_DATE.match(value.strip())
    if match is None:
        return None
    try:
        return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def weekday_name(value: date) -> str:
    """Monday is "mon", matching the keys of OPEN_HOURS."""
    return ("mon", "tue", "wed", "thu", "fri", "sat", "sun")[value.weekday()]


def minutes_from_midnight(value: Any) -> int | None:
    if not isinstance(value, str):
        return None
    match = HHMM.match(value.strip())
    if match is None:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2))
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def format_minutes(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def coerce(key: str, value: Any) -> Any:
    """Normalise into the form state stores, before validation sees it.

    The brief defines phone as "strips to digits", which is a transform, so it
    lives here rather than hiding inside a boolean check.
    """
    if key == "phone":
        return re.sub(r"\D", "", str(value))
    if key == "type" and isinstance(value, str):
        return value.strip().lower()
    if key in {"name", "special_requests"} and isinstance(value, str):
        return re.sub(r"\s+", " ", value).strip()
    return value


def is_valid(
    key: str,
    value: Any,
    *,
    today: date,
    slot_date: date | None,
    restaurant: Restaurant,
) -> bool:
    if key == "date":
        return _valid_date(value, today=today, restaurant=restaurant)
    if key == "time":
        return _valid_time(value, slot_date=slot_date, restaurant=restaurant)
    if key == "party_size":
        if isinstance(value, bool) or not isinstance(value, int):
            return False
        return restaurant.party_min <= value <= restaurant.party_max
    if key == "email":
        return (
            isinstance(value, str)
            and len(value) <= 254
            and EMAIL.match(value.strip()) is not None
        )
    if key == "phone":
        return isinstance(value, str) and 10 <= len(value) <= 15
    if key == "type":
        return isinstance(value, str) and value in restaurant.table_types
    if key in {"name", "special_requests"}:
        return isinstance(value, str) and 0 < len(value) <= 200
    return False


def _valid_date(value: Any, *, today: date, restaurant: Restaurant) -> bool:
    parsed = parse_iso_date(value)
    if parsed is None:
        return False
    if parsed < today:
        return False
    return parsed <= today + timedelta(days=restaurant.max_days_ahead)


def _valid_time(
    value: Any, *, slot_date: date | None, restaurant: Restaurant
) -> bool:
    minutes = minutes_from_midnight(value)
    if minutes is None:
        return False
    if minutes % restaurant.slot_minutes != 0:
        return False

    # Without a date the weekday is unknown, so the format and grid rules hold and
    # the opening hours rule is deferred to the submission check, which always has
    # both.
    if slot_date is None:
        return True

    window = restaurant.open_hours.get(weekday_name(slot_date))
    if window is None:
        return False

    opening = minutes_from_midnight(window.open)
    last_seating = minutes_from_midnight(window.last_seating)
    if opening is None or last_seating is None:
        return False

    return opening <= minutes <= last_seating


def sanitize(
    slots: Mapping[str, Any], *, today: date, restaurant: Restaurant
) -> dict[str, Any]:
    """Drop every slot that fails validation, returning only what may be trusted.

    Rejections are silent by design. Telling the model a value was refused invites
    it to argue; leaving the slot empty makes it ask again next turn.
    """
    accepted: dict[str, Any] = {}
    current_date: date | None = None

    # slot_keys rather than slot_order: the asking order omits `type`, and a
    # seating preference is still a slot that has to be sanitised. Date precedes
    # time in that tuple, which is what lets a time be checked against the day it
    # belongs to even when both arrive in the same turn.
    for key in restaurant.slot_keys:
        if key not in slots:
            continue
        raw = slots[key]
        if raw is None:
            continue

        value = coerce(key, raw)
        if not is_valid(
            key, value, today=today, slot_date=current_date, restaurant=restaurant
        ):
            continue

        accepted[key] = value
        if key == "date":
            current_date = parse_iso_date(value)

    return accepted
