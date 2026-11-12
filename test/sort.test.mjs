import test from "node:test";
import assert from "node:assert/strict";
import { fteDaysFigure, fteDaysLabel } from "../public/lib/stack.mjs";
import {
  ASCENDING,
  DESCENDING,
  PROJECT_SORT_KEYS,
  PEOPLE_SORT_KEYS,
  SORT_KINDS,
  sortKeys,
  findSortKey,
  isSortKey,
  defaultDirection,
  oppositeDirection,
  directionLabel,
  selectSortKey,
  toggleSortDirection,
  inclusiveDays,
  projectMeasures,
  personMeasures,
  personLoadAt,
  sortProjects,
  sortPeople,
  markerReordersPeople,
  MARKER_DRAG,
  MARKER_RELEASE,
  SORT_APPLIED
} from "../public/lib/sort.mjs";

/*
 * Four people and three projects. The assignments are chosen so every key has
 * a distinct order: Atlas and Borealis overlap in time and differ in FTE-days,
 * Cirrus has no work at all, and the load at 2026-06-15 is 0.3, 0.4, 0.8 and
 * zero for the four people.
 */
function plan() {
  return {
    people: [
      { id: "p1", name: "Anna", availability: 100 },
      { id: "p2", name: "Ben", availability: 80 },
      { id: "p3", name: "Cara", availability: 100 },
      { id: "p4", name: "Dan", availability: 50 }
    ],
    projects: [
      { id: "pr1", name: "Atlas" },
      { id: "pr2", name: "Borealis" },
      { id: "pr3", name: "Cirrus" }
    ],
    assignments: [
      { id: "a1", projectId: "pr1", personId: "p1", start: "2026-01-10", end: "2026-01-19", share: 50 },
      { id: "a2", projectId: "pr1", personId: "p2", start: "2026-02-01", end: "2026-02-05", share: 100 },
      { id: "a3", projectId: "pr2", personId: "p1", start: "2026-01-01", end: "2026-01-05", share: 20 },
      { id: "a4", projectId: "pr2", personId: "p2", start: "2026-06-01", end: "2026-06-30", share: 40 },
      { id: "a5", projectId: "pr2", personId: "p3", start: "2026-06-01", end: "2026-06-30", share: 80 },
      { id: "a6", projectId: "pr1", personId: "p1", start: "2026-06-10", end: "2026-06-20", share: 30 }
    ]
  };
}

function ids(list) {
  return list.map(function (item) { return item.id; });
}

test("each list has its own small, labelled key set", () => {
  assert.deepEqual(SORT_KINDS, ["projects", "people"]);
  assert.deepEqual(sortKeys("projects").map((d) => d.key), PROJECT_SORT_KEYS.map((d) => d.key));
  assert.equal(sortKeys("people"), PEOPLE_SORT_KEYS);
  assert.deepEqual(PROJECT_SORT_KEYS.map((d) => d.key), ["name", "start", "end", "fte"]);
  assert.deepEqual(PEOPLE_SORT_KEYS.map((d) => d.key), ["name", "location", "free", "load", "start"]);
  [...PROJECT_SORT_KEYS, ...PEOPLE_SORT_KEYS].forEach((def) => {
    assert.equal(typeof def.label, "string");
    assert.ok(def.label.length > 0);
  });
});

test("a key is recognised only by the list that owns it", () => {
  assert.equal(isSortKey("projects", "fte"), true);
  assert.equal(isSortKey("projects", "load"), false);
  assert.equal(isSortKey("people", "load"), true);
  assert.equal(isSortKey("people", "fte"), false);
  assert.equal(isSortKey("projects", "nope"), false);
  assert.equal(findSortKey("people", "start").label, "Earliest assignment");
  assert.equal(findSortKey("people", "location").label, "Location");
});

test("each key carries a sensible first direction", () => {
  assert.equal(defaultDirection("projects", "name"), ASCENDING);
  assert.equal(defaultDirection("projects", "start"), ASCENDING);
  assert.equal(defaultDirection("projects", "end"), DESCENDING);
  assert.equal(defaultDirection("projects", "fte"), DESCENDING);
  assert.equal(defaultDirection("people", "location"), ASCENDING);
  assert.equal(defaultDirection("people", "free"), DESCENDING);
  assert.equal(defaultDirection("people", "load"), DESCENDING);
  assert.equal(defaultDirection("people", "start"), ASCENDING);
  assert.equal(defaultDirection("projects", "nope"), ASCENDING);
});

test("the direction toggle flips and is named in words", () => {
  assert.equal(oppositeDirection(ASCENDING), DESCENDING);
  assert.equal(oppositeDirection(DESCENDING), ASCENDING);
  assert.equal(oppositeDirection("nonsense"), DESCENDING);
  assert.equal(directionLabel(ASCENDING), "Ascending");
  assert.equal(directionLabel(DESCENDING), "Descending");
});

test("choosing a key applies that key's direction, and re-choosing it holds", () => {
  const first = selectSortKey("projects", null, "end");
  assert.deepEqual(first, { key: "end", direction: DESCENDING });
  // Pressing the key already in force leaves the order alone; the toggle
  // flips it.
  assert.equal(selectSortKey("projects", first, "end"), first);
  assert.deepEqual(toggleSortDirection(first), { key: "end", direction: ASCENDING });
  assert.equal(toggleSortDirection(null), null);
});

test("day counts are inclusive and a bad pair has no duration", () => {
  assert.equal(inclusiveDays("2026-01-01", "2026-01-01"), 1);
  assert.equal(inclusiveDays("2026-01-01", "2026-01-05"), 5);
  assert.equal(inclusiveDays("2026-01-05", "2026-01-01"), 0);
  assert.equal(inclusiveDays("nope", "2026-01-05"), 0);
  assert.equal(inclusiveDays(null, undefined), 0);
});

test("the project measures are the earliest start, latest end and FTE-days", () => {
  const m = projectMeasures(plan());
  assert.equal(m.pr1.firstStart, "2026-01-10");
  assert.equal(m.pr1.lastEnd, "2026-06-20");
  // Working days only: 6 * 0.5 + 4 * 1.0 + 8 * 0.3 = 9.4 FTE-days.
  assert.ok(Math.abs(m.pr1.fteDays - 9.4) < 1e-9, m.pr1.fteDays);
  assert.equal(m.pr2.firstStart, "2026-01-01");
  assert.equal(m.pr2.lastEnd, "2026-06-30");
  // 3 * 0.2 + 22 * 0.4 + 22 * 0.8 = 27.
  assert.ok(Math.abs(m.pr2.fteDays - 27) < 1e-9, m.pr2.fteDays);
  // A project with no assignment has no dates and no FTE-days.
  assert.deepEqual(m.pr3, { firstStart: null, lastEnd: null, fteDays: 0 });
});

test("the rail's FTE-days figure reads the same working-day count", () => {
  const m = projectMeasures(plan());
  assert.equal(fteDaysFigure(m.pr1.fteDays), "9 d");
  assert.equal(fteDaysLabel(m.pr1.fteDays), "9 FTE-days");
  assert.equal(fteDaysFigure(m.pr2.fteDays), "27 d");
});

test("a holiday for the Person's Location takes that day out of the FTE-days", () => {
  // One Person in Switzerland and one with no Location, the same two-day
  // range: 2026-01-01 (Thursday) and 2026-01-02 (Friday). The Swiss holiday
  // on the Thursday leaves only Friday, so their Assignment is half the size.
  const p = {
    people: [
      { id: "swiss", name: "Swiss", availability: 100, location: "Switzerland" },
      { id: "plain", name: "Plain", availability: 100 }
    ],
    projects: [{ id: "q1", name: "Q1" }, { id: "q2", name: "Q2" }],
    holidays: [{ location: "Switzerland", dates: [{ date: "2026-01-01", kind: "full" }] }],
    assignments: [
      { id: "a1", projectId: "q1", personId: "swiss", start: "2026-01-01", end: "2026-01-02", share: 100 },
      { id: "a2", projectId: "q2", personId: "plain", start: "2026-01-01", end: "2026-01-02", share: 100 }
    ]
  };
  const m = projectMeasures(p);
  // The Swiss Person loses the holiday Thursday and keeps Friday: one day.
  assert.ok(Math.abs(m.q1.fteDays - 1) < 1e-9, m.q1.fteDays);
  // A Person with no Location has no configured holidays, so both days count.
  assert.ok(Math.abs(m.q2.fteDays - 2) < 1e-9, m.q2.fteDays);
});

test("the person measure is the earliest assignment start", () => {
  const m = personMeasures(plan());
  assert.equal(m.p1.earliestStart, "2026-01-01");
  assert.equal(m.p2.earliestStart, "2026-02-01");
  assert.equal(m.p3.earliestStart, "2026-06-01");
  assert.equal(m.p4.earliestStart, null);
});

test("the load is the share active at the date, from the whole plan", () => {
  const p = plan();
  assert.ok(Math.abs(personLoadAt(p, "p1", "2026-06-15") - 0.3) < 1e-9);
  assert.ok(Math.abs(personLoadAt(p, "p2", "2026-06-15") - 0.4) < 1e-9);
  assert.ok(Math.abs(personLoadAt(p, "p3", "2026-06-15") - 0.8) < 1e-9);
  assert.equal(personLoadAt(p, "p4", "2026-06-15"), 0);
  // The ends are inclusive, but a weekend day carries no load: 2026-01-10 and
  // 11 are Saturday and Sunday, so the first working day of the Assignment is
  // Monday the 12th.
  assert.ok(Math.abs(personLoadAt(p, "p1", "2026-01-12") - 0.5) < 1e-9);
  assert.equal(personLoadAt(p, "p1", "2026-01-10"), 0);
  assert.equal(personLoadAt(p, "p1", "2026-01-09"), 0);
});

test("a holiday for the Person's Location carries no load on that date", () => {
  const p = {
    people: [{ id: "p1", name: "Anna", availability: 100, location: "Switzerland" }],
    holidays: [{ location: "Switzerland", dates: [{ date: "2026-06-15", kind: "full" }] }],
    assignments: [
      { id: "a1", projectId: "pr1", personId: "p1", start: "2026-06-01", end: "2026-06-30", share: 60 }
    ]
  };
  assert.equal(personLoadAt(p, "p1", "2026-06-15"), 0);
  // The next working day is unaffected.
  assert.ok(Math.abs(personLoadAt(p, "p1", "2026-06-16") - 0.6) < 1e-9);
});

test("with no sort chosen the caller's own order is returned untouched", () => {
  const p = plan();
  const reversed = p.projects.slice().reverse();
  assert.deepEqual(ids(sortProjects(reversed, null, p)), ["pr3", "pr2", "pr1"]);
  const peeps = p.people.slice().reverse();
  assert.deepEqual(ids(sortPeople(peeps, null, p, "2026-06-15")), ["p4", "p3", "p2", "p1"]);
  // A copy, never the caller's array.
  assert.notEqual(sortProjects(reversed, null, p), reversed);
});

test("Projects sort by name in both directions", () => {
  const p = plan();
  assert.deepEqual(ids(sortProjects(p.projects, { key: "name", direction: ASCENDING }, p)),
    ["pr1", "pr2", "pr3"]);
  assert.deepEqual(ids(sortProjects(p.projects, { key: "name", direction: DESCENDING }, p)),
    ["pr3", "pr2", "pr1"]);
});

test("Projects sort by first assignment start in both directions", () => {
  const p = plan();
  // Cirrus has no work, so it sorts last whichever way.
  assert.deepEqual(ids(sortProjects(p.projects, { key: "start", direction: ASCENDING }, p)),
    ["pr2", "pr1", "pr3"]);
  assert.deepEqual(ids(sortProjects(p.projects, { key: "start", direction: DESCENDING }, p)),
    ["pr1", "pr2", "pr3"]);
});

test("Projects sort by last assignment end in both directions", () => {
  const p = plan();
  assert.deepEqual(ids(sortProjects(p.projects, { key: "end", direction: ASCENDING }, p)),
    ["pr1", "pr2", "pr3"]);
  assert.deepEqual(ids(sortProjects(p.projects, { key: "end", direction: DESCENDING }, p)),
    ["pr2", "pr1", "pr3"]);
});

test("Projects sort by total assigned FTE in both directions", () => {
  const p = plan();
  assert.deepEqual(ids(sortProjects(p.projects, { key: "fte", direction: DESCENDING }, p)),
    ["pr2", "pr1", "pr3"]);
  assert.deepEqual(ids(sortProjects(p.projects, { key: "fte", direction: ASCENDING }, p)),
    ["pr3", "pr1", "pr2"]);
});

test("People sort by name in both directions", () => {
  const p = plan();
  assert.deepEqual(ids(sortPeople(p.people, { key: "name", direction: ASCENDING }, p, "2026-06-15")),
    ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(ids(sortPeople(p.people, { key: "name", direction: DESCENDING }, p, "2026-06-15")),
    ["p4", "p3", "p2", "p1"]);
});

test("People sort by free capacity at the Marker in both directions", () => {
  const p = plan();
  // Free = availability minus load at 2026-06-15: Anna 1.00 - 0.30 = 0.70,
  // Dan 0.50 - 0.00 = 0.50, Ben 0.80 - 0.40 = 0.40, Cara 1.00 - 0.80 = 0.20.
  assert.deepEqual(ids(sortPeople(p.people, { key: "free", direction: DESCENDING }, p, "2026-06-15")),
    ["p1", "p4", "p2", "p3"]);
  assert.deepEqual(ids(sortPeople(p.people, { key: "free", direction: ASCENDING }, p, "2026-06-15")),
    ["p3", "p2", "p4", "p1"]);
});

test("an over-allocated Person has negative free capacity and sorts last", () => {
  const p = {
    people: [
      { id: "p1", name: "Anna", availability: 100 },
      { id: "p2", name: "Ben", availability: 20 }
    ],
    assignments: [
      { id: "a1", projectId: "pr1", personId: "p1", start: "2026-06-01", end: "2026-06-30", share: 30 },
      { id: "a2", projectId: "pr1", personId: "p2", start: "2026-06-01", end: "2026-06-30", share: 80 }
    ]
  };
  const ordered = sortPeople(p.people, { key: "free", direction: DESCENDING }, p, "2026-06-15");
  // Anna 1.00 - 0.30 = 0.70; Ben 0.20 - 0.80 = -0.60, below everyone with room.
  assert.deepEqual(ids(ordered), ["p1", "p2"]);
});

test("People sort by load at the Marker in both directions", () => {
  const p = plan();
  assert.deepEqual(ids(sortPeople(p.people, { key: "load", direction: DESCENDING }, p, "2026-06-15")),
    ["p3", "p2", "p1", "p4"]);
  assert.deepEqual(ids(sortPeople(p.people, { key: "load", direction: ASCENDING }, p, "2026-06-15")),
    ["p4", "p1", "p2", "p3"]);
});

test("People sort by earliest assignment in both directions", () => {
  const p = plan();
  assert.deepEqual(ids(sortPeople(p.people, { key: "start", direction: ASCENDING }, p, "2026-06-15")),
    ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(ids(sortPeople(p.people, { key: "start", direction: DESCENDING }, p, "2026-06-15")),
    ["p3", "p2", "p1", "p4"]);
});

test("People sort by Location, grouping by place with the ones without last", () => {
  const p = {
    people: [
      { id: "p1", name: "Anna", availability: 100, location: "Switzerland" },
      { id: "p2", name: "Ben", availability: 80, location: "" },
      { id: "p3", name: "Cara", availability: 100, location: "Netherlands" },
      { id: "p4", name: "Dan", availability: 50, location: "Austria" },
      { id: "p5", name: "Eve", availability: 100, location: "switzerland" },
      { id: "p6", name: "Fay", availability: 100 }
    ],
    assignments: []
  };
  // Alphabetical by place, case-insensitively; the two Swiss People tie on the
  // place and break by name, and a missing Location sorts last in both
  // directions, as an empty one does.
  assert.deepEqual(ids(sortPeople(p.people, { key: "location", direction: ASCENDING }, p, "2026-06-15")),
    ["p4", "p3", "p1", "p5", "p2", "p6"]);
  assert.deepEqual(ids(sortPeople(p.people, { key: "location", direction: DESCENDING }, p, "2026-06-15")),
    ["p1", "p5", "p3", "p4", "p2", "p6"]);
});

test("ties break by name, not by the input order", () => {
  const p = {
    people: [
      { id: "p1", name: "Anna", availability: 100 },
      { id: "p3", name: "Cara", availability: 80 }
    ],
    assignments: [
      { id: "a1", projectId: "pr1", personId: "p1", start: "2026-06-01", end: "2026-06-30", share: 20 },
      { id: "a2", projectId: "pr1", personId: "p3", start: "2026-06-01", end: "2026-06-30", share: 0 }
    ]
  };
  // Free is 0.80 for both; reversed input still puts Anna first.
  const reversed = p.people.slice().reverse();
  assert.deepEqual(ids(sortPeople(reversed, { key: "free", direction: DESCENDING }, p, "2026-06-15")),
    ["p1", "p3"]);
});

test("the load order follows the Marker's date", () => {
  const p = plan();
  const june = sortPeople(p.people, { key: "load", direction: DESCENDING }, p, "2026-06-15");
  const january = sortPeople(p.people, { key: "load", direction: DESCENDING }, p, "2026-01-12");
  assert.deepEqual(ids(june), ["p3", "p2", "p1", "p4"]);
  // On 12 January only Anna is loaded, so she leads and the rest tie by name.
  assert.deepEqual(ids(january), ["p1", "p2", "p3", "p4"]);
});

test("a Marker drag does not reorder the rows; the release does", () => {
  const p = plan();
  const held = sortPeople(p.people, { key: "load", direction: DESCENDING }, p, "2026-06-15");
  // While the Marker is dragged the order is not recomputed, so it is still
  // the order at the start of the drag.
  assert.equal(markerReordersPeople(MARKER_DRAG, "load"), false);
  assert.deepEqual(ids(held), ["p3", "p2", "p1", "p4"]);
  // The release recomputes it at the Marker's new date.
  assert.equal(markerReordersPeople(MARKER_RELEASE, "load"), true);
  const released = sortPeople(held, { key: "load", direction: DESCENDING }, p, "2026-01-12");
  assert.deepEqual(ids(released), ["p1", "p2", "p3", "p4"]);
  // Applying the sort reads the Marker too.
  assert.equal(markerReordersPeople(SORT_APPLIED, "load"), true);
});

test("the free-capacity order follows the Marker's date", () => {
  const p = plan();
  // In June, Anna is the least loaded of the three assigned.
  const june = sortPeople(p.people, { key: "free", direction: DESCENDING }, p, "2026-06-15");
  assert.deepEqual(ids(june), ["p1", "p4", "p2", "p3"]);
  // On 12 January only Anna is loaded (0.50), so Cara (1.00) and Ben (0.80)
  // lead, then Anna and Dan tie at 0.50 and break by name.
  const january = sortPeople(p.people, { key: "free", direction: DESCENDING }, p, "2026-01-12");
  assert.deepEqual(ids(january), ["p3", "p2", "p1", "p4"]);
});

test("a Marker drag holds the free-capacity order; the release refreshes it", () => {
  const p = plan();
  const held = sortPeople(p.people, { key: "free", direction: DESCENDING }, p, "2026-06-15");
  assert.equal(markerReordersPeople(MARKER_DRAG, "free"), false);
  assert.deepEqual(ids(held), ["p1", "p4", "p2", "p3"]);
  assert.equal(markerReordersPeople(MARKER_RELEASE, "free"), true);
  const released = sortPeople(held, { key: "free", direction: DESCENDING }, p, "2026-01-12");
  assert.deepEqual(ids(released), ["p3", "p2", "p1", "p4"]);
  assert.equal(markerReordersPeople(SORT_APPLIED, "free"), true);
});

test("only a load or free-capacity order ever reacts to the Marker", () => {
  ["name", "location", "start"].forEach((key) => {
    assert.equal(markerReordersPeople(MARKER_DRAG, key), false);
    assert.equal(markerReordersPeople(MARKER_RELEASE, key), false);
    assert.equal(markerReordersPeople(SORT_APPLIED, key), false);
  });
});
