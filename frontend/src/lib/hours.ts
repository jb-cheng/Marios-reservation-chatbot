import { clockLabel } from "./format.ts";
import type { RestaurantConfig, ServiceWindow, Weekday } from "../state/types.ts";
import { WEEKDAYS } from "../state/types.ts";

/**
 * Whether the dining room is serving right now, and when it next will be.
 *
 * Computed from the same `open_hours` the availability engine uses rather than
 * written into the page as a sentence. A hardcoded "open until 10pm" beside a
 * config that says otherwise is the sort of contradiction a visitor finds in one
 * glance, and the footer's whole promise is that the host is here when the room
 * is not.
 *
 * Closing time is derived, not stored: the backend keeps `last_seating` and the
 * seating grid, and a table taken at the last seating is held for one slot. The
 * `hours` fact carries the human sentence for anything more specific.
 */

export type ServiceStatus = {
  open: boolean;
  /** Short line for a status pill. */
  label: string;
  /** What happens next, in the customer's terms. */
  detail: string;
};

const DAY_NAMES: Record<Weekday, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

/** Last seating plus one slot, which is when the room stops serving. */
export function closingTime(window: ServiceWindow, slotMinutes: number): string {
  const total = minutes(window.last_seating) + slotMinutes;
  const hours = Math.floor(total / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function serviceStatus(config: RestaurantConfig, now: Date): ServiceStatus {
  const weekday = WEEKDAYS[now.getDay()];
  const window = config.open_hours[weekday];
  const elapsed = now.getHours() * 60 + now.getMinutes();

  if (window !== null) {
    const opens = minutes(window.open);
    const closes = minutes(closingTime(window, config.slot_minutes));

    if (elapsed >= opens && elapsed < closes) {
      return {
        open: true,
        label: "Serving now",
        detail: `Until ${clockLabel(closingTime(window, config.slot_minutes))}, last seating ${clockLabel(window.last_seating)}`,
      };
    }

    if (elapsed < opens) {
      return {
        open: false,
        label: "Opens later today",
        detail: `Doors at ${clockLabel(window.open)}`,
      };
    }
  }

  // Walk forward to the next day that has a window. Bounded by a week, because a
  // config that closes every day would otherwise spin here forever.
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const next = WEEKDAYS[(now.getDay() + ahead) % 7];
    const nextWindow = config.open_hours[next];
    if (nextWindow === null) continue;
    return {
      open: false,
      label: "Closed now",
      detail: `${ahead === 1 ? "Tomorrow" : DAY_NAMES[next]} from ${clockLabel(nextWindow.open)}`,
    };
  }

  return { open: false, label: "Closed", detail: "Call us and we will find a way" };
}

export type HoursRow = { day: string; window: ServiceWindow | null };

/** Monday first, which is how a hours card is read. */
export function weeklyHours(config: RestaurantConfig): HoursRow[] {
  const order: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  return order.map((day) => ({ day: DAY_NAMES[day], window: config.open_hours[day] }));
}

/**
 * Consecutive days sharing one window collapse into a single line, so six identical
 * evenings read as "Tuesday to Sunday" rather than six rows of the same thing.
 */
export function hoursSummary(config: RestaurantConfig): { label: string; value: string }[] {
  const rows = weeklyHours(config);
  const groups: { days: string[]; window: ServiceWindow | null }[] = [];

  for (const row of rows) {
    const last = groups[groups.length - 1];
    const same =
      last !== undefined &&
      (last.window === null
        ? row.window === null
        : row.window !== null &&
          last.window.open === row.window.open &&
          last.window.last_seating === row.window.last_seating);

    if (same) last.days.push(row.day);
    else groups.push({ days: [row.day], window: row.window });
  }

  return groups.map((group) => ({
    label:
      group.days.length === 1
        ? group.days[0]
        : `${group.days[0]} to ${group.days[group.days.length - 1]}`,
    value:
      group.window === null
        ? "Closed"
        : `${clockLabel(group.window.open)} to ${clockLabel(closingTime(group.window, config.slot_minutes))}`,
  }));
}