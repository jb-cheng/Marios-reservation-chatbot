/**
 * Whether a customer's own message agrees to the summary on screen.
 *
 * Voice mode has no click to book with, so a spoken yes is the confirmation. The
 * model reports that it heard one, but the model is also the thing that gets dates
 * wrong, and every other decision it makes here is re-checked somewhere else: the
 * browser validates the slots and the server recomputes the room. Letting it create
 * a reservation on its own say-so would be the one unchecked write in the system.
 *
 * So this is an allowlist rather than a sentiment judgement. It only ever refuses:
 * anything it does not recognise leaves the summary on screen, where the Confirm
 * button is, and the customer can say it again or click.
 */

const AFFIRMATIONS = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "yes please",
  "yes thanks",
  "confirm",
  "confirmed",
  "correct",
  "right",
  "that's right",
  "that works",
  "that is right",
  "book it",
  "book that",
  "go ahead",
  "do it",
  "perfect",
  "sounds good",
  "looks good",
  "absolutely",
  "sure",
  "ok",
  "okay",
  "great",
]);

/** Any of these anywhere in the message and it is not a yes, whatever else it says. */
const NEGATIONS = [
  "no",
  "not",
  "never",
  "wait",
  "actually",
  "instead",
  "change",
  "wrong",
  "cancel",
  "but",
  "except",
  "rather",
  "stop",
  "hold on",
  "one sec",
  "hang on",
];

/** Longest message still treated as a yes. Anything longer is a new instruction. */
const MAX_WORDS = 4;

export function isAffirmation(message: string): boolean {
  const normalized = message
    .toLowerCase()
    // Speech recognition returns curly apostrophes, so "that's" and "that's" have
    // to land on the same entry.
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[.!?,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") return false;
  if (normalized.split(" ").length > MAX_WORDS) return false;
  if (NEGATIONS.some((word) => new RegExp(`\\b${word}\\b`).test(normalized))) return false;

  return AFFIRMATIONS.has(normalized);
}
