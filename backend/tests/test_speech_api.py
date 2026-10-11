"""The three speech endpoints.

Every provider call is replaced at the module boundary. A test that reached
ElevenLabs would spend quota and fail without a network, and one that reached Edge
TTS would sit in a websocket timeout, which is how a suite ends up slow enough that
nobody runs it.
"""

from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app import speech
from app.config import Settings
from app.main import create_app
from app.storage import Store

UTTERANCE = b"not really audio, but the routes never listen to it"


@pytest.fixture
def keyed(settings: Settings) -> Settings:
    """The same settings with a key present, which is all these routes look at.

    The value is never sent anywhere: the functions that would send it are
    replaced below.
    """
    return replace(settings, elevenlabs_api_key="test-key-not-real")


def build(settings: Settings) -> TestClient:
    return TestClient(create_app(settings, Store(settings.database_path)))


async def no_edge_tts(text: str, settings: Settings) -> speech.SynthesizedAudio | None:
    return None


def test_capabilities_follow_the_key(client: TestClient, keyed: Settings) -> None:
    """The browser asks instead of guessing, so the answer has to be exact.

    `server_stt` is what routes the microphone away from the browser's own
    recognition, and claiming it without a key gives voice mode a dead button.
    """
    assert client.get("/api/speech/capabilities").json() == {
        "elevenlabs": False,
        "tts_provider": "edge-tts",
        "server_stt": False,
    }

    with build(keyed) as keyed_client:
        assert keyed_client.get("/api/speech/capabilities").json() == {
            "elevenlabs": True,
            "tts_provider": "elevenlabs",
            "server_stt": True,
        }


def test_tts_prefers_elevenlabs(
    monkeypatch: pytest.MonkeyPatch, keyed: Settings
) -> None:
    async def unused_edge(text: str, settings: Settings):
        raise AssertionError("the fallback ran while the premium voice answered")

    monkeypatch.setattr(
        speech,
        "_elevenlabs_tts",
        lambda text, settings: speech.SynthesizedAudio(
            data=b"premium", media_type="audio/mpeg", provider="elevenlabs"
        ),
    )
    monkeypatch.setattr(speech, "_edge_tts", unused_edge)

    with build(keyed) as test_client:
        response = test_client.post("/api/tts", json={"text": "Table for four at 19:00."})

    assert response.status_code == 200
    assert response.content == b"premium"
    assert response.headers["x-tts-provider"] == "elevenlabs"
    assert response.headers["content-type"].startswith("audio/mpeg")
    # A spoken reply is per turn and per restaurant, so a shared cache would let
    # one browser hear another's sentence.
    assert response.headers["cache-control"] == "no-store"


def test_tts_falls_back_to_edge(
    monkeypatch: pytest.MonkeyPatch, keyed: Settings
) -> None:
    """A rejected key must still leave the customer with a voice."""
    monkeypatch.setattr(speech, "_elevenlabs_tts", lambda text, settings: None)

    async def edge(text: str, settings: Settings) -> speech.SynthesizedAudio:
        return speech.SynthesizedAudio(
            data=b"fallback", media_type="audio/mpeg", provider="edge-tts"
        )

    monkeypatch.setattr(speech, "_edge_tts", edge)

    with build(keyed) as test_client:
        response = test_client.post("/api/tts", json={"text": "See you Saturday."})

    assert response.status_code == 200
    assert response.headers["x-tts-provider"] == "edge-tts"


def test_tts_says_so_when_nothing_can_speak(
    monkeypatch: pytest.MonkeyPatch, keyed: Settings
) -> None:
    """502 rather than an empty 200, because the browser's own voice is the next
    step and it only runs when this call fails."""
    monkeypatch.setattr(speech, "_elevenlabs_tts", lambda text, settings: None)
    monkeypatch.setattr(speech, "_edge_tts", no_edge_tts)

    with build(keyed) as test_client:
        response = test_client.post("/api/tts", json={"text": "See you Saturday."})

    assert response.status_code == 502
    assert response.json() == {"error": "tts_unavailable"}


def test_stt_without_a_key_never_reaches_the_network(client: TestClient) -> None:
    response = client.post(
        "/api/stt",
        files={"file": ("utterance.webm", UTTERANCE, "audio/webm")},
    )

    assert response.status_code == 502
    assert response.json() == {"error": "stt_unavailable"}


def test_stt_returns_the_transcript(
    monkeypatch: pytest.MonkeyPatch, keyed: Settings
) -> None:
    seen: dict[str, object] = {}

    def fake(blob: bytes, filename: str, content_type: str, settings: Settings) -> str:
        seen["bytes"] = len(blob)
        seen["filename"] = filename
        seen["content_type"] = content_type
        return "a table for four on saturday"

    monkeypatch.setattr(speech, "_elevenlabs_stt", fake)

    with build(keyed) as test_client:
        response = test_client.post(
            "/api/stt",
            files={"file": ("utterance.webm", UTTERANCE, "audio/webm")},
        )

    assert response.status_code == 200
    assert response.json() == {"text": "a table for four on saturday"}
    assert seen == {
        "bytes": len(UTTERANCE),
        "filename": "utterance.webm",
        "content_type": "audio/webm",
    }


def test_stt_reports_a_rejected_provider_as_unavailable(
    monkeypatch: pytest.MonkeyPatch, keyed: Settings
) -> None:
    """The status the recorder downgrades on.

    A key that is present but wrong fails at the provider, not at configuration, so
    it has to arrive as the same 502 the browser treats as "use your own
    recognition". Anything else leaves the microphone retrying a call that cannot
    succeed.
    """
    monkeypatch.setattr(
        speech, "_elevenlabs_stt", lambda blob, filename, content_type, settings: None
    )

    with build(keyed) as test_client:
        response = test_client.post(
            "/api/stt",
            files={"file": ("utterance.webm", UTTERANCE, "audio/webm")},
        )

    assert response.status_code == 502
    assert response.json() == {"error": "stt_unavailable"}


def test_stt_refuses_an_empty_recording(
    monkeypatch: pytest.MonkeyPatch, keyed: Settings
) -> None:
    def unused(*args, **kwargs):
        raise AssertionError("an empty upload should not be sent to a provider")

    monkeypatch.setattr(speech, "_elevenlabs_stt", unused)

    with build(keyed) as test_client:
        response = test_client.post(
            "/api/stt",
            files={"file": ("utterance.webm", b"", "audio/webm")},
        )

    assert response.status_code == 502
