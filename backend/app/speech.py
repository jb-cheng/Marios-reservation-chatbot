"""Speech: text to audio, and audio to text.

Two providers, one interface. ElevenLabs is used when a key exists, and Edge TTS
otherwise, so the voice path is demoable without any account at all.

The blocking network calls run through `asyncio.to_thread`. urllib has no async
client, and calling it directly inside a request handler would stall every other
conversation in the process for the length of one synthesis.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass

from .config import Settings

logger = logging.getLogger("reservation.speech")

ELEVENLABS_TTS = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
ELEVENLABS_STT = "https://api.elevenlabs.io/v1/speech-to-text"

# Long enough for a paragraph of confirmation details, short enough that a runaway
# model monologue cannot produce a minute of audio nobody asked for.
MAX_TTS_CHARS = 600


@dataclass(frozen=True)
class SynthesizedAudio:
    data: bytes
    media_type: str
    provider: str


def _post(url: str, *, headers: dict[str, str], data: bytes, timeout: int) -> bytes:
    request = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _elevenlabs_tts(text: str, settings: Settings) -> SynthesizedAudio | None:
    if not settings.elevenlabs_api_key:
        return None

    payload = json.dumps(
        {
            "text": text[:MAX_TTS_CHARS],
            "model_id": settings.elevenlabs_tts_model,
        }
    ).encode("utf-8")

    try:
        audio = _post(
            ELEVENLABS_TTS.format(voice_id=settings.elevenlabs_voice_id),
            headers={
                "xi-api-key": settings.elevenlabs_api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            data=payload,
            # The reply is already on screen and two fallbacks sit behind this
            # call, so waiting half a minute for a voice the customer cannot hear
            # yet buys nothing. Turbo synthesis answers in well under a second.
            timeout=10,
        )
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        logger.error("elevenlabs tts rejected the request: %s %s", error.code, body[:200])
        return None
    except (urllib.error.URLError, TimeoutError):
        logger.exception("could not reach elevenlabs for speech synthesis")
        return None

    if not audio:
        return None
    return SynthesizedAudio(data=audio, media_type="audio/mpeg", provider="elevenlabs")


async def _edge_tts(text: str, settings: Settings) -> SynthesizedAudio | None:
    """Free and fast, and the reason the voice path works with no account.

    Unofficial: it drives the browser voice service, so it can break without notice.
    That is why the browser's own speech synthesis remains as a final fallback.
    """
    try:
        import edge_tts
    except ImportError:
        logger.warning("edge-tts is not installed")
        return None

    async def build() -> bytes | None:
        buffer = bytearray()
        communicate = edge_tts.Communicate(text[:MAX_TTS_CHARS], settings.tts_voice)
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                buffer.extend(chunk["data"])
        return bytes(buffer) or None

    try:
        # Short on purpose. A healthy edge-tts stream finishes in one to three
        # seconds, and the browser's own voice is waiting behind this. Observed at
        # 20s: the websocket accepted the request, sent nothing, and the customer
        # sat through the whole timeout before hearing anything at all.
        audio = await asyncio.wait_for(build(), timeout=8)
    except Exception:
        logger.exception("edge-tts synthesis failed")
        return None

    if audio is None:
        return None
    return SynthesizedAudio(data=audio, media_type="audio/mpeg", provider="edge-tts")


async def synthesize(text: str, settings: Settings) -> SynthesizedAudio | None:
    """Speak one line. ElevenLabs first, Edge TTS if there is no key or it fails."""
    if not text.strip():
        return None

    premium = await asyncio.to_thread(_elevenlabs_tts, text, settings)
    if premium is not None:
        return premium

    return await _edge_tts(text, settings)


def _safe_filename(name: str | None) -> str:
    """A filename that cannot edit the request it travels in.

    The name comes from the upload, so it is attacker-chosen, and it is interpolated
    into a Content-Disposition header. A quote would end the parameter early and a
    CRLF would start a new header line, which is how a field nobody sent ends up in
    the request to a third party. The extension is kept because it is what hints at
    the container; everything else is dropped rather than escaped, since there is no
    encoding for this that a reader is guaranteed to honour.
    """
    base = (name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    kept = "".join(character for character in base if character.isalnum() or character in "._-")
    return kept[:64] or "utterance.webm"


_MEDIA_TYPE = re.compile(r"^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$")


def _safe_content_type(value: str | None) -> str:
    """A media type that cannot edit the request either.

    Like the filename this arrives from the upload, and it is interpolated into a
    header of its own. Anything that is not shaped like `type/subtype` is replaced
    rather than escaped, and the default is the container the recorder actually
    produces.
    """
    candidate = (value or "").strip()
    return candidate if _MEDIA_TYPE.match(candidate) else "audio/webm"


def _multipart(fields: dict[str, str], filename: str, blob: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = f"----reservation{uuid.uuid4().hex}"
    body = io.BytesIO()

    for name, value in fields.items():
        body.write(f"--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.write(f"{value}\r\n".encode())

    body.write(f"--{boundary}\r\n".encode())
    body.write(
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode()
    )
    body.write(f"Content-Type: {content_type}\r\n\r\n".encode())
    body.write(blob)
    body.write(f"\r\n--{boundary}--\r\n".encode())

    return body.getvalue(), f"multipart/form-data; boundary={boundary}"


def _elevenlabs_stt(
    blob: bytes, filename: str, content_type: str, settings: Settings
) -> str | None:
    if not settings.elevenlabs_api_key:
        return None

    body, content_type_header = _multipart(
        {
            "model_id": settings.elevenlabs_stt_model,
            # Audio events ("laughs", "inhales") are noise in a reservation and they
            # end up inside slot values if they are left in.
            "tag_audio_events": "false",
        },
        _safe_filename(filename),
        blob,
        _safe_content_type(content_type),
    )

    try:
        raw = _post(
            ELEVENLABS_STT,
            headers={
                "xi-api-key": settings.elevenlabs_api_key,
                "Content-Type": content_type_header,
            },
            data=body,
            # The customer has let go of the microphone and is waiting to see their
            # own words. A reservation utterance is a few seconds long and Scribe
            # returns in about one, so anything past this is a hung request whose
            # only outcome is asking them to speak again.
            timeout=20,
        )
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        logger.error("elevenlabs stt rejected the request: %s %s", error.code, detail[:200])
        return None
    except (urllib.error.URLError, TimeoutError):
        logger.exception("could not reach elevenlabs for transcription")
        return None

    try:
        return str(json.loads(raw).get("text") or "").strip() or None
    except json.JSONDecodeError:
        logger.error("elevenlabs stt returned something that was not json")
        return None


async def transcribe(
    blob: bytes, filename: str, content_type: str, settings: Settings
) -> str | None:
    """Transcribe one recorded utterance.

    Push to talk rather than a realtime websocket, because a recording that arrives
    whole needs no proxy to keep a key out of the bundle, no reconnection logic, and
    no partial-transcript UI, and it is the shape a reservation sentence actually has.
    """
    if not blob:
        return None
    return await asyncio.to_thread(_elevenlabs_stt, blob, filename, content_type, settings)


def stt_available(settings: Settings) -> bool:
    return bool(settings.elevenlabs_api_key)
