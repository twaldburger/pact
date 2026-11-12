import test from "node:test";
import assert from "node:assert/strict";
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_DEFAULT,
  HOLIDAY_KIND_LABELS,
  isHolidayKind,
  holidayKindGroupName,
  locationKey,
  holidayLocations,
  holidaysFor,
  holidayCellsFor
} from "../public/lib/holidays.mjs";

const SWITZERLAND = {
  location: "Switzerland",
  dates: [
    { date: "2026-12-24", kind: "half" },
    { date: "2026-12-25", kind: "full" },
    { date: "2026-12-26", kind: "full" }
  ]
};

test("a holiday mark is exactly full or half", () => {
  assert.deepEqual(HOLIDAY_KINDS, ["full", "half"]);
  assert.equal(isHolidayKind("full"), true);
  assert.equal(isHolidayKind("half"), true);
  assert.equal(isHolidayKind("FULL"), false);
  assert.equal(isHolidayKind(""), false);
  assert.equal(isHolidayKind(undefined), false);
  assert.deepEqual(HOLIDAY_KIND_LABELS, { full: "Full day", half: "Half day" });
});

// The row's radio pair takes its group name from this helper, so this is what
// keeps two rows on one card - and the same row drawn twice - apart.
test("each holiday date row's radio pair has its own group name", () => {
  assert.equal(HOLIDAY_KIND_DEFAULT, "full");
  // Same row, same name: a re-render must not split one row's pair.
  assert.equal(holidayKindGroupName(0, 0), holidayKindGroupName(0, 0));
  // Two rows on one card differ by date index.
  assert.notEqual(holidayKindGroupName(0, 0), holidayKindGroupName(0, 1));
  // Two cards differ by Location index even at the same date index.
  assert.notEqual(holidayKindGroupName(0, 0), holidayKindGroupName(1, 0));
  // Every pair across a two-card board is distinct.
  const names = [];
  for (const gi of [0, 1]) {
    for (const di of [0, 1, 2]) names.push(holidayKindGroupName(gi, di));
  }
  assert.equal(new Set(names).size, names.length);
});

test("a Location is matched case-insensitively, trimmed and single-valued", () => {
  assert.equal(locationKey("  Switzerland "), "switzerland");
  assert.equal(locationKey(undefined), "");
  assert.deepEqual(holidayLocations([SWITZERLAND, { location: "switzerland", dates: [] }, { location: "" }]),
    ["Switzerland"]);
  assert.deepEqual(holidayLocations(undefined), []);
});

test("the days off one Location carry their own full-or-half mark, in date order", () => {
  const days = holidaysFor([SWITZERLAND], "switzerland");
  assert.deepEqual(days, [
    { date: "2026-12-24", kind: "half" },
    { date: "2026-12-25", kind: "full" },
    { date: "2026-12-26", kind: "full" }
  ]);
  // A malformed entry is skipped rather than drawn as a full day.
  const messy = holidaysFor([{ location: "Portugal", dates: [{ date: "nope", kind: "half" }, null] }], "Portugal");
  assert.deepEqual(messy, []);
});

test("a Location with no configured holidays has nothing shaded", () => {
  assert.deepEqual(holidaysFor([SWITZERLAND], "Portugal"), []);
  assert.deepEqual(holidaysFor([SWITZERLAND], ""), []);
  assert.deepEqual(holidaysFor(undefined, "Switzerland"), []);
});

test("the cells cover only the drawn period, adjacent same-kind days merging", () => {
  const cells = holidayCellsFor([SWITZERLAND], "Switzerland", "2026-12-01", 31);
  assert.deepEqual(cells, [
    { i: 23, n: 1, kind: "half" },
    { i: 24, n: 2, kind: "full" }
  ]);
  // A day outside the drawn period is dropped, not clamped onto the edge.
  assert.deepEqual(holidayCellsFor([SWITZERLAND], "Switzerland", "2027-01-01", 5), []);
  assert.deepEqual(holidayCellsFor([SWITZERLAND], "Switzerland", "2026-12-25", 0), []);
});

test("a half day beside a full day does not merge into one cell", () => {
  const cells = holidayCellsFor(
    [{ location: "Portugal", dates: [{ date: "2026-05-01", kind: "full" }, { date: "2026-05-02", kind: "half" }] }],
    "portugal",
    "2026-05-01",
    10
  );
  assert.deepEqual(cells, [
    { i: 0, n: 1, kind: "full" },
    { i: 1, n: 1, kind: "half" }
  ]);
});
