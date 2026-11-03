/*
 * PACT panel logic: the parts of the Person, Project and Assignment panels
 * that are rules rather than DOM - which tags to suggest, how Availability
 * steps, and how a refused drop is worded.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source.
 */

export const AVAILABILITY_MIN = 10;
export const AVAILABILITY_MAX = 100;
export const AVAILABILITY_STEP = 10;

// Snap any value to the nearest whole step and keep it inside the range, so a
// panel can never offer an Availability the server would refuse.
export function clampAvailability(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return AVAILABILITY_MIN;
  const snapped = Math.round(n / AVAILABILITY_STEP) * AVAILABILITY_STEP;
  return Math.min(AVAILABILITY_MAX, Math.max(AVAILABILITY_MIN, snapped));
}

export function stepAvailability(value, delta) {
  const direction = delta < 0 ? -1 : 1;
  return clampAvailability(clampAvailability(value) + direction * AVAILABILITY_STEP);
}

/*
 * An Assignment's Allocation, in the same whole 10% steps as Availability. It
 * is set by the same plus-and-minus stepper a Person's Availability uses, or by
 * dragging an edge; a typed value only ever arrives from a drag's pixel
 * arithmetic, and is rounded to the closest step here so the two can never
 * store a different number.
 */
export const SHARE_MIN = 10;
export const SHARE_MAX = 100;
export const SHARE_STEP = 10;

export function clampShare(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return SHARE_MAX;
  const snapped = Math.round(n / SHARE_STEP) * SHARE_STEP;
  return Math.min(SHARE_MAX, Math.max(SHARE_MIN, snapped));
}

// One step of the Share stepper, clamped at both ends. A step and the drag that
// reaches the same value both pass through clampShare, so the number they store
// is the same.
export function stepShare(value, delta) {
  const direction = delta < 0 ? -1 : 1;
  return clampShare(clampShare(value) + direction * SHARE_STEP);
}

// Where a vertical edge drag of `steps` 10% steps from `value` settles.
export function shareFromDrag(value, steps) {
  const count = Number.isFinite(steps) ? Math.round(steps) : 0;
  return clampShare(clampShare(value) + count * SHARE_STEP);
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

function sortedTags(seen) {
  return Array.from(seen.values()).sort(function (a, b) {
    return a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0;
  });
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
  return sortedTags(others);
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
  return sortedTags(others);
}

export function hasTag(tags, raw) {
  const key = tagKey(raw);
  return !!key && (tags || []).some(function (t) { return tagKey(t) === key; });
}

export function withTag(tags, raw) {
  const text = String(raw || "").trim();
  const current = (tags || []).slice();
  if (!text || hasTag(current, text)) return current;
  return current.concat(text);
}

export function withoutTag(tags, raw) {
  const key = tagKey(raw);
  return (tags || []).filter(function (t) { return tagKey(t) !== key; });
}

export function archivedPersonRefusal(name) {
  return name + " is archived. Restore this person before adding an assignment.";
}

export function archivedProjectRefusal(name) {
  return name + " is archived. Restore this project before adding an assignment.";
}

/*
 * How many Assignments a Person or a Project deletion would take with it,
 * counted over the whole plan so archived Assignments are included: a deletion
 * destroys those too, even while the archive toggle leaves them off screen.
 */
export function assignmentCount(assignments, field, id) {
  return (assignments || []).filter(function (a) { return a && a[field] === id; }).length;
}

/*
 * The words a deletion confirmation always carries: what will go, with the
 * number of Assignments named before them, and that it cannot be undone. A
 * deletion is permanent and takes a Person's or a Project's Assignments with
 * it, so the loss is visible before it happens.
 */
export function deleteConfirmation(kind, name, count) {
  if (kind === "assignment") {
    return "This deletes this assignment. It cannot be undone.";
  }
  const noun = count === 1 ? "assignment" : "assignments";
  const on = kind === "person" ? "them" : "it";
  return "This deletes " + name + " and the " + count + " " + noun + " on " + on +
    ". It cannot be undone.";
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
