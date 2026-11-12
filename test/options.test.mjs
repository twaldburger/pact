import test from "node:test";
import assert from "node:assert/strict";
import { optionsItems, dividerUnit, rangeControl, stepControl, paletteItems, paletteControl, sprintsItem, holidaysItem } from "../public/lib/options.mjs";
import { ZOOM_DEFAULT, ZOOM_LEVELS } from "../public/lib/timeline.mjs";

test("the options menu holds Show archived, Highlight weekends, Highlight holidays, Grid dividers and Minimap", () => {
  const items = optionsItems(false, true, false);
  assert.deepEqual(items.map((item) => item.key), ["archived", "weekends", "holidays", "dividers", "minimap"]);
  assert.deepEqual(items.map((item) => item.label), [
    "Show archived",
    "Highlight weekends",
    "Highlight holidays",
    "Grid dividers",
    "Minimap"
  ]);
});

test("Show archived is checked exactly while archived things are shown", () => {
  assert.equal(optionsItems(false)[0].checked, false);
  assert.equal(optionsItems(true)[0].checked, true);
  // The check is boolean, whatever truthy value the toggle hands it.
  assert.equal(optionsItems(1)[0].checked, true);
  assert.equal(optionsItems(undefined)[0].checked, false);
});

test("a fresh session opens with the weekend band and holiday band off, dividers on and Minimap off", () => {
  // The session's own defaults, handed to the menu as app.js hands them: the
  // two highlight bands are off, the dividers are on and the Minimap is off.
  const items = optionsItems(false, false, true);
  assert.equal(items[1].checked, false);
  assert.equal(items[2].checked, false);
  assert.equal(items[3].checked, true);
  assert.equal(items[4].checked, false);
});

test("Minimap is checked exactly while its toggle is on", () => {
  const minimap = (on) => optionsItems(false, true, false, on)[4].checked;
  assert.equal(minimap(true), true);
  assert.equal(minimap(false), false);
  assert.equal(minimap(1), true);
  assert.equal(minimap(undefined), false);
});

test("Highlight holidays is checked exactly while its band is drawn", () => {
  const holidays = (on) => optionsItems(false, false, false, false, on)[2].checked;
  assert.equal(holidays(true), true);
  assert.equal(holidays(false), false);
  assert.equal(holidays(1), true);
  assert.equal(holidays(undefined), false);
});

test("Highlight weekends is checked exactly while the band is drawn", () => {
  const weekends = (on) => optionsItems(false, on, false)[1].checked;
  assert.equal(weekends(true), true);
  assert.equal(weekends(false), false);
  assert.equal(weekends(1), true);
  assert.equal(weekends(undefined), false);
});

test("Grid dividers is checked exactly while the rules are drawn", () => {
  const dividers = (on) => optionsItems(false, false, on)[3].checked;
  assert.equal(dividers(true), true);
  assert.equal(dividers(false), false);
  assert.equal(dividers(1), true);
  assert.equal(dividers(undefined), false);
});

test("the items are independent of one another", () => {
  const items = optionsItems(true, false, true, false, true);
  assert.deepEqual(items.map((item) => item.checked), [true, false, true, true, false]);
  const all = optionsItems(true, true, true, true, true);
  assert.deepEqual(all.map((item) => item.checked), [true, true, true, true, true]);
});

test("the grid divider follows the zoom, falling back to the coarsest", () => {
  assert.equal(dividerUnit("day"), "day");
  assert.equal(dividerUnit("week"), "week");
  assert.equal(dividerUnit("sprint"), "sprint");
  assert.equal(dividerUnit("month"), "month");
  // An unknown zoom draws the quietest grid, the default's granularity.
  ["year", "Month", "", undefined, null].forEach((zoom) => {
    assert.equal(dividerUnit(zoom), "month");
  });
  assert.equal(dividerUnit(undefined), ZOOM_DEFAULT);
});

test("every zoom has a divider unit", () => {
  ZOOM_LEVELS.forEach((level) => {
    assert.ok(["day", "week", "sprint", "month"].includes(dividerUnit(level)));
  });
});

test("the Sprints entry states whether a cadence exists yet", () => {
  assert.equal(sprintsItem(false).key, "sprints");
  assert.equal(sprintsItem(false).label, "Sprints...");
  assert.equal(sprintsItem(false).detail, "Not defined yet");
  assert.equal(sprintsItem(true).detail, "Cadence defined");
  assert.equal(sprintsItem(1).detail, "Cadence defined");
  assert.equal(sprintsItem(undefined).detail, "Not defined yet");
});

test("the Holidays entry counts the configured dates", () => {
  assert.equal(holidaysItem(undefined).key, "holidays");
  assert.equal(holidaysItem(undefined).label, "Holidays...");
  assert.equal(holidaysItem(undefined).detail, "None yet");
  assert.equal(holidaysItem([]).detail, "None yet");
  assert.equal(holidaysItem([{ location: "Portugal", dates: [{ date: "2026-12-25", kind: "full" }] }]).detail,
    "1 date");
  assert.equal(holidaysItem([
    { location: "Portugal", dates: [{ date: "2026-12-25", kind: "full" }] },
    { location: "Switzerland", dates: [{ date: "2026-08-01", kind: "half" }] }
  ]).detail, "2 dates");
});

test("the period control reads back the stored period", () => {
  const item = rangeControl({ start: "2026-09-01", end: "2027-10-31" });
  assert.equal(item.key, "range");
  assert.equal(item.label, "Plan period");
  assert.equal(item.detail, "1 Sep 2026 - 31 Oct 2027");
  assert.equal(item.start, "2026-09-01");
  assert.equal(item.end, "2027-10-31");
  // With no plan loaded the fields are simply empty, and the row says so
  // rather than showing a fragment of a date.
  assert.deepEqual(rangeControl(null), { key: "range", label: "Plan period", detail: "Not set", start: "", end: "" });
  assert.equal(rangeControl({ start: "2026-09-01", end: "" }).detail, "Not set");
  assert.equal(rangeControl({ start: "2026-9-1", end: "2027-10-31" }).detail, "Not set");
});

test("the step control reads back the plan's step and defaults to 10", () => {
  assert.deepEqual(stepControl(5), {
    key: "step", label: "Percentage step", detail: "5%", value: 5, min: 1, max: 100, defaultValue: 10
  });
  assert.equal(stepControl(100).detail, "100%");
  assert.equal(stepControl(1).detail, "1%");
  // An absent or malformed step reads as the default of 10, never as a value
  // that would re-step the plan by something the store would refuse.
  assert.equal(stepControl(undefined).value, 10);
  assert.equal(stepControl(undefined).detail, "10%");
  assert.equal(stepControl(null).value, 10);
  assert.equal(stepControl(0).value, 10);
  assert.equal(stepControl(101).value, 10);
  assert.equal(stepControl(2.5).value, 10);
});

test("the Colour palette group is Paired and Set3, exactly one checked", () => {
  const items = paletteItems("paired");
  assert.deepEqual(items.map((item) => item.key), ["paired", "set3"]);
  assert.deepEqual(items.map((item) => item.label), ["Paired", "Set3"]);
  assert.deepEqual(items.map((item) => item.checked), [true, false]);
  assert.deepEqual(paletteItems("set3").map((item) => item.checked), [false, true]);
  // A missing or unknown palette opens at Paired rather than checking nothing.
  assert.deepEqual(paletteItems(undefined).map((item) => item.checked), [true, false]);
  assert.deepEqual(paletteItems("vibrant").map((item) => item.checked), [true, false]);
});

test("the palette row states the active scheme as its detail", () => {
  assert.deepEqual(paletteControl("paired"), { key: "palette", label: "Colour palette", detail: "Paired" });
  assert.equal(paletteControl("set3").detail, "Set3");
  // A missing or unknown palette reads as Paired, the scheme it opens at.
  assert.equal(paletteControl(undefined).detail, "Paired");
  assert.equal(paletteControl("vibrant").detail, "Paired");
});

test("the palette, period and step are each one collapsed row, not a group", () => {
  // The menu's second shape: a label and the value it holds, never a heading
  // over several rows.
  [paletteControl("paired"), rangeControl({ start: "2026-01-01", end: "2026-12-31" }), stepControl(10)]
    .forEach((item) => {
      assert.equal(typeof item.label, "string");
      assert.equal(typeof item.detail, "string");
      assert.ok(item.detail.length > 0);
    });
  assert.equal(paletteControl("set3").label, "Colour palette");
  assert.equal(rangeControl(null).label, "Plan period");
  assert.equal(stepControl(10).label, "Percentage step");
});
