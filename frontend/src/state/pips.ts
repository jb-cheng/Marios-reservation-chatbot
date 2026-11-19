import { clockLabel, shortDate, tableTypeLabel } from "../lib/format.ts";
import type { Opening, ReservationState, RestaurantConfig, SlotKey } from "./types.ts";
import { SLOT_KEYS, WEEKDAYS } from "./types.ts";
import { parseIsoDate } from "./validation.ts";

export type PipChoice = {
  label: string;
  /** Sent verbatim as a customer message. */
  message: string;
  /** The slot value this chip stands for, so it can render as selected. */
  value: string | null;
  hint?: string;
};

export type PipGroup = {
  slot: SlotKey;
  caption: string;
  choices: PipChoice[];
};

/** Three is what fits beside a conversation without burying it. */
export const MAX_PIP_GROUPS = 3;

const DAY_MS = 86_400_000;

/**
 * Only a question gets chips.
 *
 * Matching the whole reply would put seating chips under "Your seating is a
 * booth", which is a statement, not a request. So the reply is split into
 * sentences and only the ones that ask are searched.
 */
const ASK_VERB =
  /\b(tell me|let me know|which|what|when|how many|pick|choose|share|send me|prefer|would you like|could you|can you|shall i|may i)\b/;

function askingText(reply: string): string {
  return reply
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((sentence) => sentence.includes("?") || ASK_VERB.test(sentence.toLowerCase()))
    .join(" ")
    .toLowerCase();
}

const SLOT_ASKS: ReadonlyArray<{ slot: SlotKey; pattern: RegExp }> = [
  {
    slot: "date",
    pattern:
      /\b(what|which) (date|day|evening|night)\b|\bwhen (would|will|are|do|should|can|shall)\b|\bwhen\b.{0,24}\b(join|visit|come|dine|like)\b|\bdate\b.{0,20}\b(prefer|works|like|mind|suit)\b|\btell me the date\b/,
  },
  {
    slot: "time",
    pattern:
      /\b(what|which) time\b|\bthe time\b|\btime\b.{0,24}\b(prefer|works|like|suit|good|mind)\b|\bhow (early|late)\b|\bseating time\b/,
  },
  {
    slot: "party_size",
    pattern:
      /\bhow many\b|\bparty size\b|\bnumber of (guests|people|diners|seats)\b|\bhow large\b|\bparty of\b/,
  },
  {
    slot: "type",
    pattern:
      /\bseating\b|\bbooth\b|\bpatio\b|\bterrace\b|\bdining room\b|\binside or outside\b|\bwhere\b.{0,24}\b(sit|seated|prefer)\b|\b(which|what) (kind|type) of (table|seating|seat)\b|\bprefer(ence)?\b.{0,20}\b(table|seat|sit)\b/,
  },
  {
    slot: "special_requests",
    pattern:
      /\bspecial request|\banything else\b|\boccasion\b|\bcelebrat|\ballerg|\bdietary\b|\bhigh ?chair\b|\baccessib/,
  },
];

const CAPTIONS = {
  date: "Pick an evening",
  time: "Pick a time",
  party_size: "How many of you",
  type: "Where you will sit",
  special_requests: "Anything we should prepare",
};

const TYPE_MESSAGES: Record<string, string> = {
  standard: "The main dining room, a standard table.",
  patio: "The patio terrace, please.",
  booth: "A booth, please.",
};

const REQUEST_PRESETS: readonly { label: string; message: string }[] = [
  { label: "Birthday", message: "It is a birthday." },
  { label: "Anniversary", message: "We are celebrating an anniversary." },
  { label: "Quiet table", message: "Somewhere quiet, please." },
  { label: "High chair", message: "We will need a high chair." },
  { label: "Step-free access", message: "We need step-free access." },
  { label: "Nothing else", message: "No special requests, thank you." },
];

function isoFromUtc(utc: number): string {
  const date = new Date(utc);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function addDays(iso: string, days: number): string | null {
  const utc = parseIsoDate(iso);
  if (utc === null) return null;
  return isoFromUtc(utc + days * DAY_MS);
}

/** The next open evenings, closed days skipped rather than offered and refused. */
export function nextOpenDates(
  config: RestaurantConfig,
  today: string,
  count: number,
): string[] {
  const start = parseIsoDate(today);
  if (start === null) return [];

  const found: string[] = [];
  for (let offset = 0; offset <= config.max_days_ahead && found.length < count; offset += 1) {
    const utc = start + offset * DAY_MS;
    const weekday = WEEKDAYS[new Date(utc).getUTCDay()];
    if (config.open_hours[weekday] === null) continue;
    found.push(isoFromUtc(utc));
  }
  return found;
}

function dateGroup(state: ReservationState, config: RestaurantConfig, today: string): PipGroup {
  const upcoming = nextOpenDates(config, today, 5);
  // A date already chosen outside the next five stays visible and selected.
  const dates =
    state.date !== null && !upcoming.includes(state.date)
      ? [state.date, ...upcoming]
      : upcoming;

  return {
    slot: "date",
    caption: CAPTIONS.date,
    choices: dates.map((iso) => ({
      label: shortDate(iso),
      message: `Let's do ${iso}.`,
      value: iso,
      hint: iso === today ? "Tonight" : iso === addDays(today, 1) ? "Tomorrow" : undefined,
    })),
  };
}

function timeGroup(openings: readonly Opening[]): PipGroup {
  return {
    slot: "time",
    caption: CAPTIONS.time,
    choices: openings.slice(0, 12).map((opening) => ({
      label: clockLabel(opening.time),
      message: `Let's do ${opening.time}.`,
      value: opening.time,
      hint: `${opening.free} free`,
    })),
  };
}

function partyGroup(state: ReservationState, config: RestaurantConfig): PipGroup {
  const quick = [2, 4, 6, 8].filter(
    (size) => size >= config.party_min && size <= config.party_max,
  );
  // A party already chosen that is not one of the quick numbers still gets a
  // chip, so the current answer is never the one missing from the row.
  const current = state.party_size;
  const sizes =
    current !== null && !quick.includes(current) ? [current, ...quick].sort((a, b) => a - b) : quick;

  return {
    slot: "party_size",
    caption: CAPTIONS.party_size,
    choices: sizes.map((size) => ({
      label: size === 1 ? "Just me" : `${size} guests`,
      message: `A table for ${size}.`,
      value: String(size),
    })),
  };
}

function typeGroup(config: RestaurantConfig): PipGroup {
  return {
    slot: "type",
    caption: CAPTIONS.type,
    choices: [
      ...config.table_types.map((type) => ({
        label: tableTypeLabel(type),
        message: TYPE_MESSAGES[type] ?? `A ${type} table, please.`,
        value: type,
      })),
      {
        label: "No preference",
        message: "No seating preference, wherever you have room.",
        value: null,
      },
    ],
  };
}

function buildGroup(
  slot: SlotKey,
  state: ReservationState,
  config: RestaurantConfig,
  openings: readonly Opening[],
  today: string,
): PipGroup | null {
  switch (slot) {
    case "date":
      return dateGroup(state, config, today);
    case "time":
      return timeGroup(openings);
    case "party_size":
      return partyGroup(state, config);
    case "type":
      return typeGroup(config);
    case "special_requests":
      return {
        slot,
        caption: CAPTIONS.special_requests,
        choices: REQUEST_PRESETS.map((preset) => ({ ...preset, value: null })),
      };
    default:
      return null;
  }
}

/**
 * Which quick answers belong under the agent's last line.
 *
 * Ordered by SLOT_KEYS rather than by whichever pattern matched first, so the
 * deck reads in the order the booking is built. A time row also appears without
 * being asked for once an evening is chosen and the engine has sent openings,
 * because picking from what is actually free beats guessing and being refused.
 */
export function detectPipGroups(args: {
  reply: string | null;
  state: ReservationState;
  config: RestaurantConfig;
  openings?: readonly Opening[] | null;
  today: string;
}): PipGroup[] {
  const { reply, state, config, today } = args;
  if (state.submitted) return [];
  const openings = args.openings ?? [];

  const asking = reply === null ? "" : askingText(reply);
  const matched = new Set<SlotKey>();
  for (const { slot, pattern } of SLOT_ASKS) {
    if (asking !== "" && pattern.test(asking)) matched.add(slot);
  }

  if (state.date !== null && state.time === null && openings.length > 0) {
    matched.add("time");
  }

  return SLOT_KEYS.filter((slot) => matched.has(slot))
    .map((slot) => buildGroup(slot, state, config, openings, today))
    .filter((group): group is PipGroup => group !== null && group.choices.length > 0)
    .slice(0, MAX_PIP_GROUPS);
}
