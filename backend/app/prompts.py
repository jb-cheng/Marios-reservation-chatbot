"""The system prompt.

Behaviour lives here. Shape does not: the response contract is enforced by the
provider's structured output schema, so the prompt never has to beg the model for
JSON, and a malformed answer is a validation failure rather than a parsing
argument.

The availability block is rendered from the server's own computation and marked as
fact. That is the mechanism behind "the chatbot is usually correct about timings":
the model is not recalling opening hours, it is reading them.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from .availability import AVAILABLE, NO_TABLE, Opening, SlotStatus
from .config import Restaurant
from .floor_plan import LARGEST_TABLE
from .schemas import SlotValues
from .validate import parse_iso_date, weekday_name

BEHAVIOUR = """You are a restaurant reservation assistant for {name}.

You maintain a reservation object with these fields, in these exact formats:
- date: an ISO calendar date, YYYY-MM-DD, for example 2026-10-17
- time: a 24 hour clock time, HH:MM, on a {slot_minutes} minute grid, for example
  19:00. Never write 7pm, 7 pm or 7:00pm; write 19:00.
- party_size: an integer
- type: one of booth, patio or standard, or null when the customer has no preference
- name, email, phone, special_requests: text, as the customer gave it. Copy a phone
  number through as spoken rather than reformatting it.

Leave null any field the customer has not given. Never guess a value, and never
carry one over from an example in this prompt.

On every turn you receive:
- the current reservation object
- the full conversation so far
- the user's latest message
- today's date
- an AVAILABILITY block computed by the restaurant's own booking data

Respond with:
- reply: what you say to the user
- slots: the updated reservation object
- changed: array of slot keys the user explicitly modified this turn
- submit: boolean, true ONLY when the summary has already been shown to the customer
  and they have clearly confirmed it, for example "yes", "book it", "that works".
  Never true on the turn where the last missing field arrives.

Rules:
- Never say or imply that a booking is made, that a table is held, or that a receipt
  has been sent. You cannot book anything. The browser shows a summary card and the
  customer confirms there, and only that confirmation creates the reservation. When
  every required field is filled, ask them to check the details on screen.
- Only fill a slot if the user actually provided that information. Never invent a
  value, and never carry a value over from an example.
- When the customer names a weekday or a relative day such as "tomorrow" or "this
  Saturday", find it in the CALENDAR below and use the date on that row. The first
  matching row after today is the day they mean. That is a lookup, not a guess, so
  do not ask them to repeat a day they already gave you. Then say the weekday and
  the day of the month back in your reply, as in "Saturday the 17th", so a customer
  can correct a date they can hear rather than one they cannot.
- If the day they named is marked closed in the CALENDAR, say so and offer the
  nearest open day. Do not put a closed date in the reservation object.
- If the user corrects a value, update it and list the key in changed.
- Required fields are date, time, party_size, name and email. Optional fields are
  phone, special_requests, and type unless the customer expressed a preference.
- Ask for one missing required field at a time, in this order: date, time,
  party_size, name, email.
- Once every required field is filled, stop collecting and ask the customer to
  review the summary on screen and confirm it there. You may mention that a phone
  number or a note for the kitchen can still be added, but never make either a
  condition of booking, and never keep asking for optional fields once the required
  ones are done. That includes the seating type: it is on the card and it is not
  needed to book. If the customer has now said yes to a summary they could already
  see, set submit to true instead of asking another question.
- Treat the AVAILABILITY block as fact. Never name a date or time that is not in
  it, and never imply a slot is free when the block says it is booked.
- If the user asks what is free, or whether a kind of seating is available, answer
  only from the OPENINGS block. It lists every seating time that can still serve
  them and how many tables of each kind are open at each.
- Never name a table identifier and never promise a specific table. Which table a
  party is given is decided when the booking is written, not during the chat.
- If the requested slot is booked, offer the alternatives the block lists, leave
  slots unchanged until the user picks one, and do not add the requested time to
  slots.
- If the block says no_table, the room cannot seat that party at any time. Say so
  plainly, offer to have the team call, and do not invent an alternative.
- If the user asks a general question about the patio, hours, dress code, parking,
  the menu or cancellations, answer from FACTS below and leave slots unchanged. If
  FACTS does not cover it, say you will let the team follow up rather than guessing.
- Refer to seating the way a guest would, as "a booth for four" or "a table on the
  patio". Table identifiers like B2 are internal and mean nothing to a customer.
- If you are unsure what the user meant, ask a clarifying question instead of
  filling a slot.
- Never submit twice for the same session.
- Keep replies to one or two sentences. This is a conversation, not a form.

FACTS about the restaurant:
{facts}
"""


def render_facts(restaurant: Restaurant) -> str:
    return "\n".join(f"- {value}" for value in restaurant.facts.values())


def render_state(slots: SlotValues) -> str:
    values = slots.model_dump()
    lines = [
        f"- {key}: {value!r}" if value is not None else f"- {key}: (empty)"
        for key, value in values.items()
    ]
    return "\n".join(lines)


def _with_weekday(iso_date: str) -> str:
    """A date plus its weekday name, for anywhere the prompt shows a date.

    A live run resolved "this Saturday" to a Sunday. The date was valid and the
    restaurant was open, so nothing downstream could catch it. Naming the weekday
    next to every date gives the model a chance to notice its own arithmetic, and
    the rule below makes it say the weekday back so the customer can too.
    """
    parsed = parse_iso_date(iso_date)
    if parsed is None:
        return iso_date
    return f"{iso_date} ({weekday_name(parsed)})"


def _held_line(held: dict[str, int]) -> str:
    """Occupancy at the requested time, as counts per seating type.

    Rendered whenever the engine actually looked, including an explicit "none",
    because a missing line cannot be told apart from an empty room. NO_TABLE never
    reaches here: that branch answers before occupancy is queried, so printing a
    count there would state a fact nobody checked.
    """
    counts = ", ".join(f"{kind} {count}" for kind, count in sorted(held.items()))
    return f"Tables already held at this time: {counts or 'none'}."


def render_availability(availability: SlotStatus | None) -> str:
    if availability is None:
        return (
            "AVAILABILITY (server computed, treat as fact)\n"
            "Not evaluated yet: a date, a time and a party size are all needed "
            "before the room can be checked."
        )

    header = (
        f"AVAILABILITY (server computed, treat as fact)\n"
        f"Requested {_with_weekday(availability.date)} at {availability.time} for "
        f"{availability.party_size}"
        + (f", preference {availability.type}" if availability.type else "")
        + ": "
    )

    if availability.state == AVAILABLE:
        return (
            header
            + f"AVAILABLE.\n{_held_line(availability.held)}\n"
            + "Do not mention the table identifier."
        )

    if availability.state == NO_TABLE:
        return (
            header
            + f"NO_TABLE. The largest single table seats {LARGEST_TABLE}, so no "
            "arrangement of the room serves this party at any time. There are no "
            "alternatives to offer."
        )

    if not availability.alternatives:
        return (
            header
            + "BOOKED. Nothing else is free that evening, so do not offer a time.\n"
            + _held_line(availability.held)
        )

    listed = "\n".join(
        f"  {item.time}, seats {item.seats}, {item.type}"
        for item in availability.alternatives
    )
    return (
        header
        + "BOOKED.\n"
        + _held_line(availability.held)
        + "\nFree alternatives, the only times you may offer:\n"
        + listed
    )


def conflict_reply(availability: SlotStatus, restaurant: Restaurant) -> str:
    """A reply composed from computed facts, used when a turn discovers a conflict.

    The turn on which a customer first names a date and time cannot have had
    availability in its prompt, because the prompt is built before the model reads
    the message. Rather than spend a second model call, or let the customer give
    their name and email before learning the slot is full, the server says the
    factual thing itself. Every time in this sentence came from the engine, so
    there is nothing here a model could have invented.
    """
    if availability.state == NO_TABLE:
        return (
            f"The largest table at {restaurant.name} seats {LARGEST_TABLE}, so I "
            f"cannot seat a party of {availability.party_size} at one table on "
            f"{availability.date}. If you would like, the team can call you about "
            "arranging the room."
        )

    if not availability.alternatives:
        return (
            f"{availability.time} on {availability.date} is fully booked, and "
            "there is nothing else free that evening for a party of "
            f"{availability.party_size}. Another date would give us more to work with."
        )

    offered = ", ".join(item.time for item in availability.alternatives)
    return (
        f"{availability.time} on {availability.date} is fully booked. I have "
        f"{offered} free for {availability.party_size} instead. Which of those "
        "works for you?"
    )


AVAILABILITY_ASKS = (
    "what time", "what times", "which time", "what slots", "what's free",
    "what is free", "anything free", "any tables", "any openings", "any availability",
    "what do you have", "what's available", "what is available", "what availability",
    "when are you free", "when is there", "how busy",
)

# "is a booth available at seven", "do you have a table free".
AVAILABILITY_ASK_RE = re.compile(
    r"\b(?:do you have|is|are|have you got)\b.{0,28}\b(?:free|available|open)\b"
)


def asks_about_availability(text: str) -> bool:
    """Whether a message is asking what the room can offer.

    Distinct from a general question about the restaurant. "Do you have a patio?"
    is answered from FACTS; "do you have a patio table free at seven?" has to be
    answered from the engine, because only the engine knows what is held.

    Shared by the server and the deterministic provider so the two cannot disagree
    about what counts as an availability question.
    """
    lower = (text or "").lower()
    if any(phrase in lower for phrase in AVAILABILITY_ASKS):
        return True
    return AVAILABILITY_ASK_RE.search(lower) is not None


CONFIRM_ASK = (
    "Everything I need is on the card. Please check the details there and confirm."
)

NOT_BOOKED_YET = (
    "Nothing is booked yet. Tell me what is missing and I will put it on the card, "
    "and the booking is only made when you confirm it there."
)

# Longest customer message that can be answered by nudging them back to the card.
# Past this a message is a question of its own and deserves the model's answer.
MAX_NUDGE_WORDS = 3

# Sentences that can only be true after /api/submit has answered 200.
#
# /api/chat never writes anything, so a reply saying a table is held is a falsehood
# no matter how well the model was instructed. The prompt forbids it and the
# deterministic provider never says it, but the same prompt also says not to collect
# optional fields once the required ones are filled, and Command A+ did that twice
# while this was being tested. An instruction is not a guarantee.
#
# The live model produced "Your reservation for Saturday the 17th at 19:00 for 4 has
# been confirmed", which is why the subject and the verb are matched with a gap
# between them rather than as one phrase, and why the scan is per sentence: a
# whole-reply match cannot tell a claim from a denial that happens to share a word.
_CLAIM_TENSE = r"(?:is|are|was|were|has been|have been|will be|is now|'s)\s+"
_CLAIM_VERB = _CLAIM_TENSE + r"(?:booked|confirmed|held|reserved|secured|all set|set|locked)"
# "That table is booked" is an availability fact about somebody else's evening, not a
# claim about this customer, so a table or a seat only counts with the stronger verbs.
_CLAIM_VERB_STRONG = _CLAIM_TENSE + r"(?:confirmed|held|reserved|secured|all set|set|locked)"

BOOKING_CLAIMS = (
    re.compile(
        r"\b(?:your|the|our|my)\s+(?:booking|reservation)\b[^.!?]{0,80}?\b"
        + _CLAIM_VERB
        + r"\b",
        re.I,
    ),
    re.compile(
        r"\b(?:your|the|our|my)\s+(?:table|seat)\b[^.!?]{0,80}?\b"
        + _CLAIM_VERB_STRONG
        + r"\b",
        re.I,
    ),
    re.compile(r"\byou(?:'re| are)(?: all)? (?:booked|confirmed|set|good to go)\b", re.I),
    re.compile(r"\b(?:i|we)(?:'ve| have) (?:booked|confirmed|held|reserved|secured)\b", re.I),
    re.compile(r"\breceipt\b[^.!?]{0,40}?\b(?:sent|emailed|on its way)\b", re.I),
)

# A claim carrying one of these nearby is qualifying or denying, not claiming: "the
# table is held once you confirm" is true and should survive. Checked in a window
# around the match rather than over the whole sentence, because a long sentence can
# contain both a claim and an unrelated conditional, and the real model produced
# exactly that: "Your reservation ... is set; you can still add a phone number if you
# like."
_SENTENCE_SPLIT = re.compile(r"[.!?]+")
_QUALIFIER = re.compile(
    r"(?:\b(?:not|nothing|never|yet|until|once|when|whenever|if|after|before|only|"
    r"cannot|will not)\b|n't\b)",
    re.I,
)
_QUALIFIER_BEFORE = 24
_QUALIFIER_AFTER = 32


def claims_a_booking(reply: str) -> bool:
    """Whether a reply says a reservation exists that this endpoint did not create."""
    for sentence in _SENTENCE_SPLIT.split(reply):
        for pattern in BOOKING_CLAIMS:
            for match in pattern.finditer(sentence):
                start = max(0, match.start() - _QUALIFIER_BEFORE)
                window = sentence[start : match.end() + _QUALIFIER_AFTER]
                if not _QUALIFIER.search(window):
                    return True
    return False


def redirects_from_the_summary(message: str, reply: str, *, complete: bool) -> bool:
    """Whether a reply pulls the customer away from a summary that is already up.

    Command A+ was handed a complete reservation and the single word "yes", and
    answered by asking which seating type the customer wanted. Nothing had changed
    and nothing had been asked about the room, so the question was invented: the
    optional fields are already on the card, and a summary the customer has to
    answer a question about before they can confirm it is a summary that never gets
    confirmed.

    Narrow on purpose. It needs a question in the reply, because a statement is left
    alone; a short message, because a long one is a real question; and a complete
    state, because before that the model is supposed to be collecting.
    """
    if not complete or "?" not in reply:
        return False
    if len((message or "").split()) > MAX_NUDGE_WORDS:
        return False
    return not asks_about_availability(message)


def openings_reply(
    day: str,
    openings_list: tuple[Opening, ...],
    party_size: int | None,
    type_: str | None,
) -> str:
    """A reply composed from computed openings.

    Used on the turn where the date first appears, which is the one turn that
    cannot have had openings in its prompt. Every time in this sentence came from
    the engine, so there is nothing here a model could have invented.
    """
    party = f" for {party_size}" if party_size else ""

    if not openings_list:
        return (
            f"I have nothing free on {day}{party}"
            + (f" for a {type_} table" if type_ else "")
            + ". Another date would give us more to work with."
        )

    usable = [
        opening
        for opening in openings_list
        if type_ is None or type_ in opening.by_type()
    ]
    if not usable:
        return (
            f"On {day} I have seatings free{party}, but none of them can give you a "
            f"{type_} table. I can offer a different kind of seating, or look at "
            "another date."
        )

    times = ", ".join(opening.time for opening in usable)
    detail = f" for a {type_} table" if type_ else party
    return f"On {day} I have {times} free{detail}. Which one works for you?"


def render_openings(
    day: str, openings_list: tuple[Opening, ...] | None, party_size: int | None
) -> str | None:
    """The room's free seatings for one day, as the model is allowed to see them.

    Rendered as counts per seating type rather than table identifiers. The model
    needs to be able to answer "is a booth free at seven" and "what times do you
    have", and it must never promise a specific table, because which table a party
    gets is the engine's decision at submission time.
    """
    if openings_list is None:
        return None

    header = f"OPENINGS for {_with_weekday(day)}" + (
        f" (party of {party_size})" if party_size else ""
    )

    if not openings_list:
        return f"{header}\nNothing free. Do not offer a time on this date."

    lines = []
    for opening in openings_list:
        counts = ", ".join(
            f"{kind} {count}" for kind, count in sorted(opening.by_type().items())
        )
        lines.append(f"  {opening.time}: {len(opening.free)} free ({counts})")

    return header + "\n" + "\n".join(lines)


def render_calendar(today: date, restaurant: Restaurant, days: int = 14) -> str:
    """The next two weeks, with weekdays and closed days marked.

    This exists because a live Command A+ run resolved "this Saturday" to 2026-10-12,
    which is a Monday, while the prompt already stated that today was Sunday the
    11th. The model had the correct anchor and still got the arithmetic wrong, and
    because the date was valid and the restaurant open on Sundays, nothing
    downstream could catch it.

    So dates become a lookup rather than a calculation. Marking closed days here
    also means "tomorrow" said on a Sunday is refused in the same breath, instead of
    reaching validation and coming back with a silently dropped time.
    """
    lines = []
    for offset in range(days):
        day = today + timedelta(days=offset)
        window = restaurant.open_hours.get(weekday_name(day))
        hours = "closed" if window is None else f"{window.open} to {window.last_seating}"
        marker = " (today)" if offset == 0 else ""
        lines.append(f"  {day.strftime('%a')} {day.isoformat()}{marker}: {hours}")

    return (
        "CALENDAR (look dates up here, never compute them)\n" + "\n".join(lines)
    )


def system_prompt(
    *,
    restaurant: Restaurant,
    slots: SlotValues,
    availability: SlotStatus | None,
    today: date,
    now: datetime | None = None,
    availability_note: str | None = None,
    openings: tuple[Opening, ...] | None = None,
    openings_date: str | None = None,
    openings_party: int | None = None,
) -> str:
    """Build the system prompt for one turn.

    `availability_note` replaces the default "not evaluated yet" wording when
    availability could not be computed for a specific reason, such as a time that
    is not a seating time. Saying "not evaluated" in that case would tell the model
    the room had not been checked, when the honest answer is that the request was
    not a real slot.
    """
    behaviour = BEHAVIOUR.format(
        name=restaurant.name,
        facts=render_facts(restaurant),
        slot_minutes=restaurant.slot_minutes,
    )
    block = render_availability(availability)
    if availability is None and availability_note:
        block = f"AVAILABILITY (server computed, treat as fact)\n{availability_note}"

    openings_block = render_openings(
        openings_date or "", openings, openings_party
    )

    # The clock is given as well as the date, because "tonight" and "tomorrow
    # evening" cannot be resolved from a date alone. Relative dates stay the
    # model's job rather than the server's, since customers phrase them in too many
    # forms to parse reliably, so it gets the facts it needs to do the arithmetic.
    moment = now if now is not None else datetime.combine(today, datetime.min.time())
    clock = (
        f"Now is {moment.strftime('%A')} {moment.isoformat(timespec='minutes')}, "
        f"local restaurant time."
        if now is not None
        else f"Today is {today.isoformat()} ({today.strftime('%A')})."
    )

    parts = [
        behaviour,
        clock,
        "",
        render_calendar(today, restaurant),
        "",
        f"CURRENT RESERVATION OBJECT\n{render_state(slots)}",
        "",
        block,
    ]
    if openings_block:
        parts += ["", openings_block]

    return "\n".join(parts) + "\n"
