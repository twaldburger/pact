/*
 * PACT plan store, validation and persistence. Node built-ins only.
 *
 * One JSON file is the single source of truth. Writes are atomic: the new plan
 * is written to a temporary file, flushed, then renamed over the old one, so an
 * interrupted save can never truncate the plan. The file is created on first
 * run from a seeded plan, which is convenience data for a fresh checkout.
 */
import fs from "node:fs";
import path from "node:path";

export const INKS = ["steel", "moss", "teal", "iris", "plum", "umber"];

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

function monthStart(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function monthEnd(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function addMonths(date, n) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + n, 1));
}

// How far past an Assignment's own extent the range reaches, and how much of
// today's neighbourhood the range always holds: the same recent past and
// eleven months ahead the seed has always drawn.
export const RANGE_MARGIN_MONTHS = 1;
export const RANGE_PAST_MONTHS = 2;
export const RANGE_FUTURE_MONTHS = 11;

/*
 * The extent the axis must cover, as a grow-only rule: the stored range is a
 * floor, and work near or past either edge, or today near an edge, extends it.
 * Both ends are whole months, so the axis bands stay clean, and the rule is
 * pure and idempotent - a second call with its own output changes nothing -
 * so the store can recompute it on every write and the tests can pin it.
 */
export function growRange(range, assignments, today) {
  let start = monthStart(fromISO(range.start));
  let end = monthEnd(fromISO(range.end));

  const now = fromISO(today);
  const todayStart = addMonths(now, -RANGE_PAST_MONTHS);
  const todayEnd = monthEnd(addMonths(now, RANGE_FUTURE_MONTHS));
  if (todayStart < start) start = todayStart;
  if (todayEnd > end) end = todayEnd;

  for (const assignment of assignments || []) {
    const marginStart = addMonths(fromISO(assignment.start), -RANGE_MARGIN_MONTHS);
    const marginEnd = monthEnd(addMonths(fromISO(assignment.end), RANGE_MARGIN_MONTHS));
    if (marginStart < start) start = marginStart;
    if (marginEnd > end) end = marginEnd;
  }

  return { start: toISO(start), end: toISO(end) };
}

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
      { id: "anna", name: "Anna Meier", availability: 100, tags: ["React", "lead"], note: "leads Atlas" },
      { id: "ben", name: "Ben Falk", availability: 80, tags: ["React", "Design"], note: "contract through June" },
      { id: "cara", name: "Cara Nowak", availability: 60, tags: ["Design"], note: "part-time, Tue-Thu" }
    ],
    projects: [
      { id: "atlas", name: "Atlas", colour: "steel", notes: "phase one" },
      { id: "borealis", name: "Borealis", colour: "moss", notes: "phase two" },
      { id: "cara-onboarding", name: "Cara onboarding", colour: "iris", notes: "" },
      { id: "warehouse-move", name: "Warehouse move", colour: "teal", notes: "not started" }
    ],
    assignments: [
      { id: "a-atlas-anna", projectId: "atlas", personId: "anna", start: d(-4), end: d(38), share: 60, tags: ["React", "Design"], note: "shadowing Cara" },
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

function requireTenths(value, what) {
  if (!Number.isInteger(value) || value < 10 || value > 100 || value % 10 !== 0) {
    throw new ValidationError(what + " must be a whole number from 10 to 100 in steps of 10");
  }
  return value;
}

function requireInk(value) {
  if (!INKS.includes(value)) throw new ValidationError("project.colour must be one of: " + INKS.join(", "));
  return value;
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
    availability: requireTenths(input.availability, "person.availability"),
    tags: optionalStringArray(input.tags, "person.tags"),
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
    colour: requireInk(input.colour),
    notes: optionalString(input.notes, "project.notes")
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
    share: requireTenths(input.share, "assignment.share"),
    tags: optionalStringArray(input.tags, "assignment.tags"),
    note: optionalString(input.note, "assignment.note")
  };
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
  if (!range || !isValidISODate(range.start) || !isValidISODate(range.end)) {
    errors.push("range.start and range.end must be valid YYYY-MM-DD dates");
  } else if (range.start > range.end) {
    errors.push("range.start must not be after range.end");
  }

  checkList(plan.people, "people", errors, (person) => {
    if (typeof person.name !== "string" || person.name.trim() === "") return "people.name must be a non-empty string";
    if (!Number.isInteger(person.availability) || person.availability < 10 || person.availability > 100 || person.availability % 10 !== 0) {
      return "people.availability must be 10..100 in steps of 10";
    }
    if (person.tags !== undefined && (!Array.isArray(person.tags) || person.tags.some((t) => typeof t !== "string"))) {
      return "people.tags must be an array of strings";
    }
    if (person.note !== undefined && typeof person.note !== "string") return "people.note must be a string";
    if (person.archived !== undefined && typeof person.archived !== "boolean") return "people.archived must be a boolean";
    return null;
  });

  checkList(plan.projects, "projects", errors, (project) => {
    if (typeof project.name !== "string" || project.name.trim() === "") return "projects.name must be a non-empty string";
    if (!INKS.includes(project.colour)) return "projects.colour must be one of: " + INKS.join(", ");
    if (project.notes !== undefined && typeof project.notes !== "string") return "projects.notes must be a string";
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
    if (!Number.isInteger(assignment.share) || assignment.share < 10 || assignment.share > 100 || assignment.share % 10 !== 0) {
      return "assignments.share must be 10..100 in steps of 10";
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
    return parsed;
  }
  const seed = seedPlan();
  atomicWrite(filePath, JSON.stringify(seed, null, 2) + "\n");
  return seed;
}

export function createStore(filePath) {
  let plan = loadOrSeed(filePath);

  // Mutate a clone, validate it, write it, and only then adopt it in memory, so
  // a refused or failed save leaves both the file and the running plan as they
  // were.
  function commit(mutator) {
    const next = structuredClone(plan);
    const result = mutator(next);
    // Every write recomputes the extent, so the axis always holds the plan and
    // today, and only ever grows under the owner's scroll position.
    next.range = growRange(next.range, next.assignments, todayISO());
    const errors = validatePlan(next);
    if (errors.length) throw new ValidationError(errors.join("; "));
    atomicWrite(filePath, JSON.stringify(next, null, 2) + "\n");
    plan = next;
    return result === undefined ? undefined : structuredClone(result);
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

    createPerson: function (input) {
      rejectUnknown(input, ["id", "name", "availability", "tags", "note"], "person");
      return commit((next) => {
        const person = normalizePerson(input);
        if (!person.id) person.id = uniqueId("person", next.people);
        if (next.people.some((p) => p.id === person.id)) throw new ValidationError("person.id already exists");
        next.people.push(person);
        return person;
      });
    },

    updatePerson: function (id, patch) {
      rejectUnknown(patch, ["name", "availability", "tags", "note", "archived"], "person");
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

    createProject: function (input) {
      rejectUnknown(input, ["id", "name", "colour", "notes"], "project");
      return commit((next) => {
        const project = normalizeProject(input);
        if (!project.id) project.id = uniqueId("project", next.projects);
        if (next.projects.some((p) => p.id === project.id)) throw new ValidationError("project.id already exists");
        next.projects.push(project);
        return project;
      });
    },

    updateProject: function (id, patch) {
      rejectUnknown(patch, ["name", "colour", "notes", "archived"], "project");
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
    }
  };
}
