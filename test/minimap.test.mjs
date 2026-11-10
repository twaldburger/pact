import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MINIMAP_DEFAULT,
  isMinimapEnabled,
  minimapDensity,
  visibleDayWindow,
  centerScrollLeft,
  dragScrollLeft,
  trackDayAt
} from "../public/lib/minimap.mjs";
import { defaultScopes } from "../public/lib/filter.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");

// A fixture whose density can be worked out by hand: two People (100% and 50%,
// so 1.5 FTE available on every day) and three Assignments whose shares add to
// 0.5, 1.0, 0.5 and 1.0 FTE across the four days.
const FIXTURE = {
  range: { start: "2026-01-01", end: "2026-01-04" },
  people: [
    { id: "p1", name: "P1", availability: 100 },
    { id: "p2", name: "P2", availability: 50 }
  ],
  projects: [{ id: "q1", name: "Q1" }],
  assignments: [
    { id: "a1", personId: "p1", projectId: "q1", start: "2026-01-01", end: "2026-01-02", share: 50 },
    { id: "a2", personId: "p2", projectId: "q1", start: "2026-01-02", end: "2026-01-03", share: 50 },
    { id: "a3", personId: "p1", projectId: "q1", start: "2026-01-04", end: "2026-01-04", share: 100 }
  ]
};

test("the Minimap is off by default and only true enables it", () => {
  assert.equal(MINIMAP_DEFAULT, false);
  assert.equal(isMinimapEnabled(true), true);
  assert.equal(isMinimapEnabled(false), false);
  assert.equal(isMinimapEnabled(1), false);
  assert.equal(isMinimapEnabled(undefined), false);
});

test("the density series matches hand-computed used over available", () => {
  const series = minimapDensity(FIXTURE, "", defaultScopes(), false);
  assert.equal(series.dayCount, 4);
  assert.equal(series.start, "2026-01-01");
  assert.equal(series.end, "2026-01-04");
  assert.equal(series.capacity, true);
  assert.deepEqual(series.slices.map((s) => s.available), [1.5, 1.5, 1.5, 1.5]);
  assert.deepEqual(series.slices.map((s) => s.used), [0.5, 1, 0.5, 1]);
  assert.deepEqual(series.slices.map((s) => s.density), [0.3333, 0.6667, 0.3333, 0.6667]);
  assert.deepEqual(series.slices.map((s) => s.over), [false, false, false, false]);
  assert.equal(series.maxDensity, 0.6667);
});

test("a slice past its available capacity is over-allocated", () => {
  const plan = {
    range: { start: "2026-01-01", end: "2026-01-02" },
    people: [{ id: "p1", name: "P1", availability: 50 }],
    projects: [{ id: "q1", name: "Q1" }],
    assignments: [
      { id: "a1", personId: "p1", projectId: "q1", start: "2026-01-01", end: "2026-01-02", share: 100 }
    ]
  };
  const series = minimapDensity(plan, "", defaultScopes(), false);
  assert.deepEqual(series.slices.map((s) => s.density), [2, 2]);
  assert.deepEqual(series.slices.map((s) => s.over), [true, true]);
  assert.equal(series.maxDensity, 2);
});

test("a filter that empties the grid leaves an empty map", () => {
  const series = minimapDensity(FIXTURE, "nothing-matches-this", defaultScopes(), false);
  assert.equal(series.capacity, false);
  assert.equal(series.maxDensity, 0);
  assert.deepEqual(series.slices.map((s) => s.density), [0, 0, 0, 0]);
});

test("the density follows the Filter as the grid does, propagation included", () => {
  // A plain match on a Person brings that Person's Assignments, so P2 alone
  // keeps a2 and only a2: 0.5 FTE used against 0.5 FTE available.
  const series = minimapDensity(FIXTURE, "P2", defaultScopes(), false);
  assert.deepEqual(series.slices.map((s) => s.available), [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual(series.slices.map((s) => s.used), [0, 0.5, 0.5, 0]);
  assert.deepEqual(series.slices.map((s) => s.density), [0, 1, 1, 0]);
});

test("the density follows Show archived", () => {
  const plan = {
    range: { start: "2026-01-01", end: "2026-01-01" },
    people: [
      { id: "p1", name: "Live", availability: 100 },
      { id: "p2", name: "Gone", availability: 100, archived: true }
    ],
    projects: [{ id: "q1", name: "Q1" }],
    assignments: [
      { id: "a1", personId: "p1", projectId: "q1", start: "2026-01-01", end: "2026-01-01", share: 50 }
    ]
  };
  // Archived off: one 100% row, half used.
  assert.equal(minimapDensity(plan, "", defaultScopes(), false).slices[0].density, 0.5);
  // Archived on: the archived Person's capacity joins the available total.
  assert.equal(minimapDensity(plan, "", defaultScopes(), true).slices[0].density, 0.25);
});

test("work outside the period is read only as far as the period reaches", () => {
  const plan = {
    range: { start: "2026-01-02", end: "2026-01-03" },
    people: [{ id: "p1", name: "P1", availability: 100 }],
    projects: [{ id: "q1", name: "Q1" }],
    assignments: [
      { id: "a1", personId: "p1", projectId: "q1", start: "2026-01-01", end: "2026-01-04", share: 100 }
    ]
  };
  const series = minimapDensity(plan, "", defaultScopes(), false);
  assert.deepEqual(series.slices.map((s) => s.used), [1, 1]);
});

test("a plan with no period has an empty series", () => {
  assert.deepEqual(minimapDensity({ people: [] }, "", defaultScopes(), false), {
    start: null, end: null, dayCount: 0, slices: [], maxDensity: 0, capacity: false
  });
});

/* --- the visible window and the scroll arithmetic ------------------------ */

test("the visible window is the viewport's day area, held inside the period", () => {
  // A 1000px viewport, a 200px sticky column and a 20px day: 40 days are shown.
  assert.deepEqual(visibleDayWindow(0, 1000, 200, 20, 100), { start: 0, width: 40 });
  assert.deepEqual(visibleDayWindow(200, 1000, 200, 20, 100), { start: 10, width: 40 });
  // Scrolled to the end the window still sits inside the period.
  assert.deepEqual(visibleDayWindow(1900, 1000, 200, 20, 100), { start: 95, width: 5 });
  // A period shorter than the viewport reads as one whole window.
  assert.deepEqual(visibleDayWindow(0, 1000, 200, 20, 20), { start: 0, width: 20 });
  // No drawn day width yet: the whole period, nothing to map.
  assert.deepEqual(visibleDayWindow(0, 1000, 200, 0, 20), { start: 0, width: 20 });
});

test("centering a day is the shared formula goToToday also uses", () => {
  // 20px days, a 1000px viewport and a 200px column: half the 800px day area.
  assert.equal(centerScrollLeft(10, 20, 1000, 200), 210 - 400);
  assert.equal(centerScrollLeft(30, 20, 1000, 200), 610 - 400);
});

test("dragging the window moves the scroll by the days the pointer crossed", () => {
  // 100px across a 200px strip over 100 twenty-pixel days is 50 days, 1000px.
  assert.equal(dragScrollLeft(500, 100, 200, 100, 20), 1500);
  assert.equal(dragScrollLeft(500, -100, 200, 100, 20), -500);
  // Zero-width track: nothing to read, so the scroll is unchanged.
  assert.equal(dragScrollLeft(500, 100, 0, 100, 20), 500);
});

test("a press on the track reads the day under the pointer", () => {
  assert.equal(trackDayAt(50, 50, 200, 100), 0);
  assert.equal(trackDayAt(150, 50, 200, 100), 50);
  assert.equal(trackDayAt(250, 50, 200, 100), 100);
});

/* --- the markup ----------------------------------------------------------- */

test("the strip is present in the shell and hidden until enabled", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.match(html, /class="minimap" id="minimap"[^>]*hidden/);
  assert.match(html, /class="minimap__svg"/);
  assert.match(html, /class="minimap__fill"/);
  assert.match(html, /class="minimap__over"/);
  assert.match(html, /class="minimap__window"/);
});
