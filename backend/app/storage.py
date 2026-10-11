"""SQLite storage for the HITL queue.

Two relations, as the brief specifies. `pending` holds everything the chatbot has
been asked to book, with a status column so a rejection can be marked rather than
deleted. `official` holds what staff approved.

Under this design a pending row already occupies its table, because the customer
was told the table was theirs the moment they confirmed. So occupancy reads
pending plus official, and a rejection is what releases a table. That is the only
part of this file that is not obvious, and it is the part that stops two customers
being handed the same booth.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"

# Statuses whose rows still hold a table.
HOLDING = (PENDING, APPROVED)

_PENDING_DDL = """
CREATE TABLE IF NOT EXISTS pending (
    submission_id    TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    date             TEXT NOT NULL,
    time             TEXT NOT NULL,
    party_size       INTEGER NOT NULL,
    table_id         TEXT NOT NULL,
    table_type       TEXT NOT NULL,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL,
    phone            TEXT NOT NULL,
    special_requests TEXT,
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TEXT NOT NULL,
    decided_at       TEXT
)
"""

_OFFICIAL_DDL = """
CREATE TABLE IF NOT EXISTS official (
    submission_id    TEXT PRIMARY KEY,
    session_id       TEXT NOT NULL,
    date             TEXT NOT NULL,
    time             TEXT NOT NULL,
    party_size       INTEGER NOT NULL,
    table_id         TEXT NOT NULL,
    table_type       TEXT NOT NULL,
    name             TEXT NOT NULL,
    email            TEXT NOT NULL,
    phone            TEXT NOT NULL,
    special_requests TEXT,
    approved_at      TEXT NOT NULL
)
"""

# Indexes the occupancy query depends on. Without them every availability check
# is a full scan of both tables, which is invisible at demo size and unbearable
# at any other size.
_INDEXES = (
    "CREATE INDEX IF NOT EXISTS idx_pending_slot ON pending(date, time, status)",
    "CREATE INDEX IF NOT EXISTS idx_official_slot ON official(date, time)",
)

_COLUMNS = (
    "submission_id",
    "session_id",
    "date",
    "time",
    "party_size",
    "table_id",
    "table_type",
    "name",
    "email",
    "phone",
    "special_requests",
)


@dataclass(frozen=True)
class Reservation:
    submission_id: str
    session_id: str
    date: str
    time: str
    party_size: int
    table_id: str
    table_type: str
    name: str
    email: str
    phone: str
    special_requests: str | None
    status: str
    created_at: str
    decided_at: str | None

    def as_dict(self) -> dict[str, Any]:
        return {
            "submission_id": self.submission_id,
            "session_id": self.session_id,
            "date": self.date,
            "time": self.time,
            "party_size": self.party_size,
            "table_id": self.table_id,
            "table_type": self.table_type,
            "name": self.name,
            "email": self.email,
            "phone": self.phone,
            "special_requests": self.special_requests,
            "status": self.status,
            "created_at": self.created_at,
            "decided_at": self.decided_at,
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Store:
    """A connection per operation.

    SQLite connections are not safe to share across threads, and FastAPI runs sync
    handlers in a threadpool. Opening per call is the cheapest correct answer at
    this scale, and it means no connection lifetime to reason about.
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_schema(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute(_PENDING_DDL)
            connection.execute(_OFFICIAL_DDL)
            for statement in _INDEXES:
                connection.execute(statement)
            connection.commit()

    # -- writes -------------------------------------------------------------

    def insert_pending(
        self, *, submission_id: str, session_id: str, slots: dict[str, Any], table_id: str
    ) -> Reservation:
        created = _now()
        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO pending (
                    submission_id, session_id, date, time, party_size, table_id,
                    table_type, name, email, phone, special_requests, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    submission_id,
                    session_id,
                    slots["date"],
                    slots["time"],
                    slots["party_size"],
                    table_id,
                    slots.get("type") or "standard",
                    slots["name"],
                    slots["email"],
                    slots["phone"],
                    slots.get("special_requests"),
                    PENDING,
                    created,
                ),
            )
            connection.commit()

        return Reservation(
            submission_id=submission_id,
            session_id=session_id,
            date=slots["date"],
            time=slots["time"],
            party_size=slots["party_size"],
            table_id=table_id,
            table_type=slots.get("type") or "standard",
            name=slots["name"],
            email=slots["email"],
            phone=slots["phone"],
            special_requests=slots.get("special_requests"),
            status=PENDING,
            created_at=created,
            decided_at=None,
        )

    def approve(self, submission_id: str) -> Reservation | None:
        """Move a pending row to official. Sends no message: the customer was told
        they were booked at submission, so silence here is correct, not an omission.
        """
        decided = _now()
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM pending WHERE submission_id = ? AND status = ?",
                (submission_id, PENDING),
            ).fetchone()
            if row is None:
                return None

            connection.execute(
                f"""
                INSERT OR REPLACE INTO official ({", ".join(_COLUMNS)}, approved_at)
                VALUES ({", ".join("?" for _ in _COLUMNS)}, ?)
                """,
                tuple(row[column] for column in _COLUMNS) + (decided,),
            )
            connection.execute(
                "UPDATE pending SET status = ?, decided_at = ? WHERE submission_id = ?",
                (APPROVED, decided, submission_id),
            )
            connection.commit()

        return self.get(submission_id)

    def reject(self, submission_id: str) -> Reservation | None:
        """Mark rejected, which releases the table. This is the only decision that
        contacts the customer.
        """
        decided = _now()
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "UPDATE pending SET status = ?, decided_at = ? WHERE submission_id = ? AND status = ?",
                (REJECTED, decided, submission_id, PENDING),
            )
            connection.commit()
            if cursor.rowcount == 0:
                return None

        return self.get(submission_id)

    def reset(self) -> None:
        """Wipe both tables. Exists for demo reruns and is not linked from the UI."""
        with closing(self._connect()) as connection:
            connection.execute("DELETE FROM pending")
            connection.execute("DELETE FROM official")
            connection.commit()

    # -- reads --------------------------------------------------------------

    def get(self, submission_id: str) -> Reservation | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM pending WHERE submission_id = ?", (submission_id,)
            ).fetchone()
        return _to_reservation(row) if row is not None else None

    def find_active_by_session(self, session_id: str) -> Reservation | None:
        """The live booking for a browser session, if there is one.

        Makes submission idempotent on the server rather than relying only on the
        browser's latch: a double click, a retried request after a dropped
        connection, or two tabs sharing storage all end up returning the same row
        instead of writing two bookings for one customer.
        """
        holding = ", ".join("?" for _ in HOLDING)
        with closing(self._connect()) as connection:
            row = connection.execute(
                f"""
                SELECT * FROM pending
                WHERE session_id = ? AND status IN ({holding})
                ORDER BY created_at DESC LIMIT 1
                """,
                (session_id, *HOLDING),
            ).fetchone()
        return _to_reservation(row) if row is not None else None

    def list_pending(self, statuses: tuple[str, ...] = (PENDING,)) -> list[Reservation]:
        if not statuses:
            return []
        placeholders = ", ".join("?" for _ in statuses)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"""
                SELECT * FROM pending
                WHERE status IN ({placeholders})
                ORDER BY created_at DESC, submission_id
                """,
                statuses,
            ).fetchall()
        return [_to_reservation(row) for row in rows]

    def list_official(self) -> list[Reservation]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT *, 'approved' AS status, approved_at AS created_at,
                       approved_at AS decided_at
                FROM official ORDER BY approved_at DESC, submission_id
                """
            ).fetchall()
        return [_to_reservation(row) for row in rows]

    def occupied_tables(self, day: date, time: str) -> set[str]:
        """Every table held at one seating, by pending and official rows alike."""
        iso = day.isoformat()
        holding = ", ".join("?" for _ in HOLDING)
        with closing(self._connect()) as connection:
            held = connection.execute(
                f"SELECT table_id FROM pending WHERE date = ? AND time = ? AND status IN ({holding})",
                (iso, time, *HOLDING),
            ).fetchall()
            official = connection.execute(
                "SELECT table_id FROM official WHERE date = ? AND time = ?",
                (iso, time),
            ).fetchall()

        return {row["table_id"] for row in held} | {row["table_id"] for row in official}

    def occupied_at(self):
        """The callable the availability engine wants."""

        def lookup(day: date, time: str) -> set[str]:
            return self.occupied_tables(day, time)

        return lookup

    def double_booked(self) -> list[dict[str, Any]]:
        """Slots where more than one booking claims the same table.

        Should be unreachable while availability gates submission, and that is
        exactly why the admin screen shows it: a table appearing here means
        something bypassed the gate, which is worth seeing rather than discovering
        from an unhappy customer.

        Counted by distinct submission id, not by row. An approved booking exists in
        both relations at once, so counting rows would flag every single approval as
        a conflict, and a warning that cries wolf is worse than no warning.
        """
        holding = ", ".join("?" for _ in HOLDING)
        with closing(self._connect()) as connection:
            rows = connection.execute(
                f"""
                SELECT date, time, table_id,
                       COUNT(DISTINCT submission_id) AS claims
                FROM (
                    SELECT submission_id, date, time, table_id
                    FROM pending WHERE status IN ({holding})
                    UNION ALL
                    SELECT submission_id, date, time, table_id
                    FROM official
                )
                GROUP BY date, time, table_id
                HAVING claims > 1
                ORDER BY date, time
                """,
                HOLDING,
            ).fetchall()

        return [dict(row) for row in rows]


def _to_reservation(row: sqlite3.Row) -> Reservation:
    return Reservation(
        submission_id=row["submission_id"],
        session_id=row["session_id"],
        date=row["date"],
        time=row["time"],
        party_size=row["party_size"],
        table_id=row["table_id"],
        table_type=row["table_type"],
        name=row["name"],
        email=row["email"],
        phone=row["phone"],
        special_requests=row["special_requests"],
        status=row["status"],
        created_at=row["created_at"],
        decided_at=row["decided_at"],
    )
