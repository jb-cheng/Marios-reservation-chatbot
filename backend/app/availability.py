"""Availability, computed rather than recalled.

The model never decides whether a table is free. It is handed the answer as fact,
and can only repeat times this module produced. That is the difference between a
reservation agent that is usually right and one that is confidently wrong.

Occupancy is injected as `occupied_at(day, time) -> set of table ids`, so the
same code serves the prompt, the submission gate, the admin conflict view and the
tests, and so the tests do not need a database.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import date

from .config import Restaurant
from .floor_plan import TABLES, Table, candidates
from .validate import format_minutes, minutes_from_midnight, parse_iso_date, weekday_name

OccupiedAt = Callable[[date, str], set[str]]

AVAILABLE = "available"
BOOKED = "booked"
NO_TABLE = "no_table"


@dataclass(frozen=True)
class Alternative:
    time: str
    table_id: str
    seats: int
    type: str

    def as_dict(self) -> dict:
        return {
            "time": self.time,
            "table_id": self.table_id,
            "seats": self.seats,
            "type": self.type,
        }


@dataclass(frozen=True)
class SlotStatus:
    date: str
    time: str
    party_size: int
    type: str | None
    state: str
    table_id: str | None
    alternatives: tuple[Alternative, ...]
    # Tables held at this time, by seating type. Empty for NO_TABLE means occupancy
    # was never queried, not that the room is empty, so the renderer omits the line
    # there rather than reporting a zero. Deliberately absent from `as_dict()`: the
    # browser's contract is unchanged.
    held: dict[str, int]

    def as_dict(self) -> dict:
        return {
            "date": self.date,
            "time": self.time,
            "party_size": self.party_size,
            "type": self.type,
            "state": self.state,
            "table_id": self.table_id,
            "alternatives": [item.as_dict() for item in self.alternatives],
        }


class NotAServiceSlot(ValueError):
    """Raised for a date and time the restaurant is not open to seat anyone.

    A distinct type rather than a bare ValueError so callers can tell "your input
    was nonsense" from "a table is taken", which need different replies.
    """


def service_slots(day: date, restaurant: Restaurant) -> tuple[str, ...]:
    """Every seating time that day, on the slot grid, up to last seating."""
    window = restaurant.open_hours.get(weekday_name(day))
    if window is None:
        return ()

    opening = minutes_from_midnight(window.open)
    last_seating = minutes_from_midnight(window.last_seating)
    if opening is None or last_seating is None:
        return ()

    step = restaurant.slot_minutes
    return tuple(
        format_minutes(minutes)
        for minutes in range(opening, last_seating + 1, step)
    )


def is_service_slot(day: date, time: str, restaurant: Restaurant) -> bool:
    return time in service_slots(day, restaurant)


def choose_table(
    party_size: int, type_: str | None, occupied: Iterable[str]
) -> Table | None:
    """The smallest fitting free table, or None.

    Smallest first is what stops a party of two from consuming the eight top,
    which matters because the room is twelve tables and the demo books several of
    them.
    """
    taken = set(occupied)
    for table in candidates(party_size, type_):
        if table.id not in taken:
            return table
    return None


def held_by_type(occupied: Iterable[str]) -> dict[str, int]:
    """How many tables are held at one time, grouped by seating type.

    Counts and never identifiers, because the model is forbidden from naming or
    promising a table, and a count is what "is anybody else booked then" needs.
    """
    taken = set(occupied)
    counts: dict[str, int] = {}
    for table in TABLES:
        if table.id in taken:
            counts[table.type] = counts.get(table.type, 0) + 1
    return counts


def alternatives(
    *,
    day: date,
    requested: str,
    party_size: int,
    type_: str | None,
    occupied_at: OccupiedAt,
    restaurant: Restaurant,
    limit: int = 3,
) -> tuple[Alternative, ...]:
    """Up to `limit` nearby openings, nearest first.

    Nearest is by clock distance in either direction, so a 19:00 request that is
    full offers 19:30 before 18:30. Times the engine did not produce never appear
    here, which is the guarantee the prompt relies on.
    """
    wanted = minutes_from_midnight(requested)
    if wanted is None:
        return ()

    ordered: list[tuple[int, int, str]] = []
    for slot in service_slots(day, restaurant):
        minutes = minutes_from_midnight(slot)
        if minutes is None or minutes == wanted:
            continue
        ordered.append((abs(minutes - wanted), -minutes, slot))
    # Nearest first, and on a tie the later time wins: a guest who cannot make
    # seven can usually make half past, while moving earlier means leaving sooner.
    ordered.sort()

    found: list[Alternative] = []
    for _, _, slot in ordered:
        table = choose_table(party_size, type_, occupied_at(day, slot))
        if table is None:
            continue
        found.append(
            Alternative(
                time=slot, table_id=table.id, seats=table.seats, type=table.type
            )
        )
        if len(found) >= limit:
            break

    return tuple(found)


@dataclass(frozen=True)
class Opening:
    """One seating time that still has room, and what is free at it."""

    time: str
    free: tuple[Table, ...]

    def by_type(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for table in self.free:
            counts[table.type] = counts.get(table.type, 0) + 1
        return counts

    def as_dict(self) -> dict:
        return {"time": self.time, "free": len(self.free), "by_type": self.by_type()}


def openings(
    *,
    day: date,
    occupied_at: OccupiedAt,
    restaurant: Restaurant,
    party_size: int | None = None,
    type_: str | None = None,
) -> tuple[Opening, ...]:
    """Every seating time that day which can still serve this party.

    This exists because the requested-slot view alone cannot answer "what do you
    have free on Saturday". Without it the model has no data for that question, and
    a model with no data either stalls or makes something up.

    `party_size` defaults to one, meaning "show the room as it stands". A closed day
    returns an empty tuple rather than raising, because "nothing is free" and "we are
    not open" both deserve a plain answer.
    """
    size = party_size if party_size is not None else 1
    result: list[Opening] = []

    for slot in service_slots(day, restaurant):
        taken = occupied_at(day, slot)
        free = tuple(
            table for table in candidates(size, type_) if table.id not in taken
        )
        if free:
            result.append(Opening(time=slot, free=free))

    return tuple(result)


def status(
    *,
    day: date,
    time: str,
    party_size: int,
    type_: str | None,
    occupied_at: OccupiedAt,
    restaurant: Restaurant,
    limit: int = 3,
) -> SlotStatus:
    """Resolve one requested seating.

    Raises NotAServiceSlot when the restaurant is closed that day or the time is
    not on the grid, because answering "booked" for a slot that does not exist
    would be a lie of exactly the kind this module exists to prevent.
    """
    iso = day.isoformat()

    if not candidates(party_size, type_):
        # Nothing in the room can serve this party at any time, so there is
        # nothing to offer as an alternative either.
        return SlotStatus(
            date=iso,
            time=time,
            party_size=party_size,
            type=type_,
            state=NO_TABLE,
            table_id=None,
            alternatives=(),
            held={},
        )

    if not is_service_slot(day, time, restaurant):
        raise NotAServiceSlot(f"{iso} {time} is not a seating time")

    occupied = occupied_at(day, time)
    table = choose_table(party_size, type_, occupied)
    if table is not None:
        return SlotStatus(
            date=iso,
            time=time,
            party_size=party_size,
            type=type_,
            state=AVAILABLE,
            table_id=table.id,
            alternatives=(),
            held=held_by_type(occupied),
        )

    return SlotStatus(
        date=iso,
        time=time,
        party_size=party_size,
        type=type_,
        state=BOOKED,
        table_id=None,
        held=held_by_type(occupied),
        alternatives=alternatives(
            day=day,
            requested=time,
            party_size=party_size,
            type_=type_,
            occupied_at=occupied_at,
            restaurant=restaurant,
            limit=limit,
        ),
    )


def status_from_strings(
    *,
    date_text: str,
    time_text: str,
    party_size: int,
    type_: str | None,
    occupied_at: OccupiedAt,
    restaurant: Restaurant,
    limit: int = 3,
) -> SlotStatus | None:
    """Convenience wrapper for callers holding raw slot strings.

    Returns None when the date does not parse, which lets a half-filled draft skip
    the availability lookup instead of raising on it.
    """
    day = parse_iso_date(date_text)
    if day is None:
        return None

    return status(
        day=day,
        time=time_text,
        party_size=party_size,
        type_=type_,
        occupied_at=occupied_at,
        restaurant=restaurant,
        limit=limit,
    )
