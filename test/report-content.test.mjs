import test from "node:test";
import assert from "node:assert/strict";
import { seedPlan } from "../lib/plan.mjs";
import { projectMeasures, sortProjects } from "../public/lib/sort.mjs";
import {
  reportBuckets,
  reportContent,
  tagChoices,
  tagKeyGroups,
  tagKeyState,
  tagSelection,
  tagSplitRows,
  tagToggled
} from "../public/lib/report-content.mjs";

/*
 * A plan whose arithmetic is easy to check by hand. January 2026 has 22
 * weekdays and no holidays configured, so one full-time Assignment over the
 * month is 22 FTE-days, and Anna's five working days off are five days the
 * report must not count.
 */
function fixture() {
  return {
    range: { start: "2026-01-01", end: "2026-01-31" },
    people: [
      { id: "anna", name: "Anna", availability: 100, location: "Berlin", tags: [] },
      { id: "ben", name: "Ben", availability: 50, location: "Berlin", tags: [] }
    ],
    projects: [
      { id: "solar", name: "Solar", colour: 0, tags: ["api:Solar", "Testing"] },
      { id: "leave", name: "Annual Leave", colour: 4, absence: true, tags: ["Absence"] }
    ],
    assignments: [
      { id: "a1", projectId: "solar", personId: "anna", start: "2026-01-01", end: "2026-01-31", share: 100, tags: [] },
      { id: "a2", projectId: "leave", personId: "anna", start: "2026-01-05", end: "2026-01-09", share: 100, tags: [] }
    ]
  };
}

function wholeView(plan) {
  return {
    projects: plan.projects,
    people: plan.people,
    assignments: plan.assignments
  };
}

function report(plan, view, options) {
  return reportContent(view || wholeView(plan), plan, Object.assign({ zoom: "month" }, options));
}

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + " != " + b);

/* --- the buckets ---------------------------------------------------------- */

test("the report's zoom level drives the buckets", () => {
  const plan = { range: { start: "2026-01-01", end: "2026-12-31" } };
  assert.equal(reportBuckets(plan, "month").length, 12);
  assert.equal(reportBuckets(plan, "day").length, 365);
  assert.equal(reportBuckets(plan, "week")[0].start, "2026-01-01");
  // Sprint with no chain falls back on months rather than an empty table.
  assert.equal(reportBuckets(plan, "sprint", []).length, 12);
  assert.equal(reportBuckets(plan, "sprint", [
    { index: 1, name: "Sprint 01", start: "2025-12-29", end: "2026-01-11" },
    { index: 2, name: "Sprint 02", start: "2026-01-12", end: "2026-01-25" }
  ]).map((b) => b.label).join(","), "Sprint 01,Sprint 02");
});

test("the buckets tile the plan period exactly", () => {
  const plan = { range: { start: "2026-01-15", end: "2026-04-02" } };
  ["day", "week", "month"].forEach((zoom) => {
    const buckets = reportBuckets(plan, zoom);
    assert.ok(buckets.length > 0, zoom);
    assert.equal(buckets[0].start, plan.range.start, zoom);
    assert.equal(buckets[buckets.length - 1].end, plan.range.end, zoom);
    for (let i = 1; i < buckets.length; i++) {
      const prev = new Date(buckets[i - 1].end + "T00:00:00Z").getTime() + 86400000;
      assert.equal(new Date(buckets[i].start + "T00:00:00Z").getTime(), prev, zoom + " gap at " + i);
    }
  });
});

/* --- the pivots reconcile with the plan ----------------------------------- */

test("each pivot's totals reconcile with the plan total", () => {
  const plan = fixture();
  const f = report(plan);
  near(f.planTotal, 17);
  near(f.byProject.total.total, 17);
  near(f.byPerson.total.total, 17);
  near(f.byTag.total.total, 17);
  // Every bucket column adds to the same total the Total column carries.
  near(f.byProject.total.cells.reduce((s, v) => s + v, 0), 17);
  near(f.byTag.total.cells.reduce((s, v) => s + v, 0), 17);
  near(f.byPerson.total.cells.reduce((s, v) => s + v, 0), 17);
  // The tag pivot's own rows sum to its total row.
  near(f.byTag.rows.reduce((s, r) => s + r.total, 0), f.byTag.total.total);
});

test("the Of plan column sums to 100%", () => {
  const plan = fixture();
  const f = report(plan);
  near(f.byProject.rows.reduce((s, r) => s + r.share, 0), 1);
  near(f.byPerson.rows.reduce((s, r) => s + r.share, 0), 1);
  near(f.byTag.rows.reduce((s, r) => s + r.share, 0), 1);
});

test("a two-tag project splits its FTE-days evenly between its tags", () => {
  const plan = fixture();
  const f = report(plan);
  const solar = f.byTag.rows.find((r) => r.tag === "api:Solar");
  const testing = f.byTag.rows.find((r) => r.tag === "Testing");
  near(solar.total, 8.5);
  near(testing.total, 8.5);
  near(solar.cells[0], 8.5);
  near(testing.cells[0], 8.5);
});

/* --- absences contribute nothing ------------------------------------------ */

test("absences contribute no FTE-days to any pivot or chart", () => {
  const plan = fixture();
  const f = report(plan);
  // The absence Project is no row, and no tag on it becomes one.
  assert.equal(f.byProject.rows.some((r) => r.id === "leave"), false);
  assert.equal(f.byTag.rows.some((r) => r.tag === "Absence" || r.label === "Annual Leave"), false);
  // And no bucket in either chart counts it.
  near(f.planTotal, 17);
  near(f.charts.line.reduce((s, b) => s + b.alloc, 0), 17);
  near(f.charts.stacked.reduce((s, b) => s + b.segments.reduce((t, g) => t + g.value, 0), 0), 17);
});

test("a person's offer is read net of their time off", () => {
  const plan = fixture();
  const f = report(plan);
  const anna = f.byPerson.rows.find((r) => r.id === "anna");
  const ben = f.byPerson.rows.find((r) => r.id === "ben");
  near(anna.offered, 17);
  near(ben.offered, 11);
  near(f.offeredTotal, 28);
  near(anna.pct, 17 / 17);
  near(f.byPerson.total.pct, 17 / 28);
});

test("a part-time person reaches 100% of their own offer at their ceiling", () => {
  const plan = fixture();
  // Ben offers half of full time, so a 50% Assignment fills the offer he makes
  // and no more: the report reads that as the whole of his offer while his
  // of-plan fraction stays his part of the plan.
  plan.assignments.push({
    id: "a3", projectId: "solar", personId: "ben",
    start: "2026-01-01", end: "2026-01-31", share: 50, tags: []
  });
  const f = report(plan);
  const ben = f.byPerson.rows.find((r) => r.id === "ben");
  near(ben.offered, 11);
  near(ben.total, 11);
  near(ben.pct, 1);
  near(ben.share, 11 / 28);
});

/* --- the rail's sort is the report's order -------------------------------- */

test("the pivots keep the order they are handed", () => {
  const plan = fixture();
  const view = wholeView(plan);
  view.projects = [plan.projects[0]];
  const f = reportContent(view, plan, { zoom: "month" });
  assert.deepEqual(f.byProject.rows.map((r) => r.id), ["solar"]);
  const reversed = { projects: plan.projects.slice().reverse(), people: plan.people.slice().reverse(), assignments: plan.assignments };
  const g = reportContent(reversed, plan, { zoom: "month" });
  assert.deepEqual(g.byPerson.rows.map((r) => r.id), ["ben", "anna"]);
});

test("the pivots follow the sort the rail stores", () => {
  const plan = seedPlan();
  const stored = { key: "name", direction: "desc" };
  const ordered = sortProjects(plan.projects, stored, plan);
  const view = {
    projects: ordered,
    people: plan.people,
    assignments: plan.assignments
  };
  const f = reportContent(view, plan, { zoom: "month" });
  assert.deepEqual(f.byProject.rows.map((r) => r.id), ordered.map((p) => p.id));
  // The report has no sort control of its own, so this order is the only one
  // it can show - and it is not the plan's own order by accident.
  assert.notDeepEqual(ordered.map((p) => p.id), plan.projects.map((p) => p.id));
});

/* --- the Filter narrows the report ---------------------------------------- */

test("the report reads the view it is given, so the Filter narrows it", () => {
  const plan = fixture();
  const narrowed = {
    projects: [plan.projects[0]],
    people: [plan.people[0]],
    assignments: [plan.assignments[0]]
  };
  const f = reportContent(narrowed, plan, { zoom: "month" });
  assert.equal(f.byProject.rows.length, 1);
  assert.equal(f.byPerson.rows.length, 1);
  assert.equal(f.byTag.rows.length, 2);
  near(f.planTotal, 17);
  near(f.byProject.rows[0].share, 1);
});

/* --- the figures are the app's own ---------------------------------------- */

test("a project's row total is the measure sort.mjs already computes", () => {
  const plan = seedPlan();
  const measures = projectMeasures(plan);
  const f = report(plan, {
    projects: plan.projects,
    people: plan.people,
    assignments: plan.assignments
  });
  f.byProject.rows.forEach((row) => {
    near(row.total, measures[row.id].fteDays);
  });
});

/* --- a project with no tags still reconciles ------------------------------ */

test("an untagged project still reconciles, under its own row", () => {
  const plan = fixture();
  plan.projects.push({ id: "ops", name: "Ops", colour: 2, tags: [] });
  plan.assignments.push({ id: "a3", projectId: "ops", personId: "ben", start: "2026-01-05", end: "2026-01-09", share: 100, tags: [] });
  const f = report(plan);
  const untagged = f.byTag.rows.find((r) => r.tag === "");
  assert.ok(untagged, "an untagged row is present");
  near(untagged.total, 5);
  near(f.planTotal, 22);
  near(f.byTag.total.total, 22);
});

/* --- a row's tag list is shown alphabetically ----------------------------- */

test("a project's row shows its tags alphabetically, not in the plan's order", () => {
  const plan = fixture();
  plan.projects[0].tags = ["Zebra", "api:Solar", "Testing"];
  const stored = plan.projects[0].tags.slice();
  const f = report(plan);
  const solar = f.byProject.rows.find((r) => r.id === "solar");
  assert.deepEqual(solar.tags, ["api:Solar", "Testing", "Zebra"]);
  // Display only: the plan keeps the order the user typed.
  assert.deepEqual(plan.projects[0].tags, stored);
});

test("the sort is case-insensitive, so a capital does not jump the queue", () => {
  const plan = fixture();
  plan.projects[0].tags = ["testing", "Architect", "api:Solar", "Zebra", "beta"];
  const f = report(plan);
  assert.deepEqual(f.byProject.rows.find((r) => r.id === "solar").tags,
    ["api:Solar", "Architect", "beta", "testing", "Zebra"]);
});

test("a repeated tag still collapses, however it is ordered", () => {
  const plan = fixture();
  plan.projects[0].tags = ["Testing", "api:Solar", "Testing"];
  const f = report(plan);
  assert.deepEqual(f.byProject.rows.find((r) => r.id === "solar").tags, ["api:Solar", "Testing"]);
  assert.equal(f.byTag.rows.length, 2);
});

test("a person's row reads its tags the same way", () => {
  const plan = fixture();
  plan.people[0].tags = ["Zebra", "Architect"];
  const f = report(plan);
  assert.deepEqual(f.byPerson.rows.find((r) => r.id === "anna").tags, ["Architect", "Zebra"]);
});

test("sorting a row's tags changes no figure", () => {
  const plan = fixture();
  const reversed = fixture();
  reversed.projects[0].tags = plan.projects[0].tags.slice().reverse();
  const f = report(plan);
  const g = report(reversed);
  near(g.planTotal, f.planTotal);
  near(g.byProject.rows.find((r) => r.id === "solar").total, 17);
  assert.deepEqual(g.byProject.rows.find((r) => r.id === "solar").cells,
    f.byProject.rows.find((r) => r.id === "solar").cells);
  f.byTag.rows.forEach((row) => {
    const other = g.byTag.rows.find((r) => r.tag === row.tag);
    assert.ok(other, row.tag);
    near(other.total, row.total);
    near(other.share, row.share);
    assert.deepEqual(other.cells, row.cells);
  });
  // The even split still divides the same FTE-days the same way.
  near(g.byTag.rows.find((r) => r.tag === "api:Solar").total, 8.5);
  near(g.byTag.rows.find((r) => r.tag === "Testing").total, 8.5);
  near(g.byTag.total.total, f.byTag.total.total);
});

test("the by-tag rows keep their own order: the most FTE-days first", () => {
  const plan = fixture();
  plan.projects[0].tags = ["Zebra", "api:Solar", "Testing"];
  plan.projects.push({ id: "ops", name: "Ops", colour: 2, tags: ["Zebra"] });
  plan.assignments.push({ id: "a3", projectId: "ops", personId: "ben", start: "2026-01-05", end: "2026-01-09", share: 100, tags: [] });
  const f = report(plan);
  // Two tags share the Solar row's 17 FTE-days at 8.5, and Zebra carries that
  // plus the Ops row's 5: the figure order, not the alphabetical one. A tie
  // between the split's two halves breaks by label, untouched by this sort.
  assert.deepEqual(f.byTag.rows.map((r) => r.tag), ["Zebra", "Testing", "api:Solar"]);
});

/* --- allocation by person: one denominator, the person's own offer --------- */

/*
 * A plan across two months, so a bucket's share and the period's share can
 * differ. January 2026 has 22 working days and February 20.
 *   - Anna offers a full week: 11 of her 22 January days at 50%, and 5 of her
 *     20 February days at 100%, so her cells are 50% and 25% while her period
 *     figure is 16 over the 42 days she offers - not the 75% the two cells add
 *     to.
 *   - Ben offers half a week and is put on a full Allocation for January, so he
 *     is at 200% of his own offer in that bucket: the over-allocation the
 *     view exists to show. Nothing is allocated to him in February.
 */
function spreadFixture() {
  return {
    range: { start: "2026-01-01", end: "2026-02-28" },
    people: [
      { id: "anna", name: "Anna", availability: 100, tags: ["lead"] },
      { id: "ben", name: "Ben", availability: 50, tags: [] }
    ],
    projects: [{ id: "atlas", name: "Atlas", colour: 0, tags: [] }],
    assignments: [
      { id: "a1", projectId: "atlas", personId: "anna", start: "2026-01-01", end: "2026-01-31", share: 50, tags: [] },
      { id: "a2", projectId: "atlas", personId: "anna", start: "2026-02-02", end: "2026-02-06", share: 100, tags: [] },
      { id: "a3", projectId: "atlas", personId: "ben", start: "2026-01-01", end: "2026-01-31", share: 100, tags: [] }
    ]
  };
}

function spread(plan, options) {
  return report(plan, wholeView(plan), options);
}

test("a person's cell is their FTE-days over what they offer in that bucket", () => {
  const plan = spreadFixture();
  const f = spread(plan);
  const anna = f.allocationByPerson.rows.find((r) => r.id === "anna");
  const ben = f.allocationByPerson.rows.find((r) => r.id === "ben");
  assert.equal(f.buckets.map((b) => b.key).join(","), "2026-01,2026-02");
  // Half a full Allocation over January, then a full one over five February
  // days: the share of what each person offers, read bucket by bucket.
  near(anna.cells[0], 0.5);
  near(anna.cells[1], 5 / 20);
  // Ben offers half a week, so a full Allocation over January is 200% of him.
  near(ben.cells[0], 2);
  near(ben.cells[1], 0);
  // Each figure is the by-person row's own FTE-days over its own offer array,
  // not a second computation: the two tables cannot disagree.
  const annaDays = f.byPerson.rows.find((r) => r.id === "anna");
  anna.cells.forEach((cell, i) => near(cell, annaDays.cells[i] / annaDays.offeredCells[i]));
});

test("every cell divides by the offer in the same bucket, and no other figure", () => {
  const plan = spreadFixture();
  const f = spread(plan);
  f.allocationByPerson.rows.forEach((row) => {
    const days = f.byPerson.rows.find((r) => r.id === row.id);
    assert.equal(row.cells.length, f.buckets.length);
    row.cells.forEach((cell, i) => {
      if (days.offeredCells[i] > 0) near(cell, days.cells[i] / days.offeredCells[i]);
      else assert.equal(cell, null, "a bucket with no offer carries no share");
    });
  });
});

test("a bucket a person offers nothing in shows no share rather than Infinity", () => {
  const plan = spreadFixture();
  // At Day zoom a Saturday offers no working day at all, so there is nothing to
  // divide by: the cell is null, which the report draws as its missing figure.
  const f = spread(plan, { zoom: "day" });
  const saturday = f.buckets.findIndex((b) => b.key === "2026-01-03");
  assert.notEqual(saturday, -1, "the fixture has a Saturday in it");
  near(f.byPerson.rows.find((r) => r.id === "anna").offeredCells[saturday], 0);
  const anna = f.allocationByPerson.rows.find((r) => r.id === "anna");
  assert.equal(anna.cells[saturday], null);
  // The total row divides by the whole plan's offer, which is also nothing on a
  // Saturday.
  assert.equal(f.allocationByPerson.total.cells[saturday], null);
  // And nothing anywhere reads as Infinity or NaN.
  const all = f.allocationByPerson.rows.flatMap((r) => r.cells.concat([r.total]))
    .concat(f.allocationByPerson.total.cells, [f.allocationByPerson.total.total]);
  all.forEach((cell) => assert.ok(cell === null || Number.isFinite(cell), String(cell)));
});

test("a row's Total is the period's share, not the sum of its cells", () => {
  const plan = spreadFixture();
  const f = spread(plan);
  const anna = f.allocationByPerson.rows.find((r) => r.id === "anna");
  const days = f.byPerson.rows.find((r) => r.id === "anna");
  // 16 FTE-days over the 42 she offers across both months, not 50% + 25%.
  near(anna.total, 16 / 42);
  near(anna.total, days.pct);
  near(anna.total, days.total / days.offered);
  near(anna.cells.reduce((s, v) => s + v, 0), 0.75);
  assert.notEqual(Math.round(anna.total * 1000), Math.round(anna.cells.reduce((s, v) => s + v, 0) * 1000));
});

test("the total row is everything allocated over everything offered", () => {
  const plan = spreadFixture();
  const f = spread(plan);
  const total = f.allocationByPerson.total;
  // January: 33 FTE-days allocated over 33 offered. February: 5 over 30.
  near(total.cells[0], 1);
  near(total.cells[1], 5 / 30);
  // Over the period that is the by-person total's own figure, not a sum of the
  // two bucket shares.
  near(total.total, f.byPerson.total.pct);
  near(total.total, f.planTotal / f.offeredTotal);
  // 38 FTE-days allocated over the 63 the two people offer: Anna's 42 and Ben's
  // 21, half a week over the two months' 42 working days.
  near(total.total, 38 / 63);
  // The rows reconcile with the row they sit under, per bucket and over all.
  f.buckets.forEach((_, i) => {
    const allocated = f.byPerson.rows.reduce((s, r) => s + r.cells[i], 0);
    const offered = f.byPerson.rows.reduce((s, r) => s + r.offeredCells[i], 0);
    near(total.cells[i], allocated / offered);
  });
});

test("the view keeps the rail's order and the Filter's narrowing", () => {
  const plan = spreadFixture();
  const view = wholeView(plan);
  view.people = plan.people.slice().reverse();
  const f = spread(plan);
  assert.deepEqual(f.allocationByPerson.rows.map((r) => r.id), ["anna", "ben"]);
  const narrowed = reportContent(view, plan, { zoom: "month" });
  assert.deepEqual(narrowed.allocationByPerson.rows.map((r) => r.id), ["ben", "anna"]);
  // The filtered view still offers what the whole plan says a person offers,
  // because the offer is the Person's own.
  near(narrowed.allocationByPerson.rows[1].cells[0], 0.5);
});

/* --- the tags the by-tag view splits by (issues #168 and #173) ------------ */

/*
 * A plan carrying a taxonomy beside incidental labels: two `api:` values, two
 * untyped tags and one untagged project. The absence Project's own tag sits
 * outside every figure, so it is no row and is not offered either. January 2026
 * has 22 weekdays and Anna's five days off are not working days, so Solar's
 * full-time month is 17 FTE-days over its two tags (8.5 each), Terra is Ben's
 * half over five weekdays (2.5 over its two tags, 1.25 each), and Ops is an
 * untagged full week (5). The plan's total is 24.5.
 */
function splitFixture() {
  const plan = fixture();
  plan.projects.push(
    { id: "terra", name: "Terra", colour: 1, tags: ["api:Terra", "QA"] },
    { id: "ops", name: "Ops", colour: 2, tags: [] }
  );
  plan.assignments.push(
    { id: "a3", projectId: "terra", personId: "ben", start: "2026-01-05", end: "2026-01-09", share: 50, tags: [] },
    { id: "a4", projectId: "ops", personId: "anna", start: "2026-01-12", end: "2026-01-16", share: 100, tags: [] }
  );
  return plan;
}

test("nothing is selected until the owner ticks a tag", () => {
  const plan = splitFixture();
  // No stored selection, no rows: the view says so rather than guessing at a
  // taxonomy - a most-used tag or the colour setting included.
  const f = report(plan);
  assert.equal(f.byTagSplit, null);
  assert.deepEqual(tagSelection(plan), []);
  plan.tagColours = { keys: { projects: "api" }, colours: { "api:Solar": 2 } };
  assert.equal(report(plan).byTagSplit, null);
  // An empty selection is no selection either, not a plan that will not open.
  plan.tagSplit = {};
  assert.deepEqual(tagSelection(plan), []);
  assert.equal(report(plan).byTagSplit, null);
  plan.tagSplit = { tags: [] };
  assert.equal(report(plan).byTagSplit, null);
});

test("the keys offered are the first row of chips, the keyless tags left to the second", () => {
  const plan = splitFixture();
  const keys = tagKeyGroups(plan);
  assert.deepEqual(keys.map((k) => k.key), ["api"]);
  assert.deepEqual(keys[0].tags, ["api:Solar", "api:Terra"]);
  // A tag belonging to no key is never a key of its own, and the keys' own row
  // carries none of them: Testing and QA are chips in the tag row alone.
  assert.equal(keys.some((k) => k.key === "" || k.key === "No key"), false);
  // The tag row is every tag the view can draw a row for, alphabetical and case
  // insensitive, keyless ones included; the absence Project's own tag is not
  // offered, since no absence contributes a day.
  assert.deepEqual(tagChoices(plan), ["api:Solar", "api:Terra", "QA", "Testing"]);
  // Two keys list alphabetically, case insensitively, each key's tags
  // alphabetical; and a plan whose tags all carry a key offers no other row.
  const both = fixture();
  both.projects = both.projects.filter((p) => !p.absence);
  both.projects[0].tags = ["Web:Site", "api:Terra", "api:Solar"];
  assert.deepEqual(tagKeyGroups(both).map((k) => k.key), ["api", "Web"]);
  assert.deepEqual(tagKeyGroups(both)[1].tags, ["Web:Site"]);
  assert.deepEqual(tagChoices(both), ["api:Solar", "api:Terra", "Web:Site"]);
});

test("a key's chip is derived from its tags: all of them, or not selected", () => {
  const plan = splitFixture();
  const api = tagKeyGroups(plan)[0].tags;
  // Two states and no third: a key holding some of its tags is not selected,
  // so there is no third reading for a chip to draw.
  assert.deepEqual(tagKeyState(api, []), { count: 0, total: 2, all: false });
  assert.deepEqual(tagKeyState(api, ["api:Solar"]), { count: 1, total: 2, all: false });
  // All of them: a selected key. A tag ticked outside the key changes neither.
  assert.deepEqual(tagKeyState(api, ["api:Solar", "api:Terra"]), { count: 2, total: 2, all: true });
  assert.deepEqual(tagKeyState(api, ["api:Solar", "QA"]), { count: 1, total: 2, all: false });
  assert.deepEqual(tagKeyState(api, ["QA", "Testing"]), { count: 0, total: 2, all: false });
  // A key with no tags at all is never selected, so an empty key can never read
  // as a complete one.
  assert.equal(tagKeyState([], []).all, false);
});

test("a press on a partly selected key selects all of it, and on a selected one clears it", () => {
  const plan = splitFixture();
  const api = tagKeyGroups(plan)[0].tags;
  // From nothing: the key's chip ticks its whole set in one step and leaves
  // every tag outside it alone.
  assert.deepEqual(tagToggled([], api), ["api:Solar", "api:Terra"]);
  // From a partly selected key: the press selects every tag of the set - the
  // state the key's own chip is offering - and keeps a tag ticked in the tag row.
  assert.deepEqual(tagToggled(["api:Solar", "QA"], api), ["api:Solar", "QA", "api:Terra"]);
  // From a fully selected key: the press clears every one of its tags and
  // leaves the tag row's own selection standing.
  assert.deepEqual(tagToggled(["api:Solar", "api:Terra", "QA"], api), ["QA"]);
  // A tag's own chip is the same rule over a list of one, so its press never
  // disturbs the rest of the selection.
  assert.deepEqual(tagToggled([], ["QA"]), ["QA"]);
  assert.deepEqual(tagToggled(["api:Solar", "QA"], ["QA"]), ["api:Solar"]);
  assert.deepEqual(tagToggled(["QA"], ["Testing"]), ["QA", "Testing"]);
  // A key's derived state after its own press: full from part, empty from full.
  assert.equal(tagKeyState(api, tagToggled(["api:Solar"], api)).all, true);
  assert.equal(tagKeyState(api, tagToggled(api, api)).count, 0);
});

test("the selected tags are the rows, and every other tag is Other tags", () => {
  const plan = splitFixture();
  plan.tagSplit = { tags: ["api:Solar", "QA"] };
  const f = report(plan);
  const split = f.byTagSplit;
  // Exactly the two ticked tags, in the view's own size order; the tags nobody
  // ticked (Testing, api:Terra) and the untagged Project are one residual.
  assert.deepEqual(split.rows.map((r) => r.tag), ["api:Solar", "QA"]);
  near(split.rows[0].total, 8.5);
  near(split.rows[1].total, 1.25);
  assert.equal(split.other.label, "Other tags");
  near(split.other.total, 14.75);
  // The label each row wears is the tag it is, so a row is readable as the tag
  // the projects carry.
  assert.deepEqual(split.rows.map((r) => r.label), ["api:Solar", "QA"]);
});

test("the residual row is the plan total minus the rows shown", () => {
  const plan = splitFixture();
  plan.tagSplit = { tags: ["api:Solar", "api:Terra", "QA"] };
  const f = report(plan);
  const split = f.byTagSplit;
  near(f.planTotal, 24.5);
  // Testing (8.5) and the untagged project (5) are gathered in the one residual.
  near(split.other.total, 13.5);
  const shown = split.rows.reduce((s, r) => s + r.total, 0) + split.other.total;
  near(shown, f.planTotal);
  // And the row it sits under says the same.
  near(shown, f.byTag.total.total);
  near(split.rows.reduce((s, r) => s + r.share, 0) + split.other.share, 1);
  // Everything the report carries is ticked, so the residual is the untagged
  // Project alone; take that away and there is no residual row at all.
  plan.tagSplit = { tags: ["api:Solar", "api:Terra", "QA", "Testing"] };
  assert.deepEqual(report(plan).byTagSplit.rows.map((r) => r.tag),
    ["Testing", "api:Solar", "QA", "api:Terra"]);
  near(report(plan).byTagSplit.other.total, 5);
  plan.projects = plan.projects.filter((p) => p.id !== "ops");
  plan.assignments = plan.assignments.filter((a) => a.projectId !== "ops");
  assert.equal(report(plan).byTagSplit.other, null);
});

test("the selection's rows and residual reconcile bucket by bucket", () => {
  const plan = splitFixture();
  plan.tagSplit = { tags: ["api:Solar", "QA"] };
  const f = reportContent(wholeView(plan), plan, { zoom: "week" });
  const drawn = f.byTagSplit.rows.concat(f.byTagSplit.other ? [f.byTagSplit.other] : []);
  assert.ok(f.buckets.length > 4);
  f.buckets.forEach((_, i) => {
    const sum = drawn.reduce((s, r) => s + r.cells[i], 0);
    near(sum, f.byTag.total.cells[i]);
  });
  near(drawn.reduce((s, r) => s + r.total, 0), f.planTotal);
  // Row for row, the same tags and the same figures the complete pivot carries.
  f.byTagSplit.rows.forEach((row) => {
    const whole = f.byTag.rows.find((r) => r.tag === row.tag);
    near(row.total, whole.total);
  });
});

test("a plan carrying the shape this replaced opens with the same tags selected", () => {
  const plan = splitFixture();
  const now = splitFixture();
  now.tagSplit = { tags: ["api:Solar", "api:Terra", "QA"] };
  // The obsolete shape: a key plus the tags added beside it. Read as the tags
  // it stood for - every api tag, plus QA - so an old plan opens with its
  // selection intact rather than losing it or failing to load.
  plan.tagSplit = { key: "api", tags: ["QA"] };
  assert.deepEqual(tagSelection(plan), ["api:Solar", "api:Terra", "QA"]);
  const f = report(plan);
  const migrated = report(now);
  assert.deepEqual(f.byTagSplit.rows.map((r) => r.tag), migrated.byTagSplit.rows.map((r) => r.tag));
  near(f.byTagSplit.other.total, migrated.byTagSplit.other.total);
  // A key alone stands for its whole set.
  plan.tagSplit = { key: "api" };
  assert.deepEqual(tagSelection(plan), ["api:Solar", "api:Terra"]);
  // A key no project carries stands for the tags added beside it alone, so an
  // old selection never draws a row the plan cannot feed.
  plan.tagSplit = { key: "gone" };
  assert.deepEqual(tagSelection(plan), []);
  assert.equal(report(plan).byTagSplit, null);
  // A malformed one is no selection, not a plan that will not draw.
  plan.tagSplit = "api";
  assert.deepEqual(tagSelection(plan), []);
});

test("a tag the view carries no row for adds nothing to draw", () => {
  const plan = splitFixture();
  // The report's own complete tag list is the one thing a row can come from, so
  // a selection naming a tag no Project under this view carries draws no row
  // and still reconciles: the residual covers it with the rest.
  const rows = report(plan).byTag.rows;
  const split = tagSplitRows(rows, ["api:Solar", "Nowhere"]);
  assert.deepEqual(split.rows.map((r) => r.tag), ["api:Solar"]);
  assert.equal(tagSplitRows(rows, []), null);
});
