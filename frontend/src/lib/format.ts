/**
 * How a stored value reads on screen.
 *
 * Separate from the pips and from the summary, because both show the same
 * evening and a date formatted two ways in two panels is the kind of drift
 * nobody notices until a demo. Everything here is presentation only: what goes
 * over the wire stays ISO and 24 hour.
 */

const SHORT_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const LONG_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
const LONG_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Built from the parts rather than toLocaleDateString, so the wording is the
 * same in a test, on the page and in a screenshot regardless of the machine's
 * locale. Read at UTC midnight for the same reason validation is: a timezone
 * must not move an evening by a day.
 */
function parts(value: string): { day: number; month: number; weekday: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(utc);
  if (date.getUTCDate() !== Number(match[3])) return null;
  return { day: date.getUTCDate(), month: date.getUTCMonth(), weekday: date.getUTCDay() };
}

/** "Sat 21 Nov", for a chip. */
export function shortDate(value: string): string {
  const parsed = parts(value);
  if (parsed === null) return value;
  return `${SHORT_DAYS[parsed.weekday]} ${parsed.day} ${SHORT_MONTHS[parsed.month]}`;
}

/** "Saturday, 21 November", for the summary. */
export function longDate(value: string): string {
  const parsed = parts(value);
  if (parsed === null) return value;
  return `${LONG_DAYS[parsed.weekday]}, ${parsed.day} ${LONG_MONTHS[parsed.month]}`;
}

/** 19:00 to 7:00 pm. Messages and state keep the 24 hour form. */
export function clockLabel(raw: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return raw;
  const hours = Number(match[1]);
  const suffix = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${twelve}:${match[2]} ${suffix}`;
}

/**
 * The room's own words for its table types, keyed by what the backend stores.
 * An unknown type still reads sensibly, so changing the floor plan does not
 * leave a raw slug on the customer's summary.
 */
const TYPE_LABELS: Record<string, string> = {
  standard: "Main dining room",
  patio: "Terrace",
  booth: "Booth",
};

export function tableTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);
}