# Mario's reservation agent

A voice and text agent that takes a restaurant reservation, keeps the booking
details in the browser across turns, and hands the result to a staff queue for a
human decision.

This repo is the agent. The restaurant's own website is built separately and is
not part of this tree.

The design, including five places where it deliberately departs from the original
brief, is in [docs/superpowers/specs/2026-10-10-reservation-agent-design.md](docs/superpowers/specs/2026-10-10-reservation-agent-design.md).

## Layout

```
frontend/   Vite + React 19 + TypeScript + Tailwind 4. The conversation, the
            confirmation card, and the staff queue at /admin.
backend/    FastAPI. Availability, validation, storage, providers, guardrails,
            email. SQLite, no server to run.
shared/     validation-cases.json, asserted by both test suites so the rules that
            exist in two languages cannot drift apart.
```

## Running it

Prerequisites: Node 20 or newer, Python 3.11 or newer, and Git Bash on Windows.

One time only:

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# .venv/bin/pip install -r requirements.txt                   # macOS and Linux

cd ../frontend
npm install
```

Then, from the repo root:

```bash
./dev.sh
```

That starts the API on port 8000 and the app on 5173, and Ctrl-C stops both.

Prefer two terminals? Run these instead, and leave `dev.sh` alone:

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000 --reload --reload-dir app
cd frontend && npm run dev
```

Open http://localhost:5173/ for the agent and http://localhost:5173/admin for the
staff queue.

Without any API keys the agent runs on a deterministic provider, so the whole
flow works offline. Copy `backend/.env.example` to `backend/.env` and add keys to
use Cohere and Groq instead:

```
LLM_PROVIDER=cohere
COHERE_API_KEY=...
COHERE_MODEL=command-a-plus-05-2026
GROQ_API_KEY=...
GUARDRAILS_ENABLED=true
```

`.env` is gitignored, and every variable is documented in `.env.example`.
`scripts/list_models.py` prints the model IDs your Cohere account can actually
deploy, which is worth running before trusting a model name.

Voice mode is `http://localhost:5173/?mode=voice`, or the Voice tab in the page. It
needs no key: replies are spoken by Edge TTS and the microphone uses the browser's
own recognition. Set `ELEVENLABS_API_KEY` to move both halves onto ElevenLabs, and
`/api/speech/capabilities` is what tells the browser which one it has.

Contributors and agents should read [AGENTS.md](AGENTS.md) first: the invariants
that are load-bearing, the provider limits discovered by failing against the live
APIs, and this machine's environment traps.

## Tests

```bash
cd frontend && npm run test:state && npm run typecheck
cd backend  && .venv/Scripts/python.exe -m pytest
```

The frontend suite runs on Node's own test runner with type stripping, so there is
no test framework to install.

A plain `pytest` run is offline and deterministic. The tests that call a real
provider are marked `live` and excluded by default, because they cost quota:

```bash
cd backend && .venv/Scripts/python.exe -m pytest -m live
```

## How a booking flows

1. The browser keeps the slot values in `localStorage` and sends them with every
   turn. Only those: no transcript and no UI preferences, so a reload restores a
   half-finished booking without keeping what the customer said or how they were
   talking. The model returns updated values; the browser validates and merges them,
   and the server never writes to storage.
2. The server computes what the room can actually seat and hands the model those
   facts, so suggested alternatives are real openings rather than plausible times.
3. When every required slot is filled the browser shows a summary and the assistant
   asks the customer to check it there. It never claims the booking first: confirming
   calls `POST /api/submit`, which re-checks the room, writes a pending row, and
   emails a receipt.
4. Staff approve or reject from `/admin`. Approving moves the row to the official
   list and tells the customer nothing, because they were already told they were
   booked. Rejecting is the only decision that contacts them, with alternatives
   the engine computed at that moment.
