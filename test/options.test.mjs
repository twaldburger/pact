import test from "node:test";
import assert from "node:assert/strict";
import { optionsItems } from "../public/lib/options.mjs";

test("the options menu holds Show archived", () => {
  const items = optionsItems(false);
  assert.deepEqual(items.map((item) => item.key), ["archived"]);
  assert.equal(items[0].label, "Show archived");
});

test("Show archived is checked exactly while archived things are shown", () => {
  assert.equal(optionsItems(false)[0].checked, false);
  assert.equal(optionsItems(true)[0].checked, true);
  // The check is boolean, whatever truthy value the toggle hands it.
  assert.equal(optionsItems(1)[0].checked, true);
  assert.equal(optionsItems(undefined)[0].checked, false);
});
