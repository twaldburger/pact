/*
 * The rules behind the first write to Azure DevOps: what may be published, which
 * iteration a day falls in, what the comment says, and what the panel's press
 * does when it may not be pressed.
 *
 * No network call is made here. These are the pure rules the server, the browser
 * and this file read from one source; the calls themselves, against stubbed ADO
 * answers, are in ado-write-back-api.test.mjs. What is pinned here is the part
 * the API suite cannot check for itself: that an iteration is chosen by an
 * inclusive date test in UTC rather than by name, that the comment's marker is
 * its first line and the table is the whole of the rest, that a refused write
 * says which cause stopped it, and that a plan still cannot carry a credential.
 */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { createStore, seedPlan, validatePlan } from "../lib/plan.mjs";
import {
  WRITE_BACK_MARKER,
  allocationComment,
  commentFigure,
  iterationForDate,
  iterationRefusal,
  iterationWindows,
  linkRow,
  writeBackLine,
  writeBackState
} from "../public/lib/ado.mjs";
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("ado-write-back");

const MAPPING = {
  organizationUrl: "https://dev.azure.com/example",
  project: "PACT",
  projectLevels: ["Epic"],
  assignmentLevels: ["Feature", "User Story"]
};

const LINK = {
  workItemId: 4,
  rev: 7,
  workItemType: "User Story",
  datesAssumed: false,
  values: {
    title: "My first Story",
    personEmail: "anna@example.com",
    project: "Super Epic Project",
    start: null,
    end: null,
    iterationPath: null
  }
};

/* --- what may be published, and why not ---------------------------------- */

test("an Assignment with no work item behind it cannot write back, and says so", () => {
  [undefined, null, {}, { rev: 7, datesAssumed: false }, { workItemId: 0 }].forEach((link) => {
    const state = writeBackState(link);
    assert.equal(state.enabled, false);
    assert.equal(state.reason, "unlinked");
    assert.match(state.title, /no Azure DevOps work item behind it/);
    assert.match(state.title, /An import establishes the link/);
  });
});

test("assumed dates are never published, and the reason is the assumed marker", () => {
  const assumed = writeBackState(Object.assign({}, LINK, { datesAssumed: true }));
  assert.equal(assumed.enabled, false);
  assert.equal(assumed.reason, "assumed");
  assert.match(assumed.title, /assumed/);
  assert.match(assumed.title, /Set this Assignment's own dates/);
  // The marker is the only thing that decides this: a link whose dates are ADO's
  // or a person's is enabled, whatever else it carries.
  const decided = writeBackState(LINK);
  assert.equal(decided.enabled, true);
  assert.equal(decided.reason, "");
  assert.match(decided.title, /#4/);
});

/* --- which sprint the Assignment starts in ------------------------------- */

const SPRINTS = [
  { path: "\\PACT\\Iteration\\Sprint 01", start: "2026-01-01", end: "2026-01-14" },
  { path: "\\PACT\\Iteration\\Sprint 02", start: "2026-01-15", end: "2026-01-28" }
];

test("an iteration is chosen by an inclusive date test, with a boundary day at each end", () => {
  // Each end belongs to the sprint that ends there: a day is contained, not
  // bracketed. Both ends of Sprint 01, from its first day to its last.
  assert.equal(iterationForDate(SPRINTS, "2026-01-01").path, "\\PACT\\Iteration\\Sprint 01");
  assert.equal(iterationForDate(SPRINTS, "2026-01-14").path, "\\PACT\\Iteration\\Sprint 01");
  assert.equal(iterationForDate(SPRINTS, "2026-01-07").path, "\\PACT\\Iteration\\Sprint 01");
  // The day before the first sprint and the day after the last are in no sprint.
  assert.equal(iterationForDate(SPRINTS, "2025-12-31").path, "");
  assert.equal(iterationForDate(SPRINTS, "2026-01-29").path, "");
  assert.equal(iterationForDate(SPRINTS, "2026-01-15").path, "\\PACT\\Iteration\\Sprint 02");
  assert.equal(iterationForDate(SPRINTS, "2026-01-28").path, "\\PACT\\Iteration\\Sprint 02");
});

test("a date is read in UTC, so an instant late in a day lands on that day", () => {
  // ADO answers its dates as instants. Reading one in this machine's own zone
  // would move the day for any offset west of Greenwich.
  assert.equal(iterationForDate(SPRINTS, "2026-01-14T23:30:00Z").path, "\\PACT\\Iteration\\Sprint 01");
  assert.equal(iterationForDate(SPRINTS, "2026-01-15T00:00:00Z").path, "\\PACT\\Iteration\\Sprint 02");
  // A start that is not a date places nothing, and says so rather than throwing.
  const none = iterationForDate(SPRINTS, "");
  assert.equal(none.path, "");
  assert.equal(none.covers, 0);
});

test("a day covered by no iteration is refused, naming the day", () => {
  const chosen = iterationForDate(SPRINTS, "2026-01-29");
  assert.equal(chosen.covers, 0);
  const refusal = iterationRefusal({ project: "PACT", date: chosen.date, covers: chosen.covers });
  assert.match(refusal, /2026-01-29/);
  assert.match(refusal, /No Azure DevOps iteration in PACT covers/);
  // And never a silent fall back to the project root, which is a real path that
  // would put the work in no sprint at all.
  assert.match(refusal, /will not fall back to the project's root/);
});

test("a day two iterations cover is a refusal rather than a pick", () => {
  const overlapping = [
    { path: "\\PACT\\Iteration\\Sprint 01", start: "2026-01-01", end: "2026-01-14" },
    { path: "\\PACT\\Iteration\\Sprint 02", start: "2026-01-10", end: "2026-01-21" }
  ];
  const chosen = iterationForDate(overlapping, "2026-01-12");
  assert.equal(chosen.path, "");
  assert.equal(chosen.covers, 2);
  const refusal = iterationRefusal({ project: "PACT", date: chosen.date, covers: chosen.covers });
  assert.match(refusal, /2 Azure DevOps iterations in PACT cover 2026-01-12/);
  assert.match(refusal, /cannot tell which one to write/);
  // Both ends are inclusive, so two sprints that share a boundary day share that
  // day too: the day is covered by two, which is a refusal rather than a pick.
  const sequential = [
    { path: "\\PACT\\Iteration\\Sprint 01", start: "2026-01-01", end: "2026-01-14" },
    { path: "\\PACT\\Iteration\\Sprint 02", start: "2026-01-14", end: "2026-01-28" }
  ];
  assert.equal(iterationForDate(sequential, "2026-01-14").covers, 2);
});

test("the iteration tree is read at every depth, as the paths a work item is written with", () => {
  const tree = {
    name: "PACT",
    path: "\\PACT\\Iteration",
    children: [
      {
        name: "Sprint 01",
        attributes: { startDate: "2026-01-01T00:00:00Z", finishDate: "2026-01-14T00:00:00Z" },
        children: [{
          name: "Week 1",
          attributes: { startDate: "2026-01-01T00:00:00Z", finishDate: "2026-01-07T00:00:00Z" }
        }]
      },
      { name: "Sprint 02" }
    ]
  };
  // A classification node's path carries the project's own `Iteration` segment;
  // a work item's `System.IterationPath` does not, and writing the first is
  // refused as an invalid tree name. The windows are the work item's paths.
  const windows = iterationWindows(tree);
  assert.deepEqual(windows, [
    { path: "PACT\\Sprint 01", start: "2026-01-01", end: "2026-01-14" },
    { path: "PACT\\Sprint 01\\Week 1", start: "2026-01-01", end: "2026-01-07" }
  ]);
  // The root itself is never a window, and never the fallback: a project with
  // iterations switched off answers without a tree at all.
  assert.deepEqual(iterationWindows(undefined), []);
  assert.deepEqual(iterationWindows({ name: "PACT", path: "\\PACT\\Iteration" }), []);
});

/* --- the comment --------------------------------------------------------- */

test("the comment's first line is the marker, and the table is the whole of the rest", () => {
  const text = allocationComment({
    personName: "Anna Example",
    share: 40,
    start: "2026-01-05",
    end: "2026-02-13",
    fteDays: 8.84
  });
  const lines = text.split("\n");
  assert.equal(lines[0], WRITE_BACK_MARKER + " _(maintained automatically)_");
  assert.equal(lines[1], "");
  assert.equal(lines[2], "| Person | Share | From | To | FTE-days |");
  assert.equal(lines[3], "| --- | --- | --- | --- | --- |");
  assert.equal(lines[4], "| Anna Example | 40% | 2026-01-05 | 2026-02-13 | 8.8 |");
  // Followed by nothing: no prose, no second table, no trailing blank line for a
  // later edit to append to.
  assert.equal(lines.length, 5);
  assert.equal(text.endsWith("\n"), false);
});

test("a pipe in a name cannot end a table cell", () => {
  const text = allocationComment({ personName: "Anna | Meier", share: 100, start: "2026-01-05", end: "2026-01-09", fteDays: 5 });
  assert.match(text, /\| Anna \\\| Meier \|/);
});

test("a figure reads as the report writes one: one decimal, a middot for nothing", () => {
  assert.equal(commentFigure(8.84), "8.8");
  assert.equal(commentFigure(12), "12.0");
  assert.equal(commentFigure(0), "\u00b7");
  assert.equal(commentFigure(Number.NaN), "-");
});

test("what a finished write back reads as names both halves", () => {
  const line = writeBackLine({
    workItemId: 4,
    workItemType: "User Story",
    iterationPath: "\\PACT\\Iteration\\Sprint 01",
    comment: "posted"
  });
  assert.match(line, /Wrote back to User Story #4/);
  assert.match(line, /its comment was posted/);
  assert.match(line, /its iteration is now \\PACT\\Iteration\\Sprint 01/);
  // Edited and posted are different outcomes, and the line says which.
  const edited = writeBackLine({ workItemId: 4, iterationPath: "x", comment: "edited" });
  assert.match(edited, /updated in place/);
});

/* --- the plan, and its baseline ------------------------------------------ */

function linkedPlan() {
  const plan = seedPlan();
  plan.ado = MAPPING;
  plan.people[0].email = "anna@example.com";
  const assignment = plan.assignments[0];
  assignment.link = JSON.parse(JSON.stringify(LINK));
  return plan;
}

function storeFor(plan) {
  const dir = tempDir();
  const file = path.join(dir, "plan.json");
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + "\n");
  return { store: createStore(file), file: file };
}

test("a person setting the dates is what stops them being assumed", () => {
  const { store } = storeFor(linkedPlan());
  const assignment = store.get().assignments[0];
  const stale = Object.assign({}, ASSUMED_DATES, { datesAssumed: true });
  store.updateAssignment(assignment.id, { link: stale });
  // A save that sends the same dates back leaves the guess a guess: the marker
  // is about where the dates came from, not that a panel was open.
  store.updateAssignment(assignment.id, { start: assignment.start, end: assignment.end });
  assert.equal(store.get().assignments[0].link.datesAssumed, true);
  // Moving either end is a person deciding, so the marker clears.
  const moved = new Date(Date.parse(assignment.end + "T00:00:00Z") + 6 * 86400000).toISOString().slice(0, 10);
  store.updateAssignment(assignment.id, { end: moved });
  assert.equal(store.get().assignments[0].link.datesAssumed, false);
});

const ASSUMED_DATES = {
  workItemId: 4,
  rev: 7,
  workItemType: "User Story",
  datesAssumed: true,
  values: {
    title: "My first Story",
    personEmail: "anna@example.com",
    project: "Super Epic Project",
    start: null,
    end: null,
    iterationPath: null
  }
};

test("a plan still refuses a credential in its ado block, and in a link", () => {
  const plan = linkedPlan();
  assert.deepEqual(validatePlan(plan), []);
  ["token", "pat", "password", "clientSecret"].forEach((key) => {
    const broken = linkedPlan();
    broken.ado = Object.assign({}, MAPPING, { [key]: "abcdef" });
    assert.notDeepEqual(validatePlan(broken), [], "the ado block carried " + key);
    const linked = linkedPlan();
    linked.assignments[0].link.values = Object.assign({}, LINK.values, { [key]: "abcdef" });
    assert.notDeepEqual(validatePlan(linked), [], "a link carried " + key);
  });
});

/* --- what the row and its press are drawn from --------------------------- */

test("the link's row is the work item's, and the write back does not edit it", () => {
  const row = linkRow(LINK, MAPPING);
  assert.equal(row.linked, true);
  assert.equal(row.text, "4");
  assert.match(row.title, /revision 7/);
  // The row says what the press does and what stays read-only, rather than
  // claiming PACT writes nothing.
  assert.match(row.title, /an import establishes the link/);
  assert.match(row.title, /the write back publishes/);
  assert.doesNotMatch(row.title, /does not write to ADO/);
});
