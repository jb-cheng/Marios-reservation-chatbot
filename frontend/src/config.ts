import type { RestaurantConfig } from "@/state/types";

/**
 * Client side configuration.
 *
 * Restaurant facts are deliberately not here. Opening hours, the slot grid and the
 * party range live on the server, which computes availability and validates
 * submissions, and the browser fetches them at boot. One source for one fact, so
 * the client cannot reject a time the availability engine considers open.
 */

/** The API is same-origin: Vite proxies /api in dev, and the built app is served
 *  beside the backend in production. */
export const API_BASE = "";

export type AgentMode = "voice" | "text";

const MODE_KEY = "reservation_mode";

function readStoredMode(): AgentMode | null {
  try {
    const stored = globalThis.localStorage.getItem(MODE_KEY);
    return stored === "voice" || stored === "text" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Voice first or text first, decided without a code change.
 *
 * Precedence is a query parameter, then a build-time variable, then what the
 * visitor chose last. The query parameter is what makes criterion 10 a toggle
 * rather than a rebuild: `?mode=voice` and `?mode=text` are the two arms of the
 * A/B, and a presenter can switch between them mid-demo.
 */
export function initialMode(): AgentMode {
  try {
    const params = new URLSearchParams(globalThis.location.search);
    const requested = params.get("mode");
    if (requested === "voice" || requested === "text") return requested;
  } catch {
    // No location available, fall through to the stored or built default.
  }

  const stored = readStoredMode();
  if (stored !== null) return stored;

  const built = import.meta.env.VITE_AGENT_MODE;
  return built === "voice" ? "voice" : "text";
}

export function persistMode(mode: AgentMode): void {
  try {
    globalThis.localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private browsing with storage disabled should not break the conversation.
  }
}

export const ASSISTANT_NAME = "Mario";

export const RESTAURANT_FALLBACK_NAME = "Mario's";

/**
 * Used only for the first paint, before /api/config arrives. The real values are
 * replaced by the server's, so a stale build cannot validate against old hours.
 */
export const PLACEHOLDER_CONFIG: RestaurantConfig = {
  name: RESTAURANT_FALLBACK_NAME,
  open_hours: {
    sun: null,
    mon: null,
    tue: null,
    wed: null,
    thu: null,
    fri: null,
    sat: null,
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
