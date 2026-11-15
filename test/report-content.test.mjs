import test from "node:test";
import assert from "node:assert/strict";
import { seedPlan } from "../lib/plan.mjs";
import { projectMeasures } from "../public/lib/sort.mjs";
import { reportBuckets, reportContent } from "../public/lib/report-content.mjs";

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

test("the Share of Plan column sums to 100%", () => {
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
