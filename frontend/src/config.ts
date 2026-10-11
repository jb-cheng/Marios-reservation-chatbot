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

/**
 * Voice first or text first, decided without a code change.
 *
 * Precedence is a query parameter, then a build-time variable, then text. The query
 * parameter is what makes criterion 10 a toggle rather than a rebuild: `?mode=voice`
 * and `?mode=text` are the two arms of the A/B, and a presenter can switch between
 * them mid-demo.
 *
 * The choice is deliberately not persisted. localStorage holds the slot object and
 * the session id, and nothing else: a UI preference is not part of the reservation,
 * and writing one there would put a third key in the only storage this app is
 * allowed to use.
 */
export function initialMode(): AgentMode {
  try {
    const params = new URLSearchParams(globalThis.location.search);
    const requested = params.get("mode");
    if (requested === "voice" || requested === "text") return requested;
  } catch {
    // No location available, fall through to the built default.
  }

  return import.meta.env.VITE_AGENT_MODE === "voice" ? "voice" : "text";
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
  required_slots: ["date", "time", "party_size", "name", "email"],
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
