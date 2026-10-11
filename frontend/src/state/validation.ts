import type { RestaurantConfig, SlotKey } from "./types.ts";
import { WEEKDAYS } from "./types.ts";

export type ValidationContext = {
  /** Local date as YYYY-MM-DD. Passed in rather than read from a clock so the
   *  rules stay testable at any date. */
  today: string;
  config: RestaurantConfig;
  /** The date currently held in state, needed to choose a weekday when
   *  validating a time. Null when the date slot is still empty. */
  date: string | null;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM = /^(\d{1,2}):(\d{2})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Calendar-safe conversions. Everything is computed against UTC midnight so a
 * daylight saving boundary cannot shift a date by one day.
 */
export function parseIsoDate(value: string): number | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = Date.UTC(year, month - 1, day);
  const probe = new Date(utc);
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return utc;
}

function isoToUtcMillis(value: string): number | null {
  return parseIsoDate(value);
}

export function weekdayOf(value: string): (typeof WEEKDAYS)[number] | null {
  const utc = isoToUtcMillis(value);
  if (utc === null) return null;
  return WEEKDAYS[new Date(utc).getUTCDay()];
}

function minutesFromMidnight(value: string): number | null {
  const match = HHMM.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Brings a raw value into the form state actually stores, before validation
 * sees it. The brief defines phone as "strips to digits", which is a transform,
 * so it lives here instead of hiding inside a boolean check.
 *
 * Coercion normalises presentation only. It never reinterprets a value: an ISO
 * timestamp is not sliced into a date, because guessing at a timezone is worse
 * than rejecting the value and asking again.
 *
 * Returns the value unchanged when there is nothing sensible to coerce.
 */
export function coerceValue(key: SlotKey, value: unknown): unknown {
  if (typeof value !== "string" && typeof value !== "number") return value;

  switch (key) {
    case "phone":
      return String(value).replace(/\D/g, "");
    case "type":
      return String(value).trim().toLowerCase();
    case "name":
    case "special_requests":
      return String(value).trim().replace(/\s+/g, " ");
    default:
      return value;
  }
}

/**
 * The gate between model output and memory. A false here drops the value
 * silently: the model never learns it was rejected, and next turn it asks again
 * for the slot that is still empty.
 */
export function isValid(
  key: SlotKey,
  value: unknown,
  ctx: ValidationContext,
): boolean {
  switch (key) {
    case "date":
      return validDate(String(value), ctx);
    case "time":
      return validTime(String(value), ctx);
    case "party_size":
      return validPartySize(value, ctx.config);
    case "email":
      return typeof value === "string" &&
        value.length <= 254 &&
        EMAIL.test(value.trim());
    case "phone":
      return typeof value === "string" && value.length >= 10 && value.length <= 15;
    case "type":
      return (
        typeof value === "string" &&
        value.length <= 200 &&
        ctx.config.table_types.includes(value)
      );
    case "name":
    case "special_requests":
      return typeof value === "string" && value.length > 0 && value.length <= 200;
  }
}

function validDate(raw: string, ctx: ValidationContext): boolean {
  const target = isoToUtcMillis(raw);
  if (target === null) return false;
  const today = isoToUtcMillis(ctx.today);
  if (today === null) return false;
  if (target < today) return false;
  const horizon = today + ctx.config.max_days_ahead * 86_400_000;
  return target <= horizon;
}

function validTime(raw: string, ctx: ValidationContext): boolean {
  const minutes = minutesFromMidnight(raw);
  if (minutes === null) return false;
  if (minutes % ctx.config.slot_minutes !== 0) return false;

  // Without a date the weekday is unknown, so the format and grid rules hold
  // and the opening hours rule is deferred. The state always carries both by
  // the time a submission is validated server side.
  if (ctx.date === null) return true;

  const weekday = weekdayOf(ctx.date);
  if (weekday === null) return false;
  const window = ctx.config.open_hours[weekday];
  if (window === null) return false;

  const open = minutesFromMidnight(window.open);
  const lastSeating = minutesFromMidnight(window.last_seating);
  if (open === null || lastSeating === null) return false;

  return minutes >= open && minutes <= lastSeating;
}

function validPartySize(value: unknown, config: RestaurantConfig): boolean {
  if (typeof value !== "number") return false;
  if (!Number.isInteger(value)) return false;
  return value >= config.party_min && value <= config.party_max;
}

/** Normalises a time to HH:MM with a leading zero, for display only. */
export function formatTime(raw: string): string {
  const minutes = minutesFromMidnight(raw);
  if (minutes === null) return raw;
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
