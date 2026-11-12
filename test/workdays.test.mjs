import test from "node:test";
import assert from "node:assert/strict";
import {
  isWeekend,
  workingFraction,
  isWorkingDay,
  workingDays
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
