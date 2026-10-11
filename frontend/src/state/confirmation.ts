/**
 * Whether a customer's own message agrees to the summary on screen.
 *
 * Voice mode has no click to book with, so a spoken yes is the confirmation. The
 * model reports that it heard one, but the model is also the thing that gets dates
 * wrong and the thing that announced a booking which did not exist, so every other
 * decision it makes here is re-checked somewhere else: the browser validates the
 * slots, the server recomputes the room, and the server refuses a reply that claims
 * an outcome. Letting it create a reservation on its own say-so would be the one
 * unchecked write in the system.
 *
 * So this is a vocabulary check rather than a sentiment judgement, and it only ever
 * refuses: what it does not recognise leaves the summary on screen, where the
 * Confirm button is, and the customer can say it again or click. Exact phrases alone
 * were too strict for speech, where "yeah go ahead" and "yes please book it" are the
 * normal ways to agree, so a short message with an agreeing word in it and nothing
 * questioning counts too.
 */

/** Whole phrases that only ever mean yes. */
const PHRASES = new Set(["do it", "go ahead", "that works", "that's right", "sounds good"]);

const AFFIRMATIONS = new Set([
  "yes",
  "yeah",
  "yep",
  "yup",
  "ok",
  "okay",
  "sure",
  "fine",
  "confirm",
  "confirmed",
  "correct",
  "right",
  "agreed",
  "perfect",
  "great",
  "good",
  "sounds",
  "looks",
  "absolutely",
  "certainly",
  "definitely",
  "please",
  "book",
  "works",
]);

/** Any of these as a word and the message is not an agreement, whatever else it says. */
const NEGATIONS = new Set([
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
  "hold",
  "hang",
  "maybe",
  "unless",
  "tomorrow",
]);

/**
 * A message asking something is not a message agreeing to something.
 *
 * The auxiliaries are here too, so "is that ok" is refused even when speech
 * recognition dropped the question mark. That costs a customer who says "yes that is
 * right" and gets asked again, which is the cheap side of the trade: a refusal leaves
 * the Confirm button on screen, while a false agreement writes a row to the queue.
 */
const QUESTIONS = new Set([
  "what",
  "which",
  "when",
  "where",
  "who",
  "why",
  "how",
  "can",
  "could",
  "would",
  "should",
  "shall",
  "will",
  "is",
  "are",
  "was",
  "were",
  "do",
  "does",
  "did",
  "have",
  "has",
  "any",
  "anything",
  "else",
]);

/** Longest message still treated as an agreement. Past this it is an instruction. */
const MAX_WORDS = 5;

export function isAffirmation(message: string): boolean {
  // Speech recognition returns curly apostrophes, so "that's" and "that's" have to
  // land on the same entry.
  const lower = message.toLowerCase().replace(/[\u2018\u2019]/g, "'");
  // Checked before the punctuation is stripped, because "yes?" is the customer
  // asking whether this is right rather than telling us to go ahead.
  if (lower.includes("?")) return false;

  const normalized = lower
    .replace(/[.!?,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (normalized === "") return false;
  if (PHRASES.has(normalized)) return true;

  const words = normalized.split(" ");
  if (words.length > MAX_WORDS) return false;
  if (words.some((word) => NEGATIONS.has(word))) return false;
  if (words.some((word) => QUESTIONS.has(word))) return false;

  return words.some((word) => AFFIRMATIONS.has(word));
}
