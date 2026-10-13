"""What the Resend request looks like on the wire.

`api.resend.com` sits behind Cloudflare, which refuses urllib's default
`Python-urllib/3.x` client signature with a 403 whose entire body is `error code:
1010`. Resend never sees the request, so a valid key and a valid sender still
produce nothing, `send()` returns False, and the caller at `main.py` discards that
False. The booking succeeds and the customer waits for an email that was never sent.

The header is the only part of this that cannot be recovered from the response, so
it is asserted here rather than discovered in front of an audience.
"""

from __future__ import annotations

import json
import urllib.error
from dataclasses import replace

import pytest

from app import email as email_module
from app.config import Settings
from app.email import (
    RESEND_ENDPOINT,
    EmailMessage,
    ResendTransport,
    transport_for,
)

MESSAGE = EmailMessage(
    to="jean@example.com",
    subject="Your table is held",
    text="Table for 4 on 2026-10-17 at 19:00.",
)


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

        def read(self) -> bytes:
            return b"{}"

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


def test_the_request_identifies_itself_as_something_other_than_urllib(captured: dict) -> None:
    """A missing User-Agent is a 403 from Cloudflare, not an email that failed."""
    transport = ResendTransport("test-key-not-real", "reservations@marios.test")

    assert transport.send(MESSAGE) is True

    agent = captured["requests"][0]["headers"].get("user-agent")
    assert agent, "urllib's default agent is blocked before Resend sees the request"
    assert not agent.startswith("Python-urllib")


def test_resend_gets_the_sender_the_recipient_and_the_body(captured: dict) -> None:
    transport = ResendTransport("test-key-not-real", "reservations@marios.test")

    assert transport.send(MESSAGE) is True

    request = captured["requests"][0]
    assert request["url"] == RESEND_ENDPOINT
    assert request["method"] == "POST"
    assert request["headers"]["authorization"] == "Bearer test-key-not-real"
    assert request["headers"]["content-type"] == "application/json"
    assert json.loads(request["data"]) == {
        "from": "reservations@marios.test",
        "to": ["jean@example.com"],
        "subject": MESSAGE.subject,
        "text": MESSAGE.text,
    }


def test_a_refusal_is_reported_as_a_failure_and_not_raised(captured: dict) -> None:
    """The caller cannot distinguish a refused send from a delivered one, so the
    return value is the only signal that anything went wrong."""
    captured["error"] = urllib.error.HTTPError(
        RESEND_ENDPOINT, 403, "Forbidden", {}, None
    )
    transport = ResendTransport("test-key-not-real", "reservations@marios.test")

    assert transport.send(MESSAGE) is False


# -- which transport runs ---------------------------------------------------


def cleared(settings: Settings, **overrides) -> Settings:
    """Every credential off, so a value in the developer's real .env cannot decide
    which transport a test gets."""
    base: dict = {"resend_api_key": None, "email_from": ""}
    base.update(overrides)
    return replace(settings, **base)


def test_the_outbox_runs_when_nothing_is_configured(settings: Settings) -> None:
    assert transport_for(cleared(settings)).name == "outbox"


def test_resend_needs_a_sender_as_well_as_a_key(settings: Settings) -> None:
    """A key with no sender used to select Resend and post an empty `from`, which
    fails at call time exactly like a bad key does, and leaves nothing readable on
    disk the way the outbox would have."""
    configured = cleared(settings, resend_api_key="re_test", email_from="")

    assert transport_for(configured).name == "outbox"


def test_resend_runs_when_it_is_fully_configured(settings: Settings) -> None:
    configured = cleared(
        settings, resend_api_key="re_test", email_from="reservations@marios.test"
    )

    assert transport_for(configured).name == "resend"
