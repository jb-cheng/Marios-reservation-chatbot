"""Print the model IDs your account can actually deploy.

Exists because a wrong model ID is a 404 at demo time, and the only trustworthy
answer is the one the account gives. Reads the key from backend/.env through the
normal settings path, so it never appears in an argument list or a log.

    .venv/Scripts/python.exe scripts/list_models.py
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import load_settings  # noqa: E402

MODELS_ENDPOINT = "https://api.cohere.com/v2/models"


def main() -> int:
    settings = load_settings()

    if not settings.cohere_api_key:
        print("COHERE_API_KEY is empty. Put it in backend/.env first.")
        return 1

    request = urllib.request.Request(
        f"{MODELS_ENDPOINT}?page_size=100&endpoint=chat",
        headers={"Authorization": f"Bearer {settings.cohere_api_key}"},
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        print(f"Cohere returned {error.code}: {body[:400]}")
        return 1
    except urllib.error.URLError as error:
        print(f"Could not reach Cohere: {error.reason}")
        return 1

    models = payload.get("models", [])
    configured = settings.cohere_model

    print(f"{len(models)} chat-capable deployments on this account:\n")
    for model in models:
        marker = "  <-- COHERE_MODEL" if model.get("name") == configured else ""
        print(f"  {model.get('name')}{marker}")

    if configured and configured not in {m.get("name") for m in models}:
        print(
            f"\nCOHERE_MODEL is set to {configured!r}, which is not in that list. "
            "Pick one of the names above."
        )
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
