import test from "node:test";
import assert from "node:assert/strict";
import {
  cadenceFrom,
  sprintsFor,
  sprintName,
  NAME_PREFIX_DEFAULT,
  NAME_NUMBER_DEFAULT,
  SPRINT_LENGTH_DEFAULT
} from "../public/lib/sprints.mjs";

const PERIOD = { start: "2026-01-01", end: "2026-02-28" };
const CADENCE = { start: "2026-01-01", length: 14, namePrefix: "Sprint ", nameNumber: 24 };

function starts(list) {
  return list.map((s) => s.start);
}
function ends(list) {
  return list.map((s) => s.end);
}
function names(list) {
  return list.map((s) => s.name);
}

test("no cadence yields no sprints", () => {
  assert.equal(cadenceFrom({}), null);
  assert.equal(cadenceFrom({ cadence: null }), null);
  assert.equal(cadenceFrom({ cadence: { start: "not-a-date" } }), null);
  assert.deepEqual(sprintsFor(null, [], PERIOD), []);
  assert.deepEqual(sprintsFor({ start: "not-a-date" }, [], PERIOD), []);
  // A period that ends before the cadence starts has no sprint to draw.
  assert.deepEqual(sprintsFor(CADENCE, [], { start: "2025-01-01", end: "2025-02-01" }), []);
});

test("cadenceFrom fills the defaults a new cadence is offered with", () => {
  assert.deepEqual(cadenceFrom({ cadence: { start: "2026-01-05" } }), {
    start: "2026-01-05",
    length: SPRINT_LENGTH_DEFAULT,
    namePrefix: NAME_PREFIX_DEFAULT,
    nameNumber: String(NAME_NUMBER_DEFAULT)
  });
  // A malformed length reads as the default, so a stray stored value still draws.
  assert.equal(cadenceFrom({ cadence: { start: "2026-01-05", length: 0 } }).length, 14);
  assert.equal(cadenceFrom({ cadence: { start: "2026-01-05", length: 9999 } }).length, 14);
});

test("the chain is contiguous and covers the period for a 14-day cadence", () => {
  const list = sprintsFor(CADENCE, [], PERIOD);
  assert.deepEqual(starts(list), ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12", "2026-02-26"]);
  assert.deepEqual(ends(list), ["2026-01-14", "2026-01-28", "2026-02-11", "2026-02-25", "2026-03-11"]);
  assert.deepEqual(names(list), ["Sprint 24", "Sprint 25", "Sprint 26", "Sprint 27", "Sprint 28"]);
  // Each sprint starts the day after the previous ends, and the last one runs
  // past the period's end rather than being cut in half.
  for (let i = 1; i < list.length; i++) {
    const previousEnd = new Date(list[i - 1].end + "T00:00:00Z");
    const expected = new Date(previousEnd.getTime() + 86400000).toISOString().slice(0, 10);
    assert.equal(list[i].start, expected);
  }
  assert.ok(list[list.length - 1].end >= PERIOD.end);
  // The day indices run end to end from the period's start, and the last
  // sprint extends past the drawn days.
  assert.deepEqual(list.map((s) => s.startIndex), [0, 14, 28, 42, 56]);
  assert.deepEqual(list.map((s) => s.endIndex), [13, 27, 41, 55, 69]);
});

test("lengthening one sprint moves every later one by the same amount", () => {
  const base = sprintsFor(CADENCE, [], PERIOD);
  const longer = sprintsFor(CADENCE, [{ index: 2, length: 21 }], PERIOD);
  // The sprints before the adjustment are untouched.
  assert.equal(longer[0].start, base[0].start);
  assert.equal(longer[0].end, base[0].end);
  // The adjusted sprint is 21 days, ending seven days later than before.
  assert.equal(longer[1].start, "2026-01-15");
  assert.equal(longer[1].end, "2026-02-04");
  // Every later sprint starts and ends exactly seven days later.
  for (let i = 2; i < longer.length; i++) {
    assert.equal(shiftDays(base[i].start, 7), longer[i].start);
    assert.equal(shiftDays(base[i].end, 7), longer[i].end);
  }
});

test("shortening one sprint pulls every later one back", () => {
  const base = sprintsFor(CADENCE, [], PERIOD);
  const shorter = sprintsFor(CADENCE, [{ index: 2, length: 7 }], PERIOD);
  assert.equal(shorter[1].end, "2026-01-21");
  for (let i = 2; i < shorter.length; i++) {
    assert.equal(shiftDays(base[i].start, -7), shorter[i].start);
  }
});

test("renaming one sprint leaves the rule naming the rest", () => {
  const list = sprintsFor(CADENCE, [{ index: 2, name: "Sprint 30 - hardening" }], PERIOD);
  assert.deepEqual(names(list).slice(0, 4), [
    "Sprint 24",
    "Sprint 30 - hardening",
    "Sprint 26",
    "Sprint 27"
  ]);
});

test("padding follows the first number's spelling", () => {
  const period = { start: "2026-01-01", end: "2026-01-31" };
  // A typed leading zero keeps the width at two.
  const padded = sprintsFor({ start: "2026-01-01", length: 10, namePrefix: "26-", nameNumber: "01" }, [], period);
  assert.deepEqual(names(padded), ["26-01", "26-02", "26-03", "26-04"]);
  // A two-digit first number pads to two without a leading zero.
  const two = sprintsFor({ start: "2026-01-01", length: 10, namePrefix: "Sprint ", nameNumber: 24 }, [], period);
  assert.deepEqual(names(two), ["Sprint 24", "Sprint 25", "Sprint 26", "Sprint 27"]);
  // A one-digit first number pads to one.
  const one = sprintsFor({ start: "2026-01-01", length: 10, namePrefix: "S", nameNumber: 1 }, [], period);
  assert.deepEqual(names(one), ["S1", "S2", "S3", "S4"]);
  assert.equal(sprintName({ namePrefix: "26-", nameNumber: "01" }, 3), "26-03");
});

test("the chain counts from where it was numbered, not from the period", () => {
  // A period that opens mid-chain must keep the numbering the cadence set.
  const list = sprintsFor(CADENCE, [], { start: "2026-01-20", end: "2026-02-28" });
  // The sprint covering 20 Jan is the second of the chain.
  assert.equal(list[0].start, "2026-01-15");
  assert.equal(list[0].name, "Sprint 25");
  // It began before the period, so its drawn start is clamped to day zero.
  assert.equal(list[0].startIndex, 0);
});

test("days before the cadence's start carry no sprint", () => {
  const list = sprintsFor({ start: "2026-01-15", length: 14, namePrefix: "Sprint ", nameNumber: 1 }, [], PERIOD);
  assert.equal(list[0].start, "2026-01-15");
  assert.equal(list[0].startIndex, 14);
  assert.equal(list[0].name, "Sprint 1");
});

test("a period ending inside a sprint keeps that sprint whole", () => {
  const list = sprintsFor(CADENCE, [], { start: "2026-01-01", end: "2026-01-20" });
  assert.equal(list.length, 2);
  assert.equal(list[1].start, "2026-01-15");
  assert.equal(list[1].end, "2026-01-28");
  assert.ok(list[1].end > "2026-01-20");
});

test("a period shorter than one sprint yields one", () => {
  const list = sprintsFor(CADENCE, [], { start: "2026-01-05", end: "2026-01-10" });
  assert.equal(list.length, 1);
  assert.equal(list[0].start, "2026-01-01");
  assert.equal(list[0].end, "2026-01-14");
  assert.equal(list[0].startIndex, 0);
});

test("adjustments outside the chain are harmless", () => {
  const list = sprintsFor(CADENCE, [{ index: 99, length: 3, name: "ghost" }, { index: 0, name: "zero" }], {
    start: "2026-01-01", end: "2026-01-20"
  });
  assert.deepEqual(names(list), ["Sprint 24", "Sprint 25"]);
  assert.deepEqual(ends(list), ["2026-01-14", "2026-01-28"]);
});

test("adjusting the period adds or drops trailing sprints without cutting the last", () => {
  const long = sprintsFor(CADENCE, [], { start: "2026-01-01", end: "2026-01-06" });
  const longer = sprintsFor(CADENCE, [], { start: "2026-01-01", end: "2026-02-01" });
  assert.equal(long.length, 1);
  assert.equal(longer.length, 3);
  // Both keep their last sprint whole: the end is the chain's, not the period's.
  assert.ok(long[0].end > "2026-01-06");
  assert.ok(longer[longer.length - 1].end > "2026-02-01");
});

function shiftDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  return new Date(d.getTime() + days * 86400000).toISOString().slice(0, 10);
}
