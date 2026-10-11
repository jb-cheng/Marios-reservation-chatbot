"""A deterministic provider, so the whole system is testable with no network.

This is a test double and a demo fallback, not a rival to Command A+. It exists
for three reasons: every acceptance criterion becomes a unit test instead of a
coin flip against a live model, the demo still works when campus wifi does not,
and the merge and availability layers get exercised against output that cannot
vary between runs.

It follows the same contract as the real providers and the same rules the system
prompt states: only fill a slot the user actually provided, never invent one, and
when a requested seating is full, offer the alternatives the server computed
instead of guessing at times.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from .availability import BOOKED, NO_TABLE, Opening, SlotStatus
from .config import Restaurant
from .floor_plan import LARGEST_TABLE
from .prompts import asks_about_availability
from .schemas import AgentOutput, ChatMessage, SlotValues
from .validate import minutes_from_midnight, parse_iso_date

WORD_NUMBERS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12,
}

WEEKDAY_INDEX = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
    "friday": 4, "saturday": 5, "sunday": 6,
}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}
for _short, _full in (
    ("jan", "january"), ("feb", "february"), ("mar", "march"), ("apr", "april"),
    ("jun", "june"), ("jul", "july"), ("aug", "august"), ("sep", "september"),
    ("sept", "september"), ("oct", "october"), ("nov", "november"), ("dec", "december"),
):
    MONTHS[_short] = MONTHS[_full]

CORRECTION_MARKERS = (
    "actually", "make it", "change", "instead", "no,", "not ", "correction",
    "i meant", "sorry,", "rather",
)

CONFIRMATIONS = (
    "yes", "yeah", "yep", "yup", "confirm", "book it", "book that", "that works",
    "go ahead", "perfect", "sounds good", "do it", "sure", "absolutely",
    "looks good", "ok", "okay", "great",
)

TYPE_WORDS = {
    "booth": "booth", "booths": "booth",
    "patio": "patio", "outside": "patio", "terrace": "patio", "al fresco": "patio",
    "standard": "standard", "regular": "standard", "normal": "standard",
    "inside": "standard",
}

# Questions the agent is allowed to answer from restaurant facts rather than from
# imagination. Each entry maps a trigger to the fact key it answers from.
OFF_TOPIC = (
    ("patio", "patio"), ("outside", "patio"),
    ("open", "hours"), ("hours", "hours"), ("close", "hours"), ("when are you", "hours"),
    ("dress", "dress_code"), ("jacket", "dress_code"), ("wear", "dress_code"),
    ("park", "parking"),
    ("menu", "cuisine"), ("cuisine", "cuisine"), ("food", "cuisine"), ("serve", "cuisine"),
    ("cancel", "cancellation"),
    ("kid", "children"), ("child", "children"), ("high chair", "children"),
    ("address", "address"), ("where are you", "address"), ("location", "address"),
    ("phone", "phone"), ("number", "phone"),
    ("large group", "large_party"), ("big group", "large_party"),
)

SPECIAL_REQUEST_TRIGGERS = (
    "birthday", "anniversary", "allerg", "gluten", "vegetarian", "vegan",
    "wheelchair", "high chair", "stroller", "celebrat", "proposal", "engagement",
    "quiet", "baby",
)

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{8,}\d)")
EXPLICIT_DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")

# Trigger and value are separate patterns on purpose. The trigger is matched
# without regard to case, because "Under Jean" starts a sentence and "under Jean"
# does not, while the value still has to look like a proper noun. One combined
# case-insensitive pattern would have accepted "under jean" and stored a name in
# the wrong case, or rejected the capitalised form entirely, which is what it did.
NAME_TRIGGER_RE = re.compile(
    r"\b(?:my name is|i\s?am|i'm|name is|under the name|under|it's|its|this is)\s+",
    re.IGNORECASE,
)
NAME_VALUE_RE = re.compile(r"([A-Z][\w'’-]*(?:\s+[A-Z][\w'’-]*){0,2})")
MONTH_DAY_RE = re.compile(
    r"\b(?:" + "|".join(sorted(MONTHS, key=len, reverse=True)) + r")\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b"
)
DAY_OF_MONTH_RE = re.compile(r"\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b")
CLOCK_RE = re.compile(r"\b(\d{1,2}):(\d{2})\s*(am|pm)?\b")
HOUR_AMPM_RE = re.compile(r"\b(\d{1,2})\s*(am|pm)\b")
# "at 7", "around 7:20", "about 19:00". Deliberately not "for": in "table for 4"
# that number is a head count, and reading it as four o'clock would invent a time
# the customer never said. "for 7pm" is still caught by the am/pm pattern.
AT_TIME_RE = re.compile(r"\b(?:at|around|about)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b")

# A correction usually drops the noun: "actually make it 6" says nothing about
# parties. So a bare number is only read as a party size behind a correction
# marker, and never when it is really a time.
CORRECTION_NUMBER_RE = re.compile(
    r"\b(?:make it|change it to|change to|actually|instead|no,|not)\s*"
    r"(\d{1,2})(?!\s*(?:am|pm|:|o'clock))"
)

# Words that follow a name trigger but are not names.
NOT_NAMES = {
    "looking", "looking for", "not sure", "here", "sorry", "trying",
    "wondering", "after", "calling", "booking",
}


@dataclass
class _Extraction:
    slots: dict[str, Any]
    correction_marker: bool
    off_topic_key: str | None
    confirmed: bool
    asks_availability: bool


class FakeProvider:
    """Rule-based extraction. No randomness, no clock reads, no network."""

    name = "fake"

    def __init__(self, restaurant: Restaurant) -> None:
        self.restaurant = restaurant

    async def complete(
        self,
        system: str,
        messages: list[ChatMessage],
        schema: dict[str, Any],
        *,
        state: SlotValues | None = None,
        availability: SlotStatus | None = None,
        openings: tuple[Opening, ...] | None = None,
        today: date | None = None,
    ) -> AgentOutput:
        current = state.model_dump() if state is not None else {}
        today = today or date.today()
        text = messages[-1].content if messages else ""
        found = self._extract(text, today=today)

        slots = {key: value for key, value in current.items() if value is not None}
        slots.update(found.slots)

        changed = self._changed(current, found)

        # A full slot is not a bookable slot. The server already computed what is
        # genuinely free, so the alternatives come from there and the requested
        # time is dropped rather than repeated back as if it were available.
        booked = availability is not None and availability.state == BOOKED
        if booked:
            slots.pop("time", None)
            changed = [key for key in changed if key != "time"]

        if availability is not None and availability.state == NO_TABLE:
            slots.pop("time", None)
            changed = [key for key in changed if key != "time"]

        complete = all(
            slots.get(key) is not None for key in self.restaurant.required_slots
        )
        submit = bool(found.confirmed and complete and not booked)

        reply = self._reply(
            found,
            slots,
            changed,
            availability=availability,
            openings=openings,
            complete=complete,
            submit=submit,
        )

        return AgentOutput(
            reply=reply,
            slots=SlotValues(**{key: slots.get(key) for key in SlotValues.model_fields}),
            changed=changed,
            submit=submit,
        )

    # -- extraction ---------------------------------------------------------

    def _extract(self, text: str, *, today: date) -> _Extraction:
        lower = text.lower()
        slots: dict[str, Any] = {}

        # "Do you have a patio?" is a question about the room, not a request for a
        # table on it. Without this, every off-topic question that mentions a
        # seating type would silently fill the preference slot.
        question = self._is_question(lower)
        correction = any(marker in lower for marker in CORRECTION_MARKERS)

        party = self._party_size(lower, correction=correction)
        if party is not None:
            slots["party_size"] = party

        found_date = self._date(lower, today=today)
        if found_date is not None:
            slots["date"] = found_date

        found_time = self._time(lower)
        if found_time is not None:
            slots["time"] = found_time

        if not question:
            for word, table_type in TYPE_WORDS.items():
                if re.search(rf"\b{re.escape(word)}\b", lower):
                    slots["type"] = table_type
                    break

        name = self._name(text)
        if name is not None:
            slots["name"] = name

        email = EMAIL_RE.search(text)
        if email is not None:
            slots["email"] = email.group(0)

        phone = PHONE_RE.search(text)
        if phone is not None:
            slots["phone"] = phone.group(0)

        requests = [
            trigger for trigger in SPECIAL_REQUEST_TRIGGERS if trigger in lower
        ]
        if requests:
            slots["special_requests"] = ", ".join(sorted(set(requests)))

        off_topic = None
        for trigger, fact_key in OFF_TOPIC:
            if trigger in lower:
                off_topic = fact_key
                break

        confirmed = any(
            re.search(rf"\b{re.escape(word)}\b", lower) for word in CONFIRMATIONS
        )

        return _Extraction(
            slots=slots,
            correction_marker=correction,
            off_topic_key=off_topic,
            confirmed=confirmed,
            asks_availability=asks_about_availability(lower),
        )

    @staticmethod
    def _is_question(lower: str) -> bool:
        if lower.strip().endswith("?"):
            return True
        return re.match(
            r"^(do|does|did|is|are|was|were|can|could|will|would|what|where|when|why|how|which)\b",
            lower.strip(),
        ) is not None

    def _party_size(self, lower: str, *, correction: bool = False) -> int | None:
        # Every pattern here is party shaped. A bare "any number in the sentence"
        # rule would read "table for two at 7" as a party of seven, and would take a
        # street number or a time for a head count.
        not_a_time = r"(?!\s*(?:am|pm|:|\d|o'clock))"
        patterns = (
            r"\btable for (\d+)",
            r"\bparty of (\d+)",
            r"\bfor (\d+) (?:of us|people|guests|pax|persons)\b",
            r"\b(\d+) (?:of us|people|guests|pax|persons)\b",
            rf"\bfor (\d+){not_a_time}\b",
        )
        for pattern in patterns:
            match = re.search(pattern, lower)
            if match is not None:
                return int(match.group(1))

        for word, value in WORD_NUMBERS.items():
            if re.search(
                rf"\b(?:table for|party of|for)?\s*{word}\b(?:\s+(?:of us|people|guests|pax))?\b",
                lower,
            ):
                return value

        if re.search(r"\b(just me|myself|alone|solo|on my own)\b", lower):
            return 1

        if correction:
            match = CORRECTION_NUMBER_RE.search(lower)
            if match is not None:
                value = int(match.group(1))
                if self.restaurant.party_min <= value <= self.restaurant.party_max:
                    return value

        return None

    def _date(self, lower: str, *, today: date) -> str | None:
        explicit = EXPLICIT_DATE_RE.search(lower)
        if explicit is not None and parse_iso_date(explicit.group(0)) is not None:
            return explicit.group(0)

        if "today" in lower or "tonight" in lower:
            return today.isoformat()
        if "tomorrow" in lower:
            return (today + timedelta(days=1)).isoformat()
        if "next week" in lower:
            return (today + timedelta(days=7)).isoformat()

        for word, index in WEEKDAY_INDEX.items():
            if re.search(rf"\b{word}\b", lower) or re.search(
                rf"\b{word[:3]}\b", lower
            ):
                delta = (index - today.weekday()) % 7
                return (today + timedelta(days=delta)).isoformat()

        month_day = MONTH_DAY_RE.search(lower)
        if month_day is not None:
            month = MONTHS[month_day.group(1).rstrip(".")]
            day = int(month_day.group(2))
            for year in (today.year, today.year + 1):
                try:
                    candidate = date(year, month, day)
                except ValueError:
                    continue
                if candidate >= today:
                    return candidate.isoformat()
            return None

        day_of_month = DAY_OF_MONTH_RE.search(lower)
        if day_of_month is not None:
            day = int(day_of_month.group(1))
            for year in (today.year, today.year + 1):
                try:
                    candidate = date(year, today.month, day)
                except ValueError:
                    continue
                if candidate >= today:
                    return candidate.isoformat()
            return None

        return None

    def _time(self, lower: str) -> str | None:
        clock = CLOCK_RE.search(lower)
        if clock is not None:
            hour = int(clock.group(1))
            minute = int(clock.group(2))
            suffix = clock.group(3)
            return self._normalise(hour, minute, suffix)

        hour_ampm = HOUR_AMPM_RE.search(lower)
        if hour_ampm is not None:
            return self._normalise(int(hour_ampm.group(1)), 0, hour_ampm.group(2))

        at_time = AT_TIME_RE.search(lower)
        if at_time is not None:
            minute = int(at_time.group(2)) if at_time.group(2) else 0
            return self._normalise(int(at_time.group(1)), minute, at_time.group(3))

        half_past = re.search(
            r"\bhalf past (\d+)(?:\s*(am|pm))?\b", lower
        )
        if half_past is not None:
            return self._normalise(int(half_past.group(1)), 30, half_past.group(2))

        o_clock = re.search(r"\b(\d+)\s*o'clock(?:\s*(am|pm))?\b", lower)
        if o_clock is not None:
            return self._normalise(int(o_clock.group(1)), 0, o_clock.group(2))

        for word, value in WORD_NUMBERS.items():
            if re.search(rf"\b{word}\s*o'clock\b", lower):
                return self._normalise(value, 0, None)

        return None

    def _normalise(self, hour: int, minute: int, suffix: str | None) -> str | None:
        if suffix == "pm" and hour < 12:
            hour += 12
        elif suffix == "am" and hour == 12:
            hour = 0
        elif suffix is None and hour <= 11:
            # No am/pm marker and an hour that only makes sense in the evening for
            # a restaurant that opens at four. Rather than guess wrong, prefer the
            # reading that falls inside service hours and let validation reject it
            # if neither does.
            for candidate in (hour + 12, hour):
                if self._in_service(candidate, minute):
                    hour = candidate
                    break
        if hour > 23 or minute > 59:
            return None
        return f"{hour:02d}:{minute:02d}"

    def _in_service(self, hour: int, minute: int) -> bool:
        minutes = hour * 60 + minute
        for window in self.restaurant.open_hours.values():
            if window is None:
                continue
            opening = minutes_from_midnight(window.open)
            closing = minutes_from_midnight(window.last_seating)
            if opening is not None and closing is not None and opening <= minutes <= closing:
                return True
        return False

    def _name(self, text: str) -> str | None:
        trigger = NAME_TRIGGER_RE.search(text)
        if trigger is None:
            return None

        value = NAME_VALUE_RE.match(text, trigger.end())
        if value is None:
            return None

        name = value.group(1).strip()
        if name.lower() in NOT_NAMES:
            return None
        return name

    def _changed(self, current: dict[str, Any], found: _Extraction) -> list[str]:
        """Slots the user actually modified.

        A key counts as changed when it already held a different value, or when the
        user signalled a correction. Filling an empty slot is not a change, which is
        what lets the merge rule distinguish a first answer from a rewrite.
        """
        changed: list[str] = []
        for key, value in found.slots.items():
            previous = current.get(key)
            differs = previous is not None and str(previous) != str(value)
            if differs or found.correction_marker:
                changed.append(key)
        return changed

    # -- reply --------------------------------------------------------------

    def _reply(
        self,
        found: _Extraction,
        slots: dict[str, Any],
        changed: list[str],
        *,
        availability: SlotStatus | None,
        openings: tuple[Opening, ...] | None,
        complete: bool,
        submit: bool,
    ) -> str:
        parts: list[str] = []

        if availability is not None and availability.state == NO_TABLE:
            parts.append(
                f"The largest table in the room seats {LARGEST_TABLE}, "
                f"so I cannot seat a party of {slots.get('party_size')} at one table. "
                "If you would like, the team can call you about arranging the room."
            )
            return " ".join(parts)

        if availability is not None and availability.state == BOOKED:
            listed = ", ".join(
                f"{item.time} (table {item.table_id})" for item in availability.alternatives
            )
            parts.append(
                f"{availability.date} at {availability.time} is fully booked."
                if not listed
                else f"{availability.date} at {availability.time} is fully booked. "
                f"I have {listed} free instead."
            )
            parts.append("Which of those works for you?")
            return " ".join(parts)

        # "What do you have free?" gets an answer built from the engine's openings,
        # so every time offered here is one the room can actually serve.
        if found.asks_availability and openings is not None:
            wanted_type = slots.get("type")
            usable = [
                opening
                for opening in openings
                if wanted_type is None or wanted_type in opening.by_type()
            ]
            day = slots.get("date") or "that day"

            if not usable:
                parts.append(
                    f"I have nothing free on {day}"
                    + (f" for a {wanted_type} table" if wanted_type else "")
                    + ". Another date would give us more to work with."
                )
            else:
                times = ", ".join(opening.time for opening in usable)
                detail = f" for a {wanted_type} table" if wanted_type else ""
                parts.append(f"On {day} I have {times} free{detail}.")

            parts.append("Which time works for you?")
            return " ".join(parts)

        if found.off_topic_key is not None:
            fact = self.restaurant.facts.get(found.off_topic_key)
            if fact:
                parts.append(fact)

        if submit:
            table = (availability.table_id if availability is not None else None) or "a table"
            parts.append(
                f"Booking it: {slots.get('date')} at {slots.get('time')} for "
                f"{slots.get('party_size')}, table {table}, under {slots.get('name')}. "
                "A receipt is on its way to your email."
            )
            return " ".join(parts)

        if complete:
            parts.append(
                f"So that is {slots.get('date')} at {slots.get('time')} for "
                f"{slots.get('party_size')} under {slots.get('name')}. Shall I book it?"
            )
            return " ".join(parts)

        if changed:
            parts.append(f"Noted, I have updated {', '.join(changed)}.")
        elif found.slots:
            parts.append("Got that.")

        missing = self._next_missing(slots)
        if missing is not None:
            parts.append(missing)

        return " ".join(part for part in parts if part)

    def _next_missing(self, slots: dict[str, Any]) -> str | None:
        prompts = {
            "date": "What date were you thinking?",
            "time": "And what time?",
            "party_size": "How many will be dining?",
            "type": "Any seating preference: booth, patio, or a standard table?",
            "name": "What name should the booking be under?",
            "email": "And an email address for the receipt?",
            "phone": "A phone number in case we need to reach you?",
            "special_requests": "Anything I should let the kitchen or the floor know, a birthday or an allergy?",
        }
        for key in self.restaurant.slot_order:
            if slots.get(key) is None and key in prompts:
                return prompts[key]
        return None
