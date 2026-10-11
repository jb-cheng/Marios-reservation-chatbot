import assert from "node:assert/strict";
import test from "node:test";

import { isAffirmation } from "../src/state/confirmation.ts";

test("an unambiguous yes is a confirmation", () => {
  const messages = [
    "yes",
    "Yes.",
    "yeah",
    "yep",
    "confirm",
    "book it",
    "that works",
    "go ahead",
    "sounds good",
    "OK!",
  ];

  for (const message of messages) {
    assert.equal(isAffirmation(message), true, message);
  }
});

test("punctuation and a curly apostrophe from speech recognition still count", () => {
  assert.equal(isAffirmation("  yes,   please.  "), true);
  assert.equal(isAffirmation("That’s right"), true);
});

/**
 * The cases that matter. Each of these reached a booking when the model's own
 * submit flag was the only gate, because each contains a yes somewhere.
 */
test("a message that merely contains a yes is not one", () => {
  const messages = [
    "no",
    "not yet",
    "wait",
    "yes but can we do 8 instead",
    "actually no, yes I meant the 18th",
    "I said yes to the booth, not the patio",
    "change the time to 20:00",
    "yes, and could you note that it is a birthday",
  ];

  for (const message of messages) {
    assert.equal(isAffirmation(message), false, message);
  }
});

test("a long message is an instruction rather than a yes", () => {
  assert.equal(
    isAffirmation("yes please book the table for saturday at seven for four people"),
    false,
  );
});

test("nothing said is not a yes", () => {
  assert.equal(isAffirmation(""), false);
  assert.equal(isAffirmation("   "), false);
});
