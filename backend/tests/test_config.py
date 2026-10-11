"""Reading credentials out of the environment.

Every key this app uses arrives as text a person pasted into a file, and a key wrapped
in literal quote characters is refused by the provider exactly like a wrong key is. The
error message cannot tell the two apart, which is how a working credential ends up
looking like a broken integration, so the parsing is tested rather than trusted.
"""

from __future__ import annotations

import pytest

from app.config import _secret

VARIABLE = "RESERVATION_TEST_SECRET"


@pytest.fixture(autouse=True)
def clean(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv(VARIABLE, raising=False)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("sk_abc123", "sk_abc123"),
        ("  sk_abc123  ", "sk_abc123"),
        ('"sk_abc123"', "sk_abc123"),
        ("'sk_abc123'", "sk_abc123"),
        ('  "sk_abc123"  ', "sk_abc123"),
        ("", None),
        ("   ", None),
        ('""', None),
        ("''", None),
    ],
)
def test_a_credential_survives_how_it_was_pasted(
    monkeypatch: pytest.MonkeyPatch, raw: str, expected: str | None
) -> None:
    monkeypatch.setenv(VARIABLE, raw)

    assert _secret(VARIABLE) == expected


def test_a_missing_credential_is_none_rather_than_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """Callers test truthiness to decide whether a provider exists at all."""
    assert _secret(VARIABLE) is None


def test_half_a_quote_is_part_of_the_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(VARIABLE, '"sk_abc123')

    assert _secret(VARIABLE) == '"sk_abc123'


def test_quotes_inside_a_credential_are_left_alone(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(VARIABLE, 'sk_"abc"')

    assert _secret(VARIABLE) == 'sk_"abc"'
