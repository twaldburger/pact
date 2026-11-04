import test from "node:test";
import assert from "node:assert/strict";
import { optionsItems, rangeControl } from "../public/lib/options.mjs";

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

test("the period control reads back the stored period", () => {
  const item = rangeControl({ start: "2026-09-01", end: "2027-10-31" });
  assert.equal(item.key, "range");
  assert.equal(item.label, "Plan period");
  assert.equal(item.start, "2026-09-01");
  assert.equal(item.end, "2027-10-31");
  // With no plan loaded the fields are simply empty, not undefined.
  assert.deepEqual(rangeControl(null), { key: "range", label: "Plan period", start: "", end: "" });
});
