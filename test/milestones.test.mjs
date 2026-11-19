import test from "node:test";
import assert from "node:assert/strict";
import {
  milestoneProjects,
  milestoneSlot,
  milestoneShown,
  milestoneMarks,
  milestoneDateLabel,
  milestoneLabel,
  milestoneAxisSlots
} from "../public/lib/milestones.mjs";
import { LABEL_SEPARATOR } from "../public/lib/label.mjs";

const projects = [
  { id: "atlas", name: "Atlas" },
  { id: "borealis", name: "Borealis" },
  { id: "atlas-archived", name: "Atlas archive", archived: true }
];

test("a milestone resolves the projects it relates to, in the order it names them", () => {
  const milestone = { id: "launch", projectIds: ["borealis", "atlas"] };
  assert.deepEqual(milestoneProjects(milestone, projects).map((p) => p.name), ["Borealis", "Atlas"]);
});

test("a milestone relating to no project resolves to none", () => {
  assert.deepEqual(milestoneProjects({ id: "launch", projectIds: [] }, projects), []);
  assert.deepEqual(milestoneProjects({ id: "launch" }, projects), []);
  assert.deepEqual(milestoneProjects(null, projects), []);
  assert.deepEqual(milestoneProjects({ projectIds: ["atlas"] }, undefined), []);
});

test("an id that no longer names a project resolves to nothing, and the others still resolve", () => {
  // A deleted project's id is kept in the plan; it is not a link here.
  const stale = { id: "launch", projectIds: ["atlas", "deleted-project"] };
  assert.deepEqual(milestoneProjects(stale, projects).map((p) => p.id), ["atlas"]);
  // A milestone naming only gone projects reads as one that relates to none.
  const gone = { id: "launch", projectIds: ["deleted-project"] };
  assert.deepEqual(milestoneProjects(gone, projects), []);
});

test("a repeated id is one link, and an archived project still resolves", () => {
  // An archived project is still in the plan; whether it is drawn is the
  // visibility rule's question, not this one's.
  const milestone = { id: "launch", projectIds: ["atlas", "atlas", "atlas-archived"] };
  assert.deepEqual(milestoneProjects(milestone, projects).map((p) => p.id), ["atlas", "atlas-archived"]);
});

/* --- what the grid draws -------------------------------------------------- */

// The grid draws a Milestone only while the view leaves a Project it relates to
// in sight. `visibleProjectIds` is what the Filter left of the Projects.

test("a milestone related to projects is drawn only while one of them is visible", () => {
  const linked = { id: "launch", name: "Launch", date: "2026-12-01", colour: 1, projectIds: ["atlas"] };
  assert.equal(milestoneShown(linked, projects, ["atlas"]), true);
  assert.equal(milestoneShown(linked, projects, ["borealis"]), false);
  assert.equal(milestoneShown(linked, projects, []), false);
  // One visible link of several is enough, whatever order they are named in.
  const two = Object.assign({}, linked, { projectIds: ["atlas", "borealis"] });
  assert.equal(milestoneShown(two, projects, ["borealis"]), true);
  assert.equal(milestoneShown(two, projects, ["atlas"]), true);
  // The visible set may arrive as a Set; the rule is the same either way.
  assert.equal(milestoneShown(linked, projects, new Set(["atlas"])), true);
});

test("a milestone linked to a project the plan no longer holds counts that link as gone", () => {
  const stale = { id: "launch", name: "Launch", date: "2026-12-01", colour: 1, projectIds: ["atlas", "deleted-project"] };
  // The deleted id never makes the milestone visible...
  assert.equal(milestoneShown(stale, projects, []), false);
  assert.equal(milestoneShown(Object.assign({}, stale, { projectIds: ["deleted-project"] }), projects, []), true);
  // ...and a milestone left with no resolvable link is plan-wide.
  assert.equal(milestoneShown(Object.assign({}, stale, { projectIds: ["deleted-project"] }), projects, ["atlas"]), true);
});

test("a milestone related to no project is plan-wide and always drawn", () => {
  const wide = { id: "wide", name: "Audit", date: "2026-12-01", colour: 2 };
  assert.equal(milestoneShown(wide, projects, []), true);
  assert.equal(milestoneShown(wide, projects, ["atlas"]), true);
  assert.equal(milestoneShown(Object.assign({}, wide, { projectIds: [] }), projects, []), true);
});

test("a mark is one per date, the first milestone naming it and the rest counted", () => {
  const plan = [
    { id: "launch", name: "Launch", date: "2026-12-01", colour: 2 },
    { id: "cutover", name: "Cutover", date: "2026-12-01", colour: 5 },
    { id: "dry-run", name: "Dry run", date: "2026-12-01", colour: 9 },
    { id: "audit", name: "Audit", date: "2026-11-20", colour: 7 }
  ];
  const marks = milestoneMarks(plan, projects, [], "2026-11-01", 40);
  // Date order, whatever order the plan holds them in.
  assert.deepEqual(marks.map((mark) => mark.date), ["2026-11-20", "2026-12-01"]);
  assert.deepEqual(marks.map((mark) => mark.i), [19, 30]);
  const shared = marks[1];
  assert.equal(shared.name, "Launch");
  assert.equal(shared.colour, 2);
  assert.equal(shared.count, 3);
  assert.equal(milestoneLabel(shared), "Launch" + LABEL_SEPARATOR + "1 Dec +2");
});

test("only the visible milestones inside the drawn period are marked", () => {
  const plan = [
    { id: "early", name: "Early", date: "2026-10-31", colour: 1 },
    { id: "first", name: "First", date: "2026-11-01", colour: 1 },
    { id: "linked", name: "Linked", date: "2026-11-05", colour: 1, projectIds: ["borealis"] },
    { id: "hidden", name: "Hidden", date: "2026-11-06", colour: 1, projectIds: ["atlas"] },
    { id: "last", name: "Last", date: "2026-11-10", colour: 1 },
    { id: "late", name: "Late", date: "2026-11-11", colour: 1 }
  ];
  const marks = milestoneMarks(plan, projects, ["borealis"], "2026-11-01", 10);
  // The day before the period, the day after it, and the milestone whose only
  // project the view left out are all absent; the period's own ends are in.
  assert.deepEqual(marks.map((mark) => mark.name), ["First", "Linked", "Last"]);
  assert.deepEqual(marks.map((mark) => mark.i), [0, 4, 9]);
});

test("a plan with no milestones, or no period, marks nothing", () => {
  assert.deepEqual(milestoneMarks(undefined, projects, [], "2026-11-01", 30), []);
  assert.deepEqual(milestoneMarks([], projects, [], "2026-11-01", 30), []);
  assert.deepEqual(milestoneMarks([{ id: "x", name: "X", date: "2026-11-02", colour: 1 }], projects, [], "", 30), []);
  // A malformed date is skipped rather than read as the day of the epoch.
  assert.deepEqual(milestoneMarks([{ id: "x", name: "X", date: "2 Nov", colour: 1 }], projects, [], "2026-11-01", 30), []);
});

/* --- the colour ---------------------------------------------------------- */

test("a mark's colour is the milestone's palette slot, read through the model", () => {
  assert.equal(milestoneSlot({ colour: 3 }), 3);
  assert.equal(milestoneSlot({ colour: 0 }), 0);
  // A legacy ink name migrates to its slot, as a Project's own colour does.
  assert.equal(milestoneSlot({ colour: "plum" }), 5);
  // Anything malformed reads as the palette's first slot rather than drawing
  // nothing, which is what a Project with no valid colour does.
  assert.equal(milestoneSlot({ colour: 42 }), 0);
  assert.equal(milestoneSlot({ colour: "neon" }), 0);
  assert.equal(milestoneSlot({}), 0);
  assert.equal(milestoneSlot(null), 0);
});

/* --- the axis label ------------------------------------------------------ */

test("a date is named by its day and month, the month band carrying the year", () => {
  assert.equal(milestoneDateLabel("2026-11-19"), "19 Nov");
  assert.equal(milestoneDateLabel("2027-01-01"), "1 Jan");
  assert.equal(milestoneDateLabel("2026-13-01"), "");
  assert.equal(milestoneDateLabel(undefined), "");
});

test("the label names the date once, and counts the rest only when others share it", () => {
  const one = { date: "2026-11-19", name: "Launch", count: 1 };
  assert.equal(milestoneLabel(one), "Launch" + LABEL_SEPARATOR + "19 Nov");
  assert.equal(milestoneLabel(Object.assign({}, one, { count: 2 })), "Launch" + LABEL_SEPARATOR + "19 Nov +1");
  assert.equal(milestoneLabel(Object.assign({}, one, { count: 3 })), "Launch" + LABEL_SEPARATOR + "19 Nov +2");
});

/* --- the axis's fit ------------------------------------------------------ */

// The room a slot has is geometry: it starts at its own date's column and ends
// where the next date's starts, so two labels can never overlap however long
// they are. A label wider than that room falls back to the bare tick.

const WIDE = [
  { date: "2026-11-01", i: 0, name: "Launch", colour: 0, count: 1 },
  { date: "2026-11-02", i: 1, name: "Cutover window", colour: 0, count: 1 },
  { date: "2026-11-20", i: 19, name: "Close", colour: 0, count: 1 }
];

// Six pixels a character: a label is measured, never guessed, so the test hands
// the rule its own measuring.
const widthOf = (text) => text.length * 6;

test("a crowded axis falls back to a tick rather than overlapping the next date", () => {
  // Month zoom, five pixels a day: the room a date has is the gap to the next
  // one, 5, 90 and 55 pixels against labels of 84, 132 and 84.
  const tight = milestoneAxisSlots(WIDE, { dayWidth: 5, dayCount: 30, widthOf });
  assert.deepEqual(tight.map((slot) => slot.room), [5, 90, 55]);
  assert.deepEqual(tight.map((slot) => slot.labelled), [false, false, false]);
  // Day zoom, forty pixels a day: the second date has room and the last has
  // the rest of the period; the first still has one day beside it.
  const roomy = milestoneAxisSlots(WIDE, { dayWidth: 40, dayCount: 30, widthOf });
  assert.deepEqual(roomy.map((slot) => slot.labelled), [false, true, true]);
});

test("the count is part of what has to fit", () => {
  const one = { date: "2026-11-01", i: 0, name: "Launch", colour: 0, count: 1 };
  // Ninety pixels of room: the name and date alone fit it, the count does not.
  const bare = milestoneAxisSlots([one], { dayWidth: 30, dayCount: 3, widthOf });
  const shared = milestoneAxisSlots([Object.assign({}, one, { count: 4 })],
    { dayWidth: 30, dayCount: 3, widthOf });
  assert.equal(bare[0].label, "Launch" + LABEL_SEPARATOR + "1 Nov");
  assert.equal(shared[0].label, "Launch" + LABEL_SEPARATOR + "1 Nov +3");
  assert.equal(bare[0].labelled, true);
  assert.equal(shared[0].labelled, false);
});

test("a slot with no measuring, or no room, is a tick rather than an error", () => {
  const marks = [{ date: "2026-11-01", i: 0, name: "Launch", colour: 0, count: 1 }];
  assert.equal(milestoneAxisSlots(marks, {}).every((slot) => slot.labelled === false), true);
  assert.equal(milestoneAxisSlots(marks, { dayWidth: 0, dayCount: 5, widthOf }).every((slot) => !slot.labelled), true);
  assert.equal(milestoneAxisSlots(marks, { dayWidth: 40, dayCount: NaN, widthOf }).every((slot) => !slot.labelled), true);
  // The last date of the period has one day of room and nothing beyond it.
  const last = milestoneAxisSlots([{ date: "2026-11-05", i: 4, name: "A", colour: 0, count: 1 }],
    { dayWidth: 40, dayCount: 5, widthOf });
  assert.equal(last[0].room, 40);
  assert.equal(last[0].labelled, false);
  // No marks at all is no slots, and a non-list is no marks.
  assert.deepEqual(milestoneAxisSlots([], { dayWidth: 40, dayCount: 5, widthOf }), []);
  assert.deepEqual(milestoneAxisSlots(null, { dayWidth: 40, dayCount: 5, widthOf }), []);
});

test("a widening day, or a shorter name, is what turns a tick back into a label", () => {
  const mark = { date: "2026-11-01", i: 0, name: "Launch", colour: 0, count: 1 };
  // Four days of room, and the name's own drawing decides the rest.
  const at = (dayWidth, name) => milestoneAxisSlots([Object.assign({}, mark, { name })],
    { dayWidth, dayCount: 4, widthOf })[0].labelled;
  assert.equal(at(5, "Launch"), false);
  assert.equal(at(16, "Launch"), false);
  assert.equal(at(16, "L"), true);
  assert.equal(at(40, "Launch"), true);
  assert.equal(at(40, "Launch and the cutover weekend"), false);
});

test("the inset the label starts at is taken off the room it has", () => {
  // One date with ninety pixels beside it and a label of eighty-four: it fits
  // while the label starts close to its own column, and stops fitting once the
  // inset eats the difference.
  const marks = [{ date: "2026-11-01", i: 0, name: "Launch", colour: 0, count: 1 }];
  const at = (inset) => milestoneAxisSlots(marks, { dayWidth: 30, dayCount: 3, inset, widthOf })[0];
  assert.equal(at(0).room, 90);
  assert.equal(at(0).labelled, true);
  assert.equal(at(4).room, 86);
  assert.equal(at(4).labelled, true);
  assert.equal(at(10).room, 80);
  assert.equal(at(10).labelled, false);
  // No inset at all reads as none, and a malformed one never widens the room.
  assert.equal(at(undefined).room, 90);
  assert.equal(at("wide").room, 90);
  assert.equal(at(-40).room, 90);
});
