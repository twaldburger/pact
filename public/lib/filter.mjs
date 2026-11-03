/*
 * PACT Filter: the rule that hides what does not match, and the suggestions
 * that teach the plan's own vocabulary.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source. The filter is session-only: it
 * is never sent to the server and never written to the plan.
 *
 * Hiding is decided per thing - a Person, a Project or an Assignment matches
 * the typed text anywhere in its own fields - and then propagated, because a
 * match carries what belongs to it: a matching Project brings all of its
 * Assignments, a matching Person all of their work, and a matching Assignment
 * its Person's row and its Project. The whole plan is never changed; the
 * caller keeps it for the row-header figures, which describe the Person rather
 * than the query.
 */

export const FILTER_SCOPES = ["people", "projects", "assignments"];

// How many suggestions the dropdown is willing to draw at once.
export const SUGGESTION_LIMIT = 8;

export function defaultScopes() {
  return { people: true, projects: true, assignments: true };
}

export function scopeCount(scopes) {
  const s = scopes || {};
  return FILTER_SCOPES.filter(function (key) { return !!s[key]; }).length;
}

// The control's own statement of what is being looked in: "all 3", "2 of 3"
// or "none". It never implies that a switched-off area cannot appear, because
// propagation may still carry it.
export function scopeSummary(scopes) {
  const n = scopeCount(scopes);
  if (n === FILTER_SCOPES.length) return "all " + FILTER_SCOPES.length;
  if (n === 0) return "none";
  return n + " of " + FILTER_SCOPES.length;
}

// The areas named in the empty state, in the order they are switched on.
export function searchedAreas(scopes) {
  const names = FILTER_SCOPES.filter(function (key) { return (scopes || {})[key]; });
  if (names.length === 0) return "no areas";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names[0] + " or " + names[1];
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}

function lower(value) {
  return String(value == null ? "" : value).toLowerCase();
}

// The whole query: a case-insensitive substring anywhere in the text. `rea`
// finds React, and whole words are never required.
export function matchesQuery(text, query) {
  const q = lower(query).trim();
  if (q === "") return true;
  return lower(text).indexOf(q) !== -1;
}

function won(text, q) {
  return lower(text).indexOf(lower(q)) !== -1;
}

function personMatches(person, q) {
  if (won(person.name, q)) return true;
  if ((person.tags || []).some(function (tag) { return won(tag, q); })) return true;
  return won(person.note, q);
}

function projectMatches(project, q) {
  return won(project.name, q) || won(project.notes, q);
}

function assignmentMatches(assignment, q) {
  if ((assignment.tags || []).some(function (tag) { return won(tag, q); })) return true;
  return won(assignment.note, q);
}

/*
 * The plan as the filter leaves it: the People rows, Projects in the Stack and
 * Assignments on the Timeline that survive, in their original order. The input
 * plan is never touched. An empty query means no filter at all.
 */
export function filterPlan(plan, query, scopes) {
  const people = (plan && plan.people) || [];
  const projects = (plan && plan.projects) || [];
  const assignments = (plan && plan.assignments) || [];
  const s = scopes || defaultScopes();
  const q = lower(query).trim();
  if (q === "") {
    return { people: people.slice(), projects: projects.slice(), assignments: assignments.slice() };
  }

  const matchedPeople = new Set();
  const matchedProjects = new Set();
  const matchedAssignments = new Set();
  if (s.people) {
    people.forEach(function (person) {
      if (personMatches(person, q)) matchedPeople.add(person.id);
    });
  }
  if (s.projects) {
    projects.forEach(function (project) {
      if (projectMatches(project, q)) matchedProjects.add(project.id);
    });
  }
  if (s.assignments) {
    assignments.forEach(function (assignment) {
      if (assignmentMatches(assignment, q)) matchedAssignments.add(assignment.id);
    });
  }

  // What each match carries. A Person or Project match reaches every
  // Assignment that belongs to it; an Assignment match reaches only itself.
  const shownAssignments = new Set();
  assignments.forEach(function (assignment) {
    if (matchedPeople.has(assignment.personId) ||
        matchedProjects.has(assignment.projectId) ||
        matchedAssignments.has(assignment.id)) {
      shownAssignments.add(assignment.id);
    }
  });

  // Every Assignment that survives has to have a row and a Stack entry, so it
  // brings its Person and its Project with it.
  const shownPeople = new Set(matchedPeople);
  const shownProjects = new Set(matchedProjects);
  assignments.forEach(function (assignment) {
    if (!shownAssignments.has(assignment.id)) return;
    shownPeople.add(assignment.personId);
    shownProjects.add(assignment.projectId);
  });

  return {
    people: people.filter(function (p) { return shownPeople.has(p.id); }),
    projects: projects.filter(function (p) { return shownProjects.has(p.id); }),
    assignments: assignments.filter(function (a) { return shownAssignments.has(a.id); })
  };
}

export function filterIsEmpty(view) {
  return view.people.length === 0 && view.projects.length === 0 && view.assignments.length === 0;
}

/*
 * A Person's assigned share on one day, read from the whole plan. The
 * row-header figure is the Person's own load and must never be narrowed by the
 * filter, so this is handed the unfiltered plan. Dates are ISO strings, so the
 * comparison is exact and needs no parsing.
 */
export function personAssignedShare(plan, personId, dateISO) {
  let total = 0;
  ((plan && plan.assignments) || []).forEach(function (assignment) {
    if (assignment.personId !== personId) return;
    if (assignment.start <= dateISO && assignment.end >= dateISO) total += assignment.share / 100;
  });
  return total;
}

const SOURCE_PROJECT = "Project";
const SOURCE_PERSON = "Person";
const SOURCE_ASSIGNMENT_TAG = "Assignment tag";
const SOURCE_PERSON_TAG = "Person tag";
const SOURCE_PROJECT_NOTE = "Project note";
const SOURCE_ASSIGNMENT_NOTE = "Assignment note";
const SOURCE_PERSON_NOTE = "Person note";

export function countLabel(count, unit) {
  const n = Number(count) || 0;
  if (unit === "person") return n + (n === 1 ? " person" : " people");
  if (unit === "project") return n + (n === 1 ? " project" : " projects");
  return n + (n === 1 ? " assignment" : " assignments");
}

// Distinct values of one tag vocabulary, first spelling winning, matched
// case-insensitively - the same rule the tag editors use.
function collectTags(items) {
  const seen = new Map();
  (items || []).forEach(function (item) {
    (item.tags || []).forEach(function (tag) {
      const text = String(tag).trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (!seen.has(key)) seen.set(key, text);
    });
  });
  return seen;
}

function countPeopleWithTag(people, value) {
  const q = lower(value);
  return people.filter(function (person) {
    return (person.tags || []).some(function (tag) { return lower(tag) === q; });
  }).length;
}

function countAssignmentsWithTag(assignments, value) {
  const q = lower(value);
  return assignments.filter(function (assignment) {
    return (assignment.tags || []).some(function (tag) { return lower(tag) === q; });
  }).length;
}

function addCandidate(out, seen, source, value, count, unit) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return;
  const key = source + "\u0000" + lower(text);
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ source: source, value: text, count: count, unit: unit });
}

/*
 * The plan's own vocabulary, offered while typing: project names, people's
 * names, Assignment tags, Person tags and the text in notes. Each suggestion
 * carries the source it came from and how many things it would match, and only
 * the areas currently looked in contribute. `prefix` marks a value the typed
 * text starts, so a prefix match can be offered before a mere substring.
 */
export function filterSuggestions(plan, query, scopes) {
  const people = (plan && plan.people) || [];
  const projects = (plan && plan.projects) || [];
  const assignments = (plan && plan.assignments) || [];
  const s = scopes || defaultScopes();
  const q = lower(query).trim();
  const out = [];
  const seen = new Set();
  if (q === "") return out;

  if (s.projects) {
    projects.forEach(function (project) {
      const count = assignments.filter(function (a) { return a.projectId === project.id; }).length;
      addCandidate(out, seen, SOURCE_PROJECT, project.name, count, "assignment");
    });
    projects.forEach(function (project) {
      if (!project.notes || !won(project.notes, q)) return;
      const text = String(project.notes).trim();
      const count = projects.filter(function (p) { return won(p.notes, text); }).length;
      addCandidate(out, seen, SOURCE_PROJECT_NOTE, text, count, "project");
    });
  }

  if (s.people) {
    people.forEach(function (person) {
      const text = String(person.name == null ? "" : person.name).trim();
      const count = people.filter(function (p) { return won(p.name, text); }).length;
      addCandidate(out, seen, SOURCE_PERSON, text, count, "person");
    });
    collectTags(people).forEach(function (tag) {
      addCandidate(out, seen, SOURCE_PERSON_TAG, tag, countPeopleWithTag(people, tag), "person");
    });
    people.forEach(function (person) {
      if (!person.note || !won(person.note, q)) return;
      const text = String(person.note).trim();
      const count = people.filter(function (p) { return won(p.note, text); }).length;
      addCandidate(out, seen, SOURCE_PERSON_NOTE, text, count, "person");
    });
  }

  if (s.assignments) {
    collectTags(assignments).forEach(function (tag) {
      addCandidate(out, seen, SOURCE_ASSIGNMENT_TAG, tag, countAssignmentsWithTag(assignments, tag), "assignment");
    });
    assignments.forEach(function (assignment) {
      if (!assignment.note || !won(assignment.note, q)) return;
      const text = String(assignment.note).trim();
      const count = assignments.filter(function (a) { return won(a.note, text); }).length;
      addCandidate(out, seen, SOURCE_ASSIGNMENT_NOTE, text, count, "assignment");
    });
  }

  const kept = out.filter(function (item) { return won(item.value, q); });
  kept.forEach(function (item) {
    item.prefix = lower(item.value).indexOf(q) === 0;
    item.matchLabel = countLabel(item.count, item.unit);
  });
  kept.sort(function (a, b) {
    if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return lower(a.value) < lower(b.value) ? -1 : lower(a.value) > lower(b.value) ? 1 : 0;
  });
  return kept;
}
