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
  countLabel,
  parseFilterTerm,
  fieldLabel,
  unknownFieldHint
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
    "person tag: x": ["person.tags"],
    "person tags: x": ["person.tags"],
    "tag: x": ["person.tags", "assignment.tags"],
    "tags: x": ["person.tags", "assignment.tags"],
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
    "assignment tag: x": ["assignment.tags"],
    "assignment tags: x": ["assignment.tags"],
    "assignment note: x": ["assignment.note"],
    "assignment notes: x": ["assignment.note"]
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

test("a plausible prefix that names no field is an unknown term", () => {
  const term = parseFilterTerm("meeting: notes");
  assert.equal(term.kind, "unknown");
  assert.equal(term.prefix, "meeting");
  // It is not quietly read as plain text: it matches nothing and is named.
  const view = filterPlan(plan(), "meeting: notes", defaultScopes());
  assert.equal(filterIsEmpty(view), true);
  assert.equal(unknownFieldHint(term.prefix).indexOf("meeting") !== -1, true);
  assert.equal(unknownFieldHint("meeting").indexOf("not a field") !== -1, true);
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
  // tag: both tag kinds, note: person and assignment notes, name: both names.
  assert.deepEqual(ids(filterPlan(plan(), "tag: react", defaultScopes()).people), ["anna", "cara"]);
  // Anna matches by Person tag, so all of her work comes with her.
  assert.deepEqual(ids(filterPlan(plan(), "tag: react", defaultScopes()).assignments),
    ["a-react-anna", "a-bor-anna", "a-react-cara"]);
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
  assert.equal(fieldLabel(["person.tags", "assignment.tags"]), "person tags or assignment tags");
  assert.equal(fieldLabel(["person.name", "project.name"]), "person names or project names");
});

test("the dropdown teaches the field prefixes as a plain query is typed", () => {
  const found = filterSuggestions(plan(), "per", defaultScopes());
  const prefixes = found.filter((item) => item.kind === "prefix").map((item) => item.value);
  assert.deepEqual(prefixes, ["person name:", "person tag:", "person note:"]);
  prefixes.forEach((value) => {
    const item = found.find((i) => i.value === value);
    assert.equal(item.source, "Field");
    assert.equal(item.insert, value + " ");
    assert.equal(typeof item.matchLabel, "string");
  });
  // Typing a whole alias offers just that prefix.
  assert.deepEqual(filterSuggestions(plan(), "tag", defaultScopes()).map((item) => item.value), ["tag:"]);
});

test("a typed term's dropdown offers the names and tags of its field", () => {
  const found = filterSuggestions(plan(), "person tag: re", defaultScopes());
  assert.equal(found.length > 0, true);
  found.forEach((item) => {
    assert.equal(item.source, "Person tag");
    assert.equal(item.kind, "value");
    assert.equal(item.insert, "person tag: " + item.value);
  });
  // A prefix with no value yet teaches the whole field, so choosing a value
  // completes the term.
  const empty = filterSuggestions(plan(), "project notes:", defaultScopes());
  assert.equal(empty.some((item) => item.value === "phase two"), true);
  assert.equal(empty.find((item) => item.value === "phase two").insert, "project notes: phase two");
  // An unknown prefix offers nothing.
  assert.equal(filterSuggestions(plan(), "meeting: notes", defaultScopes()).length, 0);
});
