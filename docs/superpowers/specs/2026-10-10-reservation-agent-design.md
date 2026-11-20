# Reservation Agent: Design

Date: 2026-10-10
Status: awaiting review
Source brief: `ac422523-3cb0-4373-8726-733254ecbad5.txt` (Voice Reservation Agent, Browser-Based, HITL)

## 1. Scope

This repo hosts the reservation agent: the browser chat experience, the browser-owned
slot memory, the thin backend, the LLM layer, guardrails, speech, and the human-in-the-loop
staff queue. It is a demo harness, so it is reachable on its own at `/chat` and `/admin`.

The repo also hosts the restaurant's marketing pages, now separate documents rather than
sections below the reservation conversation. Vite builds six HTML entries: reservations at
`/`, story at `/our-story/`, menu at `/the-menu/`, experience at `/the-experience/`, and the
`chat.html` and `admin.html` entries served by Vite at the `/chat` and `/admin` aliases.
`/chat` shows the same reservation workspace as `/`. The teammate's Figma file
(`UX Project`, `KKBTSw872wO5axaYKuOqYs`) supplied the reservation frame and visual language;
the marketing pages are this repo's own design. Reservations no longer includes those
marketing sections, and the agent does not depend on them.

## 2. Decisions that differ from the brief

These six came out of the conversation. They are deliberate, and the presentation should
describe the system as it is actually built.

| # | Brief says | This design does | Why |
|---|---|---|---|
| D1 | Approval is required before a reservation becomes official; approval sends an email | Submission is the moment the customer treats the table as theirs. Approving moves the row to `official` and sends nothing. Rejecting is the only path that contacts the customer | Staff act as a veto, not a gate. A demo where nobody clicks approve still leaves the customer with a real booking |
| D2 | Three email templates (received, approved, rejected) | Two: a receipt at submit, alternatives at reject | Follows from D1. The deliverable "screenshot of the approval email" becomes "screenshot of the booking receipt" |
| D3 | `pending` and `official` tables only, no availability source, yet the agent must suggest alternatives for booked slots | An availability engine exists: floor plan as an in-code data structure, occupancy in SQLite | Without it, "the chatbot is usually correct about timings" is a hope rather than a property |
| D4 | Not stated | A `pending` row occupies its table. Availability reads `pending` plus `official` | A customer who was told the table is theirs must not be silently double-booked. A reject releases the row |
| D5 | `submit_reservation()` is the only tool call, taking no arguments, and the model's `submit` flag triggers it | Submission is a browser function, not an LLM tool. The single state-derived receipt contains `ConfirmCard` actions when required slots are complete, independent of the model. Submission requires a button click or the guarded spoken affirmation in 4.4, behind a `submitting` latch | The customer sees the details before agreeing. A model's `submit: true` alone never authorizes a booking |
| D6 | Three storage keys, including `reservation_messages` holding the conversation array, and step 2 of the per-turn flow appends to it | Two keys: the slot object and the session id. The transcript lives in React state and is gone on refresh. Any `reservation_messages` key left by an earlier build is deleted on load | The transcript is where a name, email and phone number get written to disk in plaintext, and the slot object is already everything the agent needs. Returning to saved details requires consent before conversation resumes from the slots with empty history, per 4.1 |

Two smaller additions: `pending` gains a `status` column so a rejection can be marked rather
than deleted (the brief says "mark rejected" and gives nowhere to mark it), and a `table_id`
column because D3 makes table identity real.

## 3. Repository shape

```
frontend/
  index.html              # reservations: /
  our-story/index.html    # /our-story/
  the-menu/index.html     # /the-menu/
  the-experience/index.html # /the-experience/
  chat.html               # reservations alias: /chat
  admin.html              # staff queue: /admin
  vite.config.ts          # appType: mpa, six HTML build inputs
  src/
    main.tsx              # passes the HTML root's data-page to App
    App.tsx               # selects ChatPage, MarketingPage or AdminPage from page
    config.ts             # voice-vs-text default
    index.css             # palette, fonts, motion and responsive reservation workspace
    pages/                ChatPage.tsx, MarketingPage.tsx, AdminPage.tsx
    components/
      ChatPanel.tsx        # turn flow, resume/reset consent and submission gates
      MessageList.tsx      # internally scrolling, in-memory transcript
      Composer.tsx         # Text textarea with dictation, or Voice microphone
      PipDeck.tsx          # quick-answer buttons only
      ConfirmCard.tsx      # confirmation actions inside the receipt, no second summary
      HostCard.tsx         # portrait, Text/Voice toggle, voice status
      EveningPanel.tsx     # single state-derived receipt, long-field popovers and actions
      Avatar/             # one component per avatar state
      site/               # SiteHeader, HeroBand, StorySection, MenuSection,
                          # ExperienceSection, SiteFooter, Reveal, sections.ts, tabs.ts
    hooks/
      use-restaurant-config.ts  # one /api/config request shared by the whole page
      use-auto-resize-textarea.ts
    lib/
      format.ts           # dates and clocks as they read on screen
      hours.ts            # service status and the weekly hours, from config
      utils.ts            # cn
    state/
      types.ts            # ReservationState, SlotKey, ChatPayload
      storage.ts          # localStorage read/write, lazy session id, clearDraft, toChatPayload
      merge.ts            # mergeSlots
      validation.ts       # isValid
      pips.ts             # which quick answers a reply calls for
      confirmation.ts     # isAffirmation, for the voice path
    api/
      client.ts           # postChat, fetchAvailability, submitReservation
    speech/
      recorder.ts         # push to talk capture
      stt.ts              # Web Speech API, server STT behind a capability check
      tts.ts              # backend audio, browser fallback, the analyser
backend/
  app/
    main.py               # FastAPI: /api/chat, /api/submit, /api/tts, /api/admin/*
    config.py             # hours, slot grid, provider selection, email transport
    floor_plan.py         # the table literal
    availability.py       # status() and alternatives()
    storage.py            # SQLite: pending, official
    llm.py                # ChatProvider protocol, Cohere/Groq/Gemini/Fake, fallback
    guardrails.py         # Prompt Guard 2, output safeguard, regex backstop
    prompts.py            # system prompt, availability block rendering
    email.py              # transports: Mailgun or outbox files
    schemas.py            # pydantic: request, response, LLM output
  tests/
  requirements.txt
  .venv/
  outbox/                 # rendered emails when no provider key exists
```

Dev runs two processes: `uvicorn` on 8000, `vite dev` on 5173 with `/api` proxied to it.
One origin, so no CORS configuration and no credentials mode surprises.

### 3.1 The pages and reservation workspace

This is a Vite MPA, not client-side routing over one long page. Each HTML entry declares its
page through `data-page` on the root element; `main.tsx` passes that to `App`, which chooses
the reservation, marketing or admin component. Header and reservation links are ordinary
anchors to document URLs. The header marks the active link with `aria-current="page"` in
both desktop and mobile navigation; it no longer probes scroll position.

Reservations contains the host, conversation and one receipt, with a short hero above and
a compact footer below. At desktop widths of at least 1024px the page is a `100dvh` workspace:
the transcript scrolls inside `MessageList`, leaving the composer, quick answers and receipt
actions in view. The old 352 / 928 / 284px column contract is deliberately retired. The host
width and conversation space adapt to the viewport, with a 250px receipt inside the
reservation card and further compaction on short desktop screens. Below 1024px the compact
host, conversation and receipt stack in normal page flow; the transcript still has its own
scroll region. The story, menu and experience each live on their own marketing page.

Every restaurant fact used by the reservation workspace comes from `/api/config`: hours,
seating types, party limits and the facts block. The floor plan drawing on the experience
page is a schematic of the three seating areas and deliberately carries no table ids, because
the real plan lives on the server and a second copy here would drift from the engine.

The mode labels are **Text** and **Voice**. Text keeps the textarea, Send button and small
microphone for dictation. Voice replaces the textarea with a large microphone control; its
transcript still appears in the conversation. Switching modes stops capture, not playback.
Spoken output is on by default in both modes, with an independent Sound on/off button.
Muting stops active and pending playback and prevents new synthesis requests. Unmuting reads
out the latest assistant reply when idle. This preference lives only on the current page;
no third storage key is added. Text dictation is never permission to book, as 4.4 specifies.

### 3.2 Quick answers, without replacing the conversation

`pips.ts` reads the agent's last reply and offers quick-answer buttons. There are no pip
inputs, contact fields or guest steppers. Names, contact details and custom answers go through
the Text composer or Voice input instead.

Three rules make this safe:

1. **Only asking sentences select question-based chips.** The reply is split into sentences
   and only the ones carrying `?` or an ask verb are searched. A statement about an existing
   seating choice must not produce another seating question.
2. **Nothing here writes a slot.** Every chip ends in the same `send()` the textarea's button
   calls, so extraction, the merge rule and `isValid` all still apply. Seating chips carry
   the canonical backend token in their sentence ("The main dining room, a standard table.").
3. **Time choices come only from backend openings.** The deck never generates available times
   from the configured seating grid or the model's prose. No returned openings means no time
   buttons. Conflict alternatives likewise come from the backend.

At most three groups show, ordered by `SLOT_KEYS`. A time row can appear unasked when a date
is chosen, time is still missing and the backend has returned openings. Pips do not replace
the mode's composer; both are locked during a request or capture and while consent is pending.

### 3.3 One receipt, including confirmation

`EveningPanel` reads `state`, `config` and `confirmation`, never the agent's prose. It is the
only reservation summary. `ConfirmCard` now contains just the confirmation actions inside
that receipt, not a duplicate list of details. When the browser's required slots are complete,
it offers "Confirm booking" and "Change something". The latter switches to Text and focuses
the textarea. A submitted booking is read-only, without these actions.

Fields longer than 48 characters display a "View in full" button opening a native popover
with the entire value and a Close button. This keeps receipt controls visible on short desktop
screens without clipping or discarding long names, email addresses or notes.

`ChatPanel` writes merged slots and mirrors them into React state in the same call. A
`storage` listener re-reads `reservation_state` when another tab changes or clears it, cancels
the old conversation's chat/audio/capture, clears its transcript and recomputes whether consent
is needed. Non-empty or submitted state requires the resume dialog; an empty reset starts
fresh. A conversation-generation check also prevents a late submission response from restoring
an old booking over a newer draft, without cancelling any booking created on the server.

## 4. The state model

### 4.1 Stored shape

`localStorage` key `reservation_state` holds exactly the brief's schema, with `phone` taking
the slot of the brief's duplicated `name` key:

```typescript
type ReservationState = {
  date: string | null;              // "2026-10-11"
  time: string | null;              // "19:00"
  party_size: number | null;
  type: string | null;              // "booth" | "patio" | "standard"
  name: string | null;
  email: string | null;
  phone: string | null;             // digits only
  special_requests: string | null;
  submitted: boolean;
};
```

The only other persisted key is `reservation_session_id`: a UUID generated lazily at
submission and reused across refreshes and continuation of that draft. It is not a permanent
browser identity. Starting fresh removes both keys; the next submission creates a new UUID.
The transcript is held only in React state and is never persisted. `purgeLegacyKeys` removes
old `reservation_messages` and `reservation_mode` keys on load.

Returning to a non-empty saved draft opens a native modal dialog with **Continue** and
**Start fresh** before any greeting, TTS or chat turn. Escape cannot dismiss the resume choice.
Configuration and speech-capability requests can still load while the dialog is open.

Continue waits for restaurant config, revalidates saved values against today's date and the
current rules, and retains the existing session id. If the saved date is no longer valid,
its time is also dropped. Valid contact details and other valid slots survive. The browser
then sends a synthetic continuation intent to `/api/chat` with the revalidated slots and an
empty `messages` history, asking for the next missing detail or confirmation and refreshed
room openings. The resume turn uses the backend's reply and openings but ignores all model
slot changes and can never auto-submit, even if `submit` is true.

For a submitted state the same dialog offers **View booking** instead of Continue. Viewing
restores the saved details read-only, with no model call or spoken greeting. It is not a new
booking or a fresh availability check.

**Start over** stays visible in the reservation header, including after submission, and opens
a confirmation dialog rather than clearing immediately. **Keep planning** or Escape dismisses
that reset prompt without discarding the draft. **Start fresh**, from either dialog, cancels
old chat requests, audio and capture; clears the transcript, draft UI and both storage keys;
and starts a fresh greeting in the current mode. Reset controls are disabled while this tab
is submitting. Starting fresh never cancels a previously submitted server booking.

### 4.2 What crosses the wire

The brief forbids the model ever seeing `submitted` or `session_id`, but the stored object
contains `submitted`. So the wire type is narrower than the stored type, and the narrowing is
one named function rather than an inline delete:

```typescript
type SlotValues = Omit<ReservationState, "submitted">;

function toChatPayload(state: ReservationState): SlotValues {
  const { submitted: _submitted, ...slots } = state;
  return slots;
}
```

`session_id` is never part of this type. It appears only in `POST /api/submit`. This is the
kind of rule that silently rots when someone adds a tenth field, so it is expressed as a type
that will fail to compile rather than a comment that will not.

### 4.3 Per-turn flow

1. Read state, initialising empty slots and `submitted: false` if absent. A saved draft or
   submitted booking first follows the consent flow in 4.1; the steps below describe a normal
   turn after that choice.
2. Append the user message to the in-memory transcript. It is not persisted, per D6.
3. `POST /api/chat` with `{ state, messages, message, current_date }`, where `state` is
   `toChatPayload(state)`.
4. Server runs guardrails on `message`. If flagged, it returns a refusal, `slots` equal to the
   state it received, `changed: []`, `submit: false`, and never calls the main model.
5. Server calls `availability.status()` when the incoming state has both a date and a time,
   and renders the result into the system prompt as fact.
6. Provider returns `{ reply, slots, changed, submit }` through native structured output.
7. Server validates with pydantic. Malformed means one retry, then the no-op fallback.
8. Server responds with the four output fields plus `availability` and backend-computed
   `openings` for time choices.
9. Browser validates each incoming slot with `isValid`, merges with `mergeSlots`, writes once.
   The continuation turn in 4.1 is the exception: its revalidated saved slots are kept unchanged.
10. Browser renders `reply` as text and speaks it unless sound is muted, regardless of input mode. A turn passing the spoken
    confirmation gates proceeds to submission instead, using the submission result for its reply.
11. The single receipt always reflects browser state. When every configured required slot is
    filled, the draft is not submitted and no consent dialog is open, it gains `ConfirmCard`
    actions. The model does not decide whether those actions appear. See 4.4.
12. On explicit confirmation, the browser calls `submitReservation()` to read stored slots and
    lazily obtain the session id, then sends `POST /api/submit` with
    `{ ...toChatPayload(state), session_id }`.
13. Server re-runs `availability.status()`. Still free means it inserts the `pending` row,
    sends the receipt, and returns `{ submission_id, table_id }`. Taken means HTTP 409 with
    `{ error: "slot_taken", alternatives: [...] }`, no row, no email. A party no single table
    can seat means HTTP 422 with `{ error: "no_table" }`, also no row and no email.
14. On success, if this is still the same conversation generation, the browser sets
    `submitted: true` and shows a read-only booking with no further LLM turns. If another tab
    has reset or replaced the draft in the meantime, the late response cannot change the newer
    draft or append a stale confirmation. This is a browser-state guard, not server cancellation.
15. On 409 the browser offers the alternatives as buttons. `submitted` stays false; choosing
    one sends the next message and resumes at step 3. A `no_table` 422 shows the largest table
    size and asks the customer to call the restaurant. Other validation failures explain which
    details need correcting. No row is written for either refusal.

### 4.4 What counts as confirmation

The brief makes `submit: true` mean "all slots filled and the user clearly confirmed", and the
per-turn flow then POSTs `/submit`. Read literally, the confirmation summary card can only
appear after the customer has already said yes, which is backwards for criterion 6: the summary
is what the customer is confirming.

Confirmation actions therefore appear from browser completeness, not from the model's flag.
The receipt already shows the details they approve; `ConfirmCard` adds no second summary.

Completeness follows `/api/config.required_slots`, currently `date`, `time`, `party_size`,
`name` and `email`. Phone and special requests are optional, as is seating type. A null type
means any fitting table serves; a chosen type is honoured strictly, per 6.2.

- **Text mode.** Clicking "Confirm booking" is the explicit confirmation. Neither a typed
  affirmation nor microphone dictation can auto-submit, regardless of the model's `submit`
  flag. A Text dictation turn remains ineligible even if the user switches to Voice while
  waiting for its response.
- **Voice mode.** Automatic submission requires all of these: a spoken turn, a complete draft
  before the utterance was sent, `isAffirmation` accepting that utterance, `submit: true` in
  the response, and Voice selected both when sending and when handling the response. A turn
  that first completes the details cannot book them too. Resume turns never auto-submit.
  The same "Confirm booking" button remains available as an explicit alternative.

The button is temporarily disabled while busy, listening or waiting for configuration, but
not by a stale chat `availability` result that may describe the previous time. A corrected
slot can still be submitted for the server's authoritative room recheck. HTTP 409 or 422
then reports a conflict or invalid request rather than letting an old chat result lock the UI.

Both routes use the same `submitReservation()` path guarded by the browser's `submitting`
latch. The server also checks the session id for an existing active booking, so a retry does
not create a second row. A fresh draft gets a new session only at its next submission.

## 5. Merge and validation

Exactly the brief's function, with `SlotKey` typed so an unknown key from the model cannot
reach state:

```typescript
const SLOT_KEYS = [
  "date", "time", "party_size", "type",
  "name", "email", "phone", "special_requests",
] as const;
type SlotKey = (typeof SLOT_KEYS)[number];

function mergeSlots(
  current: ReservationState,
  incoming: Partial<Record<SlotKey, unknown>>,
  changed: readonly string[],
): ReservationState {
  const merged = { ...current };
  for (const key of SLOT_KEYS) {
    const value = incoming[key];
    if (value === null || value === undefined) continue;
    if (!isValid(key, value)) continue;
    const wasEmpty = merged[key] === null;
    if (wasEmpty || changed.includes(key)) assign(merged, key, value);
  }
  return merged;
}
```

`SLOT_KEYS` is `as const`, so the loop is exhaustive by construction and a ninth key the model
invents has nowhere to land. `assign` is a three line generic helper whose only job is to let
TypeScript see that key and value arrive together; writing `merged[key] = value` directly would
need a cast, and a cast in the one function that guards memory is where reviewers stop trusting
it.

One write per turn, after merge, never per slot. `submitted` is never mergeable: it is not in
`SlotValues`, so the model cannot flip it.

Validation rules, all as the brief specifies:

| Slot | Rule |
|---|---|
| `date` | parseable ISO date, today or later, within 90 days |
| `time` | parseable 24h, within `config.openHours` for that weekday, on the slot grid |
| `party_size` | integer 1 through 20 |
| `email` | basic regex, length cap |
| `phone` | stripped to digits, 10 through 15 |
| `name`, `special_requests`, `type` | non-empty string, length 200 or less. `type` additionally restricted to the three known values |

A failure drops the value silently. No rejection is reported to the model, because the next
turn re-asks for any still-empty slot and an argument about it would be worse than the
question.

The same rules exist again in `backend/app/schemas.py`. Duplicated on purpose: the browser
version protects state, the server version protects the queue, and neither can be trusted to
have run.

## 6. Availability

### 6.1 Floor plan, in code

```python
@dataclass(frozen=True)
class Table:
    id: str          # "B1"
    seats: int
    type: str        # "booth" | "patio" | "standard"

TABLES: list[Table] = [
    Table("B1", 2, "booth"),  Table("B2", 4, "booth"),
    Table("B3", 4, "booth"),  Table("B4", 6, "booth"),
    Table("P1", 2, "patio"),  Table("P2", 4, "patio"),
    Table("P3", 4, "patio"),
    Table("S1", 2, "standard"), Table("S2", 4, "standard"),
    Table("S3", 4, "standard"), Table("S4", 6, "standard"),
    Table("S5", 8, "standard"),
]
```

Twelve tables, eight seats maximum, is an assumption and the whole point of keeping it in a
literal: changing the room is changing this list, with no migration and no seating admin UI.
`seats` is a hard cap, not a comfort preference, so a party of 6 may be offered a 6 top but not a
4.

One boundary the brief's rules leave open: `party_size` is valid up to 20, but no table seats 20.
The resolution is explicit rather than improvised. A party larger than the biggest single table
gets `status = "no_table"`, which is not the same as "booked": there are no alternatives to offer,
because no arrangement of the room serves them at any time. The agent says so and offers to have
the team call, and `/submit` refuses the row. Reserving one table per party keeps that logic to a
comparison instead of a subset-sum over tables.

`no_table` has a second cause that is not the room's size: a seating type that cannot seat the
party. No booth seats more than 6, so a booth for 8 is `no_table` while the room seats 8 at S5.
Quoting the room's limit for that request produced the observed contradiction "the largest table
seats 8, so I cannot seat a party of 8", and sent a customer away to phone about arranging a room
that could already seat them. `SlotStatus.capacity` therefore carries the largest table of the
*requested kind*, and both the prompt block and the spoken reply name that limit and offer the two
ways out: another kind of table, or the requested kind for fewer guests.

### 6.2 Config

Assumed values, all in `backend/app/config.py`, all literal edits:

- Tuesday through Sunday, 16:00 to 22:00. Last seating 21:00. Monday closed.
- 30 minute slot grid.
- Party of `n` needs a table with `seats >= n`.
- A `type` in state is a preference. It is honoured strictly: if a party of 6 asks for the
  patio and no patio table seats 6, the answer is unavailable with alternatives, not a silent
  switch to a standard table.

### 6.3 Computation

```python
def status(date, time, party_size, type_, *, occupied) -> SlotStatus
def alternatives(date, time, party_size, type_, *, occupied, limit=3) -> list[SlotStatus]
```

Candidate tables are those big enough and of the right type. Occupied is the set of
`table_id` held at that date and time by rows in `pending` plus `official`. The chosen table
is the smallest fitting candidate, so a party of 2 does not consume the 8 top.

`SlotStatus.state` is one of three, and the distinction is what keeps the agent's wording
truthful: `available` with a `table_id`, `booked` with the alternatives worth offering, and
`no_table`, meaning no table of the requested kind can serve this party so there is nothing to
offer. `capacity` says which limit binds, as described in 6.1.

`alternatives` scans the remaining slots of that evening outward from the requested time in
30 minute steps and returns the first three that resolve, each with a concrete `table_id`.

`occupied` is a parameter, so the same function serves the prompt injection, the submit gate,
the admin conflict view, and the unit tests.

### 6.4 How the model sees it

Injected, never discovered. The system prompt gains a block the model did not produce:

```
AVAILABILITY (server computed, treat as fact)
Requested 2026-10-11 (sun) at 19:00 for 4, preference booth: BOOKED.
Tables already held at this time: booth 4, standard 2.
Free alternatives, the only times you may offer:
  19:30, seats 4, booth
  20:00, seats 4, booth
  20:30, seats 4, standard
```

When the requested slot is free the block says `AVAILABLE`, reports the held counts the same
way, and ends with "Do not mention the table identifier". Counts and never identifiers,
because which table a party gets is the engine's decision at submission time, and a model that
can name a table can promise one. The held line appears whenever occupancy was actually
queried and reads `none` for an empty room, so a missing line is never left for the model to
interpret; `no_table` omits it, because that branch answers before occupancy is read and a
zero there would be a fact nobody checked.

The held counts exist because a live Command A+ run was asked "is there already another booking
at that time" and answered "there are no other bookings at that exact time" while a `pending`
row held a booth at exactly that time. The block carried no occupancy at all, so the answer was
invented rather than misread. The engine had already computed the occupied set in order to pick
a table, and discarded it.

The rules for `reply` then cover the rest: suggest from the listed alternatives only, leave
`slots` unchanged until the customer picks, never name a time that is not in the block.

`availability` also comes back in the HTTP response, because the UI needs the assigned
`table_id` for the receipt and needs the alternatives as chips. The held counts do not: they
are prompt material, and `as_dict()` leaves them out so the browser's contract is unchanged.
`capacity` is left out for the same reason.

The block describes the draft as it stood *before* the customer's message, because the prompt is
built before the model reads it. So it is missing on a turn that first learns the date and time,
and stale on a turn that changes the party, the time or the seating kind. `/api/chat` resolves the
room again against the extracted slots in both cases, and states the answer itself rather than
spending a second model call:

- `booked` or `no_table` replaces the reply with `conflict_reply`, every time in it coming from
  the engine.
- `available` appends `available_reply`, so whatever the model asked for next survives. It
  replaces instead when the prompt had said the room could not serve the draft, because the
  model's reply then argues with the new answer.

That last path exists because of a second observed failure: told "ok 6 guests then", the agent
said "Let me check if a booth is available then" and nothing followed. The server had computed
`available` and had no sentence for it, so a promise was the last thing the customer heard.

A `booked` turn drops `time` from the slots, because a time the room cannot honour is never
stored. A `no_table` turn keeps it: the party or the seating kind is what cannot be served, at
every time, so the time is innocent, and deleting it left the next turn with nothing to check.

### 6.5 What the room has free, not just the slot that was asked about

The requested-slot view alone cannot answer "what do you have free on Saturday",
because it only resolves once the customer has already named a date, a time and a
party. A model with no data for that question either stalls or invents times, so
`availability.openings()` lists every seating that day which can still serve the
party, with a count of free tables per seating type.

It is rendered into the prompt as an `OPENINGS` block whenever the draft has a
valid date, filtered by party size but deliberately not by seating type, so the
model can answer "is a booth free at seven" from the same block. Table identifiers
are never shown to the model: which table a party gets is the engine's decision at
submission time, and a model that promised table B2 would be making a claim the
system does not honour.

The same first-turn problem as 6.4 applies: on the turn where the date first
appears, the prompt had no openings in it. So the server resolves openings against
the merged slots after the model answers, and when the message asked about
availability, composes the reply itself from the engine's list. `openings` is also
returned in the HTTP response, and the browser renders each free time as a chip
while no time is chosen, so picking one is a click on something the engine says is
free rather than a guess that gets refused.

Detection of "is this an availability question" lives in `prompts.py` and is shared
with the deterministic provider, so the server and the fake model cannot disagree
about what counts as one. "Do you have a patio?" stays a question about the room
and is answered from `FACTS`; "do you have a patio table free at seven?" is an
availability question and is answered from the engine.

## 7. LLM layer

```python
class ChatProvider(Protocol):
    async def complete(self, system: str, messages: list[Message],
                       schema: dict) -> AgentOutput: ...
```

Selected by `LLM_PROVIDER`. Implementations: `cohere`, `groq`, `gemini`, `fake`.

Structured output comes from each provider's native constrained decoding, per the brief.
LangChain's `with_structured_output()` wraps the three, and using it is the brief's explicit
instruction, so the plan uses it and isolates it entirely inside `llm.py`. If `langchain-cohere`
or `langchain-groq` does not resolve on Python 3.14, the fallback is a direct call against each
vendor SDK behind the same protocol. Nothing above `llm.py` can tell the difference, so this is
a contained swap rather than a rearchitecture.

Two facts are not yet established and are the first backend tasks:

- The Command A+ deployment ID. Cohere's docs are unreachable from here, so
  `scripts/list_models.py` calls the account's models endpoint with the real key and prints
  the deployable strings. No guessing in a model ID: a wrong one is a 404 at demo time.
- The Groq fast path ID, from the same kind of listing. Confirmed already as available on Groq:
  `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, and a Qwen 3 variant.

Fallback chain: `asyncio.wait_for` at 3 seconds, Cohere then Groq then Gemini. If all three
fail, the response is the brief's canned "sorry, could you repeat that?" with `slots` set to
the state we received and `changed: []`, which makes the browser merge provably a no-op. That
is the property that matters under failure: no provider being reachable must never corrupt
memory.

`gemini` is implemented for the chain's sake but will not be verified, since you have Cohere and
Groq keys. It ships as unverified code, and the plan says so.

### 7.1 The fake provider

`FakeProvider` is deterministic, rule-based extraction over the message text: recognises dates,
clock times, "table for N", email, phone, booth/patio/standard, and explicit correction markers
("actually", "make it", "no,"). It is the default in tests and is what makes criterion 4 stable.

The brief's criterion 4 test, "feed the LLM a message with no slot info and confirm state is
unchanged", is flaky against a live model and exact against the fake. Live providers get the
same scripted transcript in a `pytest -m live` suite that is skipped unless keys exist.

## 8. Guardrails

Order, because it controls cost and blast radius:

1. Inbound: `guardrails.py` sends the raw user text to Groq
   `meta-llama/llama-prompt-guard-2-86m` (falling back to the 22m if the account is rate limited)
   with a jailbreak or injection classification task. Flagged means a refusal reply, the main
   model is not called, and state is untouched. One small classifier call, not a large chat call.
2. Main model: only reached when inbound is clean.
3. Output: pydantic validation against `AgentOutput`, and any key not in `SlotValues` is
   rejected before the response is sent. A schema that does not validate is retried once, then
   the no-op fallback.
4. Content safeguard: Groq `openai/gpt-oss-safeguard-20b` on the outgoing `reply`, behind
   `SAFEGUARD_ENABLED`. Off by default because it doubles the per-turn model calls for a benefit
   the demo cannot show. A regex backstop for obvious injection markers runs regardless, since
   it is free.

Honest risk to name: Prompt Guard 2 is a 22M to 86M classifier. Small classifiers produce false
positives on ordinary text, and restaurant conversation contains idioms that read as violent to
a tiny model ("I could kill for a table by the window"). The refusal path must therefore never
clear state, and a flagged turn must remain re-askable. Guardrail behaviour gets its own test
case for exactly that idiom.

## 9. Speech

### 9.1 STT

Text dictation uses the Web Speech API in `speech/stt.ts`, with `continuous: false` and
`interimResults: true`. Voice mode prefers recorded audio sent to `/api/stt` when server
capabilities advertise ElevenLabs transcription. A failed server transcription withdraws that
capability for this page and offers browser recognition instead. Neither API key reaches the
browser. The text composer remains usable when microphone permission or recognition fails.

### 9.2 TTS

Sound is on by default, independently of Text or Voice input. The greeting, chat replies and
booking confirmation use the existing `/api/tts` endpoint, which prefers ElevenLabs and falls
back to Edge TTS. The team has tested ElevenLabs successfully; the earlier rejected-key
observation is historical, not a current setup requirement. The `x-tts-provider` response
header identifies the voice that actually plays, in either input mode.

`speech/tts.ts` decodes the returned audio into a shared `AudioContext`. An `AnalyserNode`
measures RMS waveform amplitude each animation frame; this drives the mouth rather than a
free-running speaking loop. Speaking begins at playback start, not while fetching or decoding.
Silence produces zero level. Muting aborts pending synthesis or autoplay waits, stops active
playback, closes the mouth and prevents further speech requests. An already accepted server
synthesis may still consume provider quota. Input-mode changes leave output playing; starting
microphone capture, sending a new turn, resetting or leaving the page stops it.

If autoplay is blocked, the page says sound will start on interaction and waits without marking
the host as speaking. A pointer or keyboard gesture in the conversation resumes the context.
Only the current reply can be queued; mute or cancellation discards it. The browser's autoplay
policy still decides whether a fresh page may speak before that first gesture.

When server audio cannot be produced or decoded, browser `speechSynthesis` is the final fallback.
Its actual start/end events drive speaking state, and word-boundary events produce short mouth
movements when supported. No waveform or phoneme alignment is claimed for that fallback.
Every spoken line remains visible as text, whether sound is enabled or muted.

Microphone capture needs HTTPS or localhost. Localhost during development is fine. A campus
network demo needs the built app served over TLS, not a bare `vite preview` on an http URL.

## 10. Avatar

The avatar accepts `idle`, `listening`, `thinking`, `speaking` or `error`. `speaking` is the
analyser-driven state. ChatPanel derives this single state from the turn flow and actual audio
playback. All states now share one mounted renderer rather than replacing the portrait component
and WebGL context on each transition.

The host lives inside `HostCard`, beside independent input-mode and sound controls. A
lazy-loaded Three.js renderer draws a local stylized 3D bust with dark hair, warm skin, a
cream dinner jacket and bow tie against a gold oval. There is no remote avatar service or
model download. The existing 236:276 portrait footprint is retained across desktop and mobile.

The jaw and lips follow the decoded waveform amplitude, opening a real mouth cavity and
revealing teeth. This is amplitude-driven articulation, not phoneme-accurate lip sync. Silence,
muting, cancellation and every non-speaking state close the mouth. Reduced motion disables
idle head movement and blinking, while speech articulation remains tied to audible output.
The renderer stays mounted across state changes and releases its graphics resources on unmount.

If WebGL is unavailable or its context is lost, the original SVG portrait remains visible
with a rudimentary animated mouth in the same position. Both renderers share the same audio
level and silence rules; the fallback does not pretend to have phoneme alignment either.

## 11. HITL queue and admin

Endpoints, all under `/api`:

| Method | Path | Behaviour |
|---|---|---|
| POST | `/chat` | Guardrails, availability, provider chain, validated response |
| POST | `/submit` | Re-check availability, insert `pending`, send receipt, return `submission_id` and `table_id`. 409 with alternatives when the slot went, 422 when no table can seat the party |
| GET | `/availability` | `date`, `party_size`, optional `type`. Powers the composer chips and the reject alternatives |
| GET | `/admin/pending` | Pending rows plus computed conflict flags |
| GET | `/admin/stream` | Server-Sent Events, notified on submit and on approve or reject |
| POST | `/admin/approve/{id}` | Copy to `official`, mark the pending row approved. No email |
| POST | `/admin/reject/{id}` | Mark rejected, release the table, send alternatives |
| POST | `/admin/reset` | Wipe both tables for demo reruns. Not linked from the UI |

`pending.status` is one of `pending`, `approved`, `rejected`. Approving copies rather than moves,
so the audit trail survives a reset-free demo. Availability counts rows with status `pending` or
`approved`, which is D4.

Rejecting computes alternatives at reject time through the same `availability.alternatives()`,
so the alternatives email contains real openings rather than invented ones.

`/admin` is a plain React table: date, time, party, type, table, name, email, phone, special
requests, age, Approve and Reject. Minimal styling, as the brief says.

Freshness uses `GET /api/admin/stream`, a Server-Sent Events endpoint fed by an in-process
notify call at the end of `/submit`, plus a full refetch when the tab regains focus. Criterion 8
asks for the pending row to appear within 1 second, and polling cannot promise that: a 5 second
interval is a 5 second average with a 5 second worst case, and a 1 second interval only looks
like it works until two turns collide. SSE is roughly twenty lines of async generator and an
`EventSource`, and it is the honest answer. A manual refresh button stays so a presenter is never
at the mercy of the transport.

`scripts/seed.py` writes a handful of `official` rows so that a specific Saturday evening is
full. The demo can then show the suggestion path on cue instead of hoping a model asks for a
clash.

## 12. Email

`email.py` picks a transport from config: Mailgun when `MAILGUN_API_KEY`, `MAILGUN_DOMAIN` and
`EMAIL_FROM` are all set, otherwise the outbox transport writes the rendered message to
`backend/outbox/` and logs the path. The domain is a path segment of the sending URL
(`https://api.mailgun.net/v3/<domain>/messages`), so a key alone cannot address the API, and the
sender has to belong to that domain. The flow is identical either way, so the queue is testable
before any email key exists and the deliverable screenshot is producible from the outbox file.

Templates, two per D2:

1. **Receipt**, sent at submit. Reads like a confirmation: date, time, party, table, name, the
   special requests the customer gave, and a line that staff will verify the booking. Not the
   brief's "our team will confirm shortly", because under D1 the customer is right to read the
   booking as made.
2. **Alternatives**, sent at reject. Says the slot could not be held and lists three real
   openings from the availability engine.

## 13. A/B variant

`config.ts` chooses the initial mode from `?mode=voice` or `?mode=text`, then `VITE_AGENT_MODE`,
then Text by default. The on-screen Text/Voice toggle changes the current page's mode without
persisting another storage key. Criterion 10 is satisfied by the URL parameter or toggle,
with no code change or rebuild. The input and confirmation differences are in 3.1 and 4.4.

## 14. Testing

Deterministic checks keep the same commands, run from the repository root:

```bash
(cd frontend && npm run test:state && npm run typecheck)
(cd backend && NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 .venv/Scripts/python.exe -m pytest -m "not live")
```

Frontend tests use `node --test` with Node 24 type stripping and a small `localStorage` shim.
The suites cover `state`, `confirmation`, `validation-parity`, `pips`, `hours`,
`site-navigation`, `speech-lifecycle` and `avatar`. Navigation tests use Vite to verify direct
HTML handling and the six build entries. Speech tests cover actual-start notifications, silence,
autoplay waits, fetch/decode cancellation and audio-graph cleanup using controlled browser APIs.
Avatar tests exercise the real mesh deformation, lips, cavity, reduced motion, resource reuse
and SVG fallback. None of these tests calls live providers.

- Criterion 3: a correction turn with `changed: ["party_size"]` overwrites, and the same value
  arriving without `changed` on a non-empty slot does not.
- Criterion 4: incoming slots for a message with no slot info, plus a hallucinated
  `email` that fails `isValid`, leave state byte-identical.
- Merge-rule edge cases: null values, unknown keys, empty strings, out-of-range party size.
- Pips: statements do not select question-based chips, contact questions have no pip fields,
  seating chips carry backend tokens, and time buttons use returned openings only. Configured
  hours supply open date choices, not an invented list of available times.
- Storage and confirmation: clearing a draft removes both allowed keys, a later session id is
  distinct, and affirmative speech is checked separately from questions and corrections.
- Navigation: document links and `aria-current="page"`, direct page and alias requests without
  an SPA fallback, and six independently selected HTML entries in the production build.
- Hours: the service status at the boundaries, the last seating plus one slot as closing, and
  a window that wraps past midnight.

Backend, `pytest` with `fastapi.testclient` and a temp SQLite file per test.

- `availability`: capacity boundaries, type preference, smallest-fit table choice, the
  pending-occupies rule, alternatives ordering and the limit of 3.
- `POST /chat` against `FakeProvider`: no slot info means no state change; an off-topic question
  returns a reply with `slots` unchanged (criterion 5); a correction sets `changed`.
- Guardrails: a flagged message never reaches the provider, and the idiom false positive above
  does not clear state.
- `POST /submit`: happy path writes pending and fires the receipt into the outbox; a taken slot
  returns 409 with alternatives and writes nothing.
- Admin: approve copies to official and sends nothing; reject releases the table so the same slot
  becomes available again; reset empties both tables.
- Fallback: a provider that raises and a provider that exceed 3 seconds both produce the no-op
  response with `changed: []`.

Live suite, `pytest -m live`, skipped unless both keys exist: 20 scripted utterances against
Cohere and Groq asserting slot extraction, `changed` correctness, submit gating, and the
hallucination check against a real model.

Browser verification uses the external Playwright script
`C:/Users/jbnou/pw-scratch/marios-pages.mjs`, not a repository dependency. Run it with `node`
against an isolated API using the fake provider, a temporary database and outbox directory,
and `MAILGUN_API_KEY=""`. Before any test booking, its health check requires
`email_transport: outbox` and `provider_chain: ["fake"]`. The script defaults to the frontend
at `http://localhost:5174` (`MARIOS_URL` can override it) and routes API requests to
`http://127.0.0.1:8010`. Speech capability and TTS responses are stubbed; these checks do not
verify live speech or email delivery.

Current coverage replaces the old fixed-width and pip-field browser checks:

1. **Pages and layout.** Navigation loads independent documents, each marketing page contains
   only its own section, and the active anchor has `aria-current="page"`. Returning to
   Reservations with saved slots shows the consent dialog. At 1440x900, 1366x768, 1024x768 and 1280x720,
   the workspace, receipt, pips and composer fit without page overflow in Text and Voice.
   Voice has a large microphone and no textarea; Text retains its dictation microphone.
   Long saved notes open in a native popover with their full value while confirmation stays
   visible. The script does not assert the retired 352 / 928 / 284px widths.
2. **Draft lifecycle and booking.** Continue resumes at the missing detail; expired saved
   dates also lose their times without dropping valid contact details. Start over asks first,
   Keep planning preserves the draft, and Start fresh removes both storage keys. A submitted
   booking reloads read-only behind View booking; a later fresh booking gets a different
   session and submission id while both rows remain in `/api/admin/queue`.
3. **Confirmation races.** Controlled responses check that Text dictation cannot authorize
   booking even when switched to Voice before the response, a late submission cannot overwrite
   a draft reset in another tab, and stale chat availability cannot disable confirmation of
   a corrected time. A positive Voice affirmation submits once, microphone denial leaves Text
   usable, and a chat reply arriving after reset cannot refill the draft. These are deterministic
   browser checks, not provider guarantees.
4. **Mobile.** At 390x844 the stacked receipt and controls do not overflow horizontally;
   composer, pip and mode buttons have at least 44px touch targets. Voice still replaces the
   textarea, and mobile navigation opens a separate marketing document. Pips are buttons only,
   with no fields or steppers.

The companion `C:/Users/jbnou/pw-scratch/marios-speech.mjs` checks default-on sound in Text,
mute cancellation during synthesis and playback, prevention of further synthesis while muted,
input-mode independence, controlled autoplay suspension, held-pointer and keyboard mute races,
waveform-driven mouth movement and silence, desktop fit, mobile fallback, and loss of an active
WebGL context. It uses the same isolated API and generated audio with a silent interval. Set
`MARIOS_LIVE_SAMPLE` to a cached ElevenLabs audio file to include playback of a real provider
response without spending quota again. Both scripts check for page errors; all 29 checks
passed against the production preview.

One short live `/api/tts` request returned ElevenLabs MP3 audio, which was then decoded and
played through the 3D host in the browser. Live microphone transcription was not reverified
in this change. Receipt delivery, criterion 1 (under 90 seconds) and the admin queue appearing
inside a second also require separate verification; the fake/outbox checks do not establish them.

Latency harness, `scripts/latency.py`. One methodological caveat worth stating before the
presentation rather than during it: schema-validated structured output cannot be streamed,
because a partial object is by definition invalid. So TTFT is measured on a streaming reply-only
call to the same model, and the structured turn is measured as total time. Both numbers go in
the chart, labelled, rather than one number presented as the other.

## 15. Risks

| Risk | Handling |
|---|---|
| LangChain provider packages lag on Python 3.14 | Verified in the first backend task. Contained fallback to vendor SDKs behind the same protocol |
| Command A+ ID unknown, Cohere structured-output parameter shape unconfirmed | Resolved against the live account before any prompt work depends on it |
| Prompt Guard 2 false positives on ordinary idioms | Refusal path never clears state; dedicated test case |
| Edge TTS is unofficial and can break without warning | Browser `speechSynthesis` fallback keeps the demo running, with the avatar degrading visibly |
| Web Speech API is Chromium-only in practice | Text path is always available; the demo is specified for Chrome or Edge |
| Mic needs a permission prompt and a secure origin | Localhost in dev, HTTPS build for the campus demo |
| Two processes to run for a live demo | A single `npm run dev:all` wrapper, and a smoke script that asserts both ports answer |
| Gemini provider unverifiable without a key | Ships as unverified code and is labelled that way in the plan |

## 16. Acceptance criteria traceability

| # | Criterion | Where it is satisfied |
|---|---|---|
| 1 | Reservation in under 90 seconds | Manual script, section 14 |
| 2 | State survives refresh, tab switch, popup close and reopen | Saved slots return behind native consent. Continue revalidates them, preserves the session, and resumes with empty history and refreshed backend openings; it cannot auto-submit. View booking restores submitted details read-only without a model call. Cross-tab changes refresh state and consent; Start fresh clears both keys. The transcript is never persisted. See 4.1 |
| 3 | Corrections update the slot | `changed` gate in `mergeSlots`, unit tested |
| 4 | Hallucinated values never enter state | `isValid` plus the `changed` gate, unit tested and covered by `-m live` |
| 5 | Off-topic questions do not corrupt state | Prompt rules plus no-op merge, backend test |
| 6 | Confirmation summary matches the customer | `EveningPanel` is the single receipt from browser state, with `ConfirmCard` actions and native popovers for long values; it never reads model prose |
| 7 | Submit fires only after explicit confirmation | Button click, or all spoken gates in 4.4: already complete, affirmative utterance, response `submit: true`, Voice at send and response, never a resume turn or Text dictation. Submission rechecks the room server-side |
| 8 | Pending appears in admin within 1 second | SSE push from `/submit`, plus a test that the row exists and the notify fires immediately |
| 9 | Approval and rejection behave correctly | Reworded per D1: approve moves to official silently, reject notifies with alternatives |
| 10 | Voice versus text A/B with no code change | `VITE_AGENT_MODE`, `?mode=` and the in-memory Text/Voice toggle; no third storage key |

## 17. Build order

The plan will decompose this into five slices, each independently verifiable:

1. Repo split into `frontend/` and `backend/`, plus the two unresolved provider facts.
2. State module and tests: types, storage, validation, merge. No UI, no network.
3. Backend core: config, floor plan, availability, storage, the fake provider, `/chat` and
   `/submit`. The whole agent becomes testable with zero external calls.
4. UI: ChatPanel and the per-turn flow, Composer extracted from the mock, MessageList,
   ConfirmCard, Avatar states, admin table.
5. Real providers, guardrails, speech, email, latency harness, seed data.

Slice 3 is where the design either holds or does not, because it is the first point at which
"usually correct about availability" is either a property of the system or a claim.
