import test from "node:test";
import assert from "node:assert/strict";
import {
  sprintCalendarDays,
  sprintWorkingDays,
  sprintDaysFigure
} from "../public/lib/sprint-days.mjs";

// 2026-01-01 is a Thursday and 2026-01-14 the Wednesday two weeks on, so the
// sprint holds fourteen calendar days and ten weekdays.
const SPRINT = { start: "2026-01-01", end: "2026-01-14" };
const SWISS = {
  location: "Switzerland",
  dates: [{ date: "2026-01-05", kind: "full" }]
};
const HALF = {
  location: "Switzerland",
  dates: [{ date: "2026-01-05", kind: "half" }]
};

test("a sprint's calendar length is both ends inclusive", () => {
  assert.equal(sprintCalendarDays(SPRINT), 14);
  assert.equal(sprintCalendarDays({ start: "2026-01-05", end: "2026-01-05" }), 1);
  assert.equal(sprintCalendarDays(null), 0);
  assert.equal(sprintCalendarDays({ start: "nope", end: "2026-01-14" }), 0);
  assert.equal(sprintCalendarDays({ start: "2026-01-14", end: "2026-01-01" }), 0);
});

test("a sprint's working days are the shared count over its own dates", () => {
  // With no holidays the weekends fall out and the ten weekdays remain.
  assert.equal(sprintWorkingDays(SPRINT, []), 10);
  assert.equal(sprintWorkingDays(SPRINT, undefined), 10);
});

test("a configured holiday inside the sprint lowers the figure", () => {
  assert.equal(sprintWorkingDays(SPRINT, [SWISS]), 9);
  // A holiday outside the sprint changes nothing.
  assert.equal(sprintWorkingDays(SPRINT, [{
    location: "Switzerland",
    dates: [{ date: "2026-01-15", kind: "full" }]
  }]), 10);
});

test("a half day leaves half a working day in the figure", () => {
  assert.equal(sprintWorkingDays(SPRINT, [HALF]), 9.5);
});

test("a per-sprint length adjustment moves the figure", () => {
  // The row's own end, not the cadence's default: seven days, five weekdays.
  const shorter = { start: "2026-01-01", end: "2026-01-07" };
  assert.equal(sprintCalendarDays(shorter), 7);
  assert.equal(sprintWorkingDays(shorter, []), 5);
  // And a sprint running past a period end counts every day it has.
  const long = { start: "2026-01-01", end: "2026-01-20" };
  assert.equal(sprintCalendarDays(long), 20);
  assert.equal(sprintWorkingDays(long, []), 14);
});

test("the row figure reads the calendar length then the working days", () => {
  assert.equal(sprintDaysFigure(SPRINT, []), "14 days, 10 working days");
  assert.equal(sprintDaysFigure(SPRINT, [SWISS]), "14 days, 9 working days");
  assert.equal(sprintDaysFigure(SPRINT, [HALF]), "14 days, 9.5 working days");
  // The singulars read as singulars.
  assert.equal(sprintDaysFigure({ start: "2026-01-05", end: "2026-01-05" }, []),
    "1 day, 1 working day");
  assert.equal(sprintDaysFigure(null, []), "0 days, 0 working days");
});
