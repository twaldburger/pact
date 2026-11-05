/*
 * PACT Filter: the rule that hides what does not match, the rule that aims a
 * typed term at one field, and the suggestions that teach the plan's own
 * vocabulary.
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
 *
 * A query is either plain text - searched through the "Look in" scope as
 * before - or a single `field: value` term, which names one field and ignores
 * the scope. There is one owner for that rule: parseFilterTerm, below, is what
 * both the filter and the suggestions read.
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

/*
 * The fields a typed term can name, and the words that name them. A prefix is
 * matched case-insensitively and trimmed, and both the singular and the plural
 * work. The bare `tag:`/`tags:` means both tag kinds, `note:`/`notes:` both
 * person and assignment notes, and `name:`/`names:` both names; everything
 * else points at exactly one field.
 */
export const FILTER_FIELDS = [
  "person.name",
  "person.tags",
  "person.note",
  "project.name",
  "project.notes",
  "assignment.tags",
  "assignment.note"
];

// What each field is called where the interface has to name it.
export const FIELD_LABELS = {
  "person.name": "person names",
  "person.tags": "person tags",
  "person.note": "person notes",
  "project.name": "project names",
  "project.notes": "project notes",
  "assignment.tags": "assignment tags",
  "assignment.note": "assignment notes"
};

// The canonical fields and the safe short aliases. Each maps to the list of
// fields it searches, so a multi-field alias reads like any other term.
const PREFIX_FIELDS = {
  "person name": ["person.name"],
  "person names": ["person.name"],
  "person": ["person.name"],
  "people": ["person.name"],
  "person tag": ["person.tags"],
  "person tags": ["person.tags"],
  "tag": ["person.tags", "assignment.tags"],
  "tags": ["person.tags", "assignment.tags"],
  "person note": ["person.note"],
  "person notes": ["person.note"],
  "note": ["person.note", "assignment.note"],
  "notes": ["person.note", "assignment.note"],
  "project name": ["project.name"],
  "project names": ["project.name"],
  "project": ["project.name"],
  "projects": ["project.name"],
  "project note": ["project.notes"],
  "project notes": ["project.notes"],
  "assignment tag": ["assignment.tags"],
  "assignment tags": ["assignment.tags"],
  "assignment note": ["assignment.note"],
  "assignment notes": ["assignment.note"],
  "name": ["person.name", "project.name"],
  "names": ["person.name", "project.name"]
};

// The prefixes the dropdown teaches, one row each, with the field it points
// at and the words for it. This is a readable subset of PREFIX_FIELDS.
const TEACHING_PREFIXES = [
  { name: "person name", label: "person names", fields: ["person.name"] },
  { name: "people", label: "people by name", fields: ["person.name"] },
  { name: "person tag", label: "person tags", fields: ["person.tags"] },
  { name: "person note", label: "person notes", fields: ["person.note"] },
  { name: "project", label: "projects by name", fields: ["project.name"] },
  { name: "project note", label: "project notes", fields: ["project.notes"] },
  { name: "assignment tag", label: "assignment tags", fields: ["assignment.tags"] },
  { name: "assignment note", label: "assignment notes", fields: ["assignment.note"] },
  { name: "name", label: "people and projects by name", fields: ["person.name", "project.name"] },
  { name: "tag", label: "person and assignment tags", fields: ["person.tags", "assignment.tags"] },
  { name: "note", label: "person and assignment notes", fields: ["person.note", "assignment.note"] }
];

function lower(value) {
  return String(value == null ? "" : value).toLowerCase();
}

export function fieldLabel(fields) {
  const labels = (fields || []).map(function (field) { return FIELD_LABELS[field]; }).filter(Boolean);
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return labels.slice(0, -1).join(", ") + " or " + labels[labels.length - 1];
}

/*
 * The parse rule, and the only place a query is read. Splitting is done once,
 * here:
 *
 * - No colon, or text before the colon that is not letters-and-spaces, or a
 *   colon with nothing after it: plain text.
 * - Letters-and-spaces before the colon, a value after it, and a prefix in the
 *   table: a field term, carrying its field ids and the trimmed value.
 * - Letters-and-spaces before the colon, a value after it, but no such prefix:
 *   an unknown term carrying the offending prefix. The caller shows no match
 *   and names it, rather than quietly treating it as plain text.
 *
 * The value is everything after the first colon, spaces included, with only
 * the outer spaces stripped. The prefix is matched case-insensitively and
 * trimmed, and runs of spaces inside it collapse to one.
 */
export function parseFilterTerm(query) {
  const text = String(query == null ? "" : query);
  const trimmed = text.trim();
  const colon = text.indexOf(":");
  if (colon === -1) return { kind: "plain", text: trimmed };

  const prefix = text.slice(0, colon).trim().toLowerCase().replace(/\s+/g, " ");
  const value = text.slice(colon + 1).trim();
  // Letters and spaces only, and a value must follow the colon. A colon in
  // ordinary prose - "3:1", "ends with:" - stays plain text.
  const plausible = prefix !== "" && /^[a-z ]+$/.test(prefix);
  if (!plausible || value === "") return { kind: "plain", text: trimmed };

  const fields = PREFIX_FIELDS[prefix];
  if (!fields) return { kind: "unknown", prefix: prefix };
  return { kind: "field", fields: fields.slice(), value: value, prefix: prefix };
}

// The hint for an unrecognised prefix: it names the offending word and the
// fields the Filter does know.
export function unknownFieldHint(prefix) {
  return '"' + String(prefix == null ? "" : prefix) + '" is not a field the Filter knows. ' +
    "Try person, people, person tag, person note, project, project note, " +
    "assignment tag, assignment note, name, tag or note.";
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

function someTag(tags, q) {
  return (tags || []).some(function (tag) { return won(tag, q); });
}

// One place each field is read from, so matching and suggesting cannot drift
// apart. Every matcher takes the thing and the already-lowered value.
const FIELD_MATCHES = {
  "person.name": function (item, q) { return won(item.name, q); },
  "person.tags": function (item, q) { return someTag(item.tags, q); },
  "person.note": function (item, q) { return won(item.note, q); },
  "project.name": function (item, q) { return won(item.name, q); },
  "project.notes": function (item, q) { return won(item.notes, q); },
  "assignment.tags": function (item, q) { return someTag(item.tags, q); },
  "assignment.note": function (item, q) { return won(item.note, q); }
};

function termMatches(kind, item, fields, q) {
  return (fields || []).some(function (field) {
    return field.indexOf(kind + ".") === 0 && FIELD_MATCHES[field](item, q);
  });
}

function personMatches(person, q) {
  if (won(person.name, q)) return true;
  if (someTag(person.tags, q)) return true;
  return won(person.note, q);
}

function projectMatches(project, q) {
  return won(project.name, q) || won(project.notes, q);
}

function assignmentMatches(assignment, q) {
  if (someTag(assignment.tags, q)) return true;
  return won(assignment.note, q);
}

/*
 * The plan as the filter leaves it: the People rows, Projects in the Stack and
 * Assignments on the Timeline that survive, in their original order. The input
 * plan is never touched. An empty query means no filter at all.
 *
 * A field term ignores the scope and is matched only against the field or
 * fields it names; an unknown term matches nothing. Propagation is the same
 * for every kind of match.
 */
export function filterPlan(plan, query, scopes) {
  const people = (plan && plan.people) || [];
  const projects = (plan && plan.projects) || [];
  const assignments = (plan && plan.assignments) || [];
  const s = scopes || defaultScopes();
  const term = parseFilterTerm(query);

  const matchedPeople = new Set();
  const matchedProjects = new Set();
  const matchedAssignments = new Set();

  if (term.kind === "plain") {
    const q = lower(term.text);
    if (q === "") {
      return { people: people.slice(), projects: projects.slice(), assignments: assignments.slice() };
    }
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
  } else if (term.kind === "field") {
    const q = lower(term.value);
    people.forEach(function (person) {
      if (termMatches("person", person, term.fields, q)) matchedPeople.add(person.id);
    });
    projects.forEach(function (project) {
      if (termMatches("project", project, term.fields, q)) matchedProjects.add(project.id);
    });
    assignments.forEach(function (assignment) {
      if (termMatches("assignment", assignment, term.fields, q)) matchedAssignments.add(assignment.id);
    });
  } else {
    // An unrecognised prefix: no match at all, so the empty state can explain
    // the field it did not recognise.
    return { people: [], projects: [], assignments: [] };
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
const SOURCE_FIELD = "Field";

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

// Each field's own vocabulary, offered the way it is matched: the values that
// would satisfy the field. `q` narrows it to values containing the typed text;
// an empty `q` - a prefix with no value yet - offers the whole field.
function collectField(plan, field, q, out, seen) {
  const people = (plan && plan.people) || [];
  const projects = (plan && plan.projects) || [];
  const assignments = (plan && plan.assignments) || [];

  if (field === "project.name") {
    projects.forEach(function (project) {
      const count = assignments.filter(function (a) { return a.projectId === project.id; }).length;
      addCandidate(out, seen, SOURCE_PROJECT, project.name, count, "assignment");
    });
  } else if (field === "project.notes") {
    projects.forEach(function (project) {
      if (!project.notes || !won(project.notes, q)) return;
      const text = String(project.notes).trim();
      const count = projects.filter(function (p) { return won(p.notes, text); }).length;
      addCandidate(out, seen, SOURCE_PROJECT_NOTE, text, count, "project");
    });
  } else if (field === "person.name") {
    people.forEach(function (person) {
      const text = String(person.name == null ? "" : person.name).trim();
      const count = people.filter(function (p) { return won(p.name, text); }).length;
      addCandidate(out, seen, SOURCE_PERSON, text, count, "person");
    });
  } else if (field === "person.tags") {
    collectTags(people).forEach(function (tag) {
      addCandidate(out, seen, SOURCE_PERSON_TAG, tag, countPeopleWithTag(people, tag), "person");
    });
  } else if (field === "person.note") {
    people.forEach(function (person) {
      if (!person.note || !won(person.note, q)) return;
      const text = String(person.note).trim();
      const count = people.filter(function (p) { return won(p.note, text); }).length;
      addCandidate(out, seen, SOURCE_PERSON_NOTE, text, count, "person");
    });
  } else if (field === "assignment.tags") {
    collectTags(assignments).forEach(function (tag) {
      addCandidate(out, seen, SOURCE_ASSIGNMENT_TAG, tag, countAssignmentsWithTag(assignments, tag), "assignment");
    });
  } else if (field === "assignment.note") {
    assignments.forEach(function (assignment) {
      if (!assignment.note || !won(assignment.note, q)) return;
      const text = String(assignment.note).trim();
      const count = assignments.filter(function (a) { return won(a.note, text); }).length;
      addCandidate(out, seen, SOURCE_ASSIGNMENT_NOTE, text, count, "assignment");
    });
  }
}

function orderCandidates(items, q) {
  items.forEach(function (item) {
    item.prefix = lower(item.value).indexOf(q) === 0;
    item.matchLabel = countLabel(item.count, item.unit);
  });
  items.sort(function (a, b) {
    if (a.prefix !== b.prefix) return a.prefix ? -1 : 1;
    if (a.count !== b.count) return b.count - a.count;
    return lower(a.value) < lower(b.value) ? -1 : lower(a.value) > lower(b.value) ? 1 : 0;
  });
  return items;
}

// The plain query's vocabulary, from the areas being looked in.
function scopedSuggestions(plan, q, scopes) {
  const s = scopes || defaultScopes();
  const out = [];
  const seen = new Set();
  if (s.projects) {
    collectField(plan, "project.name", q, out, seen);
    collectField(plan, "project.notes", q, out, seen);
  }
  if (s.people) {
    collectField(plan, "person.name", q, out, seen);
    collectField(plan, "person.tags", q, out, seen);
    collectField(plan, "person.note", q, out, seen);
  }
  if (s.assignments) {
    collectField(plan, "assignment.tags", q, out, seen);
    collectField(plan, "assignment.note", q, out, seen);
  }
  return orderCandidates(out.filter(function (item) { return won(item.value, q); }), q);
}

// The prefix-typed vocabulary: a value suggestion carries the full term, so
// choosing it fills in `field: value` rather than the value alone.
function fieldSuggestions(plan, fields, value, prefix) {
  const q = lower(value).trim();
  const out = [];
  const seen = new Set();
  (fields || []).forEach(function (field) {
    collectField(plan, field, q, out, seen);
  });
  const kept = q === "" ? out : out.filter(function (item) { return won(item.value, q); });
  kept.forEach(function (item) {
    item.kind = "value";
    item.insert = prefix + ": " + item.value;
  });
  return orderCandidates(kept, q);
}

// The prefixes themselves, taught while a plain query is being typed. They
// match from the start of the prefix, so `p` offers the person and project
// fields and `tag` offers `tag:`.
function withTeachingPrefixes(out, q) {
  if (!/^[a-z ]*$/.test(q)) return out;
  const teaching = [];
  TEACHING_PREFIXES.forEach(function (item) {
    if (item.name.indexOf(q) !== 0) return;
    teaching.push({
      kind: "prefix",
      source: SOURCE_FIELD,
      value: item.name + ":",
      insert: item.name + ": ",
      matchLabel: item.label,
      count: 0,
      unit: "field",
      prefix: true
    });
  });
  return teaching.concat(out);
}

/*
 * The plan's own vocabulary, offered while typing: project names, people's
 * names, Assignment tags, Person tags and the text in notes. Each suggestion
 * carries the source it came from and how many things it would match. A plain
 * query draws only from the areas currently looked in; a typed term draws only
 * from the field it names; an unknown prefix draws nothing. Alongside the
 * vocabulary, a plain query is offered the field prefixes themselves.
 */
export function filterSuggestions(plan, query, scopes) {
  const term = parseFilterTerm(query);
  if (term.kind === "unknown") return [];
  if (term.kind === "field") return fieldSuggestions(plan, term.fields, term.value, term.prefix);

  const q = lower(query).trim();
  if (q === "") return [];
  // A recognised prefix with no value yet - `person tag:` - is not a term, so
  // the scope still applies to the text; but the dropdown can still teach the
  // field's whole vocabulary. A colon on anything else is prose.
  const colon = query.indexOf(":");
  if (colon !== -1) {
    const prefix = query.slice(0, colon).trim().toLowerCase().replace(/\s+/g, " ");
    const fields = PREFIX_FIELDS[prefix];
    if (fields && query.slice(colon + 1).trim() === "") {
      return fieldSuggestions(plan, fields, "", prefix);
    }
    return [];
  }
  return withTeachingPrefixes(scopedSuggestions(plan, q, scopes), q);
}
