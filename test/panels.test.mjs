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
  archivedProjectRefusal
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
