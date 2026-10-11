import assert from "node:assert/strict";
import test from "node:test";

import { isComplete, mergeSlots } from "../src/state/merge.ts";
import type { RestaurantConfig, ReservationState, SlotKey } from "../src/state/types.ts";
import { emptyState } from "../src/state/types.ts";
import {
  SESSION_KEY,
  STATE_KEY,
  clearDraft,
  getSessionId,
  purgeLegacyKeys,
  readState,
  toChatPayload,
  writeState,
} from "../src/state/storage.ts";
import type { KVStorage } from "../src/state/storage.ts";
import type { ValidationContext } from "../src/state/validation.ts";
import { weekdayOf } from "../src/state/validation.ts";

const OPEN: RestaurantConfig["open_hours"]["sat"] = {
  open: "16:00",
  last_seating: "21:00",
};

const CONFIG: RestaurantConfig = {
  name: "Mario's",
  // Saturday 2026-10-10 is open. Monday is closed. Everything else mirrors
  // Saturday so the weekday lookup is the only variable under test.
  open_hours: {
    sun: OPEN,
    mon: null,
    tue: OPEN,
    wed: OPEN,
    thu: OPEN,
    fri: OPEN,
    sat: OPEN,
  },
  slot_minutes: 30,
  max_days_ahead: 90,
  party_min: 1,
  party_max: 20,
  table_types: ["booth", "patio", "standard"],
  slot_keys: [
    "date",
    "time",
    "party_size",
    "type",
    "name",
    "email",
    "phone",
    "special_requests",
  ],
  required_slots: ["date", "time", "party_size", "name", "email", "phone"],
  slot_order: [
    "date",
    "time",
    "party_size",
    "name",
    "email",
    "phone",
    "special_requests",
  ],
  facts: {},
};

/** 2026-10-10, a Saturday. Fixed so the rules do not depend on the real clock. */
const TODAY = "2026-10-10";

function ctx(date: string | null = null): ValidationContext {
  return { today: TODAY, config: CONFIG, date };
}

class MemoryStorage implements KVStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  /** Exposed so a test can assert on what was persisted, not just what was read
   *  back. Absence is the property under test here. */
  keys(): string[] {
    return [...this.data.keys()].sort();
  }
}

function filled(overrides: Partial<ReservationState> = {}): ReservationState {
  return {
    date: "2026-10-11",
    time: "19:00",
    party_size: 4,
    type: null,
    name: "Cheng",
    email: "jb@example.com",
    phone: "4169999999",
    special_requests: null,
    submitted: false,
    ...overrides,
  };
}

test("an empty slot accepts whatever the model returns that is valid", () => {
  const current = emptyState();
  const merged = mergeSlots(
    current,
    { date: TODAY, time: "19:00", party_size: 6 },
    [],
    ctx(),
  );

  assert.equal(merged.date, TODAY);
  assert.equal(merged.time, "19:00");
  assert.equal(merged.party_size, 6);
});

test("acceptance 3: a correction overwrites a slot that already has a value", () => {
  const current = filled({ party_size: 4 });
  const merged = mergeSlots(current, { party_size: 6 }, ["party_size"], ctx(TODAY));

  assert.equal(merged.party_size, 6);
});

test("a new value for a filled slot is ignored unless changed names it", () => {
  const current = filled({ party_size: 4 });
  const merged = mergeSlots(current, { party_size: 6 }, [], ctx(TODAY));

  assert.equal(merged.party_size, 4);
});

test("acceptance 4: a turn with no slot information leaves state untouched", () => {
  const current = filled();
  const incoming = Object.fromEntries(
    (Object.keys(current) as (keyof ReservationState)[]).map((k) => [k, null]),
  );

  const merged = mergeSlots(current, incoming, [], ctx(TODAY));

  assert.deepEqual(merged, current);
});

test("acceptance 4: a hallucinated invalid email never enters state", () => {
  const current = filled({ email: null });
  const merged = mergeSlots(
    current,
    { email: "this is not an address" },
    ["email"],
    ctx(TODAY),
  );

  assert.equal(merged.email, null);
});

test("a key the model invents has nowhere to land", () => {
  const current = filled();
  const incoming = { is_vip: true, table_id: "B2" } as unknown as Partial<
    Record<SlotKey, unknown>
  >;

  const merged = mergeSlots(current, incoming, ["is_vip", "table_id"], ctx(TODAY));

  assert.deepEqual(merged, current);
});

test("submitted cannot be written through a merge", () => {
  const current = filled({ submitted: false });
  const incoming = { submitted: true } as unknown as Partial<Record<SlotKey, unknown>>;

  const merged = mergeSlots(current, incoming, ["submitted"], ctx(TODAY));

  assert.equal(merged.submitted, false);
});

test("phone is stored as digits, whatever form the model returns", () => {
  const current = emptyState();
  const merged = mergeSlots(current, { phone: "+1 (416) 999-9999" }, [], ctx());

  assert.equal(merged.phone, "14169999999");
});

test("a phone that is not a phone is dropped", () => {
  const merged = mergeSlots(emptyState(), { phone: "call me soon" }, [], ctx());
  assert.equal(merged.phone, null);
});

test("type is case folded and restricted to the real table types", () => {
  const merged = mergeSlots(emptyState(), { type: "  BOOTH  " }, [], ctx());
  assert.equal(merged.type, "booth");

  const bogus = mergeSlots(emptyState(), { type: "window seat" }, [], ctx());
  assert.equal(bogus.type, null);
});

test("party_size must be a number, not a numeric string", () => {
  const merged = mergeSlots(emptyState(), { party_size: "6" }, [], ctx());
  assert.equal(merged.party_size, null);
});

test("a party outside the allowed range is dropped", () => {
  assert.equal(mergeSlots(emptyState(), { party_size: 0 }, [], ctx()).party_size, null);
  assert.equal(mergeSlots(emptyState(), { party_size: 21 }, [], ctx()).party_size, null);
  assert.equal(
    mergeSlots(emptyState(), { party_size: 20 }, [], ctx()).party_size,
    20,
  );
});

test("dates outside today through the horizon are dropped", () => {
  assert.equal(mergeSlots(emptyState(), { date: "2026-10-09" }, [], ctx()).date, null);
  assert.equal(mergeSlots(emptyState(), { date: "2027-01-09" }, [], ctx()).date, null);
  assert.equal(mergeSlots(emptyState(), { date: "2026-10-10" }, [], ctx()).date, TODAY);
});

test("a date that is not a real calendar day is dropped", () => {
  const merged = mergeSlots(emptyState(), { date: "2026-02-30" }, [], ctx());
  assert.equal(merged.date, null);
});

test("times must sit on the slot grid", () => {
  assert.equal(mergeSlots(emptyState(), { time: "19:07" }, [], ctx(TODAY)).time, null);
  assert.equal(mergeSlots(emptyState(), { time: "19:15" }, [], ctx(TODAY)).time, null);
  assert.equal(mergeSlots(emptyState(), { time: "19:30" }, [], ctx(TODAY)).time, "19:30");
});

test("a time outside the day's service window is dropped", () => {
  // 2026-10-10 is a Saturday and Saturday is open 16:00 to 21:00 last seating.
  assert.equal(weekdayOf(TODAY), "sat");
  assert.equal(mergeSlots(emptyState(), { time: "15:30" }, [], ctx(TODAY)).time, null);
  assert.equal(mergeSlots(emptyState(), { time: "21:30" }, [], ctx(TODAY)).time, null);
  assert.equal(mergeSlots(emptyState(), { time: "16:00" }, [], ctx(TODAY)).time, "16:00");
});

test("a time on a closed weekday is dropped", () => {
  const monday = "2026-10-12";
  assert.equal(weekdayOf(monday), "mon");
  assert.equal(mergeSlots(emptyState(), { time: "19:00" }, [], ctx(monday)).time, null);
});

test("a time is format checked even before a date exists", () => {
  const merged = mergeSlots(emptyState(), { time: "19:00" }, [], ctx(null));
  assert.equal(merged.time, "19:00");

  const nonsense = mergeSlots(emptyState(), { time: "evening" }, [], ctx(null));
  assert.equal(nonsense.time, null);
});

test("whitespace inside a name is collapsed, and a blank name is dropped", () => {
  const merged = mergeSlots(emptyState(), { name: "  jean   ben  " }, [], ctx());
  assert.equal(merged.name, "jean ben");

  const blank = mergeSlots(emptyState(), { name: "   " }, [], ctx());
  assert.equal(blank.name, null);
});

test("a long unbroken special request is dropped rather than truncating", () => {
  const merged = mergeSlots(
    emptyState(),
    { special_requests: "x".repeat(300) },
    [],
    ctx(),
  );
  assert.equal(merged.special_requests, null);
});

test("a merge is one pass, so a corrected date and a corrected time coexist", () => {
  const current = filled({ date: "2026-10-11", time: "19:00" });
  const merged = mergeSlots(
    current,
    { date: "2026-10-17", time: "20:00" },
    ["date", "time"],
    ctx(current.date),
  );

  assert.equal(merged.date, "2026-10-17");
  assert.equal(merged.time, "20:00");
});

test("acceptance 6 support: completeness uses the six required slots only", () => {
  const missingPhone = filled({ phone: null });
  assert.equal(isComplete(missingPhone, CONFIG), false);

  const noRequests = filled();
  assert.equal(noRequests.special_requests, null);
  assert.equal(isComplete(noRequests, CONFIG), true);

  const noType = filled({ type: null });
  assert.equal(isComplete(noType, CONFIG), true);
});

test("the chat payload carries the eight slots and nothing else", () => {
  const payload = toChatPayload(filled({ submitted: true }));

  assert.equal("submitted" in payload, false);
  assert.deepEqual(Object.keys(payload).sort(), [
    "date",
    "email",
    "name",
    "party_size",
    "phone",
    "special_requests",
    "time",
    "type",
  ].sort());
  assert.equal(payload.date, "2026-10-11");
});

test("state survives a refresh, and a corrupt draft does not crash it", () => {
  const store = new MemoryStorage();
  const original = filled();
  writeState(store, original);

  assert.deepEqual(readState(store), original);

  store.setItem(STATE_KEY, "{ not json");
  assert.deepEqual(readState(store), emptyState());

  store.setItem(STATE_KEY, JSON.stringify({ date: 5, party_size: "four" }));
  const recovered = readState(store);
  assert.equal(recovered.date, null);
  assert.equal(recovered.party_size, null);

  store.setItem(STATE_KEY, "[1,2,3]");
  assert.deepEqual(readState(store), emptyState());

  store.setItem(STATE_KEY, "null");
  assert.deepEqual(readState(store), emptyState());
});

test("a stored submitted flag is preserved and nothing else leaks in", () => {
  const store = new MemoryStorage();
  writeState(store, filled({ submitted: true }));
  const read = readState(store);

  assert.equal(read.submitted, true);
});

test("only the slots and the session id are ever persisted", () => {
  /**
   * The transcript is not stored, so a customer's name, email and phone number are
   * not left behind in plaintext after they close the tab. Asserting on the key set
   * rather than on one absent key means a future field cannot quietly start
   * persisting the conversation again.
   */
  const store = new MemoryStorage();
  writeState(store, filled());
  getSessionId(store);

  assert.deepEqual(store.keys(), [
    "reservation_session_id",
    "reservation_state",
  ]);
});

test("a transcript left by an older build is deleted, not merely ignored", () => {
  /**
   * Stopping the write is half the fix. Without this, a returning visitor keeps
   * their previous conversation on disk, including every email address and phone
   * number they typed into it.
   */
  const store = new MemoryStorage();
  store.setItem(
    "reservation_messages",
    JSON.stringify([{ role: "user", content: "reach me at jean@example.com" }]),
  );

  purgeLegacyKeys(store);

  assert.deepEqual(store.keys(), []);
});

test("the session id is created once and reused after a refresh", () => {
  const store = new MemoryStorage();
  const first = getSessionId(store);
  const second = getSessionId(store);

  assert.match(first, /^[0-9a-f-]{36}$/i);
  assert.equal(first, second);
});

test("a garbage stored session id is replaced rather than trusted", () => {
  const store = new MemoryStorage();
  store.setItem(SESSION_KEY, "../../elsewhere");

  assert.match(getSessionId(store), /^[0-9a-f-]{36}$/i);
});

test("clearing the draft leaves the session id alone", () => {
  const store = new MemoryStorage();
  const id = getSessionId(store);
  writeState(store, filled());

  clearDraft(store);

  assert.equal(store.getItem(STATE_KEY), null);
  assert.deepEqual(readState(store), emptyState());
  assert.equal(getSessionId(store), id);
});
