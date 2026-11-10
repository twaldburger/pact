/*
 * PACT ordering: the rules that put the Stack (Projects) and the People rows
 * in an order other than the one they were added in. A plain ES module with
 * no imports, so the browser (public/app.js) and `node --test` load exactly
 * the same source.
 *
 * Ordering is display order only. It is a view setting stored in the config,
 * like Zoom and Row height; it never reaches the plan file. With no key chosen
 * the caller's own order is returned untouched, and ties always break by name.
 */

export const ASCENDING = "asc";
export const DESCENDING = "desc";

/*
 * The keys each list offers, with the direction a first press on that key uses
 * and the label the menu draws. The sets are deliberately small: the Projects
 * keys are about when work happens and how much there is, the People keys
 * about who needs attention.
 */
export const PROJECT_SORT_KEYS = [
  { key: "name", label: "Name", direction: ASCENDING },
  { key: "start", label: "First assignment start", direction: ASCENDING },
  { key: "end", label: "Last assignment end", direction: DESCENDING },
  { key: "fte", label: "Total assigned FTE", direction: DESCENDING }
];

export const PEOPLE_SORT_KEYS = [
  { key: "name", label: "Name", direction: ASCENDING },
  { key: "location", label: "Location", direction: ASCENDING },
  { key: "free", label: "Free at the Marker", direction: DESCENDING },
  { key: "load", label: "Load at the Marker", direction: DESCENDING },
  { key: "start", label: "Earliest assignment", direction: ASCENDING }
];

export const SORT_KINDS = ["projects", "people"];

export function sortKeys(kind) {
  return kind === "people" ? PEOPLE_SORT_KEYS : PROJECT_SORT_KEYS;
}

export function findSortKey(kind, key) {
  return sortKeys(kind).find(function (def) { return def.key === key; }) || null;
}

export function isSortKey(kind, key) {
  return findSortKey(kind, key) !== null;
}

// The direction a first press on a key uses. An unknown key is ascending.
export function defaultDirection(kind, key) {
  const def = findSortKey(kind, key);
  return def ? def.direction : ASCENDING;
}

export function oppositeDirection(direction) {
  return direction === DESCENDING ? ASCENDING : DESCENDING;
}

export function directionLabel(direction) {
  return direction === DESCENDING ? "Descending" : "Ascending";
}

// Choosing a key applies it, with that key's sensible direction. Pressing the
// key already in force leaves the order alone; the direction toggle is what
// flips it.
export function selectSortKey(kind, current, key) {
  if (current && current.key === key) return current;
  return { key: key, direction: defaultDirection(kind, key) };
}

// The ascending/descending toggle. With no key chosen there is nothing to
// flip, so the state is returned unchanged.
export function toggleSortDirection(current) {
  if (!current) return current;
  return { key: current.key, direction: oppositeDirection(current.direction) };
}

/* --- derived measures ---------------------------------------------------- */

function isoDay(value) {
  const t = Date.parse(value + "T00:00:00Z");
  return Number.isFinite(t) ? t : null;
}

// Whole days from `start` to `end`, both ends inclusive. A malformed or
// reversed pair has no duration rather than a negative one.
export function inclusiveDays(startISO, endISO) {
  const s = isoDay(startISO);
  const e = isoDay(endISO);
  if (s === null || e === null) return 0;
  return Math.max(0, Math.round((e - s) / 86400000) + 1);
}

/*
 * Each Project's measures, across all of its Assignments in the whole plan:
 * the earliest start, the latest end and the total assigned FTE-days - the sum
 * over its Assignments of `share/100 * inclusive days`. Projects without any
 * Assignment keep null dates and zero FTE-days.
 */
export function projectMeasures(plan) {
  const out = {};
  ((plan && plan.projects) || []).forEach(function (project) {
    out[project.id] = { firstStart: null, lastEnd: null, fteDays: 0 };
  });
  ((plan && plan.assignments) || []).forEach(function (assignment) {
    const m = out[assignment.projectId];
    if (!m) return;
    if (assignment.start && (m.firstStart === null || assignment.start < m.firstStart)) {
      m.firstStart = assignment.start;
    }
    if (assignment.end && (m.lastEnd === null || assignment.end > m.lastEnd)) {
      m.lastEnd = assignment.end;
    }
    m.fteDays += (Number(assignment.share) || 0) / 100 *
      inclusiveDays(assignment.start, assignment.end);
  });
  return out;
}

// Each Person's earliest Assignment start in the whole plan, or null when they
// have none.
export function personMeasures(plan) {
  const out = {};
  ((plan && plan.people) || []).forEach(function (person) {
    out[person.id] = { earliestStart: null };
  });
  ((plan && plan.assignments) || []).forEach(function (assignment) {
    const m = out[assignment.personId];
    if (!m || !assignment.start) return;
    if (m.earliestStart === null || assignment.start < m.earliestStart) {
      m.earliestStart = assignment.start;
    }
  });
  return out;
}

/*
 * A Person's load on one day: the total allocated share active at that date,
 * as a fraction of a full working week. The whole plan is read, not the
 * filtered view, so the order and the row-header figure describe the same
 * Person. ISO dates compare exactly as strings.
 */
export function personLoadAt(plan, personId, dateISO) {
  let total = 0;
  ((plan && plan.assignments) || []).forEach(function (assignment) {
    if (assignment.personId !== personId) return;
    if (assignment.start <= dateISO && assignment.end >= dateISO) {
      total += (Number(assignment.share) || 0) / 100;
    }
  });
  return total;
}

/* --- ordering ------------------------------------------------------------ */

// Ascending or descending by value. A missing value sorts last in both
// directions, so an empty Project or Person never displaces real work.
function compareValues(a, b, direction) {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  let d;
  if (typeof a === "string" || typeof b === "string") {
    const as = String(a);
    const bs = String(b);
    d = as < bs ? -1 : as > bs ? 1 : 0;
  } else {
    d = a < b ? -1 : a > b ? 1 : 0;
  }
  return direction === DESCENDING ? -d : d;
}

// The tie-break: by name, case-insensitively, then by the original spelling
// and the id so two items that share a name still have one fixed order.
function compareNameThenId(a, b) {
  const an = String((a && a.name) == null ? "" : a.name);
  const bn = String((b && b.name) == null ? "" : b.name);
  const al = an.toLowerCase();
  const bl = bn.toLowerCase();
  if (al < bl) return -1;
  if (al > bl) return 1;
  if (an < bn) return -1;
  if (an > bn) return 1;
  const ai = String((a && a.id) == null ? "" : a.id);
  const bi = String((b && b.id) == null ? "" : b.id);
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

function projectValue(project, key, measures) {
  const m = measures[project.id] || { firstStart: null, lastEnd: null, fteDays: 0 };
  if (key === "start") return m.firstStart;
  if (key === "end") return m.lastEnd;
  if (key === "fte") return m.fteDays;
  return null;
}

function personValue(person, key, measures, plan, markerISO) {
  // Free capacity: what the Person is available for minus what is already
  // committed at the Marker's date. Both are fractions of a full week, and an
  // over-allocated Person goes negative rather than being clamped at zero.
  if (key === "free") {
    return (Number(person.availability) || 0) / 100 - personLoadAt(plan, person.id, markerISO);
  }
  if (key === "load") return personLoadAt(plan, person.id, markerISO);
  // A Person with no Location has no value to group on, so it is null and
  // sorts last in both directions, beside the other missing values.
  if (key === "location") {
    const text = String(person.location == null ? "" : person.location).trim();
    return text === "" ? null : text.toLowerCase();
  }
  if (key === "start") {
    const m = measures[person.id];
    return m ? m.earliestStart : null;
  }
  return null;
}

/*
 * The Projects in display order. A null or unknown state means the plan's own
 * order, returned as a copy so the caller's list is never touched. Otherwise
 * the sort is by the chosen key, with the name tie-break.
 */
export function sortProjects(projects, state, plan) {
  const list = (projects || []).slice();
  if (!state || !isSortKey("projects", state.key)) return list;
  const measures = projectMeasures(plan);
  const direction = state.direction === DESCENDING ? DESCENDING : ASCENDING;
  return list.sort(function (a, b) {
    if (state.key !== "name") {
      const d = compareValues(projectValue(a, state.key, measures),
        projectValue(b, state.key, measures), direction);
      if (d !== 0) return d;
    } else {
      const d = compareValues(String(a.name == null ? "" : a.name).toLowerCase(),
        String(b.name == null ? "" : b.name).toLowerCase(), direction);
      if (d !== 0) return d;
    }
    return compareNameThenId(a, b);
  });
}

/*
 * The People in display order. `markerISO` is the Marker's date, read for the
 * load and free-capacity keys. A null or unknown state means the plan's own
 * order.
 */
export function sortPeople(people, state, plan, markerISO) {
  const list = (people || []).slice();
  if (!state || !isSortKey("people", state.key)) return list;
  const measures = personMeasures(plan);
  const direction = state.direction === DESCENDING ? DESCENDING : ASCENDING;
  return list.sort(function (a, b) {
    if (state.key !== "name") {
      const d = compareValues(personValue(a, state.key, measures, plan, markerISO),
        personValue(b, state.key, measures, plan, markerISO), direction);
      if (d !== 0) return d;
    } else {
      const d = compareValues(String(a.name == null ? "" : a.name).toLowerCase(),
        String(b.name == null ? "" : b.name).toLowerCase(), direction);
      if (d !== 0) return d;
    }
    return compareNameThenId(a, b);
  });
}

/* --- the Marker rule ----------------------------------------------------- */

export const MARKER_DRAG = "drag";
export const MARKER_RELEASE = "release";
export const SORT_APPLIED = "apply";

/*
 * Whether a change in the Marker position should recompute the People order.
 * A load or free-capacity order reads the Marker, so it is recomputed when the
 * sort is applied and when the Marker is released, but never while the Marker
 * is being dragged: the rows stay where they are under the pointer. Every
 * other key is independent of the Marker and needs no recomputation at all.
 */
export function markerReordersPeople(phase, key) {
  if (key !== "load" && key !== "free") return false;
  return phase === MARKER_RELEASE || phase === SORT_APPLIED;
}
