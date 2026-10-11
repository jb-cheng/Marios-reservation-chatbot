"""Guardrails, in the order that keeps cost and blast radius smallest.

Inbound text is scanned before the main model is called, so a prompt injection
costs one small classifier call rather than a large chat call, and never reaches
the model that can write to slots. Outbound replies get a cheap marker check.

The Prompt Guard and Safeguard network paths are wired in a later slice because
they need a live Groq key to verify against, and a guardrail that has never been
observed returning a verdict is worse than no guardrail: it reads as protection
while doing nothing. Until then `settings.guardrails_enabled` gates a stub that
says so in the log rather than silently passing.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass

from .config import Settings

logger = logging.getLogger("reservation.guardrails")

# Obvious injection markers. This is a backstop, not a classifier: it exists to
# catch the crude cases for free, and it is deliberately narrow so that ordinary
# restaurant conversation is never blocked by it.
MARKER = re.compile(
    r"(?xi)"
    r"(?:ignore|disregard|forget)\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+"
    r"(?:instructions?|prompts?|rules?)"
    r"|\bsystem\s+prompt\b"
    r"|\byou\s+are\s+now\b"
    r"|\bnew\s+instructions?\b"
    r"|\breveal\s+(?:your|the)\s+(?:instructions?|prompt)\b"
    r"|\b(?:set|update|write)\s+slot\b"
)


@dataclass(frozen=True)
class GuardResult:
    blocked: bool
    reason: str | None = None
    source: str = "none"


REFUSAL = (
    "I can only help with reservations at this restaurant. "
    "What date and time were you thinking?"
)

# Prompt Guard 2 returns a probability, not a label. See _classify for the measured
# distribution this sits in the middle of.
BLOCK_THRESHOLD = 0.5


def scan_text(text: str) -> GuardResult:
    match = MARKER.search(text or "")
    if match is None:
        return GuardResult(blocked=False, source="regex")
    return GuardResult(
        blocked=True, reason=f"injection marker: {match.group(0)!r}", source="regex"
    )


async def check_inbound(text: str, settings: Settings) -> GuardResult:
    """Scan a user message before it reaches the main model."""
    marker = scan_text(text)
    if marker.blocked:
        logger.warning("inbound message blocked: %s", marker.reason)
        return marker

    if not settings.guardrails_enabled:
        return marker

    verdict = await _classify(settings, text, settings.guardrails_model)
    return verdict or marker


async def check_outbound(reply: str, settings: Settings) -> GuardResult:
    """Scan the model's reply before it is spoken or shown."""
    marker = scan_text(reply)
    if marker.blocked:
        logger.warning("outbound reply blocked: %s", marker.reason)
        return marker

    if not settings.safeguard_enabled:
        return marker

    verdict = await _classify(settings, reply, settings.safeguard_model)
    return verdict or marker


async def _classify(
    settings: Settings, text: str, model: str
) -> GuardResult | None:
    """Ask a Groq classifier about one piece of text.

    Returns None when there is no verdict, which leaves the regex result standing.
    That happens when the model is not one this function understands, when no key is
    configured, or when the call fails.

    Failing open is a deliberate choice and worth arguing with. The alternative is
    that a Groq outage takes the whole agent down, including for customers typing
    "table for two". It is survivable here because this classifier is one layer of
    several: the regex backstop already ran, slots are validated and merged under
    rules the model cannot override, `submitted` is not a slot, and availability is
    injected rather than believed. A control with that much behind it can afford to
    degrade; a control that is the only thing standing between an attacker and a
    write cannot.
    """
    if "prompt-guard" not in model:
        # GPT-OSS Safeguard answers in a different shape, and guessing at it would
        # produce a confident verdict from a misread response.
        logger.warning(
            "classifier %s has no reader implemented, relying on the regex backstop",
            model,
        )
        return None

    if not settings.groq_api_key:
        logger.warning("guardrails are enabled but GROQ_API_KEY is empty")
        return None

    try:
        from groq import AsyncGroq

        client = AsyncGroq(api_key=settings.groq_api_key)
        response = await client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": text}],
            max_tokens=16,
            temperature=0.0,
        )
        raw = (response.choices[0].message.content or "").strip()
        score = float(raw)
    except ValueError:
        logger.warning("prompt guard returned an unparseable score: %r", raw[:80])
        return None
    except Exception:
        logger.exception("prompt guard call failed")
        return None

    # Measured against this model on 2026-10-11: benign reservation text scored
    # 0.00036 and two injection attempts scored 0.9996 and 0.9976. The distribution
    # is bimodal with nothing in between, so the threshold is not a tuned value and
    # 0.5 sits in an empty gap.
    if score >= BLOCK_THRESHOLD:
        return GuardResult(
            blocked=True, reason=f"prompt guard score {score:.4f}", source=model
        )

    return GuardResult(blocked=False, reason=None, source=model)
