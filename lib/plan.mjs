/*
 * PACT plan store, validation and persistence. Node built-ins, plus the shared
 * pure range rules in public/lib/panels.mjs, so the store, the API and every
 * drag path refuse the same work with the same wording.
 *
 * One JSON file is the single source of truth. Writes are atomic: the new plan
 * is written to a temporary file, flushed, then renamed over the old one, so an
 * interrupted save can never truncate the plan. The file is created on first
 * run from a seeded plan, which is convenience data for a fresh checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { outsideRangeRefusal, rangeSettingRefusal, sortTags, stepSettingRefusal } from "../public/lib/panels.mjs";
import { leastUsedSlot, slotForColour } from "../public/lib/palette.mjs";
import { SPRINT_LENGTH_MAX, SPRINT_LENGTH_MIN } from "../public/lib/sprints.mjs";

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

/*
 * The plan a fresh checkout starts from: the three people and four projects from
 * the pass-2 fixture, with Ben over-committed at today. The dates are relative
 * to the first run so the seed still reads as a live plan whenever it is first
 * started. It is convenience data, not part of the repository.
 */
export function seedPlan() {
  const today = fromISO(todayISO());
  const rangeStart = addMonths(today, -RANGE_PAST_MONTHS);
  const rangeEnd = monthEnd(addMonths(today, RANGE_FUTURE_MONTHS));
  const d = (n) => toISO(addDays(today, n));
  return {
    range: { start: toISO(rangeStart), end: toISO(rangeEnd) },
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
function requireColour(value) {
  const slot = slotForColour(value);
  if (slot === null) throw new ValidationError("project.colour must be a slot 0..9");
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
    colour: requireColour(input.colour),
    notes: optionalString(input.notes, "project.notes"),
    tags: sortTags(optionalStringArray(input.tags, "project.tags"))
  };
  if (input.id !== undefined) project.id = requireSlug(input.id, "project.id");
  if (input.archived !== undefined) project.archived = requireBoolean(input.archived, "project.archived");
  return project;
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
    if (assignment.archived !== undefined && typeof assignment.archived !== "boolean") return "assignments.archived must be a boolean";
    return null;
  });

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

function loadOrSeed(filePath) {
  if (fs.existsSync(filePath)) {
    let raw;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      throw new Error("cannot read " + filePath + ": " + err.message);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(filePath + " is not valid JSON: " + err.message);
    }
    const errors = validatePlan(parsed);
    if (errors.length) throw new Error(filePath + " is not a valid plan: " + errors.join("; "));
    if (migrateColours(parsed)) atomicWrite(filePath, JSON.stringify(parsed, null, 2) + "\n");
    return parsed;
  }
  const seed = seedPlan();
  atomicWrite(filePath, JSON.stringify(seed, null, 2) + "\n");
  return seed;
}

// How many steps of history the running server keeps. The history is whole-plan
// snapshots held in memory only: it survives a page reload because the process
// keeps running, and it dies with a restart. Nothing new is written to disk.
export const HISTORY_LIMIT = 100;

export function createStore(filePath) {
  let plan = loadOrSeed(filePath);
  const undoStack = [];
  const redoStack = [];

  // Mutate a clone, validate it, write it, and only then adopt it in memory, so
  // a refused or failed save leaves both the file and the running plan as they
  // were. The previous plan is recorded as one undo step only once the write
  // has landed, so a failed save records nothing.
  function commit(mutator) {
    const next = structuredClone(plan);
    const result = mutator(next);
    const errors = validatePlan(next);
    if (errors.length) throw new ValidationError(errors.join("; "));
    atomicWrite(filePath, JSON.stringify(next, null, 2) + "\n");
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
    atomicWrite(filePath, JSON.stringify(target, null, 2) + "\n");
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

  return {
    filePath: filePath,

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
      rejectUnknown(input, ["id", "name", "colour", "notes", "tags"], "project");
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
      rejectUnknown(patch, ["name", "colour", "notes", "tags", "archived"], "project");
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
      rejectUnknown(input, ["id", "projectId", "personId", "start", "end", "share", "tags", "note"], "assignment");
      return commit((next) => {
        const assignment = normalizeAssignment(input, next);
        if (!assignment.id) assignment.id = uniqueId("assignment", next.assignments);
        if (next.assignments.some((a) => a.id === assignment.id)) throw new ValidationError("assignment.id already exists");
        next.assignments.push(assignment);
        return assignment;
      });
    },

    updateAssignment: function (id, patch) {
      rejectUnknown(patch, ["projectId", "personId", "start", "end", "share", "tags", "note", "archived"], "assignment");
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
    }
  };
}
