import test from "node:test";
import assert from "node:assert/strict";
import {
  DROP_DAYS,
  dayRange,
  dropRange,
  moveRange,
  rowAtY,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_DEFAULT,
  ROW_HEADER_TIGHT,
  ZOOM_LEVELS,
  ZOOM_DEFAULT,
  clampRowHeight,
  stepRowHeight,
  rowGeometry,
  isRowHeaderTight,
  isZoom
} from "../public/lib/timeline.mjs";

test("a drawn range spans the days between two pointers, in either direction", () => {
  assert.deepEqual(dayRange(3, 7, 30), { start: 3, end: 7 });
  // Right to left: the earlier day becomes the start.
  assert.deepEqual(dayRange(7, 3, 30), { start: 3, end: 7 });
  // One whole day is the shortest selection, from either end.
  assert.deepEqual(dayRange(4, 4, 30), { start: 4, end: 4 });
  assert.deepEqual(dayRange(0, 0, 30), { start: 0, end: 0 });
});

test("a drawn range stays inside the Timeline", () => {
  assert.deepEqual(dayRange(-5, 2, 10), { start: 0, end: 2 });
  assert.deepEqual(dayRange(2, 99, 10), { start: 2, end: 9 });
  assert.deepEqual(dayRange(99, -99, 10), { start: 0, end: 9 });
});

test("a Stack drop creates five whole days at the day under the pointer", () => {
  assert.deepEqual(dropRange(10, 100, DROP_DAYS), { start: 10, end: 14 });
  const range = dropRange(10, 100, DROP_DAYS);
  assert.equal(range.end - range.start + 1, 5);
});

test("a drop at the far end still creates its five days inside the Timeline", () => {
  // The ghost and the Assignment are the same extent, so the run slides left
  // to fit rather than running off the end of the plan.
  assert.deepEqual(dropRange(99, 100, DROP_DAYS), { start: 95, end: 99 });
  assert.deepEqual(dropRange(97, 100, DROP_DAYS), { start: 95, end: 99 });
});

test("a moved Assignment keeps its length and stays inside the Timeline", () => {
  assert.deepEqual(moveRange(10, 14, 3, 100), { start: 13, end: 17 });
  assert.deepEqual(moveRange(10, 14, -20, 100), { start: 0, end: 4 });
  assert.deepEqual(moveRange(95, 99, 10, 100), { start: 95, end: 99 });
  // A single-day Assignment stays a single day.
  assert.deepEqual(moveRange(50, 50, 4, 100), { start: 54, end: 54 });
});

test("a body drag targets the row under the pointer, or no row at all", () => {
  const rows = [
    { id: "anna", top: 0, bottom: 39 },
    { id: "ben", top: 40, bottom: 79 },
    { id: "cara", top: 80, bottom: 119 }
  ];
  assert.equal(rowAtY(rows, 0), "anna");
  assert.equal(rowAtY(rows, 55), "ben");
  assert.equal(rowAtY(rows, 119), "cara");
  assert.equal(rowAtY(rows, 130), null);
  assert.equal(rowAtY(rows, -1), null);
  assert.equal(rowAtY([], 5), null);
  assert.equal(rowAtY(undefined, 5), null);
});

test("the row height steps by 8 and clamps at both ends and the default", () => {
  assert.equal(ROW_HEIGHT_DEFAULT, 48);
  assert.equal(stepRowHeight(ROW_HEIGHT_DEFAULT, 1), 56);
  assert.equal(stepRowHeight(ROW_HEIGHT_DEFAULT, -1), 40);
  // At each end the control stops rather than running past the range.
  assert.equal(stepRowHeight(ROW_HEIGHT_MAX, 1), ROW_HEIGHT_MAX);
  assert.equal(stepRowHeight(ROW_HEIGHT_MIN, -1), ROW_HEIGHT_MIN);
  assert.equal(stepRowHeight(1000, 1), ROW_HEIGHT_MAX);
  assert.equal(stepRowHeight(0, -1), ROW_HEIGHT_MIN);
  // Any stray value snaps to a whole step, and a missing one is the default.
  assert.equal(clampRowHeight(33), 32);
  assert.equal(clampRowHeight(59), 56);
  assert.equal(clampRowHeight(undefined), ROW_HEIGHT_DEFAULT);
});

test("the drawable height and the step are derived from the row height", () => {
  // The original 44px row was 40px of drawable height with a 4px 10% step.
  const original = rowGeometry(44);
  assert.equal(original.fte, 40);
  assert.equal(original.step, 4);
  // The same proportion holds at every size: drawable = 10 * step.
  [32, 56, 120].forEach((row) => {
    const g = rowGeometry(row);
    assert.equal(g.row, row);
    assert.ok(Math.abs(g.fte - row * 10 / 11) < 1e-9);
    assert.equal(g.fte, 10 * g.step);
  });
});

test("the row header keeps two lines until it falls below 48px", () => {
  assert.equal(ROW_HEADER_TIGHT, 48);
  assert.equal(isRowHeaderTight(32), true);
  assert.equal(isRowHeaderTight(40), true);
  assert.equal(isRowHeaderTight(48), false);
  assert.equal(isRowHeaderTight(56), false);
});

test("that threshold follows the reader's text size", () => {
  assert.equal(isRowHeaderTight(64, 1.5), true);
  assert.equal(isRowHeaderTight(72, 1.5), false);
  assert.equal(isRowHeaderTight(88, 2), true);
  assert.equal(isRowHeaderTight(96, 2), false);
  assert.equal(isRowHeaderTight(120, 2), false);
  // A scale that cannot be read falls back to the interface's own size.
  assert.equal(isRowHeaderTight(40, 0), true);
  assert.equal(isRowHeaderTight(56, undefined), false);
});

test("the plan opens at month zoom", () => {
  assert.equal(ZOOM_DEFAULT, "month");
  assert.deepEqual(ZOOM_LEVELS, ["day", "week", "month"]);
});

test("only the three named levels are zoom", () => {
  ZOOM_LEVELS.forEach((level) => assert.equal(isZoom(level), true));
  ["", "Month", "year", undefined, null].forEach((level) => {
    assert.equal(isZoom(level), false);
  });
});
