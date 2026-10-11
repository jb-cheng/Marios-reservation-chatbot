export const SLOT_KEYS = [
  "date",
  "time",
  "party_size",
  "type",
  "name",
  "email",
  "phone",
  "special_requests",
] as const;

export type SlotKey = (typeof SLOT_KEYS)[number];

export const TABLE_TYPES = ["booth", "patio", "standard"] as const;

export type TableType = (typeof TABLE_TYPES)[number];

/**
 * The eight slots the agent fills. This is the whole shape of what crosses the
 * wire to the LLM: `submitted` is deliberately not here, so no call site can
 * hand it over by accident.
 */
export type SlotValues = {
  date: string | null;
  time: string | null;
  party_size: number | null;
  type: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  special_requests: string | null;
};

export type ReservationState = SlotValues & {
  submitted: boolean;
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ServiceWindow = {
  open: string;
  last_seating: string;
};

/**
 * Restaurant facts the validation rules need. Served by the backend, which owns
 * them, rather than duplicated into a frontend constant where it could drift
 * from the availability engine.
 */
export type RestaurantConfig = {
  name: string;
  /** Keyed by lowercase weekday. A closed day is null, not an empty window. */
  open_hours: Record<Weekday, ServiceWindow | null>;
  slot_minutes: number;
  max_days_ahead: number;
  party_min: number;
  party_max: number;
  table_types: readonly string[];
  slot_keys: readonly string[];
  required_slots: readonly SlotKey[];
  slot_order: readonly SlotKey[];
  /** Answers to general questions, so the agent never improvises restaurant facts. */
  facts: Record<string, string>;
};

export const WEEKDAYS = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export function emptyState(): ReservationState {
  return {
    date: null,
    time: null,
    party_size: null,
    type: null,
    name: null,
    email: null,
    phone: null,
    special_requests: null,
    submitted: false,
  };
}

export function isSlotKey(key: string): key is SlotKey {
  return (SLOT_KEYS as readonly string[]).includes(key);
}

export type ChatPayload = {
  state: SlotValues;
  messages: ChatMessage[];
  message: string;
  current_date: string;
};

export type TurnResponse = {
  reply: string;
  slots: SlotValues;
  changed: string[];
  submit: boolean;
  availability: AvailabilityStatus | null;
  /** Every seating the room can still offer that day, so the customer can pick
   *  rather than guess and be told no. */
  openings: Opening[];
  /** Which provider answered, so a fallback is visible rather than inferred. */
  provider: string | null;
};

export type Opening = {
  time: string;
  free: number;
  by_type: Record<string, number>;
};

export type AvailabilityState = "available" | "booked" | "no_table";

export type SlotAlternative = {
  time: string;
  table_id: string;
  seats: number;
  type: string;
};

export type AvailabilityStatus = {
  date: string;
  time: string;
  party_size: number;
  type: string | null;
  state: AvailabilityState;
  table_id: string | null;
  alternatives: SlotAlternative[];
};

export type Reservation = {
  submission_id: string;
  session_id: string;
  date: string;
  time: string;
  party_size: number;
  table_id: string;
  table_type: string;
  name: string;
  email: string;
  phone: string;
  special_requests: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
};

export type TableClash = {
  date: string;
  time: string;
  table_id: string;
  claims: number;
};

export type QueueSnapshot = {
  pending: Reservation[];
  official: Reservation[];
  double_booked: TableClash[];
};

/**
 * Every way a submission can end. A discriminated union rather than a thrown
 * error for the expected outcomes, because "that time just went" is a normal
 * branch of the conversation and the UI has something useful to show for it.
 */
export type SubmitOutcome =
  | {
      kind: "pending";
      submission_id: string;
      table_id: string;
    }
  | {
      kind: "already_submitted";
      submission_id: string;
      table_id: string;
    }
  | { kind: "slot_taken"; alternatives: SlotAlternative[] }
  | { kind: "no_table"; largest_table: number }
  | { kind: "invalid"; error: string; missing?: string[]; slots?: string[] };
