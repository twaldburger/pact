import test from "node:test";
import assert from "node:assert/strict";
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_LABELS,
  isHolidayKind,
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
