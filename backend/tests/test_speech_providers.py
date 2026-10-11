"""What the ElevenLabs requests actually look like on the wire.

The live suite can only run with a key that works, and the key in this repo does not,
so the request shape is asserted here instead: URLs, headers, body fields, truncation,
and the multipart encoding, which is hand-rolled because the alternative was another
dependency for one call. A mismatch in any of these is a 400 or a 422 that looks
exactly like a bad key from the outside, and the only way to tell them apart without
spending credits is to read the bytes.

`_post` is the seam. Nothing here reaches the network.
"""

from __future__ import annotations

import json
import re
from dataclasses import replace

import pytest

from app import speech
from app.config import Settings
from app.speech import MAX_TTS_CHARS, _multipart, _safe_content_type, _safe_filename

AUDIO = b"\x1a\x00\xff\xfb\r\n--not-a-boundary\r\n\x90"


@pytest.fixture
def keyed(settings: Settings) -> Settings:
    return replace(
        settings,
        elevenlabs_api_key="test-key-not-real",
        elevenlabs_voice_id="voice123",
        elevenlabs_tts_model="eleven_turbo_v2_5",
        elevenlabs_stt_model="scribe_v1",
    )


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Stand in for the network and keep whatever was about to be sent."""
    calls: dict = {"posts": []}

    def fake_post(url: str, *, headers: dict[str, str], data: bytes, timeout: int):
        calls["posts"].append({"url": url, "headers": headers, "data": data, "timeout": timeout})
        return b"audio-bytes"

    monkeypatch.setattr(speech, "_post", fake_post)
    return calls


def parse_multipart(body: bytes, boundary: str) -> dict[str, dict]:
    parts: dict[str, dict] = {}
    for chunk in body.split(f"--{boundary}".encode())[1:]:
        if chunk.startswith(b"--"):
            continue
        head, _, rest = chunk.partition(b"\r\n\r\n")
        name = re.search(rb'name="([^"]*)"', head).group(1).decode()
        filename = re.search(rb'filename="([^"]*)"', head)
        parts[name] = {
            "head": head.decode(),
            "filename": filename.group(1).decode() if filename else None,
            "value": rest[: -len(b"\r\n")] if rest.endswith(b"\r\n") else rest,
        }
    return parts


# -- the multipart encoder --------------------------------------------------


def test_the_body_and_the_header_agree_on_the_boundary() -> None:
    """The classic way a hand-rolled encoder fails: a boundary in the header that is
    not the boundary in the body, which the server reads as an empty form."""
    body, content_type = _multipart({"model_id": "scribe_v1"}, "a.webm", AUDIO, "audio/webm")

    assert content_type.startswith("multipart/form-data; boundary=")
    boundary = content_type.split("boundary=", 1)[1]
    assert body.startswith(f"--{boundary}\r\n".encode())
    assert body.endswith(f"--{boundary}--\r\n".encode())


def test_fields_and_audio_survive_the_round_trip() -> None:
    body, content_type = _multipart(
        {"model_id": "scribe_v1", "tag_audio_events": "false"},
        "utterance.webm",
        AUDIO,
        "audio/webm",
    )
    parts = parse_multipart(body, content_type.split("boundary=", 1)[1])

    assert parts["model_id"]["value"] == b"scribe_v1"
    assert parts["tag_audio_events"]["value"] == b"false"
    assert parts["file"]["filename"] == "utterance.webm"
    assert "Content-Type: audio/webm" in parts["file"]["head"]
    # Bytes that look like a boundary and bytes that look like a header ending both
    # have to come out unchanged, or the provider is transcribing something else.
    assert parts["file"]["value"] == AUDIO


# -- the values interpolated into headers ----------------------------------


def test_a_hostile_filename_cannot_add_a_header_line() -> None:
    assert _safe_filename('a.webm"\r\nX-Injected: yes') == "a.webmX-Injectedyes"
    assert "\r" not in _safe_filename('a"\r\nX-Injected: yes')
    assert '"' not in _safe_filename('a".webm')
    assert _safe_filename("../../etc/passwd") == "passwd"
    assert _safe_filename("..\\..\\windows\\system32") == "system32"
    assert len(_safe_filename("x" * 200)) == 64
    assert _safe_filename(None) == "utterance.webm"
    assert _safe_filename("///") == "utterance.webm"
    assert _safe_filename("take one.webm") == "takeone.webm"


def test_a_media_type_has_to_be_shaped_like_one() -> None:
    assert _safe_content_type("audio/webm") == "audio/webm"
    assert _safe_content_type("audio/mp4") == "audio/mp4"
    assert _safe_content_type("audio/webm\r\nX-Injected: yes") == "audio/webm"
    assert _safe_content_type("not a media type") == "audio/webm"
    assert _safe_content_type(None) == "audio/webm"


# -- the requests themselves ------------------------------------------------


def test_synthesis_sends_the_voice_the_model_and_nothing_else(keyed: Settings, captured: dict) -> None:
    result = speech._elevenlabs_tts("Table for four at 19:00.", keyed)

    post = captured["posts"][0]
    assert post["url"] == "https://api.elevenlabs.io/v1/text-to-speech/voice123"
    assert post["headers"]["xi-api-key"] == "test-key-not-real"
    assert post["headers"]["Accept"] == "audio/mpeg"
    assert post["headers"]["Content-Type"] == "application/json"
    assert json.loads(post["data"]) == {
        "text": "Table for four at 19:00.",
        "model_id": "eleven_turbo_v2_5",
    }
    assert result.provider == "elevenlabs"
    assert result.data == b"audio-bytes"


def test_a_long_reply_is_cut_at_the_limit(keyed: Settings, captured: dict) -> None:
    """A runaway reply would otherwise be billed at full length and arrive too late
    to be worth hearing."""
    speech._elevenlabs_tts("x" * (MAX_TTS_CHARS + 400), keyed)

    sent = json.loads(captured["posts"][0]["data"])
    assert len(sent["text"]) == MAX_TTS_CHARS


def test_transcription_sends_the_model_the_audio_and_no_audio_events(
    keyed: Settings, captured: dict
) -> None:
    result = speech._elevenlabs_stt(AUDIO, "take one.webm", "audio/webm", keyed)

    post = captured["posts"][0]
    assert post["url"] == "https://api.elevenlabs.io/v1/speech-to-text"
    assert post["headers"]["xi-api-key"] == "test-key-not-real"
    assert post["headers"]["Content-Type"].startswith("multipart/form-data; boundary=")

    parts = parse_multipart(post["data"], post["headers"]["Content-Type"].split("boundary=", 1)[1])
    assert parts["model_id"]["value"] == b"scribe_v1"
    assert parts["tag_audio_events"]["value"] == b"false"
    assert parts["file"]["value"] == AUDIO
    assert parts["file"]["filename"] == "takeone.webm", "the client chose that name"
    assert result is None, "audio-bytes is not json, and a non-transcript is not a transcript"


def test_neither_provider_is_called_without_a_key(settings: Settings, captured: dict) -> None:
    assert speech._elevenlabs_tts("hello", settings) is None
    assert speech._elevenlabs_stt(AUDIO, "a.webm", "audio/webm", settings) is None
    assert captured["posts"] == []
