import test from "node:test";
import assert from "node:assert/strict";
import { VIEW_DEFAULTS, VIEW_KEYS, normalizeView, normalizeSort } from "../public/lib/view.mjs";
import {
  ZOOM_DEFAULT,
  GRID_SPACING_DEFAULTS,
  GRID_SPACING_MIN,
  GRID_SPACING_MAX,
  clampGridSpacing,
  stepGridSpacing
} from "../public/lib/timeline.mjs";
import { PALETTE_DEFAULT } from "../public/lib/palette.mjs";
import { STACK_COLLAPSED_DEFAULT } from "../public/lib/stack.mjs";
import { MINIMAP_DEFAULT } from "../public/lib/minimap.mjs";
import { REPORT_VIEW_DEFAULT, REPORT_VIEWS } from "../public/lib/report-views.mjs";
import { ASCENDING, DESCENDING } from "../public/lib/sort.mjs";

/* --- the defaults --------------------------------------------------------- */

test("the defaults are exactly what the app shipped with", () => {
  assert.deepEqual(VIEW_DEFAULTS, {
    zoom: "month",
    reportZoom: "month",
    reportView: "by-project",
    rowHeight: 48,
    gridSpacing: { day: 44, week: 16, sprint: 8, month: 5 },
    weekends: false,
    holidays: false,
    milestones: false,
    availabilityLines: true,
    dividers: true,
    minimap: false,
    marker: true,
    palette: "paired",
    stackCollapsed: false,
    sort: { projects: null, people: null }
  });
  // The single owners of each value, so the two cannot drift.
  assert.equal(VIEW_DEFAULTS.zoom, ZOOM_DEFAULT);
  assert.deepEqual(VIEW_DEFAULTS.gridSpacing, GRID_SPACING_DEFAULTS);
  assert.equal(VIEW_DEFAULTS.palette, PALETTE_DEFAULT);
  assert.equal(VIEW_DEFAULTS.minimap, MINIMAP_DEFAULT);
  assert.equal(VIEW_DEFAULTS.stackCollapsed, STACK_COLLAPSED_DEFAULT);
  assert.equal(VIEW_DEFAULTS.reportView, REPORT_VIEW_DEFAULT);
  // A report opens on its first view.
  assert.equal(REPORT_VIEW_DEFAULT, REPORT_VIEWS[0].key);
});

test("an absent view, or any non-object, reads as every default", () => {
  [undefined, null, {}, 42, "view", [], true].forEach((raw) => {
    assert.deepEqual(normalizeView(raw), {
      zoom: "month",
      reportZoom: "month",
      reportView: "by-project",
      rowHeight: 48,
      gridSpacing: { day: 44, week: 16, sprint: 8, month: 5 },
      weekends: false,
      holidays: false,
      milestones: false,
      availabilityLines: true,
      dividers: true,
      minimap: false,
      marker: true,
      palette: "paired",
      stackCollapsed: false,
      sort: { projects: null, people: null }
    });
  });
});

test("the keys the view owns are the keys it normalises", () => {
  assert.deepEqual(Object.keys(normalizeView({})).sort(), VIEW_KEYS.slice().sort());
});

test("Show archived is not a view setting, so a stored one is dropped", () => {
  // The owner's decision: archived work is the exception, shown deliberately
  // each session. A view carrying the key saves and reloads without it.
  assert.equal(VIEW_KEYS.includes("archived"), false);
  assert.equal("archived" in normalizeView({ archived: true }), false);
  assert.deepEqual(normalizeView({ archived: true }), normalizeView({}));
});

/* --- each key round-trips ------------------------------------------------- */

test("every key survives a normalise at a non-default value", () => {
  const stored = {
    zoom: "day",
    reportZoom: "week",
    reportView: "allocation-by-tag",
    rowHeight: 120,
    gridSpacing: { day: 48, week: 30, sprint: 2, month: 7 },
    weekends: true,
    holidays: true,
    milestones: true,
    availabilityLines: false,
    dividers: false,
    minimap: true,
    marker: false,
    palette: "set3",
    stackCollapsed: true,
    sort: {
      projects: { key: "fte", direction: ASCENDING },
      people: { key: "free", direction: ASCENDING }
    }
  };
  assert.deepEqual(normalizeView(stored), stored);
});

test("a stored view naming the removed report view opens on the default", () => {
  // A config written before issue #171 removed FTE-days by tag over time still
  // names it: the report opens on its first view rather than a blank panel, and
  // the other keys keep the values the owner left.
  const folded = normalizeView({
    reportView: "by-tag-over-time",
    reportZoom: "week",
    stackCollapsed: true
  });
  assert.equal(folded.reportView, REPORT_VIEW_DEFAULT);
  assert.equal(folded.reportZoom, "week");
  assert.equal(folded.stackCollapsed, true);
});

test("the two sort lists carry their own key and direction", () => {
  const projects = normalizeSort("projects", { key: "end", direction: ASCENDING });
  assert.deepEqual(projects, { key: "end", direction: ASCENDING });
  const people = normalizeSort("people", { key: "name", direction: DESCENDING });
  assert.deepEqual(people, { key: "name", direction: DESCENDING });
  // No stored order is a valid value, not a malformed one.
  assert.equal(normalizeSort("people", null), null);
  assert.equal(normalizeSort("people", undefined), null);
});

/* --- one bad key falls back alone ----------------------------------------- */

test("a malformed value falls back for that key and leaves the rest", () => {
  const stored = {
    zoom: "year",
    reportView: "by-chart-type",
    rowHeight: "tall",
    gridSpacing: { day: "wide", week: 30, sprint: null, month: 7 },
    weekends: "yes",
    holidays: "yes",
    milestones: "yes",
    availabilityLines: "yes",
    dividers: 1,
    minimap: "on",
    marker: "yes",
    palette: "neon",
    stackCollapsed: "true",
    sort: { projects: { key: "nonsense" }, people: null }
  };
  assert.deepEqual(normalizeView(stored), {
    zoom: "month",
    reportZoom: "month",
    reportView: "by-project",
    rowHeight: 48,
    gridSpacing: { day: 44, week: 30, sprint: 8, month: 7 },
    weekends: false,
    holidays: false,
    milestones: false,
    availabilityLines: true,
    dividers: true,
    minimap: false,
    marker: true,
    palette: "paired",
    stackCollapsed: false,
    sort: { projects: null, people: null }
  });
});

test("a valid key beside a malformed one is kept", () => {
  const view = normalizeView({ zoom: "week", palette: "nope", weekends: true, dividers: "no" });
  assert.equal(view.zoom, "week");
  assert.equal(view.weekends, true);
  assert.equal(view.palette, "paired");
  assert.equal(view.dividers, true);
});

test("a malformed direction reads as the key's own direction, not a lost sort", () => {
  // `free` sorts descending on its first press, `name` ascending.
  assert.deepEqual(normalizeSort("people", { key: "free", direction: "sideways" }),
    { key: "free", direction: DESCENDING });
  assert.deepEqual(normalizeSort("projects", { key: "name", direction: "" }),
    { key: "name", direction: ASCENDING });
  // An unknown key is no order at all, whatever direction it carries.
  assert.equal(normalizeSort("projects", { key: "weight", direction: ASCENDING }), null);
});

test("a row height is snapped and clamped, never left off the scale", () => {
  assert.equal(normalizeView({ rowHeight: 50 }).rowHeight, 48);
  assert.equal(normalizeView({ rowHeight: 52 }).rowHeight, 56);
  assert.equal(normalizeView({ rowHeight: 4 }).rowHeight, 32);
  assert.equal(normalizeView({ rowHeight: 400 }).rowHeight, 120);
  assert.equal(normalizeView({ rowHeight: Number.NaN }).rowHeight, 48);
});

test("each zoom keeps its own spacing, a missing or malformed one falling back alone", () => {
  assert.deepEqual(normalizeView({}).gridSpacing, { day: 44, week: 16, sprint: 8, month: 5 });
  // A missing spacing object, and one that only names a single zoom.
  assert.deepEqual(normalizeView({ gridSpacing: null }).gridSpacing,
    { day: 44, week: 16, sprint: 8, month: 5 });
  assert.deepEqual(normalizeView({ gridSpacing: { day: 30 } }).gridSpacing,
    { day: 30, week: 16, sprint: 8, month: 5 });
  // One bad width falls back for its zoom alone; the rest are kept.
  assert.deepEqual(normalizeView({ gridSpacing: { day: 30, week: "wide", sprint: 2, month: 48 } }).gridSpacing,
    { day: 30, week: 16, sprint: 2, month: 48 });
});

test("a spacing is clamped to 2..48 and stepped in twos", () => {
  assert.equal(clampGridSpacing(-10), GRID_SPACING_MIN);
  assert.equal(clampGridSpacing(0), GRID_SPACING_MIN);
  assert.equal(clampGridSpacing(1000), GRID_SPACING_MAX);
  assert.equal(clampGridSpacing(30), 30);
  assert.equal(clampGridSpacing(Number.NaN), null);
  // The step keeps Month's odd default odd and clamps at each end.
  assert.equal(stepGridSpacing(5, 1), 7);
  assert.equal(stepGridSpacing(5, -1), 3);
  assert.equal(stepGridSpacing(3, -1), GRID_SPACING_MIN);
  assert.equal(stepGridSpacing(47, 1), GRID_SPACING_MAX);
  assert.equal(stepGridSpacing(2, -1), GRID_SPACING_MIN);
  assert.equal(stepGridSpacing(48, 1), GRID_SPACING_MAX);
  assert.equal(stepGridSpacing("wide", 1), null);
});

test("the milestone rules start off, are restored on load, and Reset view returns them to off", () => {
  // Off on a first run and in any config that never stored it.
  assert.equal(VIEW_DEFAULTS.milestones, false);
  assert.equal(normalizeView({}).milestones, false);
  // Switched on, the stored view brings them back.
  assert.equal(normalizeView({ milestones: true }).milestones, true);
  // Reset view writes the defaults whole, so the toggle comes back off.
  assert.equal(VIEW_DEFAULTS.milestones, false);
  // Only a boolean is a stored value; anything else is the default.
  [1, "yes", null, [], {}].forEach((raw) => {
    assert.equal(normalizeView({ milestones: raw }).milestones, false);
  });
});

test("the availability lines start drawn, are restored on load, and Reset view returns them to drawn", () => {
  // Drawn on a first run and in any config that never stored it: that is how
  // every row opened while the line was not a setting.
  assert.equal(VIEW_DEFAULTS.availabilityLines, true);
  assert.equal(normalizeView({}).availabilityLines, true);
  // Switched off, the stored view brings them back hidden.
  assert.equal(normalizeView({ availabilityLines: false }).availabilityLines, false);
  // Reset view writes the defaults whole, so the toggle comes back on.
  assert.equal(normalizeView(VIEW_DEFAULTS).availabilityLines, true);
  // Only a boolean is a stored value; anything else is the default.
  [1, 0, "yes", null, [], {}].forEach((raw) => {
    assert.equal(normalizeView({ availabilityLines: raw }).availabilityLines, true);
  });
});

test("the Marker starts drawn, is restored on load, and Reset view returns it to drawn", () => {
  // Shown on a first run and in any config that never stored it: that is how
  // the grid opened while its visibility was not a setting.
  assert.equal(VIEW_DEFAULTS.marker, true);
  assert.equal(normalizeView({}).marker, true);
  // Switched off, the stored view brings it back hidden.
  assert.equal(normalizeView({ marker: false }).marker, false);
  // Reset view writes the defaults whole, so the toggle comes back on.
  assert.equal(normalizeView(VIEW_DEFAULTS).marker, true);
  // Only a boolean is a stored value; anything else is the default.
  [1, 0, "yes", null, [], {}].forEach((raw) => {
    assert.equal(normalizeView({ marker: raw }).marker, true);
  });
});

test("normalise returns a fresh object every time", () => {
  const a = normalizeView({});
  const b = normalizeView({});
  a.sort.projects = { key: "name", direction: ASCENDING };
  a.gridSpacing.day = 2;
  assert.equal(b.sort.projects, null);
  assert.equal(normalizeView({}).sort.people, null);
  assert.equal(b.gridSpacing.day, 44);
});
