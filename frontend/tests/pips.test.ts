import assert from "node:assert/strict";
import test from "node:test";

import { clockLabel } from "../src/lib/format.ts";
import { MAX_PIP_GROUPS, detectPipGroups, nextOpenDates } from "../src/state/pips.ts";
import type { PipGroup } from "../src/state/pips.ts";
import type { Opening, RestaurantConfig, ReservationState } from "../src/state/types.ts";
import { emptyState } from "../src/state/types.ts";

const OPEN: RestaurantConfig["open_hours"]["sat"] = { open: "16:00", last_seating: "21:00" };

const CONFIG: RestaurantConfig = {
  name: "Mario's",
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
  required_slots: ["date", "time", "party_size", "name", "email"],
  slot_order: ["date", "time", "party_size", "name", "email", "phone", "special_requests"],
  facts: {},
};

// A Friday, so the closed Monday falls inside the next five open evenings.
const TODAY = "2026-11-13";
const OPENINGS: Opening[] = [{ time: "19:00", free: 3, by_type: { standard: 3 } }];

function detect(
  reply: string | null,
  state: ReservationState = emptyState(),
  openings: readonly Opening[] | null = [],
): PipGroup[] {
  return detectPipGroups({ reply, state, config: CONFIG, openings, today: TODAY });
}

function slots(groups: PipGroup[]): string[] {
  return groups.map((group) => group.slot);
}

test("the greeting offers date and party suggestions without inventing times", () => {
  const groups = detect(
    "Hi, I'm Mario at Mario's. Tell me the date, the time and how many of you, and I'll take it from there.",
  );
  assert.deepEqual(slots(groups), ["date", "party_size"]);
});

test("a seating question offers seating and nothing else", () => {
  const groups = detect("And where would you prefer to sit?");
  assert.deepEqual(slots(groups), ["type"]);
});

test("name and contact questions leave typing to the main composer", () => {
  for (const reply of [
    "What name shall I put the reservation under?",
    "What email should the receipt go to?",
    "Could you leave a phone number in case we need to call?",
    "What name and email should I use, and what is your best contact number?",
  ]) {
    assert.deepEqual(detect(reply), []);
  }
});

test("a statement about a slot is not a request for it", () => {
  assert.deepEqual(detect("I have your name as John Smith."), []);
  assert.deepEqual(detect("Your table is booked for Saturday at 19:00."), []);
  assert.deepEqual(detect("Your party size is four and your seating is a booth."), []);
});

test("only the asking sentence is searched", () => {
  const groups = detect("Your seating is a booth. What date would you like?");
  assert.deepEqual(slots(groups), ["date"]);
});

test("a party question does not offer phone or seating suggestions", () => {
  assert.deepEqual(slots(detect("How many guests will be dining?")), ["party_size"]);
  assert.deepEqual(slots(detect("What is the number of guests?")), ["party_size"]);
});

test("an occasion question offers the request presets", () => {
  const groups = detect("Is there anything else, an occasion or a high chair perhaps?");
  assert.deepEqual(slots(groups), ["special_requests"]);
  assert.deepEqual(groups[0].choices.map((choice) => choice.label), [
    "Birthday", "Anniversary", "Quiet table", "High chair", "Step-free access", "Nothing else",
  ]);
  assert.equal(groups[0].choices[0].message, "It is a birthday.");
  assert.equal(groups[0].choices.at(-1)?.message, "No special requests, thank you.");
  assert.ok(groups[0].choices.every((choice) => choice.value === null));
});

test("the deck is capped and ordered by the booking, not by the match", () => {
  const groups = detect(
    "Anything else? Where would you prefer to sit? How many guests? What time? What date?",
    emptyState(),
    OPENINGS,
  );
  assert.equal(groups.length, MAX_PIP_GROUPS);
  assert.deepEqual(slots(groups), ["date", "time", "party_size"]);
});

test("the cap applies after filtering unavailable time suggestions", () => {
  const groups = detect(
    "What date, what time, how many guests, and where would you prefer to sit? Anything else?",
  );
  assert.deepEqual(slots(groups), ["date", "party_size", "type"]);
});

test("free-response questions do not consume useful group slots", () => {
  const groups = detect(
    "What name, email and phone should I use? Anything else? Where would you prefer to sit? How many guests?",
  );
  assert.deepEqual(slots(groups), ["party_size", "type", "special_requests"]);
});

test("groups with no available quick choices are filtered before the cap", () => {
  const groups = detectPipGroups({
    reply: "What date, what time, how many guests, and where would you prefer to sit? Anything else?",
    state: emptyState(),
    config: { ...CONFIG, max_days_ahead: 0, party_min: 3, party_max: 3 },
    openings: [],
    today: "2026-11-16",
  });
  assert.deepEqual(slots(groups), ["type", "special_requests"]);
});

test("every emitted group has suggestions and no free-response input", () => {
  for (const reply of [
    "What date?", "What time?", "How many guests?", "Where would you prefer to sit?",
    "What name?", "What email?", "What phone number?", "Anything else?",
  ]) {
    for (const group of detect(reply, emptyState(), OPENINGS)) {
      assert.ok(group.choices.length > 0);
      assert.equal("input" in group, false);
    }
  }
});

test("nothing is offered once the booking is submitted", () => {
  const state = { ...emptyState(), date: "2026-11-14", submitted: true };
  assert.deepEqual(detect("What date and how many guests?", state, OPENINGS), []);
});

test("openings appear without being asked for once an evening is chosen", () => {
  const state = { ...emptyState(), date: "2026-11-14" };
  const groups = detect("Saturday the 14th it is.", state, OPENINGS);
  assert.deepEqual(slots(groups), ["time"]);
  assert.equal(groups[0].choices[0].label, "7:00 pm");
  assert.equal(groups[0].choices[0].hint, "3 free");
  assert.equal(groups[0].choices[0].message, "Let's do 19:00.");
});

test("a chosen date cannot create time chips from the client schedule", () => {
  const state = { ...emptyState(), date: "2026-11-14" };
  assert.deepEqual(detect("What time would you like?", state, []), []);
});

test("unknown openings and an empty server result both offer no time choices", () => {
  for (const state of [emptyState(), { ...emptyState(), date: "2026-11-14", time: "18:00" }]) {
    assert.deepEqual(detect("What time would you like?", state, null), []);
    assert.deepEqual(detect("What time would you like?", state, []), []);
    assert.deepEqual(detectPipGroups({
      reply: "What time would you like?", state, config: CONFIG, today: TODAY,
    }), []);
  }
});

test("time choices use only server openings, not the schedule or the current time", () => {
  const state = { ...emptyState(), date: "2026-11-14", time: "18:00" };
  const groups = detect("What time would you like?", state, [
    { time: "17:30", free: 1, by_type: { booth: 1 } },
    { time: "20:00", free: 2, by_type: { standard: 2 } },
  ]);
  assert.deepEqual(groups[0].choices, [
    { label: "5:30 pm", message: "Let's do 17:30.", value: "17:30", hint: "1 free" },
    { label: "8:00 pm", message: "Let's do 20:00.", value: "20:00", hint: "2 free" },
  ]);
});

test("chosen times are offered for corrections only when asked", () => {
  const state = { ...emptyState(), date: "2026-11-14", time: "19:00" };
  assert.deepEqual(detect("Seven it is.", state, OPENINGS), []);
  assert.equal(detect("What time would you prefer?", state, OPENINGS)[0].choices[0].value, "19:00");
});

test("seating chips carry the token the backend stores", () => {
  const groups = detect("Where would you prefer to sit?");
  const choices = groups[0].choices;
  assert.deepEqual(choices.map((choice) => choice.value), ["booth", "patio", "standard", null]);
  const dining = choices.find((choice) => choice.value === "standard");
  assert.equal(dining?.label, "Main dining room");
  assert.match(dining?.message ?? "", /standard/);
  const terrace = choices.find((choice) => choice.value === "patio");
  assert.match(terrace?.message ?? "", /patio/);
});

test("an unknown table type still gets a chip", () => {
  const groups = detectPipGroups({
    reply: "Where would you prefer to sit?",
    state: emptyState(),
    config: { ...CONFIG, table_types: ["counter"] },
    openings: [],
    today: TODAY,
  });
  assert.equal(groups[0].choices[0].label, "Counter");
  assert.equal(groups[0].choices[0].message, "A counter table, please.");
});

test("date chips skip the closed day and name the near ones", () => {
  assert.deepEqual(nextOpenDates(CONFIG, TODAY, 5), [
    "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-17", "2026-11-18",
  ]);
  const groups = detect("What date would you like?");
  assert.equal(groups[0].choices[0].hint, "Tonight");
  assert.equal(groups[0].choices[1].hint, "Tomorrow");
  assert.equal(groups[0].choices[0].label, "Fri 13 Nov");
  assert.equal(groups[0].choices[0].message, "Let's do 2026-11-13.");
});

test("a date beyond the offered five stays on screen", () => {
  const state = { ...emptyState(), date: "2026-12-24" };
  const groups = detect("What date would you like?", state);
  assert.equal(groups[0].choices[0].value, "2026-12-24");
});

test("an odd party size keeps its own chip and canonical message", () => {
  const state = { ...emptyState(), party_size: 5 };
  const groups = detect("How many guests?", state);
  assert.deepEqual(groups[0].choices.map((choice) => choice.value), ["2", "4", "5", "6", "8"]);
  assert.equal(groups[0].choices[2].message, "A table for 5.");
});

test("party suggestions respect configured limits", () => {
  const groups = detectPipGroups({
    reply: "How many guests?",
    state: { ...emptyState(), party_size: 3 },
    config: { ...CONFIG, party_min: 3, party_max: 6 },
    openings: [],
    today: TODAY,
  });
  assert.deepEqual(groups[0].choices.map((choice) => choice.value), ["3", "4", "6"]);
});

test("clock labels are 12 hour for people and 24 hour for the wire", () => {
  assert.equal(clockLabel("19:00"), "7:00 pm");
  assert.equal(clockLabel("12:30"), "12:30 pm");
  assert.equal(clockLabel("00:00"), "12:00 am");
  assert.equal(clockLabel("16:00"), "4:00 pm");
});
