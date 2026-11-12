/*
 * PACT panel logic: the parts of the Person, Project and Assignment panels
 * that are rules rather than DOM - which tags to suggest, how Availability
 * steps, and how a refused drop is worded.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source.
 */

/*
 * The plan's step: the granularity Availability and Allocation are stepped in,
 * one whole number of per cent from 1 to 100. The same value is the floor, so
 * a 10% step floors at 10% - exactly what the interface did before the step
 * became a setting - a 5% step at 5%, a 1% step at 1%. The ceiling stays 100.
 * An absent or malformed value means 10, so every existing plan loads and
 * behaves as it always did.
 */
export const DEFAULT_STEP = 10;
export const STEP_MIN = 1;
export const STEP_MAX = 100;

export function normalizeStep(value) {
  return Number.isInteger(value) && value >= STEP_MIN && value <= STEP_MAX ? value : DEFAULT_STEP;
}

// The step control's own rule. Returns the message, or null when the value may
// be stored.
export function stepSettingRefusal(value) {
  if (!Number.isInteger(value) || value < STEP_MIN || value > STEP_MAX) {
    return "The percentage step must be a whole number from 1 to 100.";
  }
  return null;
}

// Snap any value to the nearest whole step and keep it inside one step and
// 100, so a panel can never offer a value the server would refuse.
function snapToStep(value, step, fallback) {
  const s = normalizeStep(step);
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback === undefined ? s : fallback;
  const snapped = Math.round(n / s) * s;
  return Math.min(STEP_MAX, Math.max(s, snapped));
}

export function clampAvailability(value, step) {
  const s = normalizeStep(step);
  return snapToStep(value, s, s);
}

export function stepAvailability(value, delta, step) {
  const s = normalizeStep(step);
  const direction = delta < 0 ? -1 : 1;
  return clampAvailability(clampAvailability(value, s) + direction * s, s);
}

/*
 * An Assignment's Allocation, in the same step as Availability. It is set by
 * the same plus-and-minus stepper a Person's Availability uses, or by dragging
 * an edge; a typed value only ever arrives from a drag's pixel arithmetic, and
 * is rounded to the closest step here so the two can never store a different
 * number.
 */
export function clampShare(value, step) {
  return snapToStep(value, step, STEP_MAX);
}

// One step of the Share stepper, clamped at both ends. A step and the drag that
// reaches the same value both pass through clampShare, so the number they store
// is the same.
export function stepShare(value, delta, step) {
  const s = normalizeStep(step);
  const direction = delta < 0 ? -1 : 1;
  return clampShare(clampShare(value, s) + direction * s, s);
}

// Where a vertical edge drag of `steps` plan steps from `value` settles.
export function shareFromDrag(value, steps, step) {
  const s = normalizeStep(step);
  const count = Number.isFinite(steps) ? Math.round(steps) : 0;
  return clampShare(clampShare(value, s) + count * s, s);
}

function tagKey(tag) {
  return String(tag).trim().toLowerCase();
}

// Gather the tags in use, first spelling winning, matched case-insensitively.
function collectTags(items) {
  const seen = new Map();
  items.forEach(function (item) {
    const tags = item && item.tags;
    if (!Array.isArray(tags)) return;
    tags.forEach(function (tag) {
      if (typeof tag !== "string") return;
      const text = tag.trim();
      if (!text) return;
      const key = text.toLowerCase();
      if (!seen.has(key)) seen.set(key, text);
    });
  });
  return seen;
}

function sortedValues(seen) {
  return Array.from(seen.values()).sort(function (a, b) {
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
}

// Gather the Locations in use, first spelling winning, matched
// case-insensitively. A Location is single-valued, so unlike a tag there is
// only ever one per Person.
function collectLocations(items) {
  const seen = new Map();
  items.forEach(function (item) {
    const location = item && item.location;
    if (typeof location !== "string") return;
    const text = location.trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (!seen.has(key)) seen.set(key, text);
  });
  return seen;
}

/*
 * Person tags are offered from the other People only. Assignment tags are a
 * separate vocabulary and are never suggested here, even when a Person's other
 * tags are empty.
 */
export function suggestPersonTags(people, currentPersonId) {
  const current = (people || []).find(function (p) { return p.id === currentPersonId; });
  const own = collectTags(current ? [current] : []);
  const others = collectTags((people || []).filter(function (p) { return p.id !== currentPersonId; }));
  own.forEach(function (_, key) { others.delete(key); });
  return sortedValues(others);
}

/*
 * Project tags are offered from the other Projects only. Person tags and
 * Assignment tags are separate vocabularies and are never suggested here, even
 * when a Project's other tags are empty.
 */
export function suggestProjectTags(projects, currentProjectId) {
  const current = (projects || []).find(function (p) { return p.id === currentProjectId; });
  const own = collectTags(current ? [current] : []);
  const others = collectTags((projects || []).filter(function (p) { return p.id !== currentProjectId; }));
  own.forEach(function (_, key) { others.delete(key); });
  return sortedValues(others);
}

/*
 * Locations are offered from the other People only, the single-valued cousin
 * of Person tags: deduplicated case-insensitively with the first spelling
 * winning, and alphabetical. `configured` adds the Locations the holiday
 * dialog has configured, so the two sources share one suggestion list.
 */
export function suggestPersonLocations(people, currentPersonId, configured) {
  const current = (people || []).find(function (p) { return p.id === currentPersonId; });
  const own = collectLocations(current ? [current] : []);
  const others = collectLocations((people || []).filter(function (p) { return p.id !== currentPersonId; }));
  own.forEach(function (_, key) { others.delete(key); });
  const configuredSeen = collectLocations((configured || []).map(function (location) {
    return { location: location };
  }));
  own.forEach(function (_, key) { configuredSeen.delete(key); });
  configuredSeen.forEach(function (text, key) { if (!others.has(key)) others.set(key, text); });
  return sortedValues(others);
}

/*
 * Assignment tags are offered from that Project's other Assignments, and never
 * from People.
 */
export function suggestAssignmentTags(assignments, projectId, currentAssignmentId) {
  const list = assignments || [];
  const current = list.find(function (a) { return a.id === currentAssignmentId; });
  const own = collectTags(current ? [current] : []);
  const others = collectTags(list.filter(function (a) {
    return a.projectId === projectId && a.id !== currentAssignmentId;
  }));
  own.forEach(function (_, key) { others.delete(key); });
  return sortedValues(others);
}

/*
 * Every element's tags are stored alphabetically, case-insensitive A-Z, so a
 * run of tags reads the same wherever it is edited. The spelling typed is kept;
 * only the order is decided here.
 */
export function sortTags(tags) {
  return (tags || []).slice().sort(function (a, b) {
    const x = String(a).toLowerCase();
    const y = String(b).toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
}

export function hasTag(tags, raw) {
  const key = tagKey(raw);
  return !!key && (tags || []).some(function (t) { return tagKey(t) === key; });
}

export function withTag(tags, raw) {
  const text = String(raw || "").trim();
  const current = (tags || []).slice();
  if (!text || hasTag(current, text)) return current;
  return sortTags(current.concat(text));
}

export function withoutTag(tags, raw) {
  const key = tagKey(raw);
  return (tags || []).filter(function (t) { return tagKey(t) !== key; });
}

/*
 * The plan's period: the explicit start and end dates the owner sets, which
 * are the Timeline's extent and the only dates an Assignment may fall on. Both
 * ends are inclusive, so work touching either one is inside.
 */
function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

// The message a create or a move/resize outside the period is refused with,
// naming the allowed period with both ends inclusive. Returns null when the
// work fits, or when there is no period to test against.
export function outsideRangeRefusal(startISO, endISO, range) {
  if (!range) return null;
  if (startISO >= range.start && endISO <= range.end) return null;
  return "Assignments must fall inside the plan's period, " + range.start +
    " to " + range.end + " inclusive.";
}

// The period control's own rule, applied to the two dates set together: both
// must be real YYYY-MM-DD dates and the start must not be after the end.
// Returns the message, or null when the pair may be stored.
export function rangeSettingRefusal(startISO, endISO) {
  if (!isISODate(startISO) || !isISODate(endISO)) {
    return "The plan's period needs a start and an end, each a valid YYYY-MM-DD date.";
  }
  if (startISO > endISO) return "The plan's period start must not be after its end.";
  return null;
}

export function archivedPersonRefusal(name) {
  return name + " is archived. Restore this person before adding an assignment.";
}

export function archivedProjectRefusal(name) {
  return name + " is archived. Restore this project before adding an assignment.";
}

/*
 * Whether a target can take new work at all: an archived Person or Project is
 * refused by name, and anything else may be dropped on. Returns the message,
 * or null when the drop is allowed.
 */
export function dropRefusal(person, project) {
  if (person && person.archived) return archivedPersonRefusal(person.name);
  if (project && project.archived) return archivedProjectRefusal(project.name);
  return null;
}
