import test from "node:test";
import assert from "node:assert/strict";
import {
  DROP_DAYS,
  dayRange,
  dropRange,
  moveRange,
  rowAtY
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
