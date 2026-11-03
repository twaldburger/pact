import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultScopes,
  scopeCount,
  scopeSummary,
  searchedAreas,
  matchesQuery,
  filterPlan,
  filterIsEmpty,
  personAssignedShare,
  filterSuggestions,
  countLabel
} from "../public/lib/filter.mjs";

/*
 * A plan with one person whose work spans two projects, a project match that
 * carries several assignments, an assignment tag and note, and one unrelated
 * person so the filter has something to hide.
 */
function plan() {
  return {
    people: [
      { id: "anna", name: "Anna Meier", tags: ["React", "lead"], note: "leads Atlas" },
      { id: "ben", name: "Ben Falk", tags: ["Design"], note: "contract through June" },
      { id: "cara", name: "Cara Nowak", tags: [], note: "led the React migration" },
      { id: "dora", name: "Dora Voss", tags: [], note: "" }
    ],
    projects: [
      { id: "react", name: "React rewrite", notes: "phase two" },
      { id: "borealis", name: "Borealis", notes: "" }
    ],
    assignments: [
      { id: "a-react-anna", projectId: "react", personId: "anna", start: "2026-10-01", end: "2026-10-10", share: 60, tags: ["React"], note: "" },
      { id: "a-bor-anna", projectId: "borealis", personId: "anna", start: "2026-11-01", end: "2026-11-10", share: 20, tags: [], note: "" },
      { id: "a-bor-ben", projectId: "borealis", personId: "ben", start: "2026-10-01", end: "2026-10-05", share: 50, tags: ["Design"], note: "handover from Atlas" },
      { id: "a-react-cara", projectId: "react", personId: "cara", start: "2026-10-20", end: "2026-10-30", share: 40, tags: ["React"], note: "React migration" },
      { id: "a-other-dora", projectId: "borealis", personId: "dora", start: "2026-12-01", end: "2026-12-10", share: 30, tags: ["Support"], note: "" }
    ]
  };
}

function scopes(people, projects, assignments) {
  return { people: people, projects: projects, assignments: assignments };
}

function ids(list) {
  return list.map((item) => item.id);
}

test("matching is a case-insensitive substring anywhere in the text", () => {
  assert.equal(matchesQuery("React rewrite", "rea"), true);
  assert.equal(matchesQuery("React rewrite", "REA"), true);
  assert.equal(matchesQuery("React rewrite", "act rew"), true);
  // `re` sits inside Borealis, so whole words are never required.
  assert.equal(matchesQuery("Borealis", "re"), true);
  assert.equal(matchesQuery("React rewrite", "zzz"), false);
  // An empty query matches everything, so an empty filter is no filter.
  assert.equal(matchesQuery("anything", ""), true);
  assert.equal(matchesQuery("anything", "   "), true);
});

test("a matching Project appears in the Stack with all of its Assignments", () => {
  // Projects only: the other areas are off, so only the project name matches.
  const view = filterPlan(plan(), "react rewrite", scopes(false, true, false));
  assert.deepEqual(ids(view.projects), ["react"]);
  assert.deepEqual(ids(view.assignments), ["a-react-anna", "a-react-cara"]);
  // An Assignment has to have a row, so the project's people come with it.
  assert.deepEqual(ids(view.people), ["anna", "cara"]);
});

test("a matching Person appears with all of their work", () => {
  // People only: matching Anna by name carries both of her assignments, which
  // in turn bring the two projects they sit on.
  const view = filterPlan(plan(), "anna", scopes(true, false, false));
  assert.deepEqual(ids(view.people), ["anna"]);
  assert.deepEqual(ids(view.assignments), ["a-react-anna", "a-bor-anna"]);
  assert.deepEqual(ids(view.projects), ["react", "borealis"]);
});

test("a matching Assignment brings its Person's row and its Project", () => {
  // Assignments only: the note matches, and only that one block survives.
  const view = filterPlan(plan(), "handover", scopes(false, false, true));
  assert.deepEqual(ids(view.assignments), ["a-bor-ben"]);
  assert.deepEqual(ids(view.people), ["ben"]);
  assert.deepEqual(ids(view.projects), ["borealis"]);
});

test("a hidden person's row, project and blocks leave the grid", () => {
  const view = filterPlan(plan(), "support", scopes(false, false, true));
  assert.deepEqual(ids(view.people), ["dora"]);
  assert.deepEqual(ids(view.projects), ["borealis"]);
  assert.deepEqual(ids(view.assignments), ["a-other-dora"]);
  assert.equal(view.people.some((p) => p.id === "anna"), false);
});

test("a person's row-header figure is read from the whole plan", () => {
  const whole = plan();
  // The filter keeps only Borealis, so Anna's React assignment is hidden.
  const view = filterPlan(whole, "borealis", defaultScopes());
  assert.equal(view.assignments.some((a) => a.id === "a-react-anna"), false);
  // The figure on a React day still counts the whole plan, not the filter.
  assert.equal(personAssignedShare(whole, "anna", "2026-10-05"), 0.6);
  assert.equal(personAssignedShare(whole, "anna", "2026-11-05"), 0.2);
  // And the empty query changes nothing at all.
  assert.equal(personAssignedShare(whole, "anna", "2026-10-05"), 0.6);
});

test("the whole plan is never changed by filtering", () => {
  const whole = plan();
  const before = JSON.stringify(whole);
  filterPlan(whole, "react", defaultScopes());
  filterSuggestions(whole, "react", defaultScopes());
  assert.equal(JSON.stringify(whole), before);
});

test("an empty result is empty for all three things", () => {
  const view = filterPlan(plan(), "zzz", defaultScopes());
  assert.equal(filterIsEmpty(view), true);
  assert.deepEqual(ids(view.people), []);
  assert.deepEqual(ids(view.projects), []);
  assert.deepEqual(ids(view.assignments), []);
});

test("the scope control states how many areas are looked in", () => {
  assert.equal(scopeCount(defaultScopes()), 3);
  assert.equal(scopeSummary(defaultScopes()), "all 3");
  assert.equal(scopeSummary(scopes(true, false, true)), "2 of 3");
  assert.equal(scopeSummary(scopes(false, false, false)), "none");
  // The empty state names the areas that were actually searched.
  assert.equal(searchedAreas(defaultScopes()), "people, projects or assignments");
  assert.equal(searchedAreas(scopes(true, true, false)), "people or projects");
  assert.equal(searchedAreas(scopes(false, true, false)), "projects");
  assert.equal(searchedAreas(scopes(false, false, false)), "no areas");
});

test("suggestions name their source and how much they would match", () => {
  const found = filterSuggestions(plan(), "react", defaultScopes());
  const byKey = {};
  found.forEach((item) => { byKey[item.source + ":" + item.value] = item; });

  const project = byKey["Project:React rewrite"];
  assert.equal(project.count, 2);
  assert.equal(project.matchLabel, "2 assignments");

  const assignmentTag = byKey["Assignment tag:React"];
  assert.equal(assignmentTag.count, 2);
  assert.equal(assignmentTag.matchLabel, "2 assignments");

  const personTag = byKey["Person tag:React"];
  assert.equal(personTag.count, 1);
  assert.equal(personTag.matchLabel, "1 person");

  const personNote = byKey["Person note:led the React migration"];
  assert.equal(personNote.count, 1);
  assert.equal(personNote.matchLabel, "1 person");

  const assignmentNote = byKey["Assignment note:React migration"];
  assert.equal(assignmentNote.count, 1);
  assert.equal(assignmentNote.matchLabel, "1 assignment");

  // A project's own note is offered as its own source too.
  const projectNote = filterSuggestions(plan(), "phase", defaultScopes())
    .find((item) => item.source === "Project note");
  assert.equal(projectNote.value, "phase two");
  assert.equal(projectNote.matchLabel, "1 project");
});

test("prefix matches come first, then the bigger match, then the name", () => {
  const found = filterSuggestions(plan(), "re", defaultScopes());
  const order = found.map((item) => item.source + ":" + item.value);
  assert.deepEqual(order, [
    "Assignment tag:React",
    "Project:React rewrite",
    "Person tag:React",
    "Assignment note:React migration",
    "Project:Borealis",
    "Person note:led the React migration"
  ]);
  // Everything but the last two starts with the typed text; Borealis merely
  // contains it, so the prefix group comes first.
  assert.deepEqual(found.map((item) => item.prefix), [true, true, true, true, false, false]);
});

test("a suggestion is offered only when the text appears anywhere in it", () => {
  const found = filterSuggestions(plan(), "migr", defaultScopes());
  const values = found.map((item) => item.value);
  assert.equal(values.includes("led the React migration"), true);
  assert.equal(values.includes("React migration"), true);
  assert.equal(filterSuggestions(plan(), "xyz", defaultScopes()).length, 0);
  // No text, no suggestions.
  assert.equal(filterSuggestions(plan(), "", defaultScopes()).length, 0);
});

test("suggestions only come from the areas being looked in", () => {
  const found = filterSuggestions(plan(), "react", scopes(false, false, true));
  assert.equal(found.length > 0, true);
  found.forEach((item) => {
    assert.equal(item.source === "Assignment tag" || item.source === "Assignment note", true);
  });
});

test("a match count is worded for the thing it counts", () => {
  assert.equal(countLabel(1, "person"), "1 person");
  assert.equal(countLabel(2, "person"), "2 people");
  assert.equal(countLabel(1, "assignment"), "1 assignment");
  assert.equal(countLabel(4, "assignment"), "4 assignments");
  assert.equal(countLabel(1, "project"), "1 project");
  assert.equal(countLabel(3, "project"), "3 projects");
});
