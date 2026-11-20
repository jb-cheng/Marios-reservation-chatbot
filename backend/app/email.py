"""Email, behind a transport that works with no API key.

Two templates, not the brief's three. Approval sends nothing, because the customer
was told at submission that the table was theirs, so a later "you're confirmed"
would be noise about a decision they never had to wait for. Rejection is the only
decision that changes what the customer believes, and it is the only one that
writes to them.

Two transports behind one interface: Mailgun for a verified sending domain, and the
outbox, which renders the same message to a `.eml` file and logs the path. The flow
is identical either way, so the queue is testable and the receipt is screenshottable
before any email account exists.
"""

from __future__ import annotations

import base64
import logging
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from email.message import EmailMessage as MimeMessage
from pathlib import Path
from typing import Protocol

from .availability import Alternative
from .config import Restaurant, Settings
from .storage import Reservation

logger = logging.getLogger("reservation.email")

MAILGUN_API_BASE = "https://api.mailgun.net/v3"

# An edge filter that refuses urllib's default `Python-urllib/3.x` signature answers
# before the API sees anything, and that is indistinguishable from a bad key because
# `send()` returns False either way and the caller discards it.
USER_AGENT = "marios-reservations/1.0"


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    text: str


class EmailTransport(Protocol):
    name: str

    def send(self, message: EmailMessage) -> bool: ...


class OutboxTransport:
    """Writes the message to disk instead of sending it."""

    name = "outbox"

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def send(self, message: EmailMessage) -> bool:
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
            path = self.directory / f"{stamp}-{message.to.split('@')[0]}.eml"

            rendered = MimeMessage()
            rendered["To"] = message.to
            rendered["Subject"] = message.subject
            rendered.set_content(message.text)
            path.write_text(rendered.as_string(), encoding="utf-8")

            logger.info("email written to outbox: %s", path)
            return True
        except OSError:
            logger.exception("could not write email to outbox")
            return False


class MailgunTransport:
    name = "mailgun"

    def __init__(self, api_key: str, domain: str, sender: str) -> None:
        self.api_key = api_key
        self.domain = domain
        self.sender = sender

    def send(self, message: EmailMessage) -> bool:
        payload = urllib.parse.urlencode(
            {
                "from": self.sender,
                "to": message.to,
                "subject": message.subject,
                "text": message.text,
            }
        ).encode("utf-8")

        # Mailgun authenticates with HTTP Basic, where the username is the literal
        # `api` and the password is the key. A Bearer header is refused.
        credentials = base64.b64encode(f"api:{self.api_key}".encode("utf-8")).decode("ascii")

        request = urllib.request.Request(
            f"{MAILGUN_API_BASE}/{self.domain}/messages",
            data=payload,
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": USER_AGENT,
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return 200 <= response.status < 300
        except urllib.error.HTTPError as error:
            logger.error("mailgun rejected the message: %s %s", error.code, error.reason)
            return False
        except (urllib.error.URLError, TimeoutError):
            logger.exception("could not reach mailgun")
            return False


def transport_for(settings: Settings) -> EmailTransport:
    """Mailgun when it is fully configured, otherwise the outbox.

    Three values, not one. The sending domain is a path segment of the URL, so a key
    on its own cannot address the API, and without a sender the request would post an
    empty `from`. Either gap fails at call time exactly the way a bad key does and
    leaves nothing on disk to read, so a half-filled `.env` writes to the outbox
    instead of failing silently on the wire.
    """
    if settings.mailgun_api_key and settings.mailgun_domain and settings.email_from:
        return MailgunTransport(
            settings.mailgun_api_key, settings.mailgun_domain, settings.email_from
        )
    return OutboxTransport(settings.outbox_dir)


def _wrap(text: str, width: int = 68) -> str:
    """Reflow a paragraph to a readable width.

    Hand-wrapped string literals break wherever the source line happened to end, so
    a longer date or party size puts a newline in the middle of a sentence. These
    are customer-facing and get screenshotted for the presentation.
    """
    return textwrap.fill(text, width=width)


def _describe_table(reservation: Reservation) -> str:
    return f"a {reservation.table_type} table for {reservation.party_size}"


def _format_when(reservation: Reservation) -> str:
    return f"{reservation.date} at {reservation.time}"


def receipt_email(restaurant: Restaurant, reservation: Reservation) -> EmailMessage:
    """Sent at submission. Reads as a confirmation, because under this design it is
    one: the table is held from the moment the customer confirms.
    """
    requests = reservation.special_requests
    lines = [
        f"Thank you, {reservation.name.split()[0] if reservation.name else 'and welcome'}.",
        "",
        f"Your table at {restaurant.name} is booked.",
        "",
        f"  When:     {_format_when(reservation)}",
        f"  Party:    {reservation.party_size}",
        f"  Seating:  {_describe_table(reservation)}",
        f"  Name:     {reservation.name}",
    ]
    if requests:
        lines.append(f"  Notes:    {requests}")

    lines += [
        "",
        f"Booking reference: {reservation.submission_id}",
        "",
        _wrap(
            "Our team verifies every booking made through the assistant, and will "
            "only contact you if something needs to change. Until then, consider "
            "it done."
        ),
        "",
        _wrap(
            f"To change or cancel, call "
            f"{restaurant.facts.get('phone', 'the restaurant')} and quote the "
            "reference above."
        ),
        "",
        restaurant.name,
        restaurant.facts.get("address", ""),
    ]

    return EmailMessage(
        to=reservation.email,
        subject=f"Your table at {restaurant.name} on {reservation.date}",
        text="\n".join(lines),
    )


def rejection_email(
    restaurant: Restaurant,
    reservation: Reservation,
    alternatives: tuple[Alternative, ...],
) -> EmailMessage:
    """The only message a customer receives after submitting.

    The alternatives are computed by the availability engine at rejection time, so
    the times offered here are real openings rather than something a model thought
    up while writing an apology.
    """
    lines = [
        f"Hello {reservation.name.split()[0] if reservation.name else 'there'},",
        "",
        _wrap(
            f"We are sorry, but we could not hold {reservation.date} at "
            f"{reservation.time} for {reservation.party_size}. That seating is no "
            "longer available to us."
        ),
        "",
    ]

    if alternatives:
        lines.append("These times can still seat your party:")
        lines.append("")
        for item in alternatives:
            lines.append(f"  {item.time}, {item.type} table for {item.seats}")
        lines.append("")
        lines.append(
            _wrap("Reply to this message or call us and we will take care of it.")
        )
    else:
        lines.append(
            _wrap(
                "We have nothing free that evening for a party your size. Please "
                f"call us on {restaurant.facts.get('phone', 'the restaurant')} and "
                "we will see what can be arranged."
            )
        )

    lines += ["", restaurant.name, restaurant.facts.get("address", "")]

    return EmailMessage(
        to=reservation.email,
        subject=f"About your {restaurant.name} reservation on {reservation.date}",
        text="\n".join(lines),
    )
