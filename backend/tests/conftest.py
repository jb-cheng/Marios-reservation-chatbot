from __future__ import annotations

import json
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, load_settings
from app.main import create_app
from app.storage import Store

REPO_ROOT = Path(__file__).resolve().parents[2]
SHARED_CASES = REPO_ROOT / "shared" / "validation-cases.json"


@pytest.fixture
def shared() -> dict:
    """The cross-language validation table."""
    return json.loads(SHARED_CASES.read_text(encoding="utf-8"))


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    """Settings pointed at a throwaway database and outbox.

    `resend_api_key` is forced to None so a key present in the developer's real
    environment cannot make a test send an actual email.
    """
    base = load_settings()
    return replace(
        base,
        database_path=tmp_path / "test.db",
        outbox_dir=tmp_path / "outbox",
        llm_provider="fake",
        guardrails_enabled=False,
        safeguard_enabled=False,
        resend_api_key=None,
    )


@pytest.fixture
def store(settings: Settings) -> Store:
    return Store(settings.database_path)


@pytest.fixture
def client(settings: Settings, store: Store):
    app = create_app(settings, store)
    with TestClient(app) as test_client:
        yield test_client


def next_weekday(today: date, weekday: int) -> date:
    """The next date with that Python weekday, today included."""
    return today + timedelta(days=(weekday - today.weekday()) % 7)


@pytest.fixture
def saturday() -> date:
    """A Saturday at least a day out, so a test never races the real clock."""
    today = date.today() + timedelta(days=1)
    return next_weekday(today, 5)


@pytest.fixture
def monday() -> date:
    today = date.today() + timedelta(days=1)
    return next_weekday(today, 0)


def submit_payload(day: date, *, party_size: int = 4, session_id: str = "session-a", **overrides):
    body = {
        "session_id": session_id,
        "date": day.isoformat(),
        "time": "19:00",
        "party_size": party_size,
        "type": None,
        "name": "Jean Ben",
        "email": "jean@example.com",
        "phone": "4169999999",
        "special_requests": None,
    }
    body.update(overrides)
    return body
