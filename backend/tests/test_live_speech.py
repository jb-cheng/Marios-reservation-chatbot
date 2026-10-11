"""Live ElevenLabs checks. Skipped unless the key exists.

    .venv/Scripts/python.exe -m pytest -m live -k speech

Voice mode has two halves and a key that can be wrong in a way nothing else in the
app notices. A voice id pasted into ELEVENLABS_API_KEY is 20 characters of mixed
case, so the server reports ElevenLabs as configured, capabilities advertise server
transcription, and every call answers 401 while both halves quietly degrade. These
tests are the cheap way to tell that apart.

The second one is a round trip, so a voice id or model id the account cannot use
fails here rather than in front of an audience.
"""

from __future__ import annotations

import asyncio

import pytest

from app.config import load_settings
from app.speech import synthesize, transcribe

settings = load_settings()

needs_elevenlabs = pytest.mark.skipif(
    not settings.elevenlabs_api_key, reason="ELEVENLABS_API_KEY is not set"
)

SENTENCE = "A table for four on Saturday at seven."


def heard(text: str, *spellings: str) -> bool:
    """A transcriber may write a number as a digit, and that is still correct."""
    return any(spelling in text for spelling in spellings)


@pytest.mark.live
@needs_elevenlabs
def test_synthesis_comes_from_elevenlabs() -> None:
    audio = asyncio.run(synthesize(SENTENCE, settings))

    assert audio is not None, "no provider could speak; the log has the reason"
    assert audio.provider == "elevenlabs", (
        f"fell back to {audio.provider}, which means the key was rejected. "
        "A 401 here usually means a voice id is sitting in ELEVENLABS_API_KEY."
    )
    assert audio.media_type == "audio/mpeg"
    assert len(audio.data) > 4000, "one sentence is a few seconds of mp3"


@pytest.mark.live
@needs_elevenlabs
def test_a_spoken_reservation_transcribes_back_to_its_words() -> None:
    """The whole voice loop in one test: speak a booking, then listen to it."""
    audio = asyncio.run(synthesize(SENTENCE, settings))
    assert audio is not None and audio.provider == "elevenlabs"

    text = asyncio.run(transcribe(audio.data, "line.mp3", audio.media_type, settings))

    assert text is not None, "Scribe refused the audio; the log has the reason"
    lower = text.lower()
    assert heard(lower, "table"), text
    assert heard(lower, "saturday"), text
    assert heard(lower, "four", "4"), text
    assert heard(lower, "seven", "7"), text
