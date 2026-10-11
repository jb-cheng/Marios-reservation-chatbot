"""The room, as data.

Twelve tables, eight seats maximum. Changing the restaurant's layout is changing
this list: no migration, no seeding step, no seating admin screen. The alternative
was a `tables` relation, and a demo that shows a chatbot filling slots gains
nothing from a join it has to explain first.

`seats` is a hard cap rather than a comfort preference, so a party of six may be
offered the six top but never the four top.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Table:
    id: str
    seats: int
    type: str


TABLES: tuple[Table, ...] = (
    Table("B1", 2, "booth"),
    Table("B2", 4, "booth"),
    Table("B3", 4, "booth"),
    Table("B4", 6, "booth"),
    Table("P1", 2, "patio"),
    Table("P2", 4, "patio"),
    Table("P3", 4, "patio"),
    Table("S1", 2, "standard"),
    Table("S2", 4, "standard"),
    Table("S3", 4, "standard"),
    Table("S4", 6, "standard"),
    Table("S5", 8, "standard"),
)

LARGEST_TABLE = max(table.seats for table in TABLES)

# When a party has no seating preference, standard tables are offered first.
# Booths and patio are the seats customers ask for by name, so spending them on
# someone who did not ask leaves nothing for the guest who did.
TYPE_RANK = {"standard": 0, "booth": 1, "patio": 2}


def candidates(party_size: int, type_: str | None) -> tuple[Table, ...]:
    """Tables that could seat this party, best fit first.

    Ordering by seats is what keeps a party of two off the eight top. A requested
    type is honoured strictly: if the customer asked for the patio and no patio
    table fits, the answer is that it is unavailable, not a silent swap to
    somewhere they did not ask for.
    """
    fitting = [
        table
        for table in TABLES
        if table.seats >= party_size and (type_ is None or table.type == type_)
    ]
    return tuple(
        sorted(
            fitting,
            key=lambda table: (table.seats, TYPE_RANK.get(table.type, 9), table.id),
        )
    )
