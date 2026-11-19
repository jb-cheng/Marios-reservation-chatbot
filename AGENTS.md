# AGENTS.md

Guidance for an agent working in this repository. Read this before changing code.

## What this is

A restaurant reservation agent: a browser conversation that fills a slot object, a
FastAPI backend that computes what the room can actually seat, and a staff queue
where a human approves or rejects. The customer page is the restaurant's whole page:
the reservation block at the top, then the story, the menu and the room. The teammate
who owns the marketing site shared a Figma file that holds only the reservation frame,
so the sections below it are this repo's own design.

The design, including the places it deliberately departs from the original brief,
is in `docs/superpowers/specs/2026-10-10-reservation-agent-design.md`. That file is
not committed. Read it in the working tree, and update it when behaviour changes,
because a spec that contradicts the code is worse than no spec.

## Running and testing

```bash
./dev.sh                                              # API on 8000, app on 5173

cd frontend && npm run test:state && npm run typecheck
cd backend  && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 .venv/Scripts/python.exe -m pytest
cd backend  && .venv/Scripts/python.exe -m pytest -m live   # costs real quota
```

Use the venv at `backend/.venv`. Never install Python packages globally on this
machine.

## The customer page

`ChatPage` composes a fixed `SiteHeader`, the reservation block, three marketing
sections and `SiteFooter`. The reservation block is the Figma frame: `HostCard` at
352px, the conversation card at 928px, `EveningPanel` at 284px, under a 100px header.
Those widths are asserted by the browser check, so changing one is a deliberate act.

`ChatPanel` still owns the whole turn flow. `PipDeck` renders quick answers under the
agent's last question and `EveningPanel` renders the running summary; neither owns
state. Every restaurant fact on the page comes from `/api/config` through
`useRestaurantConfig`, which shares one request across all of them.

Browser checks live outside the repo, in `C:/Users/jbnou/pw-scratch/marios-stage{1,2,3}.mjs`,
run with `node` against the dev servers. They use the cached Playwright Chromium rather
than adding a dependency here. See the trap below about isolating the database first.

## Invariants worth not breaking

These are the load-bearing decisions. Changing one silently changes what the system
guarantees.

- The browser owns slot state. The server never writes to `localStorage`, and slot
  updates arrive as structured output, never as a tool call the model can invoke.
- The model never sees `submitted` or the session id. `toChatPayload` is what
  enforces that, by returning a narrower type rather than deleting a field.
- Only two keys are persisted: `reservation_state` and `reservation_session_id`. The
  transcript lives in React state and is purged from storage on load. A test asserts
  the exact key set, so a new persisted field fails the suite.
- Availability is computed, never recalled. Every time the agent offers comes from
  `availability.py`. If you find yourself letting a model name a time, stop.
- Merge rule: a non-empty slot changes only when the model lists it in `changed`.
  Fill-only breaks corrections; blind overwrite lets a hallucination destroy an
  earlier answer.
- Slot validation exists twice, in `frontend/src/state/validation.ts` and
  `backend/app/validate.py`, on purpose. `shared/validation-cases.json` is asserted
  by both suites. Change a rule in one language and the other fails, which is the
  point. Update the JSON when you change a rule.
- A `pending` row holds its table. Availability counts `pending` plus `official`, so
  a rejection is what frees a table.
- Approval is silent. The customer was told at submission that the table was theirs.
  Rejection is the only decision that sends an email.
- Submission is idempotent per session, checked server-side as well as by the
  browser's latch.
- Quick answers never write a slot. Every chip and field in `PipDeck` ends in the same
  `send()` the textarea calls, so extraction, the merge rule and `isValid` still apply.
  A pip that set state directly would be a second write path around all three.
- `pips.ts` matches asking sentences only, never the whole reply. Otherwise "I have your
  name as John" puts a name field under a statement. Bare `number` and bare `table` are
  deliberately not keywords, because "number of guests" and "a table for four" are party
  questions.
- `EveningPanel` and `ConfirmCard` read state, never the agent's prose. That is what stops
  either of them agreeing with a reply that got something wrong.

## Provider facts learned the hard way

Verified against the live APIs, and each one cost a failed call to discover.

- Cohere's structured output rejects `pattern` ("unsupported patterns: '^, $, ?=,
  ?!'") and rejects `minimum` on an integer. The schema in `llm.agent_output_schema`
  is therefore enums only, which is stronger where it applies: the decoder cannot
  emit "7pm" because "7pm" is not in the list of seating times.
- LangChain's `ChatGroq.with_structured_output` defaults to `method="function_calling"`,
  which is tool calling. It is pinned to `json_schema` with `strict=True` because the
  brief forbids slot updates arriving as tool calls.
- LangChain's Groq binding wants an OpenAI-format tool dict, not a bare JSON Schema.
  Passing the schema directly raises `ValueError: Unsupported function`.
- Prompt Guard 2 returns a probability as a string, not a label. Benign reservation
  text scores around 0.0004, an injection around 0.999. The threshold is 0.5, sitting
  in an empty gap. A `label == "unsafe"` check would silently never fire.
- Command A+ resolves relative dates unreliably. It was given "today is Sunday
  2026-10-11" in the prompt and still answered that October 12 was a Saturday. The
  prompt now carries a 14-day calendar with closed days marked, which fixed the
  closed-day case but not "this Saturday" from a Sunday, where the model asks for
  clarification instead. That is accepted behaviour, not an open bug.
- Measured per structured turn: Groq about 1.8s, Cohere 4.5s to 13.7s. The brief's 3
  second fallback threshold was written before anything was measured and would have
  abandoned most Cohere turns, so the default is 15000ms.
- Command A+ announces bookings it did not make. Told in the prompt never to say or
  imply that a reservation exists, it returned "Your reservation for Saturday the 17th
  at 19:00 for 4 has been confirmed" and, on another turn, "Your reservation ... is
  set; you can still add a phone number if you like". It also asked which seating type
  the customer wanted after every required field was filled and the customer had said
  "yes". `/api/chat` writes nothing, so both are now caught server side and replaced
  with a line about the card; the sentences are in `tests/test_confirmation_gate.py`
  verbatim. Treat an instruction in a prompt as a preference, not a guarantee.
- Voice mode speaks every assistant reply, including the greeting on page load, so
  reloads cost TTS calls once a working ElevenLabs key is in place. Text mode costs
  nothing. Edge TTS is free and is what runs while the key is rejected.
- ElevenLabs answers a voice id pasted into `ELEVENLABS_API_KEY` with 401
  `invalid_api_key`. Keys are long `sk_` strings; voice ids are 20 characters of mixed
  case such as `21m00Tcm4TlvDq8ikWAM`. `/api/speech/capabilities` still advertises the
  provider in that state because it can only see that a key exists, so both halves
  degrade at call time instead: synthesis to Edge TTS, and the recorder to browser
  recognition on the first 502 from `/api/stt`.
- Edge TTS is an unofficial websocket and it stalls. Observed: the request was
  accepted, no audio arrived, and the call ran out its timeout. That is why the
  browser's own speech synthesis sits behind it and why `/api/tts` answers 502 rather
  than an empty 200.

## Environment traps

- The Cohere key here is a trial key: a rolling window of 20 calls that replenishes,
  and 1000 calls a month. Do not run the live suite in a loop, and do not write a
  test that calls a provider when a deterministic one will do.
- `tsc` needs a few hundred MB. This machine has exhausted its commit charge before,
  at which point node processes die with "Zone Allocation failed" at around 130MB and
  it looks like a project failure. Check free memory before blaming the build.
- `uvicorn --reload` does not reload on this machine. It logs "Reloading..." and keeps
  the old worker: reproduced with StatReload and with WatchFiles, with and without
  `--timeout-graceful-shutdown`, and with no client connected at all. A minute later
  the worker PID is unchanged and still answering with the code from before the edit,
  so a fix looks like it did nothing. `dev.sh` runs without `--reload`; restart it
  after a backend change and believe the process list rather than the log.
- If port 8000 is held by a PID that `tasklist` says does not exist, the listening
  handle was inherited by a surviving child; kill the python processes by start time.
  `dev.sh` also takes the frontend down when the API dies, so a page that cannot reach
  its backend fails loudly instead of quietly.
- Never commit `backend/.env`, `backend/reservations.db`, `backend/outbox/` or
  `backend/.venv/`. All four are gitignored; do not un-ignore them.
- `NO_PROXY` on this machine includes `[::1]`, and httpx parses that as host `[` with
  port `:1]`. Anything constructing a client dies with
  `httpx.InvalidURL: Invalid port: ':1]'`, which looks like a code fault and is not one.
  Probed directly: the bracketed form fails, the bare `::1` is accepted and means the
  same thing. `dev.sh` strips the brackets for its own processes. `pytest` uses
  `TestClient`, which is httpx, so run it as
  `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 .venv/Scripts/python.exe -m pytest`.
- A Resend key is present in `backend/.env`, so `/api/health` reports
  `email_transport: resend` and a submission from the dev server sends real email to
  whatever address was typed. Before driving the UI with test data, start the API with
  `RESEND_API_KEY=""`, `DATABASE_PATH` and `OUTBOX_DIR` pointed at a temp directory.
  `load_dotenv()` does not override an existing empty variable, so this works without
  touching `.env`. Check `/api/health` says `outbox` before the first submission.
- Vite here listens on `[::1]:5173`. Use `http://localhost:5173`, not `127.0.0.1:5173`,
  or a browser check fails to connect and looks like a broken page.

## Conventions

- No em dashes anywhere, including in comments, commit messages and documentation.
- Comments explain why, not what. A comment that restates the code gets deleted.
- Do not add error handling for cases that cannot occur. Validate at boundaries: the
  HTTP edge, `localStorage` reads, and model output.
- Prefer the standard library and the platform over a new dependency. The frontend
  test suite runs on `node --test` with type stripping rather than a test framework,
  and the email transports use `urllib` rather than an SDK.
- TypeScript source imports use explicit `.ts` extensions so the same files run under
  Node's type stripping and Vite.

## Not built yet

- `scripts/latency.py` and `scripts/seed.py`, both presentation deliverables.
- Resend is written and a key is now loaded, but no message has been sent through it and
  read on the other side. The outbox transport is what has been observed working, writing
  `.eml` files. Treat the live transport as unverified, and see the trap above before
  letting a test reach it.
- ElevenLabs itself is unverified end to end. The key currently in `.env` is rejected,
  so every observation of the speech layer so far came from the Edge TTS and browser
  recognition fallbacks. The request shapes were checked against the published OpenAPI
  spec instead: both paths answer 401 rather than 404 or 405, `text` and `model_id` are
  the TTS body fields, `model_id` is the only required STT form field, and `text` is a
  required field of the STT response. So a valid key is the missing piece, not the
  integration. What has been seen working in a browser: `/api/tts` audio decoded into a
  5.2s buffer, the analyser reading real waveform from it, the avatar holding `speaking`
  for the length of the clip, push to talk recording and uploading, and the downgrade to
  browser recognition after a 502.
