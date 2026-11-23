import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultScopes,
  scopeCount,
  scopeLabel,
  scopeSummary,
  searchedAreas,
  matchesQuery,
  filterPlan,
  filterIsEmpty,
  personAssignedShare,
  filterSuggestions,
  searchEverywhereSuggestion,
  viewResultCount,
  countLabel,
  parseFilterTerm,
  fieldLabel,
  unknownFieldHint
} from "../public/lib/filter.mjs";
import { milestoneMarks } from "../public/lib/milestones.mjs";

/*
 * A plan with one person whose work spans two projects, a project match that
 * carries several assignments, an assignment tag and note, and one unrelated
 * person so the filter has something to hide.
 */
function plan() {
  return {
    people: [
      { id: "anna", name: "Anna Meier", location: "Switzerland", tags: ["React", "lead"], note: "leads Atlas" },
      { id: "ben", name: "Ben Falk", location: "Switzerland", tags: ["Design"], note: "contract through June" },
      { id: "cara", name: "Cara Nowak", location: "Netherlands", tags: [], note: "led the React migration" },
      { id: "dora", name: "Dora Voss", location: "", tags: [], note: "" }
    ],
    projects: [
      { id: "react", name: "React rewrite", notes: "phase two", tags: ["lead"] },
      { id: "borealis", name: "Borealis", notes: "", tags: [] }
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

/*
 * A plan whose tags collide by substring: `Data` is a substring of
 * `Data-Quality` and of `Databases`, so exact-tag counts and the matcher's
 * case-insensitive substring counts disagree wherever they are used.
 */
function collidingTagPlan() {
  return {
    people: [
      { id: "p1", name: "Ann Reed", location: "", tags: ["Data", "Design"], note: "" },
      { id: "p2", name: "Bo Frost", location: "", tags: ["Databases"], note: "" }
    ],
    projects: [
      { id: "pr1", name: "Alpha", notes: "", tags: ["Data"] },
      { id: "pr2", name: "Beta", notes: "", tags: [] }
    ],
    assignments: [
      { id: "as1", projectId: "pr1", personId: "p1", start: "", end: "", share: 10, tags: ["Data"], note: "" },
      { id: "as2", projectId: "pr2", personId: "p2", start: "", end: "", share: 10, tags: ["Data-Quality"], note: "" },
      { id: "as3", projectId: "pr2", personId: "p1", start: "", end: "", share: 10, tags: ["Databases"], note: "" }
    ]
  };
}

/*
 * A plan whose tags collide the way typed tags do: the bare `DevOps`, the
 * fully typed `skill:DevOps`, and `skill:DevOps-2` - each a substring of the
 * next, so a substring rule cannot tell them apart. Every tag kind carries the
 * same three spellings, so the one tag rule can be read on all four. Each
 * Person has one Assignment on one Project, so a tag match can be followed to
 * what it carries.
 */
function typedTagPlan() {
  return {
    people: [
      { id: "p-dev", name: "Dev One", location: "", tags: ["DevOps"], note: "" },
      { id: "p-skill", name: "Skill Two", location: "", tags: ["Skill:DevOps"], note: "" },
      { id: "p-skill2", name: "Skill Three", location: "", tags: ["skill:DevOps-2"], note: "" },
      { id: "p-api", name: "Api Four", location: "", tags: ["api:Stellar"], note: "" }
    ],
    projects: [
      { id: "pr-dev", name: "Alpha", notes: "", tags: ["DevOps"] },
      { id: "pr-skill", name: "Beta", notes: "", tags: ["Skill:DevOps"] },
      { id: "pr-skill2", name: "Gamma", notes: "", tags: ["skill:DevOps-2"] },
      { id: "pr-api", name: "Delta", notes: "", tags: ["api:Stellar"] }
    ],
    assignments: [
      { id: "a-dev", projectId: "pr-dev", personId: "p-dev", start: "", end: "", share: 10, tags: ["DevOps"], note: "" },
      { id: "a-skill", projectId: "pr-skill", personId: "p-skill", start: "", end: "", share: 10, tags: ["Skill:DevOps"], note: "" },
      { id: "a-skill2", projectId: "pr-skill2", personId: "p-skill2", start: "", end: "", share: 10, tags: ["skill:DevOps-2"], note: "" },
      { id: "a-api", projectId: "pr-api", personId: "p-api", start: "", end: "", share: 10, tags: ["api:Stellar"], note: "" }
    ],
    milestones: [
      { id: "m-dev", name: "Bare", date: "2026-10-01", colour: 1, tags: ["DevOps"], notes: "", projectIds: [] },
      { id: "m-skill", name: "Typed", date: "2026-10-02", colour: 2, tags: ["Skill:DevOps"], notes: "", projectIds: [] },
      { id: "m-skill2", name: "Typed twice", date: "2026-10-03", colour: 3, tags: ["skill:DevOps-2"], notes: "", projectIds: [] },
      { id: "m-api", name: "Typed api", date: "2026-10-04", colour: 4, tags: ["api:Stellar"], notes: "", projectIds: [] }
    ]
  };
}

const VIEW_BY_UNIT = { person: "people", project: "projects", assignment: "assignments" };

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

test("the row-header figure counts no non-working day", () => {
  const whole = plan();
  // Anna is busy across the weekend of 2026-10-03/04, but a Saturday carries
  // no load, so only the Monday reads 60%.
  assert.equal(personAssignedShare(whole, "anna", "2026-10-03"), 0);
  assert.equal(personAssignedShare(whole, "anna", "2026-10-04"), 0);
  assert.equal(personAssignedShare(whole, "anna", "2026-10-05"), 0.6);
  // A holiday on the Monday takes that day out too.
  whole.holidays = [{ location: "Switzerland", dates: [{ date: "2026-10-05", kind: "full" }] }];
  assert.equal(personAssignedShare(whole, "anna", "2026-10-05"), 0);
  assert.equal(personAssignedShare(whole, "anna", "2026-10-06"), 0.6);
});

test("an absence reduces capacity without adding to the assigned figure", () => {
  const whole = plan();
  whole.projects.push({ id: "holiday", name: "Holiday", absence: true });
  // Anna's React work is 60% through 2026-10-10. A 50% absence beside it
  // takes half of each day off but adds nothing to what she is allocated.
  whole.assignments.push({
    id: "a-hol-anna", projectId: "holiday", personId: "anna",
    start: "2026-10-01", end: "2026-10-10", share: 50, tags: ["Holiday"], note: ""
  });
  assert.equal(personAssignedShare(whole, "anna", "2026-10-05"), 0.6);
  // A full absence makes the day non-working, so it carries no load at all.
  whole.assignments[whole.assignments.length - 1].share = 100;
  assert.equal(personAssignedShare(whole, "anna", "2026-10-05"), 0);
  assert.equal(personAssignedShare(whole, "anna", "2026-10-06"), 0);
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
  assert.equal(scopeLabel(defaultScopes()), "in 3 areas");
  assert.equal(scopeLabel(scopes(true, false, true)), "in 2 areas");
  assert.equal(scopeLabel(scopes(false, true, false)), "in 1 area");
  assert.equal(scopeLabel(scopes(false, false, false)), "in no areas");
  // The full selection stays on the accessible label.
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

test("the dropdown leads with Search everywhere for an untyped query", () => {
  const row = searchEverywhereSuggestion(plan(), "react", defaultScopes());
  assert.equal(row.kind, "everywhere");
  assert.equal(row.source, "Search everywhere");
  assert.equal(row.value, "react");
  assert.equal(row.unit, "match");
  assert.equal(row.matchLabel, "7 matches");
  // Its number is what the broad search returns: every Person, Project and
  // Assignment the view leaves, so a broad result's row cannot undercount it.
  const view = filterPlan(plan(), "react", defaultScopes());
  assert.equal(row.count, viewResultCount(view));
  assert.equal(row.count, view.people.length + view.projects.length + view.assignments.length);
  // It inserts the term unchanged, so picking it leaves the broad search.
  assert.equal(row.insert, "react");
  assert.deepEqual(filterPlan(plan(), row.insert, defaultScopes()), view);
});

test("the Search everywhere count follows the scope and the term's own result", () => {
  const row = searchEverywhereSuggestion(plan(), "react", scopes(false, false, true));
  const view = filterPlan(plan(), "react", scopes(false, false, true));
  assert.equal(row.count, viewResultCount(view));
  assert.equal(row.count, 5);
  // Only Assignments are looked in, so only the two React assignments match.
  assert.equal(view.assignments.length, 2);
  // One match is worded for the thing that matched.
  assert.equal(searchEverywhereSuggestion(plan(), "handover", defaultScopes()).matchLabel, "3 matches");
});

const EVERYWHERE_NONE = [
  ["a typed term", "person tag: react", defaultScopes()],
  ["an empty term", "", defaultScopes()],
  ["a term that matches nothing", "zzz", defaultScopes()],
  ["a scope with nothing to look in", "react", scopes(false, false, false)]
];

EVERYWHERE_NONE.forEach(([what, query, s]) => {
  test("there is no Search everywhere row for " + what, () => {
    assert.equal(searchEverywhereSuggestion(plan(), query, s), null);
  });
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

test("every plain suggestion inserts the field-qualified term it counted", () => {
  const found = filterSuggestions(plan(), "react", defaultScopes()).filter((item) => item.kind !== "prefix");
  const bySource = {};
  found.forEach((item) => { bySource[item.source] = item; });
  // A plain tag row aims the term at the tag field rather than inserting the
  // bare value, so selecting it filters by that tag.
  assert.equal(bySource["Person tag"].insert, "person tag: React");
  assert.equal(bySource["Assignment tag"].insert, "assignment tag: React");
  // Every other plain kind carries its own field-qualified term too.
  assert.equal(bySource["Project"].insert, "project: React rewrite");
  assert.equal(bySource["Person note"].insert, "person note: led the React migration");
  assert.equal(bySource["Assignment note"].insert, "assignment note: React migration");
  // And each count comes from exactly the query selecting it runs.
  found.forEach((item) => {
    const view = filterPlan(plan(), item.insert, defaultScopes());
    assert.equal(item.count, view[VIEW_BY_UNIT[item.unit]].length, item.source + ":" + item.value);
  });
});

test("a plain tag row counts the projects its own term would draw", () => {
  const row = filterSuggestions(plan(), "lead", defaultScopes())
    .find((item) => item.source === "Project tag");
  assert.equal(row.insert, "project tag: lead");
  assert.equal(row.matchLabel, "1 project");
  assert.equal(filterPlan(plan(), row.insert, defaultScopes()).projects.length, 1);
});

test("a tag suggestion's count uses the matcher's substring rule, not exact equality", () => {
  const p = collidingTagPlan();
  const assignment = filterSuggestions(p, "assignment tag: Data", defaultScopes())
    .find((item) => item.value === "Data");
  // Substring matches Data, Data-Quality and Databases; exact equality would
  // say 1.
  assert.equal(assignment.count, 3);
  assert.equal(assignment.matchLabel, "3 assignments");
  assert.equal(filterPlan(p, assignment.insert, defaultScopes()).assignments.length, 3);

  const person = filterSuggestions(p, "person tag: Data", defaultScopes())
    .find((item) => item.source === "Person tag" && item.value === "Data");
  assert.equal(person.count, 2);
  assert.equal(filterPlan(p, person.insert, defaultScopes()).people.length, 2);

  const project = filterSuggestions(p, "project tag: Data", defaultScopes())
    .find((item) => item.value === "Data");
  assert.equal(project.count, 1);
});

/* --- a typed tag ------------------------------------------------------------ */

test("a value that carries its own kind matches a tag by prefix", () => {
  const p = typedTagPlan();
  // A reader types a typed tag one character at a time, so the value is the
  // tag's start and every tag carrying that start answers. All four tag fields
  // read the one rule.
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:D", defaultScopes()).people), ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "project tag: skill:D", defaultScopes()).projects), ["pr-skill", "pr-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "assignment tag: skill:D", defaultScopes()).assignments), ["a-skill", "a-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "milestone tag: skill:D", defaultScopes()).milestones), ["m-skill", "m-skill2"]);
  // Typing further narrows: the numbered neighbour alone once its own hyphen
  // is typed.
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:DevOps-", defaultScopes()).people), ["p-skill2"]);
  // Another typed value picks its own tag, and only that one.
  assert.deepEqual(ids(filterPlan(p, "person tag: api:Stellar", defaultScopes()).people), ["p-api"]);
  assert.deepEqual(ids(filterPlan(p, "milestone tag: api:Stellar", defaultScopes()).milestones), ["m-api"]);
  // A typed value that no tag starts with matches nothing rather than every
  // tag it shares letters with.
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:Ops", defaultScopes()).people), []);
});

test("a typed tag is read case-insensitively, both ways round", () => {
  const p = typedTagPlan();
  // The stored tag is `Skill:DevOps`: a lower-case term and an upper-case one
  // are the same request.
  ["skill:dev", "SKILL:DE", "Skill:Dev"].forEach((value) => {
    assert.deepEqual(ids(filterPlan(p, "person tag: " + value, defaultScopes()).people),
      ["p-skill", "p-skill2"], value);
    assert.deepEqual(ids(filterPlan(p, "milestone tag: " + value, defaultScopes()).milestones),
      ["m-skill", "m-skill2"], value);
  });
});

test("a typed tag is matched from its start, with the value trimmed", () => {
  const p = typedTagPlan();
  // The text either side of the value is the Filter's own spacing, trimmed as
  // any typed term is; the tag is then read from its first letter.
  assert.deepEqual(ids(filterPlan(p, "person tag:    skill:Dev   ", defaultScopes()).people),
    ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "person tags: skill:Dev", defaultScopes()).people),
    ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "project tag:  skill:devops ", defaultScopes()).projects),
    ["pr-skill", "pr-skill2"]);
});

test("a typed tag match still carries what belongs to it", () => {
  const view = filterPlan(typedTagPlan(), "assignment tag: skill:D", defaultScopes());
  // The matching Assignments survive, and bring their People's rows and their
  // Projects exactly as any other match does.
  assert.deepEqual(ids(view.assignments), ["a-skill", "a-skill2"]);
  assert.deepEqual(ids(view.people), ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(view.projects), ["pr-skill", "pr-skill2"]);
  // The bare `DevOps` neighbour is still spared, which is what the colon asks.
  assert.equal(ids(view.people).includes("p-dev"), false);
  assert.equal(ids(view.projects).includes("pr-dev"), false);
  assert.equal(ids(view.assignments).includes("a-dev"), false);
});

test("a plain tag value keeps the loose substring rule", () => {
  const p = typedTagPlan();
  // Every tag containing the letters, typed or not: the bare one, the fully
  // typed one and its numbered neighbour.
  assert.deepEqual(ids(filterPlan(p, "person tag: devops", defaultScopes()).people),
    ["p-dev", "p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "person tag: DEVOPS", defaultScopes()).people),
    ["p-dev", "p-skill", "p-skill2"]);
  // A bare kind finds every tag that carries it.
  assert.deepEqual(ids(filterPlan(p, "person tag: api", defaultScopes()).people), ["p-api"]);
  assert.deepEqual(ids(filterPlan(p, "assignment tag: devops", defaultScopes()).assignments),
    ["a-dev", "a-skill", "a-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "project tag: devops", defaultScopes()).projects),
    ["pr-dev", "pr-skill", "pr-skill2"]);
});

test("the colon is the whole signal, wherever the value reaches a tag", () => {
  // The Filter cannot know a plan's tag kinds, so it never asks whether the
  // text before the colon names one: any colon in the value means the whole
  // tag. There is one tag rule, so a plain query that keeps its colon - `v1:2`
  // is not a field prefix - is read the same way.
  const p = {
    people: [
      { id: "a", name: "Ann", location: "", tags: ["v1:2"], note: "" },
      { id: "b", name: "Bo", location: "", tags: ["v1:2-beta"], note: "" }
    ],
    projects: [],
    assignments: []
  };
  // `v1:2` is a prefix, so it leaves the tags that start with it - a narrowing
  // rather than an equal tag - and the numbered neighbour comes with it.
  assert.deepEqual(ids(filterPlan(p, "v1:2", defaultScopes()).people), ["a", "b"]);
  assert.deepEqual(ids(filterPlan(p, "v1:2-", defaultScopes()).people), ["b"]);
  // Anything without a colon is still a substring, typed or plain.
  assert.deepEqual(ids(filterPlan(typedTagPlan(), "devops", defaultScopes()).people),
    ["p-dev", "p-skill", "p-skill2"]);
});

test("a tag suggestion's count agrees with the prefix rule it inserts", () => {
  const p = typedTagPlan();
  // `skill` still offers both typed tags - the dropdown's own narrowing is the
  // loose rule - and each row's count is read from the term it inserts, so a
  // row promising two leaves two.
  const rows = filterSuggestions(p, "person tag: skill", defaultScopes());
  const byValue = {};
  rows.forEach((item) => { byValue[item.value] = item; });
  assert.equal(byValue["Skill:DevOps"].insert, "person tag: Skill:DevOps");
  // `skill:DevOps` is the start of `skill:DevOps-2` too, so the row counts the
  // pair, exactly as selecting it leaves the pair.
  assert.equal(byValue["Skill:DevOps"].count, 2);
  assert.equal(byValue["Skill:DevOps"].matchLabel, "2 people");
  assert.equal(byValue["skill:DevOps-2"].count, 1);
  rows.forEach((item) => {
    assert.equal(item.count, filterPlan(p, item.insert, defaultScopes()).people.length, item.value);
  });
  // The same holds for the Milestones' own vocabulary.
  const milestones = filterSuggestions(p, "milestone tag: skill", defaultScopes());
  assert.equal(milestones.find((item) => item.value === "Skill:DevOps").count, 2);
  milestones.forEach((item) => {
    assert.equal(item.count, filterPlan(p, item.insert, defaultScopes()).milestones.length, item.value);
  });
  // A typed value typed in full offers its row, counting what the prefix
  // leaves rather than the one tag the row names.
  const typed = filterSuggestions(p, "person tag: skill:DevOps", defaultScopes())
    .find((item) => item.value === "Skill:DevOps");
  assert.equal(typed.count, 2);
  assert.equal(filterPlan(p, typed.insert, defaultScopes()).people.length, 2);
});

/* --- a typed tag typed into the Filter (issue #278) ------------------------ */

/*
 * Two faults, both met by typing a typed tag into the Filter: a typed tag with
 * no field in front was read as an unknown field name and matched nothing, and
 * a colon value had to equal a tag, so `person tag: skill:D` could not narrow
 * as it was typed. These tests are the terms the owner reported them in.
 */

test("a typed tag with no field in front finds its rows", () => {
  const p = typedTagPlan();
  const term = parseFilterTerm("skill:De");
  // `skill` names no field, so the whole input is the plain term the reader
  // meant, and the prefix is remembered only for the empty state.
  assert.equal(term.kind, "plain");
  assert.equal(term.text, "skill:De");
  assert.equal(term.unknownPrefix, "skill");
  const view = filterPlan(p, "skill:De", defaultScopes());
  // The rows carrying `skill:DevOps` are found the way any plain term finds
  // them, and the bare `DevOps` row is not one of them.
  assert.deepEqual(ids(view.people), ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(view.projects), ["pr-skill", "pr-skill2"]);
  assert.deepEqual(ids(view.assignments), ["a-skill", "a-skill2"]);
  // Something matched, so the empty state - and the hint it carries - is never
  // reached: a working typed-tag search shows no warning.
  assert.equal(filterIsEmpty(view), false);
  // A plain term does not narrow the Milestones, and this is no field term.
  assert.equal(view.milestones.length, p.milestones.length);
});

test("a typed tag under its own field narrows by prefix", () => {
  const p = typedTagPlan();
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:D", defaultScopes()).people),
    ["p-skill", "p-skill2"]);
  // One character at a time, down to the one tag once the digit is typed.
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:DevOps", defaultScopes()).people),
    ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:DevOps-2", defaultScopes()).people),
    ["p-skill2"]);
  // All four tag fields read the one rule.
  assert.deepEqual(ids(filterPlan(p, "project tag: skill:D", defaultScopes()).projects),
    ["pr-skill", "pr-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "assignment tag: skill:D", defaultScopes()).assignments),
    ["a-skill", "a-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "milestone tag: skill:D", defaultScopes()).milestones),
    ["m-skill", "m-skill2"]);
});

test("#139 still holds: a typed tag spares the bare tag it shares letters with", () => {
  const p = typedTagPlan();
  // A bare `DevOps` does not start with `skill:DevOps`, so it stays hidden -
  // the point of typing the kind. The numbered neighbour may come along: that
  // is a narrowing, not a wrong row.
  assert.deepEqual(ids(filterPlan(p, "person tag: skill:DevOps", defaultScopes()).people),
    ["p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "project tag: skill:DevOps", defaultScopes()).projects),
    ["pr-skill", "pr-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "assignment tag: skill:DevOps", defaultScopes()).assignments),
    ["a-skill", "a-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "milestone tag: skill:DevOps", defaultScopes()).milestones),
    ["m-skill", "m-skill2"]);
  assert.equal(ids(filterPlan(p, "person tag: skill:DevOps", defaultScopes()).people).includes("p-dev"), false);
  assert.equal(ids(filterPlan(p, "project tag: skill:DevOps", defaultScopes()).projects).includes("pr-dev"), false);
  assert.equal(ids(filterPlan(p, "assignment tag: skill:DevOps", defaultScopes()).assignments).includes("a-dev"), false);
  assert.equal(ids(filterPlan(p, "milestone tag: skill:DevOps", defaultScopes()).milestones).includes("m-dev"), false);
});

test("a plain term keeps the substring rule in every tag field", () => {
  const p = typedTagPlan();
  // The bare tag, the typed one and its numbered neighbour all carry the
  // letters, so all three answer.
  assert.deepEqual(ids(filterPlan(p, "person tag: devops", defaultScopes()).people),
    ["p-dev", "p-skill", "p-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "project tag: devops", defaultScopes()).projects),
    ["pr-dev", "pr-skill", "pr-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "assignment tag: devops", defaultScopes()).assignments),
    ["a-dev", "a-skill", "a-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "milestone tag: devops", defaultScopes()).milestones),
    ["m-dev", "m-skill", "m-skill2"]);
  // A bare term typed as text reads a tag with that same rule.
  assert.deepEqual(ids(filterPlan(p, "devops", defaultScopes()).assignments),
    ["a-dev", "a-skill", "a-skill2"]);
  assert.deepEqual(ids(filterPlan(p, "DEVOPS", defaultScopes()).people),
    ["p-dev", "p-skill", "p-skill2"]);
});

test("an unknown field explains itself only when its text search found nothing", () => {
  const p = typedTagPlan();
  // `meeting: notes` names no field and appears nowhere in the plan, so the
  // search finds nothing and the hint names the prefix it could not read.
  const nothing = filterPlan(plan(), "meeting: notes", defaultScopes());
  assert.equal(filterIsEmpty(nothing), true);
  const missed = parseFilterTerm("meeting: notes");
  assert.equal(missed.unknownPrefix, "meeting");
  const hint = unknownFieldHint(missed.unknownPrefix);
  assert.equal(hint.indexOf('"meeting:"') !== -1, true);
  assert.equal(hint.indexOf("is not a field the Filter knows") !== -1, true);
  assert.equal(hint.indexOf("if you meant a field") !== -1, true);
  assert.equal(hint.indexOf("person tag") !== -1, true);
  // A typed tag that did match is a working search, not a mistyped field, so
  // the hint is never reached for it.
  assert.equal(parseFilterTerm("skill:De").unknownPrefix, "skill");
  assert.equal(filterIsEmpty(filterPlan(p, "skill:De", defaultScopes())), false);
});

test("a suggestion's count agrees with the rows the new rule leaves", () => {
  const p = typedTagPlan();
  ["skill:De", "person tag: skill:D", "person tag: skill:DevOps", "devops"].forEach((query) => {
    filterSuggestions(p, query, defaultScopes()).forEach((item) => {
      assert.equal(item.count, filterPlan(p, item.insert, defaultScopes())[VIEW_BY_UNIT[item.unit]].length,
        query + " -> " + item.source + ": " + item.value);
    });
    const everywhere = searchEverywhereSuggestion(p, query, defaultScopes());
    if (everywhere) {
      assert.equal(everywhere.count, viewResultCount(filterPlan(p, query, defaultScopes())), query);
    }
  });
  // A typed tag typed as text offers its tags, each inserting the field term
  // the reader meant, so promise and result agree.
  const rows = filterSuggestions(p, "skill:De", defaultScopes());
  assert.equal(rows.length > 0, true);
  const person = rows.find((item) => item.source === "Person tag" && item.value === "Skill:DevOps");
  assert.equal(person.insert, "person tag: Skill:DevOps");
  assert.equal(person.count, filterPlan(p, person.insert, defaultScopes()).people.length);
  // The broad search names the text search that was actually run.
  const everywhere = searchEverywhereSuggestion(p, "skill:De", defaultScopes());
  assert.equal(everywhere.insert, "skill:De");
  assert.equal(everywhere.count, viewResultCount(filterPlan(p, "skill:De", defaultScopes())));
});

test("an alias term's count reflects the alias result in the row's unit", () => {
  const p = collidingTagPlan();
  const view = filterPlan(p, "tag: Data", defaultScopes());
  const rows = filterSuggestions(p, "tag: Data", defaultScopes())
    .filter((item) => item.value === "Data");
  rows.forEach((item) => {
    assert.equal(item.insert, "tag: Data");
    // The alias spans kinds, so each row reports the alias's own result in its
    // own unit rather than one field's slice of it.
    assert.equal(item.count, view[VIEW_BY_UNIT[item.unit]].length, item.source);
  });
  assert.equal(rows.find((item) => item.source === "Person tag").count, view.people.length);
  assert.equal(rows.find((item) => item.source === "Project tag").count, view.projects.length);
  assert.equal(rows.find((item) => item.source === "Assignment tag").count, view.assignments.length);
});

test("a match count is worded for the thing it counts", () => {
  assert.equal(countLabel(1, "person"), "1 person");
  assert.equal(countLabel(2, "person"), "2 people");
  assert.equal(countLabel(1, "assignment"), "1 assignment");
  assert.equal(countLabel(4, "assignment"), "4 assignments");
  assert.equal(countLabel(1, "project"), "1 project");
  assert.equal(countLabel(3, "project"), "3 projects");
  assert.equal(countLabel(1, "match"), "1 match");
  assert.equal(countLabel(7, "match"), "7 matches");
});

/* --- typed terms ---------------------------------------------------------- */

test("a query with no colon is plain text", () => {
  assert.deepEqual(parseFilterTerm("architect"), { kind: "plain", text: "architect" });
  assert.deepEqual(parseFilterTerm("  Anna  "), { kind: "plain", text: "Anna" });
  assert.deepEqual(parseFilterTerm(""), { kind: "plain", text: "" });
  assert.deepEqual(parseFilterTerm("note"), { kind: "plain", text: "note" });
});

test("every canonical field and alias names the field it should search", () => {
  const cases = {
    "person name: x": ["person.name"],
    "person names: x": ["person.name"],
    "person: x": ["person.name"],
    "people: x": ["person.name"],
    "name: x": ["person.name", "project.name"],
    "names: x": ["person.name", "project.name"],
    "person location: x": ["person.location"],
    "person locations: x": ["person.location"],
    "location: x": ["person.location"],
    "locations: x": ["person.location"],
    "person tag: x": ["person.tags"],
    "person tags: x": ["person.tags"],
    "tag: x": ["person.tags", "project.tags", "assignment.tags"],
    "tags: x": ["person.tags", "project.tags", "assignment.tags"],
    "person note: x": ["person.note"],
    "person notes: x": ["person.note"],
    "note: x": ["person.note", "assignment.note"],
    "notes: x": ["person.note", "assignment.note"],
    "project name: x": ["project.name"],
    "project names: x": ["project.name"],
    "project: x": ["project.name"],
    "projects: x": ["project.name"],
    "project note: x": ["project.notes"],
    "project notes: x": ["project.notes"],
    "project tag: x": ["project.tags"],
    "project tags: x": ["project.tags"],
    "assignment tag: x": ["assignment.tags"],
    "assignment tags: x": ["assignment.tags"],
    "assignment note: x": ["assignment.note"],
    "assignment notes: x": ["assignment.note"],
    "milestone: x": ["milestone.name"],
    "milestones: x": ["milestone.name"],
    "milestone name: x": ["milestone.name"],
    "milestone names: x": ["milestone.name"],
    "milestone tag: x": ["milestone.tags"],
    "milestone tags: x": ["milestone.tags"],
    "milestone note: x": ["milestone.notes"],
    "milestone notes: x": ["milestone.notes"]
  };
  Object.keys(cases).forEach((query) => {
    const term = parseFilterTerm(query);
    assert.equal(term.kind, "field", query);
    assert.deepEqual(term.fields, cases[query], query);
    assert.equal(term.value, "x", query);
  });
});

test("the prefix is read case-insensitively and trimmed, runs of spaces collapse", () => {
  ["PERSON TAG:react", "  person tag:react  ", "person   tag :  react"].forEach((query) => {
    const term = parseFilterTerm(query);
    assert.equal(term.kind, "field", query);
    assert.deepEqual(term.fields, ["person.tags"], query);
    assert.equal(term.value, "react", query);
  });
});

test("the value is everything after the colon, spaces included", () => {
  const term = parseFilterTerm("project notes:  delayed payment  ");
  assert.equal(term.kind, "field");
  assert.deepEqual(term.fields, ["project.notes"]);
  assert.equal(term.value, "delayed payment");
});

test("a colon that is not a field prefix stays plain text", () => {
  // A digit before the colon, a punctured prefix, or nothing after it.
  assert.equal(parseFilterTerm("3:1").kind, "plain");
  assert.equal(parseFilterTerm("Q3: budget").kind, "plain");
  assert.equal(parseFilterTerm("person tag:").kind, "plain");
  assert.equal(parseFilterTerm("note:   ").kind, "plain");
  assert.equal(parseFilterTerm("ends with:").kind, "plain");
});

test("a prefix that names no field is plain text, remembering the prefix", () => {
  const term = parseFilterTerm("meeting: notes");
  // Not a field term: the whole input is the text the reader meant, searched
  // as any plain term is. The prefix rides along so the empty state can still
  // explain itself when that search finds nothing.
  assert.equal(term.kind, "plain");
  assert.equal(term.text, "meeting: notes");
  assert.equal(term.unknownPrefix, "meeting");
  // A plain term with no colon has no prefix to name.
  assert.equal(parseFilterTerm("architect").unknownPrefix, undefined);
  // The text finds nothing in this plan, so the empty state would name it.
  const view = filterPlan(plan(), "meeting: notes", defaultScopes());
  assert.equal(filterIsEmpty(view), true);
  const hint = unknownFieldHint(term.unknownPrefix);
  assert.equal(hint.indexOf("meeting:") !== -1, true);
  assert.equal(hint.indexOf("not a field") !== -1, true);
  // Phrased as a possibility, not a verdict: the term was still searched.
  assert.equal(hint.indexOf("if you meant a field") !== -1, true);
  // The hint names the fields the Filter does know.
  assert.equal(hint.indexOf("person location") !== -1, true);
  assert.equal(hint.indexOf("person tag") !== -1, true);
  // And it offers no suggestion rows, because nothing contains the text.
  assert.equal(filterSuggestions(plan(), "meeting: notes", defaultScopes()).length, 0);
});

test("a typed term matches only its own field, case-insensitively", () => {
  const view = (field, value) => filterPlan(plan(), field + ": " + value, defaultScopes());
  assert.deepEqual(ids(view("person name", "anna").people), ["anna"]);
  assert.deepEqual(ids(view("person tag", "LEAD").people), ["anna"]);
  assert.deepEqual(ids(view("person note", "atlas").people), ["anna"]);
  assert.deepEqual(ids(view("project name", "BOREALIS").projects), ["borealis"]);
  assert.deepEqual(ids(view("project notes", "phase").projects), ["react"]);
  assert.deepEqual(ids(view("assignment tag", "design").assignments), ["a-bor-ben"]);
  assert.deepEqual(ids(view("assignment note", "handover").assignments), ["a-bor-ben"]);
});

test("a Location is matched case-insensitively as a substring", () => {
  // `switz` sits inside Switzerland, and the term is read case-insensitively.
  assert.deepEqual(ids(filterPlan(plan(), "location: switz", defaultScopes()).people), ["anna", "ben"]);
  assert.deepEqual(ids(filterPlan(plan(), "location: SWITZERLAND", defaultScopes()).people), ["anna", "ben"]);
  assert.deepEqual(ids(filterPlan(plan(), "location: nether", defaultScopes()).people), ["cara"]);
  assert.deepEqual(ids(filterPlan(plan(), "location: atlantis", defaultScopes()).people), []);
});

test("every Location prefix behaves the same", () => {
  ["location", "locations", "person location", "person locations"].forEach((prefix) => {
    assert.deepEqual(ids(filterPlan(plan(), prefix + ": switzerland", defaultScopes()).people),
      ["anna", "ben"], prefix);
  });
});

test("a plain query searches a Person's Location like every other field", () => {
  const view = filterPlan(plan(), "switz", defaultScopes());
  assert.deepEqual(ids(view.people), ["anna", "ben"]);
  // A matching Person brings all of their work.
  assert.deepEqual(ids(view.assignments), ["a-react-anna", "a-bor-anna", "a-bor-ben"]);
  // The scope still governs a plain query.
  assert.deepEqual(ids(filterPlan(plan(), "switz", scopes(false, true, true)).people), []);
});

test("the dropdown offers the plan's Locations, sourced Person location", () => {
  const found = filterSuggestions(plan(), "switz", defaultScopes());
  const item = found.find((i) => i.source === "Person location");
  assert.equal(item.value, "Switzerland");
  assert.equal(item.count, 2);
  assert.equal(item.matchLabel, "2 people");
  // Typing the prefix with no value yet teaches the whole vocabulary.
  const empty = filterSuggestions(plan(), "location:", defaultScopes());
  assert.equal(empty.some((i) => i.value === "Switzerland"), true);
  assert.equal(empty.find((i) => i.value === "Netherlands").insert, "location: Netherlands");
});

test("the value is a substring of the field, not a whole word", () => {
  // "migr" sits inside cara's person note and the React assignment's note.
  assert.deepEqual(ids(filterPlan(plan(), "person note: migr", defaultScopes()).people), ["cara"]);
  assert.deepEqual(ids(filterPlan(plan(), "assignment note: migr", defaultScopes()).assignments), ["a-react-cara"]);
});

test("a typed term ignores the Look in scope", () => {
  const off = scopes(false, false, false);
  const onAssignments = scopes(false, false, true);
  // Person tags are searched even though nothing looks there.
  assert.deepEqual(ids(filterPlan(plan(), "person tag: react", off).people), ["anna"]);
  assert.deepEqual(ids(filterPlan(plan(), "project name: react", off).projects), ["react"]);
  // And a matching Project still brings its Assignments even when the scope
  // would not have searched Projects.
  assert.deepEqual(ids(filterPlan(plan(), "project name: react", onAssignments).assignments),
    ["a-react-anna", "a-react-cara"]);
});

test("a typed term propagates exactly as a plain match does", () => {
  // A matching Person brings their work, and those Assignments bring the
  // Projects they sit on.
  const person = filterPlan(plan(), "people: anna", defaultScopes());
  assert.deepEqual(ids(person.people), ["anna"]);
  assert.deepEqual(ids(person.assignments), ["a-react-anna", "a-bor-anna"]);
  assert.deepEqual(ids(person.projects), ["react", "borealis"]);
  // A matching Assignment brings its Person's row and its Project.
  const assignment = filterPlan(plan(), "assignment note: handover", defaultScopes());
  assert.deepEqual(ids(assignment.people), ["ben"]);
  assert.deepEqual(ids(assignment.projects), ["borealis"]);
});

test("the bare aliases span the fields they promise", () => {
  // tag: all three tag kinds, note: person and assignment notes, name: both names.
  assert.deepEqual(ids(filterPlan(plan(), "tag: react", defaultScopes()).people), ["anna", "cara"]);
  // Anna matches by Person tag, so all of her work comes with her.
  assert.deepEqual(ids(filterPlan(plan(), "tag: react", defaultScopes()).assignments),
    ["a-react-anna", "a-bor-anna", "a-react-cara"]);
  // `tag:` reaches a Project's tags too; `project tag:` narrows to Projects.
  const broad = filterPlan(plan(), "tag: lead", defaultScopes());
  assert.deepEqual(ids(broad.projects), ["react", "borealis"]);
  assert.deepEqual(ids(broad.people), ["anna", "cara"]);
  assert.deepEqual(ids(broad.assignments), ["a-react-anna", "a-bor-anna", "a-react-cara"]);
  const narrow = filterPlan(plan(), "project tag: lead", defaultScopes());
  assert.deepEqual(ids(narrow.projects), ["react"]);
  assert.deepEqual(ids(narrow.people), ["anna", "cara"]);
  assert.deepEqual(ids(narrow.assignments), ["a-react-anna", "a-react-cara"]);
  assert.deepEqual(ids(filterPlan(plan(), "name: react", defaultScopes()).projects), ["react"]);
  // note: reads person notes and assignment notes, not a project's notes.
  const note = filterPlan(plan(), "note: atlas", defaultScopes());
  assert.deepEqual(ids(note.people), ["anna", "ben"]);
  assert.deepEqual(ids(note.assignments), ["a-react-anna", "a-bor-anna", "a-bor-ben"]);
  assert.equal(filterIsEmpty(filterPlan(plan(), "note: phase", defaultScopes())), true);
});

test("a plain query is unchanged by the typed-term rule", () => {
  const view = filterPlan(plan(), "react", defaultScopes());
  assert.deepEqual(ids(view.people), ["anna", "cara"]);
  assert.deepEqual(ids(view.projects), ["react", "borealis"]);
  assert.deepEqual(ids(view.assignments), ["a-react-anna", "a-bor-anna", "a-react-cara"]);
  // The scope still governs a plain query.
  const peopleOnly = filterPlan(plan(), "react", scopes(true, false, false));
  assert.deepEqual(ids(peopleOnly.people), ["anna", "cara"]);
  assert.deepEqual(ids(peopleOnly.projects), ["react", "borealis"]);
});

test("the empty state can name the field a typed term searched", () => {
  assert.equal(fieldLabel(["person.tags"]), "person tags");
  assert.equal(fieldLabel(["person.location"]), "person locations");
  assert.equal(fieldLabel(["person.tags", "assignment.tags"]), "person tags or assignment tags");
  assert.equal(fieldLabel(["person.tags", "project.tags", "assignment.tags"]),
    "person tags, project tags or assignment tags");
  assert.equal(fieldLabel(["project.tags"]), "project tags");
  assert.equal(fieldLabel(["person.name", "project.name"]), "person names or project names");
  assert.equal(fieldLabel(["milestone.name"]), "milestone names");
  assert.equal(fieldLabel(["milestone.tags"]), "milestone tags");
  assert.equal(fieldLabel(["milestone.name", "milestone.notes"]), "milestone names or milestone notes");
});

test("the dropdown teaches the field prefixes as a plain query is typed", () => {
  const found = filterSuggestions(plan(), "per", defaultScopes());
  const prefixes = found.filter((item) => item.kind === "prefix").map((item) => item.value);
  assert.deepEqual(prefixes, ["person name:", "person location:", "person tag:", "person note:"]);
  prefixes.forEach((value) => {
    const item = found.find((i) => i.value === value);
    assert.equal(item.source, "Field");
    assert.equal(item.insert, value + " ");
    assert.equal(typeof item.matchLabel, "string");
  });
  // Typing a whole alias offers just that prefix.
  assert.deepEqual(filterSuggestions(plan(), "tag", defaultScopes()).map((item) => item.value), ["tag:"]);
  // `project` opens the three project fields, tag included.
  const project = filterSuggestions(plan(), "project", defaultScopes())
    .filter((item) => item.kind === "prefix").map((item) => item.value);
  assert.deepEqual(project, ["project:", "project note:", "project tag:"]);
});

test("a typed term's dropdown offers the names and tags of its field", () => {
  const found = filterSuggestions(plan(), "person tag: re", defaultScopes());
  assert.equal(found.length > 0, true);
  found.forEach((item) => {
    assert.equal(item.source, "Person tag");
    assert.equal(item.kind, "value");
    assert.equal(item.insert, "person tag: " + item.value);
  });
  // Project tags are their own vocabulary, drawn from Projects only.
  const projectTag = filterSuggestions(plan(), "project tag: le", defaultScopes());
  assert.equal(projectTag.length, 1);
  assert.equal(projectTag[0].source, "Project tag");
  assert.equal(projectTag[0].value, "lead");
  assert.equal(projectTag[0].matchLabel, "1 project");
  assert.equal(projectTag[0].insert, "project tag: lead");
  // A prefix with no value yet teaches the whole field, so choosing a value
  // completes the term.
  const empty = filterSuggestions(plan(), "project notes:", defaultScopes());
  assert.equal(empty.some((item) => item.value === "phase two"), true);
  assert.equal(empty.find((item) => item.value === "phase two").insert, "project notes: phase two");
  // An unknown prefix offers nothing.
  assert.equal(filterSuggestions(plan(), "meeting: notes", defaultScopes()).length, 0);
});

/* --- milestones ----------------------------------------------------------- */

/*
 * The same plan with three Milestones: one related to the React project, one
 * plan-wide, and one related to Borealis. `delivery` tags both the React
 * project and two Milestones, so a row's tag and a Milestone's tag can be told
 * apart by the field a term names.
 */
function milestonePlan() {
  const p = plan();
  p.projects[0].tags = ["lead", "delivery"];
  p.milestones = [
    { id: "m-api", name: "API freeze", date: "2026-10-15", colour: 1, tags: ["api", "delivery"], notes: "contract signed", projectIds: ["react"] },
    { id: "m-launch", name: "Atlas launch", date: "2026-11-20", colour: 2, tags: ["delivery"], notes: "", projectIds: [] },
    { id: "m-audit", name: "Audit", date: "2026-12-01", colour: 3, tags: ["governance"], notes: "external audit begins", projectIds: ["borealis"] }
  ];
  return p;
}

test("a milestone is found by its name, by its tag and by its note", () => {
  const found = (query) => ids(filterPlan(milestonePlan(), query, defaultScopes()).milestones);
  assert.deepEqual(found("milestone: api"), ["m-api"]);
  assert.deepEqual(found("milestone tag: delivery"), ["m-api", "m-launch"]);
  assert.deepEqual(found("milestone note: signed"), ["m-api"]);
  // The matching rule is every other field's: case-insensitive, anywhere.
  assert.deepEqual(found("MILESTONE TAG: DELIV"), ["m-api", "m-launch"]);
  assert.deepEqual(found("milestone note: audit"), ["m-audit"]);
  // The singular and the plural name the same fields.
  ["milestone", "milestones", "milestone name", "milestone names"].forEach((prefix) => {
    assert.deepEqual(found(prefix + ": api"), ["m-api"], prefix);
  });
  ["milestone tag", "milestone tags"].forEach((prefix) => {
    assert.deepEqual(found(prefix + ": governance"), ["m-audit"], prefix);
  });
  ["milestone note", "milestone notes"].forEach((prefix) => {
    assert.deepEqual(found(prefix + ": external"), ["m-audit"], prefix);
  });
});

test("a milestone term narrows the milestones and leaves the rows whole", () => {
  const whole = milestonePlan();
  const view = filterPlan(whole, "milestone tag: delivery", defaultScopes());
  assert.deepEqual(ids(view.milestones), ["m-api", "m-launch"]);
  // The term says nothing about the plan's People, Projects or Assignments,
  // so they stay as the scope left them - whole.
  assert.deepEqual(ids(view.people), ids(whole.people));
  assert.deepEqual(ids(view.projects), ids(whole.projects));
  assert.deepEqual(ids(view.assignments), ids(whole.assignments));
  assert.equal(filterIsEmpty(view), false);
  // A term that matches no milestone matches no milestone rather than hiding
  // the plan: with the toggle off nothing would be drawn to explain an empty
  // grid.
  const none = filterPlan(whole, "milestone: nominal", defaultScopes());
  assert.deepEqual(ids(none.milestones), []);
  assert.deepEqual(ids(none.projects), ids(whole.projects));
  assert.equal(filterIsEmpty(none), false);
});

test("a Project's tag does not reach a Milestone", () => {
  const p = milestonePlan();
  // `delivery` tags the React project and two Milestones. The project term
  // matches the Project and leaves the Milestones alone, and the same word as
  // a plain query does the same.
  const byProject = filterPlan(p, "project tag: delivery", defaultScopes());
  assert.deepEqual(ids(byProject.projects), ["react"]);
  assert.deepEqual(ids(byProject.milestones), ids(p.milestones));
  const plain = filterPlan(p, "delivery", defaultScopes());
  assert.deepEqual(ids(plain.milestones), ids(p.milestones));
  // A milestone tag term matches no row and hides none.
  const byMilestone = filterPlan(p, "milestone tag: governance", defaultScopes());
  assert.deepEqual(ids(byMilestone.milestones), ["m-audit"]);
  assert.deepEqual(ids(byMilestone.projects), ids(p.projects));
  assert.deepEqual(ids(byMilestone.assignments), ids(p.assignments));
});

test("a bare tag term stays with the rows' three vocabularies", () => {
  const p = milestonePlan();
  // `delivery` is a Project tag and a Milestone tag. The bare term matches the
  // Project and never a Milestone: Milestone tags are the fourth, separate
  // vocabulary and are reached by `milestone tag:` alone.
  const tag = filterPlan(p, "tag: delivery", defaultScopes());
  assert.deepEqual(ids(tag.projects), ["react"]);
  assert.deepEqual(ids(tag.milestones), ids(p.milestones));
  assert.deepEqual(ids(filterPlan(p, "milestone tag: delivery", defaultScopes()).milestones),
    ["m-api", "m-launch"]);
  // The bare tag suggestion list offers the rows' three kinds, not the fourth.
  assert.equal(filterSuggestions(p, "tag:", defaultScopes()).some((i) => i.source === "Milestone tag"), false);
});

test("a matched milestone the visibility rule hides stays hidden", () => {
  const p = milestonePlan();
  const view = filterPlan(p, "milestone tag: delivery", defaultScopes());
  assert.deepEqual(ids(view.milestones), ["m-api", "m-launch"]);
  const start = "2026-10-01";
  const days = 70;
  const marked = (visibleProjectIds) => milestoneMarks(view.milestones, p.projects, visibleProjectIds, start, days)
    .map((mark) => mark.name);
  // What the Filter left is drawn while the Projects its Milestones relate to
  // are in view: the plan-wide one always, the React one because React is.
  assert.deepEqual(marked(["react", "borealis"]), ["API freeze", "Atlas launch"]);
  // Taking React out of view - the Project archived, or a Filter that hides
  // it - still hides the milestone the term matched.
  assert.deepEqual(marked(["borealis"]), ["Atlas launch"]);
  // Matching never forces a milestone into view: with nothing in view, the
  // linked one stays hidden and only the plan-wide one is drawn.
  assert.deepEqual(marked([]), ["Atlas launch"]);
});

test("the dropdown teaches the milestone fields and offers their vocabulary", () => {
  const p = milestonePlan();
  const taught = filterSuggestions(p, "milestone", defaultScopes());
  assert.deepEqual(taught.filter((item) => item.kind === "prefix").map((item) => item.value),
    ["milestone:", "milestone tag:", "milestone note:"]);
  // A value row carries the whole term and counts what selecting it leaves.
  const tag = filterSuggestions(p, "milestone tag:", defaultScopes()).find((item) => item.value === "delivery");
  assert.equal(tag.source, "Milestone tag");
  assert.equal(tag.insert, "milestone tag: delivery");
  assert.equal(tag.matchLabel, "2 milestones");
  assert.equal(filterPlan(p, tag.insert, defaultScopes()).milestones.length, 2);
  const name = filterSuggestions(p, "milestone:", defaultScopes()).find((item) => item.value === "Audit");
  assert.equal(name.source, "Milestone");
  assert.equal(name.insert, "milestone: Audit");
  assert.equal(name.matchLabel, "1 milestone");
  const note = filterSuggestions(p, "milestone note:", defaultScopes())
    .find((item) => item.value === "external audit begins");
  assert.equal(note.source, "Milestone note");
  assert.equal(note.insert, "milestone note: external audit begins");
  assert.equal(note.matchLabel, "1 milestone");
  // A plain query's vocabulary is still the areas looked in, and a milestone
  // is not one of them: its name is offered once a milestone prefix is typed.
  assert.equal(filterSuggestions(p, "audit", defaultScopes()).some((item) => item.source === "Milestone"), false);
});

test("the plan is never changed by a milestone term", () => {
  const p = milestonePlan();
  const before = JSON.stringify(p);
  filterPlan(p, "milestone tag: delivery", defaultScopes());
  filterSuggestions(p, "milestone tag:", defaultScopes());
  assert.equal(JSON.stringify(p), before);
});
