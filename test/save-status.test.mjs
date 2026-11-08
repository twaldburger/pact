import test from "node:test";
import assert from "node:assert/strict";
import { SAVED, SAVING, NOT_SAVED, saveStatusWord } from "../public/lib/save-status.mjs";

test("a write in flight reads Saving…, however many are in flight", () => {
  assert.equal(saveStatusWord(1, false), SAVING);
  assert.equal(saveStatusWord(2, false), SAVING);
  // A failure already recorded is overridden while a new write is in flight.
  assert.equal(saveStatusWord(1, true), SAVING);
});

test("with nothing in flight the last write's fate decides the word", () => {
  // The initial load is a GET, not a write, so a fresh bar reads Saved.
  assert.equal(saveStatusWord(0, false), SAVED);
  // A failure keeps Not saved on screen until a later write succeeds.
  assert.equal(saveStatusWord(0, true), NOT_SAVED);
});
