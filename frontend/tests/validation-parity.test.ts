import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { RestaurantConfig, SlotKey } from "../src/state/types.ts";
import type { ValidationContext } from "../src/state/validation.ts";
import { coerceValue, isValid, parseIsoDate } from "../src/state/validation.ts";

type SharedCase = {
  key: SlotKey;
  value: unknown;
  date: string | null;
  valid: boolean;
  note?: string;
};

type SharedTable = {
  today: string;
  config: {
    open: string;
    last_seating: string;
    closed_weekday: string;
    slot_minutes: number;
    max_days_ahead: number;
    party_min: number;
    party_max: number;
  };
  cases: SharedCase[];
};

const tablePath = fileURLToPath(
  new URL("../../shared/validation-cases.json", import.meta.url),
);
const shared = JSON.parse(readFileSync(tablePath, "utf8")) as SharedTable;

const WINDOW = {
  open: shared.config.open,
  last_seating: shared.config.last_seating,
};

/**
 * Built from the shared file rather than hard-coded, so the fixture describes the
 * rules both suites are actually asserting.
 */
const CONFIG: RestaurantConfig = {
  name: "Mario's",
  open_hours: {
    mon: null,
    tue: WINDOW,
    wed: WINDOW,
    thu: WINDOW,
    fri: WINDOW,
    sat: WINDOW,
    sun: WINDOW,
  },
  slot_minutes: shared.config.slot_minutes,
  max_days_ahead: shared.config.max_days_ahead,
  party_min: shared.config.party_min,
  party_max: shared.config.party_max,
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

test("the browser rules match the shared case table", () => {
  const failures: string[] = [];

  for (const entry of shared.cases) {
    const value = coerceValue(entry.key, entry.value);
    const ctx: ValidationContext = {
      today: shared.today,
      config: CONFIG,
      date: entry.date,
    };

    const actual = isValid(entry.key, value, ctx);
    if (actual !== entry.valid) {
      failures.push(
        `${entry.key}=${JSON.stringify(entry.value)} date=${entry.date}: ` +
          `expected ${entry.valid}, got ${actual} (${entry.note ?? ""})`,
      );
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});

test("the shared table still describes this config", () => {
  /**
   * Without this, editing the hours in one place and not the other would leave
   * every parity assertion passing against a stale fixture.
   */
  assert.equal(CONFIG.slot_minutes, shared.config.slot_minutes);
  assert.equal(CONFIG.max_days_ahead, shared.config.max_days_ahead);
  assert.equal(CONFIG.open_hours.sat?.open, shared.config.open);
  assert.equal(CONFIG.open_hours.sat?.last_seating, shared.config.last_seating);

  const closed = shared.config.closed_weekday as keyof RestaurantConfig["open_hours"];
  assert.equal(CONFIG.open_hours[closed], null);
});

test("the closed weekday in the fixture really is a Monday", () => {
  // 2026-10-12 is a Monday, and the case table relies on that.
  assert.equal(shared.config.closed_weekday, "mon");
  const monday = shared.cases.find(
    (entry) => entry.key === "time" && entry.date === "2026-10-12",
  );
  assert.ok(monday, "the table should cover the closed-day case");
  assert.equal(monday?.valid, false);
});

test("every slot key appears in the shared table", () => {
  const covered = new Set(shared.cases.map((entry) => entry.key));
  const expected: SlotKey[] = [
    "date",
    "time",
    "party_size",
    "type",
    "name",
    "email",
    "phone",
    "special_requests",
  ];

  for (const key of expected) {
    assert.ok(covered.has(key), `no shared case covers ${key}`);
  }
});

test("dates are parsed as calendar dates, not prefixes", () => {
  assert.equal(parseIsoDate("2026-02-30"), null);
  assert.notEqual(parseIsoDate("2026-10-10"), null);
});
