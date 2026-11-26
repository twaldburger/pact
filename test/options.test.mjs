import test from "node:test";
import assert from "node:assert/strict";
import { optionsItems, optionGroups, optionDividerKeys, reportDisabledOptionKeys, dividerUnit, rangeControl, stepControl, paletteItems, paletteControl, blockLabelControl, blockLabelItems, sprintsItem, holidaysItem, tagsItem, milestonesItem, helpItem } from "../public/lib/options.mjs";
import { VIEW_KEYS } from "../public/lib/view.mjs";
import { ZOOM_DEFAULT, ZOOM_LEVELS } from "../public/lib/timeline.mjs";
import { sprintsFor } from "../public/lib/sprints.mjs";

test("the options menu holds Show archived, Weekends, Holidays, Milestones, Availability lines, Assignments, Grid dividers, Minimap and Marker", () => {
  const items = optionsItems(false, true, false);
  assert.deepEqual(items.map((item) => item.key), ["archived", "weekends", "holidays", "milestones", "availabilityLines", "assignments", "dividers", "minimap", "marker"]);
  assert.deepEqual(items.map((item) => item.label), [
    "Show archived",
    "Weekends",
    "Holidays",
    "Milestones",
    "Availability lines",
    "Assignments",
    "Grid dividers",
    "Minimap",
    "Marker"
  ]);
});

test("Show archived is checked exactly while archived things are shown", () => {
  assert.equal(optionsItems(false)[0].checked, false);
  assert.equal(optionsItems(true)[0].checked, true);
  // The check is boolean, whatever truthy value the toggle hands it.
  assert.equal(optionsItems(1)[0].checked, true);
  assert.equal(optionsItems(undefined)[0].checked, false);
});

test("a fresh session opens with the weekend band, holiday band and milestone rules off, the availability lines, the blocks and dividers on, Minimap off and the Marker drawn", () => {
  // The session's own defaults, handed to the menu as app.js hands them: the
  // two highlight bands and the milestone rules are off, the availability
  // lines, the assignment blocks and the dividers are on, the Minimap is off
  // and the Marker is drawn.
  const items = optionsItems(false, false, true, false, false, false, true, true, true);
  assert.equal(items[1].checked, false);
  assert.equal(items[2].checked, false);
  assert.equal(items[3].checked, false);
  assert.equal(items[4].checked, true);
  assert.equal(items[5].checked, true);
  assert.equal(items[6].checked, true);
  assert.equal(items[7].checked, false);
  assert.equal(items[8].checked, true);
});

test("Milestones is checked exactly while the milestone rules are drawn", () => {
  const milestones = (on) => optionsItems(false, false, false, false, false, on)[3].checked;
  assert.equal(milestones(true), true);
  assert.equal(milestones(false), false);
  assert.equal(milestones(1), true);
  assert.equal(milestones(undefined), false);
});

test("Availability lines is checked exactly while the lines are drawn", () => {
  const lines = (on) => optionsItems(false, true, false, false, false, false, true, on)[4].checked;
  assert.equal(lines(true), true);
  assert.equal(lines(false), false);
  assert.equal(lines(1), true);
  assert.equal(lines(undefined), false);
});

test("Assignments is checked exactly while the blocks are drawn", () => {
  const blocks = (on) => optionsItems(false, true, false, false, false, false, true, true, on)[5].checked;
  assert.equal(blocks(true), true);
  assert.equal(blocks(false), false);
  assert.equal(blocks(1), true);
  assert.equal(blocks(undefined), false);
});

test("Minimap is checked exactly while its toggle is on", () => {
  const minimap = (on) => optionsItems(false, true, false, on)[7].checked;
  assert.equal(minimap(true), true);
  assert.equal(minimap(false), false);
  assert.equal(minimap(1), true);
  assert.equal(minimap(undefined), false);
});

test("Marker is checked exactly while the line is drawn", () => {
  const marker = (on) => optionsItems(false, true, false, false, false, false, on)[8].checked;
  assert.equal(marker(true), true);
  assert.equal(marker(false), false);
  assert.equal(marker(1), true);
  assert.equal(marker(undefined), false);
});

test("Holidays is checked exactly while its band is drawn", () => {
  const holidays = (on) => optionsItems(false, false, false, false, on)[2].checked;
  assert.equal(holidays(true), true);
  assert.equal(holidays(false), false);
  assert.equal(holidays(1), true);
  assert.equal(holidays(undefined), false);
});

test("Weekends is checked exactly while the band is drawn", () => {
  const weekends = (on) => optionsItems(false, on, false)[1].checked;
  assert.equal(weekends(true), true);
  assert.equal(weekends(false), false);
  assert.equal(weekends(1), true);
  assert.equal(weekends(undefined), false);
});

test("Grid dividers is checked exactly while the rules are drawn", () => {
  const dividers = (on) => optionsItems(false, false, on)[6].checked;
  assert.equal(dividers(true), true);
  assert.equal(dividers(false), false);
  assert.equal(dividers(1), true);
  assert.equal(dividers(undefined), false);
});

test("the items are independent of one another", () => {
  const items = optionsItems(true, false, true, false, true);
  assert.deepEqual(items.map((item) => item.checked), [true, false, true, false, false, false, true, false, false]);
  const all = optionsItems(true, true, true, true, true, true, true, true, true);
  assert.deepEqual(all.map((item) => item.checked), [true, true, true, true, true, true, true, true, true]);
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

test("the Sprints entry counts the sprints the panel lists", () => {
  const period = { start: "2026-01-01", end: "2026-02-28" };
  const cadence = { start: "2026-01-01", length: 14, namePrefix: "Sprint ", nameNumber: 24 };
  assert.equal(sprintsItem(undefined).key, "sprints");
  assert.equal(sprintsItem(undefined).label, "Sprints...");

  // The entry states the count the panel's own heading states: one rule,
  // sprintsFor, counted here exactly as the panel counts it.
  const chain = sprintsFor(cadence, [], period);
  assert.equal(chain.length, 5);
  assert.equal(sprintsItem(cadence, [], period).detail, chain.length + " sprints");

  // One sprint reads singular.
  const one = { start: "2026-01-01", end: "2026-01-10" };
  assert.equal(sprintsFor(cadence, [], one).length, 1);
  assert.equal(sprintsItem(cadence, [], one).detail, "1 sprint");

  // A longer plan period lengthens the chain, so the count follows it.
  const longer = { start: "2026-01-01", end: "2026-04-30" };
  assert.ok(sprintsFor(cadence, [], longer).length > chain.length);
  assert.equal(sprintsItem(cadence, [], longer).detail,
    sprintsFor(cadence, [], longer).length + " sprints");

  // A per-sprint adjustment is part of the same derivation: a longer sprint
  // re-flows the chain and the entry counts the longer chain.
  const adjusted = sprintsFor(cadence, [{ index: 2, length: 35 }], period);
  assert.notEqual(adjusted.length, chain.length);
  assert.equal(sprintsItem(cadence, [{ index: 2, length: 35 }], period).detail,
    adjusted.length + " sprints");

  // No cadence claims no count at all rather than "0 sprints".
  assert.equal(sprintsItem(null, [], period).detail, "Not defined yet");
  assert.equal(sprintsItem(undefined).detail, "Not defined yet");
  assert.equal(sprintsItem(undefined, undefined, undefined).detail, "Not defined yet");
  assert.equal(sprintsItem({ start: "not-a-date" }, [], period).detail, "Not defined yet");
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

test("the Tags entry states what the panel holds", () => {
  assert.equal(tagsItem(undefined).key, "tags");
  assert.equal(tagsItem(undefined).label, "Tags...");
  assert.equal(tagsItem(undefined).detail, "None yet");
  assert.equal(tagsItem({}).detail, "None yet");
  assert.equal(tagsItem({ keys: { projects: "api" } }).detail, "1 key");
  assert.equal(tagsItem({ keys: { projects: "api", people: "skill" } }).detail, "2 keys");
  assert.equal(tagsItem({ colours: { "api:Stellar": 2 } }).detail, "1 colour");
  assert.equal(tagsItem({ colours: { "api:Stellar": 2, "skill:DevOps": 1 } }).detail, "2 colours");
  assert.equal(tagsItem({ keys: { projects: "api" }, colours: { "api:Stellar": 2 } }).detail, "1 key, 1 colour");
  // A malformed mapping counts for nothing rather than reporting a value it
  // could never colour.
  assert.equal(tagsItem({ keys: { bogus: "api" }, colours: { nottyped: 1 } }).detail, "None yet");
});

test("the period control reads back the stored period", () => {
  const item = rangeControl({ start: "2026-09-01", end: "2027-10-31" });
  assert.equal(item.key, "range");
  assert.equal(item.label, "Plan period");
  assert.equal(item.detail, "01.09.26 - 31.10.27");
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

test("the Milestones entry counts the plan's milestones", () => {
  assert.equal(milestonesItem(undefined).key, "milestones");
  assert.equal(milestonesItem(undefined).label, "Milestones...");
  assert.equal(milestonesItem(undefined).detail, "None yet");
  assert.equal(milestonesItem([]).detail, "None yet");
  const one = [{ id: "launch", name: "Atlas launch", date: "2026-12-01", colour: 1 }];
  assert.equal(milestonesItem(one).detail, "1 milestone");
  const three = one.concat([
    { id: "audit", name: "Audit", date: "2026-12-08", colour: 2 },
    { id: "close", name: "Q4 close", date: "2026-12-20", colour: 3 }
  ]);
  assert.equal(milestonesItem(three).detail, "3 milestones");
  // A malformed value counts for nothing rather than throwing over the menu.
  assert.equal(milestonesItem("launch").detail, "None yet");
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

test("the palette, the Block label, the period and the step are each one collapsed row, not a group", () => {
  // The menu's second shape: a label and the value it holds, never a heading
  // over several rows.
  [paletteControl("paired"), blockLabelControl("project"), rangeControl({ start: "2026-01-01", end: "2026-12-31" }), stepControl(10)]
    .forEach((item) => {
      assert.equal(typeof item.label, "string");
      assert.equal(typeof item.detail, "string");
      assert.ok(item.detail.length > 0);
    });
  assert.equal(paletteControl("set3").label, "Colour palette");
  assert.equal(blockLabelControl("both").label, "Block label");
  assert.equal(rangeControl(null).label, "Plan period");
  assert.equal(stepControl(10).label, "Percentage step");
});

test("the Block label group is Project name, Assignment name and Both, exactly one checked", () => {
  const items = blockLabelItems("project");
  assert.deepEqual(items.map((item) => item.key), ["project", "assignment", "both"]);
  assert.deepEqual(items.map((item) => item.label), ["Project name", "Assignment name", "Both"]);
  assert.deepEqual(items.map((item) => item.checked), [true, false, false]);
  assert.deepEqual(blockLabelItems("assignment").map((item) => item.checked), [false, true, false]);
  assert.deepEqual(blockLabelItems("both").map((item) => item.checked), [false, false, true]);
  // A missing or unknown setting checks Project name, which is what every
  // block said before an Assignment could have one.
  assert.deepEqual(blockLabelItems(undefined).map((item) => item.checked), [true, false, false]);
  assert.deepEqual(blockLabelItems("title").map((item) => item.checked), [true, false, false]);
});

test("the Block label row states the active setting as its detail", () => {
  assert.deepEqual(blockLabelControl("project"), { key: "blockLabel", label: "Block label", detail: "Project name" });
  assert.equal(blockLabelControl("assignment").detail, "Assignment name");
  assert.equal(blockLabelControl("both").detail, "Both");
  // A missing or unknown setting reads as the Project's name, which is what
  // every block said before an Assignment could have one.
  assert.equal(blockLabelControl(undefined).detail, "Project name");
  assert.equal(blockLabelControl("title").detail, "Project name");
  // It is a view setting, like the palette it sits after: stored in the config
  // and restored by Reset view, never written to the plan.
  assert.equal(VIEW_KEYS.includes("blockLabel"), true);
});

test("the Help entry is an action carrying the panel-opener's ellipsis", () => {
  // Named the way every other row that opens a panel is named, and with no
  // detail: there is nothing about the help to count.
  assert.deepEqual(helpItem(), { key: "help", label: "Help..." });
});

test("the menu reads as five groups in order: the help, what is drawn, what is included, the plan and the app", () => {
  const items = optionsItems(false, false, true, false, false);
  assert.deepEqual(optionGroups(items), [
    ["help"],
    ["weekends", "holidays", "milestones", "availabilityLines", "assignments", "dividers", "minimap", "marker", "palette", "blockLabel", "reset-view"],
    ["archived"],
    ["range", "step", "sprints", "holidays", "tags", "milestones"],
    ["plan-file", "ado"]
  ]);
  // The Block label follows the palette directly: both are display choices
  // about how a block is drawn, and neither is one of the overlay toggles.
  assert.equal(optionGroups(items)[1].indexOf("blockLabel"), optionGroups(items)[1].indexOf("palette") + 1);
  // A future view toggle joins the view group by being in optionsItems alone;
  // Show archived is the one row there that is not a view toggle.
  const added = items.concat([{ key: "noise", label: "X" }]);
  assert.deepEqual(optionGroups(added)[0], ["help"]);
  assert.deepEqual(optionGroups(added)[1], ["weekends", "holidays", "milestones", "availabilityLines", "assignments", "dividers", "minimap", "marker", "noise", "palette", "blockLabel", "reset-view"]);
  assert.deepEqual(optionGroups(added)[2], ["archived"]);
});

test("four dividers are drawn, each on a group boundary", () => {
  const items = optionsItems(false, false, true, false, false);
  const dividers = optionDividerKeys(items);
  // One below Help, one above Show archived, one above the plan period, which
  // together box the archived group in, plus the one above Plan file.
  assert.deepEqual(dividers, ["weekends", "archived", "range", "plan-file"]);
  assert.equal(dividers.filter((key) => key === "weekends").length, 1);
  assert.equal(dividers.filter((key) => key === "archived").length, 1);
  assert.equal(dividers.filter((key) => key === "range").length, 1);
  // Help opens the menu, so it carries no line above it.
  assert.equal(dividers.includes("help"), false);
  // Each divider sits on the first row of a group after the menu's first.
  const groups = optionGroups(items);
  dividers.forEach((key) => assert.equal(groups.slice(1).some((group) => group[0] === key), true));
  // And no row outside that first-row rule carries one: the groups after Help
  // are divided exactly where they begin.
  groups.forEach((group) => group.forEach((key, at) => {
    assert.equal(dividers.includes(key), at === 0 && groups.indexOf(group) > 0, key);
  }));
});

test("Show archived keeps its place outside the view, its value outside the view settings", () => {
  const items = optionsItems(false, false, true, false, false);
  // Grouped on its own, not among the toggles the reset restores.
  assert.equal(optionGroups(items)[2].includes("archived"), true);
  assert.equal(optionGroups(items)[1].includes("archived"), false);
  // Session-only: the view's own keys never hold it, so a reload starts with
  // archived records hidden again.
  assert.equal(VIEW_KEYS.includes("archived"), false);
  assert.equal(VIEW_KEYS.includes("showArchived"), false);
  // A report includes records the same way, so its menu offers the row.
  assert.equal(reportDisabledOptionKeys().includes("archived"), false);
});

test("no row is divided because it is an action", () => {
  const dividers = optionDividerKeys(optionsItems(false, false, true, false, false));
  // The actions: Help, Reset view, Sprints, Holidays, Tags, Milestones and Plan
  // file. Only the one that opens a group carries a line above it.
  assert.equal(dividers.includes("help"), false);
  assert.equal(dividers.includes("reset-view"), false);
  assert.equal(dividers.includes("sprints"), false);
  assert.equal(dividers.includes("holidays"), false);
  assert.equal(dividers.includes("tags"), false);
  assert.equal(dividers.includes("milestones"), false);
  assert.equal(dividers.includes("plan-file"), true);
  // Help is the menu's first row, so its line falls below it, on the view
  // group's own first row.
  assert.equal(optionGroups(optionsItems(false, false, true, false, false))[0][0], "help");
  assert.equal(dividers[0], "weekends");
});
