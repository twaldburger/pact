/*
 * PACT plan store, validation and persistence. Node built-ins, plus the shared
 * pure range rules in public/lib/panels.mjs, so the store, the API and every
 * drag path refuse the same work with the same wording.
 *
 * One JSON file is the single source of truth, and the store can be pointed at
 * a different one at runtime. Writes are atomic: the new plan is written to a
 * temporary file beside it, flushed, then renamed over the old one, so an
 * interrupted save can never truncate the plan. Before each write the file on
 * disk is compared with what the store last read or wrote, and a write that
 * would clobber another writer's change is refused. A file the store is seeded
 * into is created on first run from a seeded plan, which is convenience data
 * for a fresh checkout.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { outsideRangeRefusal, rangeSettingRefusal, sortTags, stepSettingRefusal } from "../public/lib/panels.mjs";
import { leastUsedSlot, slotForColour } from "../public/lib/palette.mjs";
import { SPRINT_LENGTH_MAX, SPRINT_LENGTH_MIN } from "../public/lib/sprints.mjs";
import { isHolidayKind } from "../public/lib/holidays.mjs";
import { isTagLevel, isTypedTag } from "../public/lib/tags.mjs";

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

// A refusal about the plan file itself - a missing, unreadable, unwritable or
// clobbered file - as opposed to a refusal about the plan's content. The status
// is the HTTP status the API answers with, so the client can tell the two apart.
export class PlanFileError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PlanFileError";
    this.status = status || 400;
  }
}

const DAY_MS = 86400000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toISO(date) {
  return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" +
    pad2(date.getUTCDate());
}

export function fromISO(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

export function isValidISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toISO(fromISO(value)) === value;
}

export function todayISO(now) {
  const n = now || new Date();
  return toISO(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
}

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}

function monthEnd(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

// How much of today's neighbourhood the seed covers: the same recent past and
// eleven months ahead the seed has always drawn.
export const RANGE_PAST_MONTHS = 2;
export const RANGE_FUTURE_MONTHS = 11;

// The extent a plan starts with: the same recent past and eleven months ahead
// the seed has always drawn. A new empty plan still needs an explicit period,
// because the period is never inferred from the plan's content.
export function defaultRange(now) {
  const today = now || fromISO(todayISO());
  return {
    start: toISO(addMonths(today, -RANGE_PAST_MONTHS)),
    end: toISO(monthEnd(addMonths(today, RANGE_FUTURE_MONTHS)))
  };
}

// A truly empty plan: the default period and no people, projects or
// assignments. This is what New plan creates at a path the owner chooses.
export function emptyPlan(now) {
  return { range: defaultRange(now), people: [], projects: [], assignments: [] };
}

/*
 * The plan a fresh checkout starts from: the three people and four projects from
 * the pass-2 fixture, with Ben over-committed at today. The dates are relative
 * to the first run so the seed still reads as a live plan whenever it is first
 * started. It is convenience data, not part of the repository.
 */
export function seedPlan() {
  const today = fromISO(todayISO());
  const d = (n) => toISO(addDays(today, n));
  return {
    range: defaultRange(today),
    people: [
      { id: "anna", name: "Anna Meier", availability: 100, tags: ["lead", "React"], note: "leads Atlas" },
      { id: "ben", name: "Ben Falk", availability: 80, tags: ["Design", "React"], note: "contract through June" },
      { id: "cara", name: "Cara Nowak", availability: 60, tags: ["Design"], note: "part-time, Tue-Thu" }
    ],
    projects: [
      { id: "atlas", name: "Atlas", colour: 1, notes: "phase one", tags: ["Platform"] },
      { id: "borealis", name: "Borealis", colour: 3, notes: "phase two", tags: ["Platform"] },
      { id: "cara-onboarding", name: "Cara onboarding", colour: 9, notes: "", tags: ["Onboarding"] },
      { id: "warehouse-move", name: "Warehouse move", colour: 0, notes: "not started", tags: ["Operations"] }
    ],
    assignments: [
      { id: "a-atlas-anna", projectId: "atlas", personId: "anna", start: d(-4), end: d(38), share: 60, tags: ["Design", "React"], note: "shadowing Cara" },
      { id: "a-atlas-ben", projectId: "atlas", personId: "ben", start: d(-4), end: d(8), share: 60, tags: ["React"], note: "" },
      { id: "a-borealis-ben", projectId: "borealis", personId: "ben", start: d(0), end: d(36), share: 30, tags: ["Design"], note: "handover from Atlas" },
      { id: "a-borealis-cara", projectId: "borealis", personId: "cara", start: d(-2), end: d(22), share: 20, tags: [], note: "" },
      { id: "a-onboard-cara", projectId: "cara-onboarding", personId: "cara", start: d(25), end: d(57), share: 20, tags: ["Design"], note: "paired with Anna" }
    ]
  };
}

/* --- validation ---------------------------------------------------------- */

function assertPlain(input, what) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError(what + " must be a JSON object");
  }
}

function rejectUnknown(input, allowed, what) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw new ValidationError(what + " has an unknown field '" + key + "'");
  }
}

function requireString(value, what) {
  if (typeof value !== "string" || value.trim() === "") throw new ValidationError(what + " must be a non-empty string");
  return value;
}

function optionalString(value, what) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new ValidationError(what + " must be a string");
  return value;
}

function optionalStringArray(value, what) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(what + " must be an array of strings");
  }
  return value.slice();
}

function requireBoolean(value, what) {
  if (typeof value !== "boolean") throw new ValidationError(what + " must be a boolean");
  return value;
}

// A whole percentage from 1 to 100. The step is the interface's rule, not the
// server's, so any whole value in the range is accepted however far it sits
// from the plan's step - changing the step never invalidates a stored value.
function requirePercent(value, what) {
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new ValidationError(what + " must be a whole number from 1 to 100");
  }
  return value;
}

// A colour is a slot 0..9. A stored legacy ink name is migrated to its slot
// here, so the value a write persists is always the slot.
function requireColour(value, what) {
  const slot = slotForColour(value);
  if (slot === null) throw new ValidationError(what + " must be a slot 0..9");
  return slot;
}

function requireSlug(value, what) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new ValidationError(what + " must be a lowercase slug");
  }
  return value;
}

function requireDate(value, what) {
  if (!isValidISODate(value)) throw new ValidationError(what + " must be a valid YYYY-MM-DD date");
  return value;
}

function requireRef(value, list, what) {
  if (typeof value !== "string" || !list.some((item) => item.id === value)) {
    throw new ValidationError(what + " does not match a known id");
  }
  return value;
}

function normalizePerson(input) {
  assertPlain(input, "person");
  const person = {
    name: requireString(input.name, "person.name"),
    location: optionalString(input.location, "person.location"),
    availability: requirePercent(input.availability, "person.availability"),
    tags: sortTags(optionalStringArray(input.tags, "person.tags")),
    note: optionalString(input.note, "person.note")
  };
  if (input.id !== undefined) person.id = requireSlug(input.id, "person.id");
  // Archiving is a state a Person already carries; an update may set it back to
  // false so an archived Person can be restored.
  if (input.archived !== undefined) person.archived = requireBoolean(input.archived, "person.archived");
  return person;
}

function normalizeProject(input) {
  assertPlain(input, "project");
  const project = {
    name: requireString(input.name, "project.name"),
    colour: requireColour(input.colour, "project.colour"),
    notes: optionalString(input.notes, "project.notes"),
    tags: sortTags(optionalStringArray(input.tags, "project.tags"))
  };
  if (input.id !== undefined) project.id = requireSlug(input.id, "project.id");
  if (input.absence !== undefined) project.absence = requireBoolean(input.absence, "project.absence");
  if (input.archived !== undefined) project.archived = requireBoolean(input.archived, "project.archived");
  return project;
}

// A Milestone is one dated point in the plan: a name, that single date, a
// palette slot, its own tags and notes, and the ids of the Projects it relates
// to. A related id is stored as written and never resolved here - a Project
// deleted from under a Milestone leaves a stale id behind, and a plan that
// refused to open over one would be worse than a link that resolves to nothing
// (public/lib/milestones.mjs owns what the interface makes of it).
function normalizeMilestone(input) {
  assertPlain(input, "milestone");
  const milestone = {};
  if (input.id !== undefined) milestone.id = requireSlug(input.id, "milestone.id");
  milestone.name = requireString(input.name, "milestone.name");
  milestone.date = requireDate(input.date, "milestone.date");
  milestone.colour = requireColour(input.colour, "milestone.colour");
  milestone.tags = sortTags(optionalStringArray(input.tags, "milestone.tags"));
  milestone.notes = optionalString(input.notes, "milestone.notes");
  milestone.projectIds = optionalStringArray(input.projectIds, "milestone.projectIds");
  return milestone;
}

function normalizeAssignment(input, plan) {
  assertPlain(input, "assignment");
  const start = requireDate(input.start, "assignment.start");
  const end = requireDate(input.end, "assignment.end");
  if (start > end) throw new ValidationError("assignment.start must not be after assignment.end");
  const assignment = {
    projectId: requireRef(input.projectId, plan.projects, "assignment.projectId"),
    personId: requireRef(input.personId, plan.people, "assignment.personId"),
    start: start,
    end: end,
    share: requirePercent(input.share, "assignment.share"),
    // The Assignment's own name: free text beside the dates and the share, so
    // two Assignments of one Project can say which work is which. Optional,
    // and never a second Project - it carries no colour, no tags and no share.
    name: optionalString(input.name, "assignment.name"),
    tags: sortTags(optionalStringArray(input.tags, "assignment.tags")),
    note: optionalString(input.note, "assignment.note")
  };
  // Shape and reference errors are named before the period refusal, so a
  // malformed Assignment and an out-of-period one each keep their own message.
  const refusal = outsideRangeRefusal(start, end, plan.range);
  if (refusal) throw new ValidationError(refusal);
  if (input.id !== undefined) assignment.id = requireSlug(input.id, "assignment.id");
  // Archiving is a state an Assignment already carries; an update may set it
  // back to false so an archived Assignment can be restored.
  if (input.archived !== undefined) assignment.archived = requireBoolean(input.archived, "assignment.archived");
  return assignment;
}

function checkList(list, what, errors, check) {
  if (!Array.isArray(list)) {
    errors.push(what + " must be an array");
    return;
  }
  const ids = new Set();
  list.forEach((item, i) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(what + "[" + i + "] must be an object");
      return;
    }
    if (typeof item.id !== "string" || item.id === "") {
      errors.push(what + "[" + i + "].id must be a non-empty string");
    } else if (ids.has(item.id)) {
      errors.push(what + " has a duplicate id '" + item.id + "'");
    } else {
      ids.add(item.id);
    }
    const problem = check(item);
    if (problem) errors.push(problem);
  });
}

export function validatePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["plan must be an object"];
  const errors = [];
  const range = plan.range;
  const rangeRefusal = rangeSettingRefusal(range && range.start, range && range.end);
  if (rangeRefusal) errors.push(rangeRefusal);

  // The step sits beside the period. Absent is the default of 10; a stored one
  // must be a whole number from 1 to 100.
  if (plan.step !== undefined) {
    const stepRefusal = stepSettingRefusal(plan.step);
    if (stepRefusal) errors.push(stepRefusal);
  }

  // Sprints are plan data beside the period: the cadence that names and spaces
  // the chain, and the per-sprint adjustments keyed by ordinal. Both are
  // optional, so a plan without them loads and behaves exactly as before.
  if (plan.cadence !== undefined) {
    const cadence = plan.cadence;
    if (!cadence || typeof cadence !== "object" || Array.isArray(cadence)) {
      errors.push("cadence must be an object");
    } else {
      if (!isValidISODate(cadence.start)) {
        errors.push("cadence.start must be a valid YYYY-MM-DD date");
      }
      if (!Number.isInteger(cadence.length) || cadence.length < SPRINT_LENGTH_MIN || cadence.length > SPRINT_LENGTH_MAX) {
        errors.push("cadence.length must be a whole number from " + SPRINT_LENGTH_MIN + " to " + SPRINT_LENGTH_MAX);
      }
      if (typeof cadence.namePrefix !== "string") {
        errors.push("cadence.namePrefix must be a string");
      }
      // The first number may be stored as a whole number or as the digits that
      // set the padding width, leading zeros included.
      const number = cadence.nameNumber;
      const whole = Number.isInteger(number) && number >= 0;
      const digits = typeof number === "string" && /^\d+$/.test(number);
      if (!whole && !digits) {
        errors.push("cadence.nameNumber must be a whole number");
      }
    }
  }

  if (plan.sprints !== undefined) {
    if (!Array.isArray(plan.sprints)) {
      errors.push("sprints must be an array");
    } else {
      plan.sprints.forEach((item, i) => {
        const what = "sprints[" + i + "]";
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          errors.push(what + " must be an object");
          return;
        }
        if (!Number.isInteger(item.index) || item.index < 1) {
          errors.push(what + ".index must be a whole number of at least 1");
        }
        if (item.length !== undefined &&
            (!Number.isInteger(item.length) || item.length < SPRINT_LENGTH_MIN || item.length > SPRINT_LENGTH_MAX)) {
          errors.push(what + ".length must be a whole number from " + SPRINT_LENGTH_MIN + " to " + SPRINT_LENGTH_MAX);
        }
        if (item.name !== undefined && typeof item.name !== "string") {
          errors.push(what + ".name must be a string");
        }
      });
    }
  }

  // Holidays are plan data beside the period: a Location and its dates, each
  // marked full or half. Optional, so a plan without them loads and behaves
  // exactly as before.
  if (plan.holidays !== undefined) {
    if (!Array.isArray(plan.holidays)) {
      errors.push("holidays must be an array");
    } else {
      plan.holidays.forEach((group, g) => {
        const what = "holidays[" + g + "]";
        if (!group || typeof group !== "object" || Array.isArray(group)) {
          errors.push(what + " must be an object");
          return;
        }
        if (typeof group.location !== "string" || group.location.trim() === "") {
          errors.push(what + ".location must be a non-empty string");
        }
        if (!Array.isArray(group.dates)) {
          errors.push(what + ".dates must be an array");
          return;
        }
        group.dates.forEach((entry, d) => {
          const dateWhat = what + ".dates[" + d + "]";
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            errors.push(dateWhat + " must be an object");
            return;
          }
          if (!isValidISODate(entry.date)) {
            errors.push(dateWhat + ".date must be a valid YYYY-MM-DD date");
          }
          if (!isHolidayKind(entry.kind)) {
            errors.push(dateWhat + ".kind must be \"full\" or \"half\"");
          }
        });
      });
    }
  }

  // Typed tags' colours are plan data beside the period: the colour-by-key
  // choice for each of the three levels and a palette slot per typed tag.
  // Optional, so a plan without them loads and behaves exactly as before.
  if (plan.tagColours !== undefined) {
    const colours = plan.tagColours;
    if (!colours || typeof colours !== "object" || Array.isArray(colours)) {
      errors.push("tagColours must be an object");
    } else {
      if (colours.keys !== undefined) {
        if (!colours.keys || typeof colours.keys !== "object" || Array.isArray(colours.keys)) {
          errors.push("tagColours.keys must be an object");
        } else {
          Object.keys(colours.keys).forEach((level) => {
            if (!isTagLevel(level)) {
              errors.push("tagColours.keys has an unknown level '" + level + "'");
            } else if (typeof colours.keys[level] !== "string" || colours.keys[level].trim() === "") {
              errors.push("tagColours.keys." + level + " must be a non-empty string");
            }
          });
        }
      }
      if (colours.colours !== undefined) {
        if (!colours.colours || typeof colours.colours !== "object" || Array.isArray(colours.colours)) {
          errors.push("tagColours.colours must be an object");
        } else {
          Object.keys(colours.colours).forEach((tag) => {
            if (!isTypedTag(tag)) {
              errors.push("tagColours.colours has a key that is not a typed tag: '" + tag + "'");
            } else if (!Number.isInteger(colours.colours[tag]) || slotForColour(colours.colours[tag]) === null) {
              errors.push("tagColours.colours['" + tag + "'] must be a slot 0..9");
            }
          });
        }
      }
    }
  }

  // The report's by-tag selection is plan data beside the period: the set of
  // tags the view's rows are. Optional, so a plan without one loads and behaves
  // exactly as before. A plan still carrying the shape this replaced - a key
  // plus the tags added beside it - keeps loading and is read as the equivalent
  // tag set (`tagSelection` in report-content.mjs): a display setting must
  // never stop a plan from opening, so the obsolete `key` is checked only where
  // it is still written.
  if (plan.tagSplit !== undefined) {
    const split = plan.tagSplit;
    if (!split || typeof split !== "object" || Array.isArray(split)) {
      errors.push("tagSplit must be an object");
    } else {
      if (split.key !== undefined) {
        if (typeof split.key !== "string" || split.key.trim() === "") {
          errors.push("tagSplit.key must be a non-empty string");
        } else if (split.key.indexOf(":") !== -1) {
          errors.push("tagSplit.key must be a tag kind, without a colon");
        }
      }
      if (split.tags !== undefined) {
        if (!Array.isArray(split.tags) || split.tags.some((tag) => typeof tag !== "string" || tag === "")) {
          errors.push("tagSplit.tags must be an array of non-empty strings");
        }
      }
    }
  }

  checkList(plan.people, "people", errors, (person) => {
    if (typeof person.name !== "string" || person.name.trim() === "") return "people.name must be a non-empty string";
    if (!Number.isInteger(person.availability) || person.availability < 1 || person.availability > 100) {
      return "people.availability must be a whole number from 1 to 100";
    }
    if (person.tags !== undefined && (!Array.isArray(person.tags) || person.tags.some((t) => typeof t !== "string"))) {
      return "people.tags must be an array of strings";
    }
    if (person.location !== undefined && typeof person.location !== "string") return "people.location must be a string";
    if (person.note !== undefined && typeof person.note !== "string") return "people.note must be a string";
    if (person.archived !== undefined && typeof person.archived !== "boolean") return "people.archived must be a boolean";
    return null;
  });

  checkList(plan.projects, "projects", errors, (project) => {
    if (typeof project.name !== "string" || project.name.trim() === "") return "projects.name must be a non-empty string";
    if (slotForColour(project.colour) === null) return "projects.colour must be a slot 0..9";
    if (project.notes !== undefined && typeof project.notes !== "string") return "projects.notes must be a string";
    if (project.absence !== undefined && typeof project.absence !== "boolean") return "projects.absence must be a boolean";
    if (project.tags !== undefined && (!Array.isArray(project.tags) || project.tags.some((t) => typeof t !== "string"))) {
      return "projects.tags must be an array of strings";
    }
    if (project.archived !== undefined && typeof project.archived !== "boolean") return "projects.archived must be a boolean";
    return null;
  });

  const personIds = new Set(Array.isArray(plan.people) ? plan.people.map((p) => p && p.id) : []);
  const projectIds = new Set(Array.isArray(plan.projects) ? plan.projects.map((p) => p && p.id) : []);
  checkList(plan.assignments, "assignments", errors, (assignment) => {
    if (!projectIds.has(assignment.projectId)) return "assignments.projectId must match a project";
    if (!personIds.has(assignment.personId)) return "assignments.personId must match a person";
    if (!isValidISODate(assignment.start) || !isValidISODate(assignment.end)) {
      return "assignments.start and assignments.end must be valid YYYY-MM-DD dates";
    }
    if (assignment.start > assignment.end) return "assignments.start must not be after assignments.end";
    if (!Number.isInteger(assignment.share) || assignment.share < 1 || assignment.share > 100) {
      return "assignments.share must be a whole number from 1 to 100";
    }
    if (assignment.tags !== undefined && (!Array.isArray(assignment.tags) || assignment.tags.some((t) => typeof t !== "string"))) {
      return "assignments.tags must be an array of strings";
    }
    if (assignment.note !== undefined && typeof assignment.note !== "string") return "assignments.note must be a string";
    if (assignment.name !== undefined && typeof assignment.name !== "string") return "assignments.name must be a string";
    if (assignment.archived !== undefined && typeof assignment.archived !== "boolean") return "assignments.archived must be a boolean";
    return null;
  });

  // Milestones are plan data beside the period: one dated point each, with a
  // colour, tags, notes and the Projects it relates to. Optional, so a plan
  // without them loads and behaves exactly as before. A related Project id is
  // checked for shape only, never resolved: a Project deleted from under a
  // Milestone leaves a stale id behind, and a plan that refused to open over
  // one would be a worse outcome than a link that resolves to nothing.
  if (plan.milestones !== undefined) {
    checkList(plan.milestones, "milestones", errors, (milestone) => {
      if (typeof milestone.name !== "string" || milestone.name.trim() === "") {
        return "milestones.name must be a non-empty string";
      }
      if (!isValidISODate(milestone.date)) return "milestones.date must be a valid YYYY-MM-DD date";
      if (slotForColour(milestone.colour) === null) return "milestones.colour must be a slot 0..9";
      if (milestone.tags !== undefined &&
          (!Array.isArray(milestone.tags) || milestone.tags.some((t) => typeof t !== "string"))) {
        return "milestones.tags must be an array of strings";
      }
      if (milestone.notes !== undefined && typeof milestone.notes !== "string") {
        return "milestones.notes must be a string";
      }
      if (milestone.projectIds !== undefined &&
          (!Array.isArray(milestone.projectIds) || milestone.projectIds.some((id) => typeof id !== "string"))) {
        return "milestones.projectIds must be an array of strings";
      }
      return null;
    });
  }

  return errors;
}

// Rewrite every Project's legacy ink name to its slot in one pass, so a plan
// written before colour became a slot is persisted in the new shape. Returns
// whether anything changed. Only called on a plan that already validated, so
// it can never write a broken file.
function migrateColours(plan) {
  let changed = false;
  if (!plan || !Array.isArray(plan.projects)) return false;
  plan.projects.forEach((project) => {
    if (!project || typeof project !== "object") return;
    const slot = slotForColour(project.colour);
    if (slot !== null && project.colour !== slot) {
      project.colour = slot;
      changed = true;
    }
  });
  return changed;
}

// A tag-colour mapping with no key chosen and no value coloured is no mapping
// at all: the plan key is dropped, the way an empty holidays list is. Only a
// well-formed empty object counts, so a malformed one is stored and then
// refused by validatePlan rather than silently ignored.
function isEmptyTagColours(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const emptyPart = (part) => part === undefined ||
    (!!part && typeof part === "object" && !Array.isArray(part) && Object.keys(part).length === 0);
  return emptyPart(value.keys) && emptyPart(value.colours);
}

// A selection holding no tags is no selection at all: the plan key is dropped,
// the way an empty holidays list is. Only a well-formed empty object counts, so
// a malformed one is stored and then refused by validatePlan rather than
// silently ignored.
function isEmptyTagSplit(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const key = typeof value.key === "string" ? value.key.trim() : "";
  const tags = value.tags === undefined ? [] : value.tags;
  if (!Array.isArray(tags)) return false;
  return key === "" && tags.length === 0;
}

/* --- atomic write -------------------------------------------------------- */

export function atomicWrite(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = path.join(
    path.dirname(filePath),
    "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + Math.random().toString(36).slice(2)
  );
  let fd;
  try {
    fd = fs.openSync(temp, "w");
    fs.writeFileSync(fd, text, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, filePath);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) { /* already closed */ }
    }
    try { fs.unlinkSync(temp); } catch (_) { /* nothing to remove */ }
    throw err;
  }
}

/* --- store --------------------------------------------------------------- */

function serialize(plan) {
  return JSON.stringify(plan, null, 2) + "\n";
}

// What the store last saw in the file: a content hash, so a change of any kind
// is caught even when the size and the timestamp happen to match. A missing or
// unreadable file reads as null, which never matches a recorded hash.
function fingerprint(filePath) {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
  } catch (_) {
    return null;
  }
}

function readPlanFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    throw new PlanFileError("cannot read " + filePath + ": " + err.message, 400);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PlanFileError(filePath + " is not valid JSON: " + err.message, 400);
  }
  const errors = validatePlan(parsed);
  if (errors.length) throw new PlanFileError(filePath + " is not a valid plan: " + errors.join("; "), 400);
  return parsed;
}

function loadExisting(filePath) {
  const parsed = readPlanFile(filePath);
  if (migrateColours(parsed)) atomicWrite(filePath, serialize(parsed));
  return parsed;
}

function loadOrSeed(filePath) {
  if (fs.existsSync(filePath)) return loadExisting(filePath);
  const seed = seedPlan();
  atomicWrite(filePath, serialize(seed));
  return seed;
}

// How many steps of history the running server keeps. The history is whole-plan
// snapshots held in memory only: it survives a page reload because the process
// keeps running, and it dies with a restart. Nothing new is written to disk.
export const HISTORY_LIMIT = 100;

export function createStore(filePath) {
  let plan = loadOrSeed(filePath);
  let current = filePath;
  let lastRead = fingerprint(current);
  const undoStack = [];
  const redoStack = [];

  // A write is refused when the file on disk no longer matches what PACT last
  // read or wrote. Another writer's change then becomes a visible choice rather
  // than a silent clobber, and the running plan keeps working from memory.
  function guardUnchanged() {
    if (fingerprint(current) !== lastRead) {
      throw new PlanFileError(
        "the plan file changed on disk since PACT last read it (" + current + "); nothing was written",
        409
      );
    }
  }

  // Adopt a freshly loaded file as the active plan. Switching files clears the
  // in-memory history, which described a different plan.
  function adopt(target, loaded) {
    plan = loaded;
    current = target;
    lastRead = fingerprint(target);
    undoStack.length = 0;
    redoStack.length = 0;
  }

  // Mutate a clone, validate it, write it, and only then adopt it in memory, so
  // a refused or failed save leaves both the file and the running plan as they
  // were. The previous plan is recorded as one undo step only once the write
  // has landed, so a failed save records nothing.
  function commit(mutator) {
    const next = structuredClone(plan);
    const result = mutator(next);
    const errors = validatePlan(next);
    if (errors.length) throw new ValidationError(errors.join("; "));
    guardUnchanged();
    atomicWrite(current, serialize(next));
    lastRead = fingerprint(current);
    undoStack.push(plan);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    plan = next;
    return result === undefined ? undefined : structuredClone(result);
  }

  // Step the history by one: take the snapshot the source stack holds, validate
  // it, write it atomically and only then move it to the other stack and adopt
  // it. A refusal or a failed write leaves the file, the plan and both stacks
  // exactly as they were.
  function step(fromStack, toStack, emptyMessage) {
    if (fromStack.length === 0) throw new ValidationError(emptyMessage);
    const target = fromStack[fromStack.length - 1];
    const errors = validatePlan(target);
    if (errors.length) throw new ValidationError(errors.join("; "));
    guardUnchanged();
    atomicWrite(current, serialize(target));
    lastRead = fingerprint(current);
    fromStack.pop();
    toStack.push(plan);
    plan = target;
  }

  function uniqueId(prefix, list) {
    const taken = new Set(list.map((item) => item.id));
    let id;
    do {
      id = prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
    } while (taken.has(id));
    return id;
  }

  function findPerson(next, id) {
    const person = next.people.find((p) => p.id === id);
    if (!person) throw new NotFoundError("no person with id '" + id + "'");
    return person;
  }

  function findProject(next, id) {
    const project = next.projects.find((p) => p.id === id);
    if (!project) throw new NotFoundError("no project with id '" + id + "'");
    return project;
  }

  function findAssignment(next, id) {
    const assignment = next.assignments.find((a) => a.id === id);
    if (!assignment) throw new NotFoundError("no assignment with id '" + id + "'");
    return assignment;
  }

  function findMilestone(next, id) {
    const milestone = (next.milestones || []).find((m) => m.id === id);
    if (!milestone) throw new NotFoundError("no milestone with id '" + id + "'");
    return milestone;
  }

  return {
    // The resolved absolute path of the active plan file.
    planFilePath: function () {
      return current;
    },

    // Switch the active plan to an existing file. Refused plainly when nothing
    // is there, when it cannot be read, or when it is not writable; the running
    // plan stays loaded. A read-only file is refused here rather than at the
    // first write, because a plan PACT cannot save has no business being open.
    openPlan: function (target) {
      if (!fs.existsSync(target)) throw new PlanFileError("no plan file at " + target, 404);
      try {
        fs.accessSync(target, fs.constants.W_OK);
      } catch (_) {
        throw new PlanFileError("the plan file at " + target + " is not writable", 403);
      }
      adopt(target, loadExisting(target));
      return { path: target };
    },

    // Create a truly empty plan at a path that does not exist yet, then make it
    // active. It never creates over an existing file.
    newPlan: function (target) {
      if (fs.existsSync(target)) {
        throw new PlanFileError("a file already exists at " + target + " - open it instead", 409);
      }
      const empty = emptyPlan();
      atomicWrite(target, serialize(empty));
      adopt(target, empty);
      return { path: target };
    },

    get: function () {
      return structuredClone(plan);
    },

    canUndo: function () {
      return undoStack.length > 0;
    },

    canRedo: function () {
      return redoStack.length > 0;
    },

    historyDepth: function () {
      return { undo: undoStack.length, redo: redoStack.length };
    },

    // One action back, whatever the action was: a drag, a panel save, a create,
    // an archive, a delete, a restore or a period change each costs one step.
    undo: function () {
      return step(undoStack, redoStack, "there is nothing to undo");
    },

    redo: function () {
      return step(redoStack, undoStack, "there is nothing to redo");
    },

    // The one write that may change the extent: the owner sets both ends
    // together. Nothing grows or recomputes the range on its own, so a stored
    // file keeps exactly the period it was saved with.
    // The plan's step, beside the period: one write that changes only it, so a
    // setting change never re-snaps or rewrites any stored Availability or
    // Share.
    setStep: function (input) {
      assertPlain(input, "plan settings");
      rejectUnknown(input, ["step"], "plan settings");
      return commit((next) => {
        next.step = requirePercent(input.step, "plan.step");
        return { step: next.step };
      });
    },

    setRange: function (input) {
      assertPlain(input, "range");
      rejectUnknown(input, ["start", "end"], "range");
      return commit((next) => {
        const refusal = rangeSettingRefusal(input.start, input.end);
        if (refusal) throw new ValidationError(refusal);
        next.range = { start: input.start, end: input.end };
        return { start: input.start, end: input.end };
      });
    },

    // Sprints are plan data beside the period: one write that sets the cadence
    // and the per-sprint adjustments together, or clears them when the cadence
    // is null. It is one undo step and one atomic save, like any other change.
    setSprints: function (input) {
      assertPlain(input, "sprints");
      rejectUnknown(input, ["cadence", "sprints"], "sprints");
      return commit((next) => {
        if (Object.prototype.hasOwnProperty.call(input, "cadence")) {
          if (input.cadence === null) delete next.cadence;
          else next.cadence = structuredClone(input.cadence);
        }
        if (Object.prototype.hasOwnProperty.call(input, "sprints")) {
          if (input.sprints === null) delete next.sprints;
          else next.sprints = structuredClone(input.sprints);
        }
        return { cadence: next.cadence, sprints: next.sprints };
      });
    },

    // Holidays are plan data beside the period: one write that sets the whole
    // list of Locations with their dates, or clears it when the list is null.
    // It is one undo step and one atomic save, like any other change.
    setHolidays: function (input) {
      assertPlain(input, "holidays");
      rejectUnknown(input, ["holidays"], "holidays");
      return commit((next) => {
        if (input.holidays === null) delete next.holidays;
        else next.holidays = structuredClone(input.holidays);
        return { holidays: next.holidays };
      });
    },

    // Typed tags' colours are plan data beside the period: one write that sets
    // the colour-by-key choices and the value colours together, or clears them
    // when the mapping is null. It is one undo step and one atomic save.
    setTagColours: function (input) {
      assertPlain(input, "tag colours");
      rejectUnknown(input, ["tagColours"], "tag colours");
      return commit((next) => {
        if (input.tagColours === null) {
          delete next.tagColours;
        } else {
          next.tagColours = structuredClone(input.tagColours);
          if (isEmptyTagColours(next.tagColours)) delete next.tagColours;
        }
        return { tagColours: next.tagColours };
      });
    },

    // The report's by-tag selection is plan data beside the period, and the first
    // thing the report itself writes: one write that replaces the set of tags the
    // view's rows are, or clears it when that set is null or empty. It is one
    // undo step and one atomic save, like any other change.
    setTagSplit: function (input) {
      assertPlain(input, "tag split");
      rejectUnknown(input, ["tagSplit"], "tag split");
      return commit((next) => {
        if (input.tagSplit === null) {
          delete next.tagSplit;
        } else {
          next.tagSplit = structuredClone(input.tagSplit);
          if (isEmptyTagSplit(next.tagSplit)) delete next.tagSplit;
        }
        return { tagSplit: next.tagSplit };
      });
    },

    createPerson: function (input) {
      rejectUnknown(input, ["id", "name", "location", "availability", "tags", "note"], "person");
      return commit((next) => {
        const person = normalizePerson(input);
        if (!person.id) person.id = uniqueId("person", next.people);
        if (next.people.some((p) => p.id === person.id)) throw new ValidationError("person.id already exists");
        next.people.push(person);
        return person;
      });
    },

    updatePerson: function (id, patch) {
      rejectUnknown(patch, ["name", "location", "availability", "tags", "note", "archived"], "person");
      return commit((next) => {
        const person = findPerson(next, id);
        const merged = normalizePerson(Object.assign({}, person, patch));
        Object.assign(person, merged, { id: person.id });
        return person;
      });
    },

    archivePerson: function (id) {
      return commit((next) => {
        const person = findPerson(next, id);
        person.archived = true;
        return { archived: id };
      });
    },

    // Destroying a Person removes them and every Assignment that referenced
    // them - archived ones included - in one write. The count is returned so
    // the confirmation and the result name the same number.
    destroyPerson: function (id) {
      return commit((next) => {
        findPerson(next, id);
        const removed = next.assignments.filter((a) => a.personId === id);
        next.assignments = next.assignments.filter((a) => a.personId !== id);
        next.people = next.people.filter((p) => p.id !== id);
        return { deleted: id, assignments: removed.length };
      });
    },

    createProject: function (input) {
      rejectUnknown(input, ["id", "name", "colour", "notes", "tags", "absence"], "project");
      return commit((next) => {
        // A new Project with no colour named takes the least-used slot among
        // the plan's Projects, so neighbours are least likely to share a fill.
        const named = input.colour === undefined
          ? Object.assign({}, input, { colour: leastUsedSlot(next.projects) })
          : input;
        const project = normalizeProject(named);
        if (!project.id) project.id = uniqueId("project", next.projects);
        if (next.projects.some((p) => p.id === project.id)) throw new ValidationError("project.id already exists");
        next.projects.push(project);
        return project;
      });
    },

    updateProject: function (id, patch) {
      rejectUnknown(patch, ["name", "colour", "notes", "tags", "absence", "archived"], "project");
      return commit((next) => {
        const project = findProject(next, id);
        const merged = normalizeProject(Object.assign({}, project, patch));
        Object.assign(project, merged, { id: project.id });
        return project;
      });
    },

    archiveProject: function (id) {
      return commit((next) => {
        const project = findProject(next, id);
        project.archived = true;
        return { archived: id };
      });
    },

    destroyProject: function (id) {
      return commit((next) => {
        findProject(next, id);
        const removed = next.assignments.filter((a) => a.projectId === id);
        next.assignments = next.assignments.filter((a) => a.projectId !== id);
        next.projects = next.projects.filter((p) => p.id !== id);
        return { deleted: id, assignments: removed.length };
      });
    },

    createAssignment: function (input) {
      rejectUnknown(input, ["id", "projectId", "personId", "start", "end", "share", "name", "tags", "note"], "assignment");
      return commit((next) => {
        const assignment = normalizeAssignment(input, next);
        if (!assignment.id) assignment.id = uniqueId("assignment", next.assignments);
        if (next.assignments.some((a) => a.id === assignment.id)) throw new ValidationError("assignment.id already exists");
        next.assignments.push(assignment);
        return assignment;
      });
    },

    updateAssignment: function (id, patch) {
      rejectUnknown(patch, ["projectId", "personId", "start", "end", "share", "name", "tags", "note", "archived"], "assignment");
      return commit((next) => {
        const assignment = findAssignment(next, id);
        const merged = normalizeAssignment(Object.assign({}, assignment, patch), next);
        Object.assign(assignment, merged, { id: assignment.id });
        return assignment;
      });
    },

    archiveAssignment: function (id) {
      return commit((next) => {
        const assignment = findAssignment(next, id);
        assignment.archived = true;
        return { archived: id };
      });
    },

    // Destroying an Assignment removes only itself; the Person and Project it
    // named are untouched.
    destroyAssignment: function (id) {
      return commit((next) => {
        findAssignment(next, id);
        next.assignments = next.assignments.filter((a) => a.id !== id);
        return { deleted: id, assignments: 1 };
      });
    },

    // A Milestone is one dated point in the plan. Creating, editing and
    // deleting one is each one undo step and one atomic save, like every other
    // write. The collection is absent until it is used, and deleting the last
    // Milestone drops it again, so a plan that never had milestones keeps none.
    // An unknown related Project id is stored as given rather than refused, so
    // a delete never invalidates a Milestone.
    createMilestone: function (input) {
      rejectUnknown(input, ["id", "name", "date", "colour", "tags", "notes", "projectIds"], "milestone");
      return commit((next) => {
        next.milestones = next.milestones || [];
        // A new Milestone with no colour named takes the least-used slot among
        // the plan's Milestones, as a new Project does among the Projects.
        const named = input.colour === undefined
          ? Object.assign({}, input, { colour: leastUsedSlot(next.milestones) })
          : input;
        const milestone = normalizeMilestone(named);
        if (!milestone.id) milestone.id = uniqueId("milestone", next.milestones);
        if (next.milestones.some((m) => m.id === milestone.id)) {
          throw new ValidationError("milestone.id already exists");
        }
        next.milestones.push(milestone);
        return milestone;
      });
    },

    updateMilestone: function (id, patch) {
      rejectUnknown(patch, ["name", "date", "colour", "tags", "notes", "projectIds"], "milestone");
      return commit((next) => {
        const milestone = findMilestone(next, id);
        const merged = normalizeMilestone(Object.assign({}, milestone, patch));
        Object.assign(milestone, merged, { id: milestone.id });
        return milestone;
      });
    },

    destroyMilestone: function (id) {
      return commit((next) => {
        findMilestone(next, id);
        next.milestones = next.milestones.filter((m) => m.id !== id);
        if (next.milestones.length === 0) delete next.milestones;
        return { deleted: id };
      });
    }
  };
}
