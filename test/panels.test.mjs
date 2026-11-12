import test from "node:test";
import assert from "node:assert/strict";
import {
  clampAvailability,
  stepAvailability,
  suggestPersonTags,
  suggestProjectTags,
  suggestPersonLocations,
  suggestAssignmentTags,
  sortTags,
  hasTag,
  withTag,
  withoutTag,
  archivedPersonRefusal,
  archivedProjectRefusal,
  dropRefusal,
  outsideRangeRefusal,
  rangeSettingRefusal,
  DEFAULT_STEP,
  STEP_MIN,
  STEP_MAX,
  normalizeStep,
  stepSettingRefusal,
  clampShare,
  stepShare,
  shareFromDrag
} from "../public/lib/panels.mjs";

test("an absent step defaults to 10 and only 1..100 is a step", () => {
  assert.equal(DEFAULT_STEP, 10);
  assert.equal(STEP_MIN, 1);
  assert.equal(STEP_MAX, 100);
  assert.equal(normalizeStep(undefined), 10);
  assert.equal(normalizeStep(null), 10);
  assert.equal(normalizeStep(0), 10);
  assert.equal(normalizeStep(101), 10);
  assert.equal(normalizeStep(5.5), 10);
  assert.equal(normalizeStep("5"), 10);
  assert.equal(normalizeStep(1), 1);
  assert.equal(normalizeStep(5), 5);
  assert.equal(normalizeStep(100), 100);
  assert.equal(stepSettingRefusal(5), null);
  assert.equal(stepSettingRefusal(1), null);
  assert.equal(stepSettingRefusal(100), null);
  assert.match(stepSettingRefusal(0), /whole number from 1 to 100/);
  assert.match(stepSettingRefusal(101), /whole number from 1 to 100/);
  assert.match(stepSettingRefusal(5.5), /whole number from 1 to 100/);
  assert.match(stepSettingRefusal(undefined), /whole number from 1 to 100/);
});

test("stepping Availability stays inside one step..100 in the plan's step", () => {
  // The default 10 is exactly today's behaviour.
  assert.equal(stepAvailability(80, 1, 10), 90);
  assert.equal(stepAvailability(80, -1, 10), 70);
  assert.equal(stepAvailability(100, 1, 10), 100);
  assert.equal(stepAvailability(10, -1, 10), 10);
  // A step of 5 moves in fives and floors at 5.
  assert.equal(stepAvailability(80, 1, 5), 85);
  assert.equal(stepAvailability(80, -1, 5), 75);
  assert.equal(stepAvailability(100, 1, 5), 100);
  assert.equal(stepAvailability(5, -1, 5), 5);
  assert.equal(clampAvailability(52, 5), 50);
  assert.equal(clampAvailability(53, 5), 55);
  assert.equal(clampAvailability(1, 5), 5);
  // A step of 1 reaches every whole percent and floors at 1.
  assert.equal(stepAvailability(50, 1, 1), 51);
  assert.equal(clampAvailability(1, 1), 1);
  assert.equal(clampAvailability(0, 1), 1);
  assert.equal(clampAvailability(99.4, 1), 99);
  // The ceiling stays 100 whatever the step, and an absent step reads as 10.
  assert.equal(clampAvailability(1000, 7), 100);
  assert.equal(clampAvailability(55), 60);
  assert.equal(clampAvailability(0), 10);
  assert.equal(clampAvailability(undefined), 10);
  assert.equal(stepAvailability(80, 1), 90);
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

test("Project tags are suggested from other Projects only", () => {
  const projects = [
    { id: "atlas", tags: ["Platform", "lead"] },
    { id: "borealis", tags: ["delivery", "Platform"] },
    { id: "summit", tags: ["Delivery", "ops"] }
  ];
  // Case-insensitive: Platform already sits on this Project, so it is not
  // offered back; the others are, first spelling winning, sorted.
  assert.deepEqual(suggestProjectTags(projects, "atlas"), ["delivery", "ops"]);
  assert.deepEqual(suggestProjectTags(projects, "summit"), ["lead", "Platform"]);
  // A new Project is offered every tag in the plan.
  assert.deepEqual(suggestProjectTags(projects, null), ["delivery", "lead", "ops", "Platform"]);
  // A Project's own tags never appear, and Person or Assignment tags are never
  // part of this vocabulary.
  assert.equal(suggestProjectTags([{ id: "solo", tags: ["Atlas"] }], "solo").length, 0);
});

test("Locations are suggested from other People only, one per Person", () => {
  const people = [
    { id: "anna", location: "Switzerland" },
    { id: "ben", location: "switzerland" },
    { id: "cara", location: "Portugal" },
    { id: "dora", location: "" },
    { id: "emil" }
  ];
  // Each Person has one Location, and blanks and missing values offer nothing.
  // Switzerland is already this Person's place, so it is not offered back,
  // even where another Person spells it differently.
  assert.deepEqual(suggestPersonLocations(people, "anna"), ["Portugal"]);
  assert.deepEqual(suggestPersonLocations(people, "cara"), ["Switzerland"]);
  // A Person's own Location is never offered back to them.
  assert.deepEqual(suggestPersonLocations([{ id: "solo", location: "Switzerland" }], "solo"), []);
  // A new Person is offered every Location in the plan.
  assert.deepEqual(suggestPersonLocations(people, null), ["Portugal", "Switzerland"]);
});

test("the Locations the holidays configure join the Person suggestions", () => {
  const people = [
    { id: "anna", location: "Switzerland" },
    { id: "cara", location: "Portugal" }
  ];
  // A configured Location nobody uses is offered; one already in use on
  // another Person is not duplicated, whichever spelling comes first.
  assert.deepEqual(suggestPersonLocations(people, "anna", ["Portugal", "Spain"]),
    ["Portugal", "Spain"]);
  // The current Person's own Location is excluded, as it is for People's own
  // Locations; a configured one is still offered.
  assert.deepEqual(suggestPersonLocations(people, "cara", ["Portugal", "Spain"]),
    ["Spain", "Switzerland"]);
  // No configured Locations leaves the list exactly as it was.
  assert.deepEqual(suggestPersonLocations(people, "anna", []), ["Portugal"]);
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
  // A new tag lands in alphabetical position, case-insensitively, so the
  // stored array is always A-Z.
  assert.deepEqual(withTag(["React"], "design"), ["design", "React"]);
  assert.deepEqual(withTag(["React"], "REACT"), ["React"]);
  assert.deepEqual(withTag(["React"], "   "), ["React"]);
  assert.deepEqual(withoutTag(["React", "design"], "react"), ["design"]);
});

test("sortTags orders case-insensitively without changing a spelling", () => {
  assert.deepEqual(sortTags(["React", "design", "lead"]), ["design", "lead", "React"]);
  assert.deepEqual(sortTags(["b", "B", "a"]).length, 3);
  assert.deepEqual(sortTags([]), []);
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

test("stepping a Share moves by the plan's step, inside one step..100", () => {
  assert.equal(stepShare(50, 1, 10), 60);
  assert.equal(stepShare(50, -1, 10), 40);
  assert.equal(stepShare(100, 1, 10), 100);
  assert.equal(stepShare(10, -1, 10), 10);
  // A step of 5 moves in fives and floors at 5; a step of 1 floors at 1.
  assert.equal(stepShare(50, 1, 5), 55);
  assert.equal(stepShare(5, -1, 5), 5);
  assert.equal(stepShare(50, 1, 1), 51);
  assert.equal(stepShare(1, -1, 1), 1);
});

test("a stepped Share stores the same number a drag would", () => {
  // A drag from 40% three steps up settles on 70%; stepping up stores 70%.
  assert.equal(shareFromDrag(40, 3, 10), 70);
  assert.equal(clampShare(70, 10), 70);
  // At a step of 5 a drag of two steps settles on 50% and the floor is 5%.
  assert.equal(shareFromDrag(40, 2, 5), 50);
  assert.equal(shareFromDrag(5, -3, 5), 5);
  // Every reachable value is already a whole step, so a step and a drag onto
  // it pass through clampShare and cannot drift apart.
  for (let value = 10; value <= 100; value += 10) {
    assert.equal(clampShare(value, 10), value);
    assert.equal(shareFromDrag(value, 0, 10), value);
  }
  // A stray value snaps to the closest step, and the range is clamped.
  assert.equal(clampShare(37, 10), 40);
  assert.equal(clampShare(34, 10), 30);
  assert.equal(clampShare(0, 10), 10);
  assert.equal(clampShare(1000, 10), 100);
  assert.equal(clampShare(0, 1), 1);
  // A drag that would run past either end stops at it, like the stepper does.
  assert.equal(shareFromDrag(90, 5, 10), 100);
  assert.equal(shareFromDrag(20, -5, 10), 10);
});
