import test from "node:test";
import assert from "node:assert/strict";
import {
  clampAvailability,
  stepAvailability,
  suggestPersonTags,
  suggestAssignmentTags,
  hasTag,
  withTag,
  withoutTag,
  archivedPersonRefusal,
  archivedProjectRefusal,
  dropRefusal,
  outsideRangeRefusal,
  rangeSettingRefusal,
  assignmentCount,
  deleteConfirmation,
  clampShare,
  SHARE_MIN,
  SHARE_MAX,
  stepShare,
  shareFromDrag
} from "../public/lib/panels.mjs";

test("stepping Availability stays inside 10..100 in whole steps", () => {
  assert.equal(stepAvailability(80, 1), 90);
  assert.equal(stepAvailability(80, -1), 70);
  assert.equal(stepAvailability(100, 1), 100);
  assert.equal(stepAvailability(10, -1), 10);
  // Any stray value is snapped to the nearest step before it moves.
  assert.equal(clampAvailability(55), 60);
  assert.equal(clampAvailability(0), 10);
  assert.equal(clampAvailability(1000), 100);
  assert.equal(clampAvailability(undefined), 10);
});

test("Person tags are suggested from other People only", () => {
  const people = [
    { id: "anna", tags: ["React", "lead"] },
    { id: "ben", tags: ["design", "React"] },
    { id: "cara", tags: ["Design", "qa"] }
  ];
  // Case-insensitive: React already sits on this Person, so it is not offered
  // back; the others are, first spelling winning, sorted.
  assert.deepEqual(suggestPersonTags(people, "anna"), ["design", "qa"]);
  assert.deepEqual(suggestPersonTags(people, "cara"), ["lead", "React"]);
  // A Person's own tags never appear, and nothing here is an Assignment tag.
  assert.equal(suggestPersonTags([{ id: "solo", tags: ["Atlas"] }], "solo").length, 0);
});

test("Assignment tags are suggested from that Project's other Assignments only", () => {
  const assignments = [
    { id: "a1", projectId: "atlas", tags: ["React", "shadow"] },
    { id: "a2", projectId: "atlas", tags: ["design", "React"] },
    { id: "a3", projectId: "borealis", tags: ["handover"] }
  ];
  // Same Project, other Assignments; this one's own tags are not offered back.
  assert.deepEqual(suggestAssignmentTags(assignments, "atlas", "a1"), ["design"]);
  assert.deepEqual(suggestAssignmentTags(assignments, "borealis", "a1"), ["handover"]);
  // Another Project's tags never leak in.
  assert.deepEqual(suggestAssignmentTags(assignments, "atlas", "a2"), ["shadow"]);
});

test("tags are added and removed case-insensitively", () => {
  assert.equal(hasTag(["React"], "react"), true);
  assert.equal(hasTag(["React"], "vue"), false);
  assert.deepEqual(withTag(["React"], "design"), ["React", "design"]);
  assert.deepEqual(withTag(["React"], "REACT"), ["React"]);
  assert.deepEqual(withTag(["React"], "   "), ["React"]);
  assert.deepEqual(withoutTag(["React", "design"], "react"), ["design"]);
});

test("a refused drop names the archived record and says why", () => {
  assert.equal(
    archivedPersonRefusal("Ben Falk"),
    "Ben Falk is archived. Restore this person before adding an assignment."
  );
  assert.equal(
    archivedProjectRefusal("Atlas"),
    "Atlas is archived. Restore this project before adding an assignment."
  );
});

test("an archived target is refused and a live one is not", () => {
  assert.equal(
    dropRefusal({ archived: true, name: "Ben Falk" }, { name: "Atlas" }),
    "Ben Falk is archived. Restore this person before adding an assignment."
  );
  assert.equal(
    dropRefusal({ name: "Anna Meier" }, { archived: true, name: "Atlas" }),
    "Atlas is archived. Restore this project before adding an assignment."
  );
  assert.equal(dropRefusal({ name: "Anna Meier" }, { name: "Atlas" }), null);
  assert.equal(dropRefusal(null, null), null);
});

test("work outside the plan's period is refused with the period named", () => {
  const range = { start: "2026-09-01", end: "2027-10-31" };
  // Both ends are inclusive, so work touching either one is inside.
  assert.equal(outsideRangeRefusal("2026-09-01", "2026-09-30", range), null);
  assert.equal(outsideRangeRefusal("2027-10-01", "2027-10-31", range), null);
  assert.equal(outsideRangeRefusal("2027-01-01", "2027-01-02", range), null);
  assert.match(
    outsideRangeRefusal("2026-08-31", "2026-09-10", range),
    /2026-09-01 to 2027-10-31 inclusive/
  );
  assert.match(
    outsideRangeRefusal("2026-09-01", "2027-11-01", range),
    /2026-09-01 to 2027-10-31 inclusive/
  );
  assert.match(
    outsideRangeRefusal("2027-11-01", "2027-11-02", range),
    /2026-09-01 to 2027-10-31 inclusive/
  );
  // With no period to test against there is nothing to refuse.
  assert.equal(outsideRangeRefusal("2000-01-01", "2000-01-02", null), null);
});

test("the period control refuses an invalid or reversed pair", () => {
  assert.equal(rangeSettingRefusal("2026-01-01", "2026-12-31"), null);
  assert.equal(rangeSettingRefusal("2026-06-15", "2026-06-15"), null);
  assert.match(rangeSettingRefusal("2026-13-01", "2026-12-31"), /valid YYYY-MM-DD/);
  assert.match(rangeSettingRefusal("", "2026-12-31"), /valid YYYY-MM-DD/);
  assert.match(rangeSettingRefusal("2026-02-30", "2026-03-01"), /valid YYYY-MM-DD/);
  assert.match(rangeSettingRefusal(null, undefined), /valid YYYY-MM-DD/);
  assert.match(rangeSettingRefusal("2026-12-31", "2026-01-01"), /must not be after/);
});

test("the deletion confirmation names the number first and says it cannot be undone", () => {
  assert.equal(
    deleteConfirmation("project", "Borealis", 6),
    "This deletes Borealis and the 6 assignments on it. It cannot be undone."
  );
  assert.equal(
    deleteConfirmation("person", "Ben Falk", 1),
    "This deletes Ben Falk and the 1 assignment on them. It cannot be undone."
  );
  assert.equal(
    deleteConfirmation("assignment", null, 1),
    "This deletes this assignment. It cannot be undone."
  );
});

test("a deletion counts every assignment, archived ones included", () => {
  const assignments = [
    { id: "a", personId: "p1", projectId: "x", archived: false },
    { id: "b", personId: "p1", projectId: "x", archived: true },
    { id: "c", personId: "p2", projectId: "x", archived: false }
  ];
  assert.equal(assignmentCount(assignments, "personId", "p1"), 2);
  assert.equal(assignmentCount(assignments, "personId", "p2"), 1);
  assert.equal(assignmentCount(assignments, "personId", "absent"), 0);
  assert.equal(assignmentCount(assignments, "projectId", "x"), 3);
});

test("stepping a Share moves exactly ten in each direction, inside 10..100", () => {
  assert.equal(stepShare(50, 1), 60);
  assert.equal(stepShare(50, -1), 40);
  assert.equal(stepShare(100, 1), 100);
  assert.equal(stepShare(10, -1), 10);
  assert.equal(SHARE_MIN, 10);
  assert.equal(SHARE_MAX, 100);
});

test("a stepped Share stores the same number a drag would", () => {
  // A drag from 40% three steps up settles on 70%; stepping up stores 70%.
  assert.equal(shareFromDrag(40, 3), 70);
  assert.equal(clampShare(70), 70);
  // Every reachable value is already a whole step, so a step and a drag onto
  // it pass through clampShare and cannot drift apart.
  for (let value = SHARE_MIN; value <= SHARE_MAX; value += 10) {
    assert.equal(clampShare(value), value);
    assert.equal(shareFromDrag(value, 0), value);
  }
  // A stray value snaps to the closest step, and the range is clamped.
  assert.equal(clampShare(37), 40);
  assert.equal(clampShare(34), 30);
  assert.equal(clampShare(0), 10);
  assert.equal(clampShare(1000), 100);
  // A drag that would run past either end stops at it, like the stepper does.
  assert.equal(shareFromDrag(90, 5), 100);
  assert.equal(shareFromDrag(20, -5), 10);
});
