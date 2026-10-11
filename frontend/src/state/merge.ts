import type {
  RestaurantConfig,
  ReservationState,
  SlotKey,
  SlotValues,
} from "./types.ts";
import { SLOT_KEYS } from "./types.ts";
import { coerceValue, isValid } from "./validation.ts";
import type { ValidationContext } from "./validation.ts";

/**
 * Writes one slot.
 *
 * TypeScript cannot correlate a union key with the specific value type that key
 * belongs to, so a fully generic helper here does not compile either. This is the
 * single assertion in the module, and what keeps it honest is that the loop below
 * iterates SLOT_KEYS: no other key can reach this function.
 */
function assign(target: SlotValues, key: SlotKey, value: unknown): void {
  (target as Record<string, unknown>)[key] = value;
}

/**
 * Merge rules, exactly as the brief specifies them.
 *
 * Not fill only: people correct themselves, and blocking an overwrite makes the
 * agent look broken. Not blind overwrite either: a model can hallucinate a value
 * for a slot nobody mentioned, and overwrite would quietly destroy a real answer
 * from an earlier turn. So a non-empty slot only changes when the model says the
 * user changed it, which is what `changed` is for.
 */
export function mergeSlots(
  current: ReservationState,
  incoming: Partial<Record<SlotKey, unknown>>,
  changed: readonly string[],
  ctx: ValidationContext,
): ReservationState {
  const merged: ReservationState = { ...current };

  for (const key of SLOT_KEYS) {
    const raw = incoming[key];
    if (raw === null || raw === undefined) continue;

    const value = coerceValue(key, raw);
    // `date` precedes `time` in SLOT_KEYS, so a date arriving in the same turn is
    // already merged by the time a time is checked. When neither the incoming
    // slots nor storage carry one, fall back to the caller's date rather than
    // silently dropping the opening hours rule.
    if (!isValid(key, value, { ...ctx, date: merged.date ?? ctx.date })) continue;

    const wasEmpty = merged[key] === null;
    const explicitlyChanged = changed.includes(key);
    if (wasEmpty || explicitlyChanged) {
      assign(merged, key, value);
    }
  }

  return merged;
}

/**
 * Completeness drives the confirmation card. It is computed here rather than
 * trusted from the model, so the summary appears before anyone agrees to it.
 */
export function isComplete(
  state: ReservationState,
  config: RestaurantConfig,
): boolean {
  return config.required_slots.every((key) => state[key] !== null);
}
