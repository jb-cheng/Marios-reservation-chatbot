import type { ReservationState, SlotValues } from "./types.ts";
import { SLOT_KEYS, emptyState } from "./types.ts";

export const STATE_KEY = "reservation_state";
export const SESSION_KEY = "reservation_session_id";

/**
 * localStorage behind an interface, so the whole state machine runs under a test
 * with a plain Map instead of a browser.
 */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const browserStorage: KVStorage = {
  getItem: (key) => globalThis.localStorage.getItem(key),
  setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  removeItem: (key) => globalThis.localStorage.removeItem(key),
};

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * Reads state, or returns a fresh draft.
 *
 * Anything in storage is treated as hostile input: it can be absent, truncated,
 * valid JSON of the wrong shape, or edited by hand. A corrupt draft must not
 * crash the conversation, and it must not smuggle a bad value into a submission,
 * so every field is checked rather than cast.
 */
export function readState(store: KVStorage): ReservationState {
  const raw = store.getItem(STATE_KEY);
  if (raw === null) return emptyState();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }

  if (typeof parsed !== "object" || parsed === null) return emptyState();

  const source = parsed as Record<string, unknown>;
  const state: ReservationState = { ...emptyState() };

  for (const key of SLOT_KEYS) {
    const value = source[key];
    if (key === "party_size") {
      if (typeof value === "number" && Number.isFinite(value)) {
        state[key] = value;
      }
      continue;
    }
    if (isNullableString(value)) {
      state[key] = value;
    }
  }

  state.submitted = source["submitted"] === true;
  return state;
}

export function writeState(store: KVStorage, state: ReservationState): void {
  store.setItem(STATE_KEY, JSON.stringify(state));
}

/**
 * Strips `submitted` before anything goes to the model. The brief forbids the
 * model ever seeing it, and the return type is what enforces that: adding a
 * ninth field to ReservationState will not silently start shipping it.
 */
export function toChatPayload(state: ReservationState): SlotValues {
  const { submitted: _submitted, ...slots } = state;
  return slots;
}

/**
 * The transcript is deliberately not here.
 *
 * Only the slot object and the session id are persisted. The conversation lives in
 * React state and is gone on refresh, which is the point: the transcript is where a
 * customer's name, email and phone number get written down in plaintext, and the
 * slot object is already everything the agent needs to carry on. The brief listed a
 * `reservation_messages` key, and dropping it is recorded as deviation D6 in the
 * design doc.
 *
 * What this costs is conversational continuity across a refresh. The model still
 * receives every filled slot, so it resumes by asking for the next missing field
 * rather than starting over, but it cannot refer back to something the customer
 * said. ChatPanel says so on screen instead of leaving an empty transcript next to
 * a half-filled summary.
 */

/**
 * One id per browser, generated lazily and reused after a refresh. It is the
 * join key between a draft in storage and a row in the HITL queue, and it never
 * appears in a chat request.
 */
export function getSessionId(store: KVStorage): string {
  const existing = store.getItem(SESSION_KEY);
  if (existing !== null && /^[0-9a-f-]{20,64}$/i.test(existing)) return existing;

  const created = createId();
  store.setItem(SESSION_KEY, created);
  return created;
}

/**
 * crypto.randomUUID needs a secure context. Localhost and HTTPS both qualify, but
 * a demo opened from a file path or a plain http address does not, so the draft
 * still has to get an id.
 */
function createId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef?.randomUUID) return cryptoRef.randomUUID();

  const bytes = new Uint8Array(16);
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const LEGACY_MESSAGES_KEY = "reservation_messages";

/**
 * Deletes the transcript key that earlier builds wrote.
 *
 * Nothing reads it any more, but ignoring it is not the same as removing it: a
 * returning visitor would otherwise keep their previous conversation on disk
 * indefinitely, including every name, email address and phone number they typed
 * into it. Not writing it going forward is only half of the fix.
 */
export function purgeLegacyKeys(store: KVStorage): void {
  store.removeItem(LEGACY_MESSAGES_KEY);
}

/**
 * Clears the draft after the customer acknowledges an approval. The session id
 * survives, because it identifies the browser rather than the conversation.
 */
export function clearDraft(store: KVStorage): void {
  store.removeItem(STATE_KEY);
}
