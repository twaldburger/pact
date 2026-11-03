import test from "node:test";
import assert from "node:assert/strict";
import {
  planQuery,
  visiblePeople,
  visibleProjects,
  visibleAssignments,
  visiblePlan
} from "../public/lib/visibility.mjs";

/*
 * Every combination of archived Person, Project and Assignment, with the
 * toggle off and on. The plan below holds one record for each of the eight
 * combinations, named `person-LLL` ... `project-LLL` ... `assignment-LLL`,
 * where L is live and A is archived in Person-Project-Assignment order.
 */

const COMBOS = ["LLL", "LLA", "LAL", "LAA", "ALL", "ALA", "AAL", "AAA"];

function buildPlan() {
  const people = [];
  const projects = [];
  const assignments = [];
  // One Person per Person-state, one Project per Project-state, and then one
  // Assignment for every Person/Project/Assignment combination.
  people.push({ id: "person-L", archived: false });
  people.push({ id: "person-A", archived: true });
  projects.push({ id: "project-L", archived: false });
  projects.push({ id: "project-A", archived: true });
  COMBOS.forEach((combo) => {
    assignments.push({
      id: "assignment-" + combo,
      personId: combo[0] === "A" ? "person-A" : "person-L",
      projectId: combo[1] === "A" ? "project-A" : "project-L",
      archived: combo[2] === "A"
    });
  });
  return { people, projects, assignments };
}

test("the URL the client asks for carries the toggle state", () => {
  assert.equal(planQuery(false), "/api/plan");
  assert.equal(planQuery(true), "/api/plan?archived=1");
});

test("all eight archive combinations are drawn only when the toggle is on", () => {
  const plan = buildPlan();
  const off = visiblePlan(plan, false);
  const on = visiblePlan(plan, true);

  // Off: every record with an archived part anywhere in the chain is hidden,
  // so only the all-live Assignment survives, on its all-live Person/Project.
  assert.deepEqual(off.people.map((p) => p.id), ["person-L"]);
  assert.deepEqual(off.projects.map((p) => p.id), ["project-L"]);
  assert.deepEqual(off.assignments.map((a) => a.id), ["assignment-LLL"]);

  // On: every archived Person and Project comes back, and with them every
  // Assignment that is itself live or archived - all eight combinations.
  assert.deepEqual(on.people.map((p) => p.id), ["person-L", "person-A"]);
  assert.deepEqual(on.projects.map((p) => p.id), ["project-L", "project-A"]);
  assert.deepEqual(on.assignments.map((a) => a.id), COMBOS.map((c) => "assignment-" + c));
});

test("an Assignment follows its Person and Project, not just its own state", () => {
  const plan = buildPlan();
  // Off, a live Assignment on an archived Person or Project is not drawn.
  const off = visiblePlan(plan, false);
  ["assignment-ALL", "assignment-LAL"].forEach((id) => {
    assert.equal(off.assignments.some((a) => a.id === id), false, id + " should be hidden");
  });
  // On, it is drawn because the Person or Project it belongs to is.
  const on = visiblePlan(plan, true);
  ["assignment-ALL", "assignment-LAL"].forEach((id) => {
    assert.equal(on.assignments.some((a) => a.id === id), true, id + " should be shown");
  });
});

test("the list helpers agree with the whole-plan rule", () => {
  const plan = buildPlan();
  [false, true].forEach((showArchived) => {
    const whole = visiblePlan(plan, showArchived);
    const people = visiblePeople(plan, showArchived);
    const projects = visibleProjects(plan, showArchived);
    assert.deepEqual(people, whole.people);
    assert.deepEqual(projects, whole.projects);
    assert.deepEqual(
      visibleAssignments(plan, people, projects, showArchived),
      whole.assignments
    );
  });
});
