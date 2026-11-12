import test from "node:test";
import assert from "node:assert/strict";
import {
  isWeekend,
  workingFraction,
  isWorkingDay,
  workingDays,
  absenceProjectIds,
  absencesFor,
  planWorkingDays
} from "../public/lib/workdays.mjs";

// 2026-01-01 is a Thursday, so the span 01..05 is Thu, Fri, Sat, Sun, Mon.
const SWISS = {
  location: "Switzerland",
  dates: [
    { date: "2026-01-01", kind: "full" },
    { date: "2026-01-02", kind: "half" }
  ]
};

test("the weekend is Saturday and Sunday, in UTC", () => {
  assert.equal(isWeekend("2026-01-03"), true);
  assert.equal(isWeekend("2026-01-04"), true);
  assert.equal(isWeekend("2026-01-02"), false);
  assert.equal(isWeekend("2026-01-05"), false);
  // A malformed date is not a weekend, and carries no working time either.
  assert.equal(isWeekend("nope"), false);
  assert.equal(isWeekend(undefined), false);
});

test("a day's working fraction is one, a half holiday leaves half, a weekend none", () => {
  assert.equal(workingFraction("2026-01-05", "", undefined), 1);
  assert.equal(workingFraction("2026-01-02", "Switzerland", [SWISS]), 0.5);
  assert.equal(workingFraction("2026-01-01", "Switzerland", [SWISS]), 0);
  assert.equal(workingFraction("2026-01-03", "Switzerland", [SWISS]), 0);
  assert.equal(workingFraction("nope", "Switzerland", [SWISS]), 0);
});

test("a half holiday is still a working day; a full holiday and a weekend are not", () => {
  assert.equal(isWorkingDay("2026-01-02", "Switzerland", [SWISS]), true);
  assert.equal(isWorkingDay("2026-01-01", "Switzerland", [SWISS]), false);
  assert.equal(isWorkingDay("2026-01-03", "", undefined), false);
});

test("the working-day count is right across a weekend, a holiday and a half day", () => {
  // Thu, Fri, Sat, Sun, Mon: three calendar weekdays, one a full holiday and
  // one a half, so 0 + 0.5 + 1 = 1.5 working days.
  assert.equal(workingDays("2026-01-01", "2026-01-05", "Switzerland", [SWISS]), 1.5);
  // The same span with no holidays is the three weekdays untouched.
  assert.equal(workingDays("2026-01-01", "2026-01-05", "", []), 3);
});

test("a Location with no configured holidays changes nothing", () => {
  // The Swiss holidays do not reach a Person in Portugal.
  assert.equal(workingDays("2026-01-01", "2026-01-05", "Portugal", [SWISS]), 3);
  // A Person with no Location at all is affected by weekends alone.
  assert.equal(workingDays("2026-01-01", "2026-01-05", "", [SWISS]), 3);
  assert.equal(workingFraction("2026-01-01", "", [SWISS]), 1);
});

test("a Location is matched the way holidays.mjs matches it", () => {
  assert.equal(workingDays("2026-01-01", "2026-01-01", "  switzerland ", [SWISS]), 0);
});

test("a weekend holiday does not subtract twice", () => {
  const p = { location: "Portugal", dates: [{ date: "2026-01-03", kind: "full" }] };
  assert.equal(workingDays("2026-01-03", "2026-01-04", "Portugal", [p]), 0);
});

test("a malformed or reversed pair has no working days", () => {
  assert.equal(workingDays("nope", "2026-01-05", "", []), 0);
  assert.equal(workingDays("2026-01-05", "2026-01-01", "", []), 0);
  assert.equal(workingDays(null, undefined, "", []), 0);
  // A single day counts itself.
  assert.equal(workingDays("2026-01-05", "2026-01-05", "", []), 1);
});

test("the half day leaves half a working day in the glossary's own example", () => {
  // Five working days at 60% is 3 FTE-days; one of them a half day leaves
  // 4.5 working days, so the Assignment is 2.7 FTE-days, not 3.
  const fiveDays = workingDays("2026-01-05", "2026-01-09", "", []);
  assert.equal(fiveDays, 5);
  assert.ok(Math.abs(0.6 * fiveDays - 3) < 1e-9);
  const halfDay = workingDays("2026-01-05", "2026-01-09", "Switzerland",
    [{ location: "Switzerland", dates: [{ date: "2026-01-06", kind: "half" }] }]);
  assert.equal(halfDay, 4.5);
  assert.ok(Math.abs(0.6 * halfDay - 2.7) < 1e-9);
});

/* --- absences ------------------------------------------------------------ */

function absence(start, end, share) {
  return { start: start, end: end, share: share };
}

test("a full absence takes a whole working day, a half absence half of one", () => {
  const full = [absence("2026-01-05", "2026-01-05", 100)];
  const half = [absence("2026-01-05", "2026-01-05", 50)];
  // The week 05..09 is Mon..Fri: five working days with no absence.
  assert.equal(workingDays("2026-01-05", "2026-01-09", "", [], full), 4);
  assert.equal(workingDays("2026-01-05", "2026-01-09", "", [], half), 4.5);
  assert.equal(workingFraction("2026-01-05", "", [], full), 0);
  assert.equal(isWorkingDay("2026-01-05", "", [], full), false);
  assert.equal(workingFraction("2026-01-05", "", [], half), 0.5);
  // A half absence is still a working day, half of one.
  assert.equal(isWorkingDay("2026-01-05", "", [], half), true);
});

test("an absence and a holiday on one day share the whole-day cap", () => {
  const half = [absence("2026-01-02", "2026-01-02", 50)];
  // The Swiss half holiday already leaves half; the absence takes the rest.
  assert.equal(workingFraction("2026-01-02", "Switzerland", [SWISS], half), 0);
  // A weekend is off however many absences cover it.
  assert.equal(workingDays("2026-01-03", "2026-01-04", "", [],
    [absence("2026-01-03", "2026-01-04", 100)]), 0);
});

test("the absence rule reads the Plan's absence Projects and their Assignments", () => {
  const plan = {
    projects: [{ id: "holiday", name: "Holiday", absence: true }, { id: "atlas", name: "Atlas" }],
    assignments: [
      { id: "a1", projectId: "holiday", personId: "anna", start: "2026-01-05", end: "2026-01-06", share: 100 },
      { id: "a2", projectId: "atlas", personId: "anna", start: "2026-01-05", end: "2026-01-09", share: 40 }
    ]
  };
  assert.deepEqual([...absenceProjectIds(plan)], ["holiday"]);
  assert.deepEqual(absencesFor(plan, "anna"), [plan.assignments[0]]);
  assert.deepEqual(absencesFor(plan, "ben"), []);
  // A Plan with no absence flag has none, so the count is the holidays alone.
  assert.equal(absencesFor({ projects: [{ id: "atlas" }], assignments: [] }, "anna").length, 0);
  assert.equal(workingDays("2026-01-05", "2026-01-09", "", [], absencesFor(plan, "anna")), 3);
});

// The plan-wide count a sprint uses: a date off for any configured Location is
// off for the whole plan.
const SWISS_AND_PORTUGAL = [
  SWISS,
  { location: "Portugal", dates: [{ date: "2026-01-05", kind: "full" }] }
];

test("the plan-wide count is the weekends alone when no holidays are configured", () => {
  assert.equal(planWorkingDays("2026-01-01", "2026-01-05", []), 3);
  assert.equal(planWorkingDays("2026-01-01", "2026-01-05", undefined), 3);
});

test("the plan-wide count takes every Location's holidays, not one Location's", () => {
  // Switzerland marks Thu full and Fri half; Portugal marks Mon full, so the
  // three weekdays contribute 0 + 0.5 + 0 = 0.5 working days.
  assert.equal(planWorkingDays("2026-01-01", "2026-01-05", SWISS_AND_PORTUGAL), 0.5);
  // Either Location alone leaves a different count, so the union is doing work.
  assert.equal(workingDays("2026-01-01", "2026-01-05", "Switzerland", SWISS_AND_PORTUGAL), 1.5);
  assert.equal(workingDays("2026-01-01", "2026-01-05", "Portugal", SWISS_AND_PORTUGAL), 2);
});

test("the plan-wide count shares the weekend, half-day and malformed edges", () => {
  // A weekend holiday does not subtract twice.
  assert.equal(planWorkingDays("2026-01-03", "2026-01-04", SWISS_AND_PORTUGAL), 0);
  assert.equal(planWorkingDays("nope", "2026-01-05", SWISS_AND_PORTUGAL), 0);
  assert.equal(planWorkingDays("2026-01-05", "2026-01-01", SWISS_AND_PORTUGAL), 0);
  // A single ordinary day counts itself.
  assert.equal(planWorkingDays("2026-01-05", "2026-01-05", []), 1);
});
