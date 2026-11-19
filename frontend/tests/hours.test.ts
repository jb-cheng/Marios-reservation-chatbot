import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { closingTime, hoursSummary, serviceStatus, weeklyHours } from "../src/lib/hours.ts";
import type { RestaurantConfig, ServiceWindow } from "../src/state/types.ts";

const DINNER: ServiceWindow = { open: "16:00", last_seating: "21:00" };

const CONFIG: RestaurantConfig = {
  name: "Mario's",
  open_hours: {
    sun: DINNER,
    mon: null,
    tue: DINNER,
    wed: DINNER,
    thu: DINNER,
    fri: DINNER,
    sat: DINNER,
  },
  slot_minutes: 30,
  max_days_ahead: 90,
  party_min: 1,
  party_max: 20,
  table_types: ["booth", "patio", "standard"],
  slot_keys: [],
  required_slots: ["date", "time", "party_size", "name", "email"],
  slot_order: [],
  facts: {},
};

/** Local time, because the status is about the visitor's own clock. */
function at(day: number, hours: number, minutes = 0): Date {
  // 2026-11-15 is a Sunday, so day 0 is the 15th and day 1 the 16th.
  return new Date(2026, 10, 15 + day, hours, minutes, 0, 0);
}

describe("closingTime", () => {
  it("adds one seating slot to the last seating", () => {
    assert.equal(closingTime(DINNER, 30), "21:30");
  });

  it("wraps past midnight rather than reporting hour 24", () => {
    assert.equal(closingTime({ open: "18:00", last_seating: "23:45" }, 30), "00:15");
  });
});

describe("serviceStatus", () => {
  it("is serving between opening and closing", () => {
    const status = serviceStatus(CONFIG, at(2, 19, 15));
    assert.equal(status.open, true);
    assert.equal(status.label, "Serving now");
    assert.match(status.detail, /9:00 pm/);
  });

  it("is not serving at the closing minute itself", () => {
    assert.equal(serviceStatus(CONFIG, at(2, 21, 30)).open, false);
  });

  it("is still serving at the last seating", () => {
    assert.equal(serviceStatus(CONFIG, at(2, 21, 0)).open, true);
  });

  it("says it opens later when the room has not opened yet today", () => {
    const status = serviceStatus(CONFIG, at(2, 11));
    assert.equal(status.open, false);
    assert.equal(status.label, "Opens later today");
    assert.equal(status.detail, "Doors at 4:00 pm");
  });

  it("names tomorrow after service has ended", () => {
    const status = serviceStatus(CONFIG, at(2, 22));
    assert.equal(status.label, "Closed now");
    assert.equal(status.detail, "Tomorrow from 4:00 pm");
  });

  it("skips the closed day rather than offering it", () => {
    // Sunday night: Monday is closed, so the next service is Tuesday.
    const status = serviceStatus(CONFIG, at(0, 22));
    assert.equal(status.open, false);
    assert.equal(status.detail, "Tuesday from 4:00 pm");
  });

  it("is closed on a day with no window at all", () => {
    const status = serviceStatus(CONFIG, at(1, 19));
    assert.equal(status.open, false);
    assert.equal(status.detail, "Tomorrow from 4:00 pm");
  });

  it("terminates on a config that never opens", () => {
    const closed: RestaurantConfig = {
      ...CONFIG,
      open_hours: { sun: null, mon: null, tue: null, wed: null, thu: null, fri: null, sat: null },
    };
    const status = serviceStatus(closed, at(3, 19));
    assert.equal(status.open, false);
    assert.equal(status.label, "Closed");
  });
});

describe("weeklyHours", () => {
  it("reads Monday first and keeps a closed day as null", () => {
    const rows = weeklyHours(CONFIG);
    assert.equal(rows[0].day, "Monday");
    assert.equal(rows[0].window, null);
    assert.equal(rows[6].day, "Sunday");
    assert.deepEqual(rows[6].window, DINNER);
  });
});

describe("hoursSummary", () => {
  it("collapses consecutive identical evenings into one line", () => {
    assert.deepEqual(hoursSummary(CONFIG), [
      { label: "Monday", value: "Closed" },
      { label: "Tuesday to Sunday", value: "4:00 pm to 9:30 pm" },
    ]);
  });

  it("splits a day that keeps different hours", () => {
    const varied: RestaurantConfig = {
      ...CONFIG,
      open_hours: { ...CONFIG.open_hours, sat: { open: "12:00", last_seating: "22:00" } },
    };
    assert.deepEqual(hoursSummary(varied), [
      { label: "Monday", value: "Closed" },
      { label: "Tuesday to Friday", value: "4:00 pm to 9:30 pm" },
      { label: "Saturday", value: "12:00 pm to 10:30 pm" },
      { label: "Sunday", value: "4:00 pm to 9:30 pm" },
    ]);
  });
});