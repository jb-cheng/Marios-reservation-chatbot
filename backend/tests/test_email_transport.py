"""What the Mailgun request looks like on the wire.

Mailgun differs from a JSON email API in three ways, and none of them can be
recovered from the response afterwards: the sending domain is a path segment rather
than a body field, the credential is HTTP Basic with the literal username `api`
rather than a Bearer token, and the message parts are form fields rather than JSON.
Any of the three wrong answers 400 or 401, `send()` returns False, and the caller at
`main.py` discards that False. The booking succeeds and the customer waits for an
email that was never sent.

So the request shape is asserted here rather than discovered in front of an audience.
"""

from __future__ import annotations

import base64
import urllib.error
import urllib.parse
from dataclasses import replace

import pytest

from app import email as email_module
from app.config import Settings
from app.email import (
    MAILGUN_API_BASE,
    EmailMessage,
    MailgunTransport,
    transport_for,
)

MESSAGE = EmailMessage(
    to="jean@example.com",
    subject="Your table is held",
    text="Table for 4 on 2026-10-17 at 19:00.",
)

DOMAIN = "mg.marios.test"
SENDER = "reservations@mg.marios.test"
ENDPOINT = f"{MAILGUN_API_BASE}/{DOMAIN}/messages"


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Stand in for the network and keep whatever was about to be sent."""
    calls: dict = {"requests": [], "status": 200, "error": None}

    class Response:
        def __init__(self, status: int) -> None:
            self.status = status

        def __enter__(self) -> "Response":
            return self

        def __exit__(self, *exc: object) -> bool:
            return False

    def fake_urlopen(request, timeout=None):
        # urllib capitalises header names on the way in, so compare lowered.
        sent = {**request.headers, **request.unredirected_hdrs}
        calls["requests"].append(
            {
                "url": request.full_url,
                "method": request.get_method(),
                "headers": {name.lower(): value for name, value in sent.items()},
                "data": request.data,
                "timeout": timeout,
            }
        )
        if calls["error"] is not None:
            raise calls["error"]
        return Response(calls["status"])

    monkeypatch.setattr(email_module.urllib.request, "urlopen", fake_urlopen)
    return calls


def test_the_sending_domain_is_a_path_segment_not_a_body_field(captured: dict) -> None:
    transport = MailgunTransport("test-key-not-real", DOMAIN, SENDER)

    assert transport.send(MESSAGE) is True

    request = captured["requests"][0]
    assert request["url"] == ENDPOINT
    assert request["method"] == "POST"


def test_the_key_is_basic_auth_under_the_username_api(captured: dict) -> None:
    """A Bearer header, which is what most email APIs want, is a 401 here."""
    transport = MailgunTransport("test-key-not-real", DOMAIN, SENDER)

    assert transport.send(MESSAGE) is True

    expected = base64.b64encode(b"api:test-key-not-real").decode("ascii")
    assert captured["requests"][0]["headers"]["authorization"] == f"Basic {expected}"


def test_mailgun_gets_the_sender_the_recipient_and_the_body_as_form_fields(
    captured: dict,
) -> None:
    transport = MailgunTransport("test-key-not-real", DOMAIN, SENDER)

    assert transport.send(MESSAGE) is True

    request = captured["requests"][0]
    assert request["headers"]["content-type"] == "application/x-www-form-urlencoded"
    assert urllib.parse.parse_qs(request["data"].decode("utf-8")) == {
        "from": [SENDER],
        "to": [MESSAGE.to],
        "subject": [MESSAGE.subject],
        "text": [MESSAGE.text],
    }


def test_a_refusal_is_reported_as_a_failure_and_not_raised(captured: dict) -> None:
    """The caller cannot distinguish a refused send from a delivered one, so the
    return value is the only signal that anything went wrong."""
    captured["error"] = urllib.error.HTTPError(ENDPOINT, 401, "Unauthorized", {}, None)
    transport = MailgunTransport("test-key-not-real", DOMAIN, SENDER)

    assert transport.send(MESSAGE) is False


# -- which transport runs ---------------------------------------------------


def cleared(settings: Settings, **overrides) -> Settings:
    """Every credential off, so a value in the developer's real .env cannot decide
    which transport a test gets."""
    base: dict = {"mailgun_api_key": None, "mailgun_domain": "", "email_from": ""}
    base.update(overrides)
    return replace(settings, **base)


def test_the_outbox_runs_when_nothing_is_configured(settings: Settings) -> None:
    assert transport_for(cleared(settings)).name == "outbox"


def test_a_key_without_a_domain_cannot_address_the_api(settings: Settings) -> None:
    """The domain is in the URL, so there is no request to make without it."""
    configured = cleared(settings, mailgun_api_key="key-test", email_from=SENDER)

    assert transport_for(configured).name == "outbox"


def test_mailgun_needs_a_sender_as_well_as_a_key_and_a_domain(settings: Settings) -> None:
    """A missing sender used to select the live transport and post an empty `from`,
    which fails at call time exactly like a bad key does, and leaves nothing readable
    on disk the way the outbox would have."""
    configured = cleared(settings, mailgun_api_key="key-test", mailgun_domain=DOMAIN)

    assert transport_for(configured).name == "outbox"


def test_mailgun_runs_when_it_is_fully_configured(settings: Settings) -> None:
    configured = cleared(
        settings,
        mailgun_api_key="key-test",
        mailgun_domain=DOMAIN,
        email_from=SENDER,
    )

    assert transport_for(configured).name == "mailgun"