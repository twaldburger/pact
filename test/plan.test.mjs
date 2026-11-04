import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createStore,
  seedPlan,
  validatePlan,
  atomicWrite,
  fromISO,
  toISO,
  todayISO,
  ValidationError,
  NotFoundError
} from "../lib/plan.mjs";

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-plan-"));
  return path.join(dir, "pact.json");
}

// A day offset from today. The seeded period always holds today with room on
// both sides, so a small offset stays inside it whatever the run date is.
function day(n) {
  const d = fromISO(todayISO());
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

test("the seeded plan is valid", () => {
  assert.deepEqual(validatePlan(seedPlan()), []);
});

test("a stored period is kept exactly, on load and through other writes", () => {
  const file = tempFile();
  const store = createStore(file);
  const set = store.setRange({ start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(set, { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(store.get().range, { start: "2026-01-01", end: "2026-12-31" });
  // A reload reads the stored period unchanged, and a later write leaves it
  // alone rather than recomputing it.
  assert.deepEqual(createStore(file).get().range, { start: "2026-01-01", end: "2026-12-31" });
  store.createPerson({ name: "Dana Vo", availability: 90 });
  assert.deepEqual(store.get().range, { start: "2026-01-01", end: "2026-12-31" });
});

test("the period is validated when it is set and nothing is written on refusal", () => {
  const file = tempFile();
  const store = createStore(file);
  const before = fs.readFileSync(file, "utf8");

  assert.throws(() => store.setRange({ start: "2026-05-01" }), /valid YYYY-MM-DD/);
  assert.throws(() => store.setRange({ start: "2026-13-01", end: "2026-12-31" }), /valid YYYY-MM-DD/);
  assert.throws(() => store.setRange({ start: "2026-12-31", end: "2026-05-01" }), /must not be after/);
  assert.throws(() => store.setRange({ start: "2026-01-01", end: "2026-12-31", extra: 1 }), ValidationError);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("work outside the period is refused and left unwritten", () => {
  const file = tempFile();
  const store = createStore(file);
  const range = store.get().range;
  const beforeStart = (+range.start.slice(0, 4) - 1) + "-01-01";
  const afterEnd = (+range.end.slice(0, 4) + 1) + "-12-31";

  assert.throws(() => store.createAssignment({
    projectId: "atlas", personId: "anna", start: beforeStart, end: beforeStart, share: 10
  }), /inside the plan's period/);

  const made = store.createAssignment({
    projectId: "atlas", personId: "anna", start: day(0), end: day(2), share: 10
  });
  const afterCreate = fs.readFileSync(file, "utf8");
  // Both a move and a resize past either edge are refused by the same rule.
  assert.throws(() => store.updateAssignment(made.id, { start: beforeStart }), /inside the plan's period/);
  assert.throws(() => store.updateAssignment(made.id, { end: afterEnd }), /inside the plan's period/);
  assert.equal(fs.readFileSync(file, "utf8"), afterCreate);
});

test("a plan with work outside its period still loads", () => {
  const file = tempFile();
  const store = createStore(file);
  const plan = store.get();
  plan.assignments.push({
    id: "old", projectId: "atlas", personId: "anna",
    start: "2000-01-01", end: "2000-01-05", share: 10, tags: [], note: ""
  });
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + "\n");
  assert.ok(createStore(file).get().assignments.some((a) => a.id === "old"));
});

test("the store seeds a missing file and reloads it", () => {
  const file = tempFile();
  const store = createStore(file);
  assert.ok(fs.existsSync(file));
  const plan = store.get();
  assert.equal(plan.people.length, 3);
  assert.equal(plan.projects.length, 4);
  assert.ok(plan.assignments.length > 0);
  // A second store on the same file reads exactly what the first saved.
  assert.deepEqual(createStore(file).get(), plan);
});

test("a corrupt file refuses to load rather than being overwritten", () => {
  const file = tempFile();
  fs.writeFileSync(file, "{ not json");
  assert.throws(() => createStore(file), /not valid JSON/);
  assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
});

test("archiving a person keeps the record and every assignment", () => {
  const store = createStore(tempFile());
  const person = store.createPerson({ name: "Dana Vo", availability: 90, tags: ["QA"], note: "" });
  assert.ok(person.id);
  assert.equal(person.availability, 90);

  const assignment = store.createAssignment({
    projectId: "atlas",
    personId: person.id,
    start: day(0),
    end: day(4),
    share: 40
  });
  assert.equal(store.get().assignments.filter((a) => a.personId === person.id).length, 1);

  const updated = store.updatePerson(person.id, { availability: 70, name: "Dana Vo-Berg" });
  assert.equal(updated.availability, 70);
  assert.equal(updated.name, "Dana Vo-Berg");
  assert.ok(updated.id === person.id);

  assert.deepEqual(store.archivePerson(person.id), { archived: person.id });
  const after = store.get();
  assert.equal(after.people.find((p) => p.id === person.id).archived, true);
  assert.equal(after.assignments.some((a) => a.id === assignment.id), true);
});

test("an archived person and project can be restored", () => {
  const store = createStore(tempFile());
  const person = store.createPerson({ name: "Erin Sol", availability: 70 });
  const project = store.createProject({ name: "Summit", colour: "plum", notes: "" });
  store.archivePerson(person.id);
  store.archiveProject(project.id);
  assert.equal(store.get().people.find((p) => p.id === person.id).archived, true);
  assert.equal(store.get().projects.find((p) => p.id === project.id).archived, true);

  assert.equal(store.updatePerson(person.id, { archived: false }).archived, false);
  assert.equal(store.updateProject(project.id, { archived: false }).archived, false);
  assert.equal(store.get().people.find((p) => p.id === person.id).archived, false);
  assert.equal(store.get().projects.find((p) => p.id === project.id).archived, false);
});

test("assignments can be created, updated and archived", () => {
  const store = createStore(tempFile());
  const created = store.createAssignment({
    projectId: "borealis",
    personId: "cara",
    start: day(10),
    end: day(14),
    share: 50
  });
  assert.equal(created.share, 50);

  const moved = store.updateAssignment(created.id, { start: day(12), end: day(19), share: 80 });
  assert.equal(moved.start, day(12));
  assert.equal(moved.end, day(19));
  assert.equal(moved.share, 80);

  assert.deepEqual(store.archiveAssignment(created.id), { archived: created.id });
  const after = store.get();
  assert.equal(after.assignments.find((a) => a.id === created.id).archived, true);
});

test("archiving a project keeps its assignments", () => {
  const store = createStore(tempFile());
  const project = store.createProject({ name: "Summit", colour: "plum", notes: "" });
  const assignment = store.createAssignment({
    projectId: project.id,
    personId: "anna",
    start: day(20),
    end: day(29),
    share: 20
  });
  const renamed = store.updateProject(project.id, { name: "Summit Two", colour: "umber" });
  assert.equal(renamed.name, "Summit Two");
  assert.equal(renamed.colour, "umber");

  assert.deepEqual(store.archiveProject(project.id), { archived: project.id });
  const after = store.get();
  assert.equal(after.projects.find((p) => p.id === project.id).archived, true);
  assert.equal(after.assignments.some((a) => a.id === assignment.id), true);
});

test("destroying a person removes the record and its assignments from memory and the file", () => {
  const file = tempFile();
  const store = createStore(file);
  const person = store.createPerson({ name: "Nina Roth", availability: 100 });
  const live = store.createAssignment({
    projectId: "atlas", personId: person.id, start: day(0), end: day(4), share: 50
  });
  const archived = store.createAssignment({
    projectId: "borealis", personId: person.id, start: day(30), end: day(34), share: 30
  });
  store.archiveAssignment(archived.id);

  // The count names both Assignments, the archived one included.
  assert.deepEqual(store.destroyPerson(person.id), { deleted: person.id, assignments: 2 });

  const kept = store.get();
  assert.equal(kept.people.some((p) => p.id === person.id), false);
  assert.equal(kept.assignments.some((a) => a.id === live.id), false);
  assert.equal(kept.assignments.some((a) => a.id === archived.id), false);

  const filed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(filed.people.some((p) => p.id === person.id), false);
  assert.equal(filed.assignments.some((a) => a.personId === person.id), false);
});

test("destroying a project removes its assignments and leaves others", () => {
  const store = createStore(tempFile());
  const project = store.createProject({ name: "Summit", colour: "plum", notes: "" });
  const mine = store.createAssignment({
    projectId: project.id, personId: "anna", start: day(0), end: day(4), share: 40
  });
  const other = store.createAssignment({
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 40
  });

  assert.deepEqual(store.destroyProject(project.id), { deleted: project.id, assignments: 1 });
  const kept = store.get();
  assert.equal(kept.projects.some((p) => p.id === project.id), false);
  assert.equal(kept.assignments.some((a) => a.id === mine.id), false);
  assert.equal(kept.assignments.some((a) => a.id === other.id), true);
});

test("destroying an assignment removes only itself", () => {
  const store = createStore(tempFile());
  const one = store.createAssignment({
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 40
  });
  const two = store.createAssignment({
    projectId: "atlas", personId: "anna", start: day(7), end: day(11), share: 60
  });

  assert.deepEqual(store.destroyAssignment(one.id), { deleted: one.id, assignments: 1 });
  const kept = store.get();
  assert.equal(kept.assignments.some((a) => a.id === one.id), false);
  assert.equal(kept.assignments.some((a) => a.id === two.id), true);
  assert.equal(kept.people.some((p) => p.id === "anna"), true);
  assert.equal(kept.projects.some((p) => p.id === "atlas"), true);
});

test("invalid input is refused and leaves the plan unchanged", () => {
  const file = tempFile();
  const store = createStore(file);
  const before = fs.readFileSync(file, "utf8");

  assert.throws(() => store.createPerson({ name: "Zero", availability: 0 }), ValidationError);
  assert.throws(() => store.createPerson({ name: "Odd", availability: 55 }), ValidationError);
  assert.throws(() => store.createPerson({ name: "", availability: 100 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "nope", personId: "anna", start: "2026-01-01", end: "2026-01-02", share: 10 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "atlas", personId: "anna", start: "2026-01-02", end: "2026-01-01", share: 10 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "atlas", personId: "anna", start: "2026-01-01", end: "2026-01-02", share: 35 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "atlas", personId: "anna", start: "2026-13-01", end: "2026-01-02", share: 30 }), ValidationError);
  assert.throws(() => store.createPerson({ name: "Typo", availability: 100, nickname: "T" }), ValidationError);
  assert.throws(() => store.updatePerson("missing", { name: "X" }), NotFoundError);
  assert.throws(() => store.archiveAssignment("missing"), NotFoundError);
  assert.throws(() => store.destroyPerson("missing"), NotFoundError);
  assert.throws(() => store.destroyProject("missing"), NotFoundError);
  assert.throws(() => store.destroyAssignment("missing"), NotFoundError);

  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("the plan file is rewritten atomically", () => {
  const file = tempFile();
  atomicWrite(file, "first");
  assert.equal(fs.readFileSync(file, "utf8"), "first");
  atomicWrite(file, "second");
  assert.equal(fs.readFileSync(file, "utf8"), "second");
  // No temporary files are left behind.
  assert.deepEqual(
    fs.readdirSync(path.dirname(file)).filter((name) => name !== "pact.json"),
    []
  );
});

test("a failed atomic write leaves the previous file intact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-atomic-"));
  const file = path.join(dir, "plan.json");
  fs.writeFileSync(file, "ORIGINAL");
  fs.chmodSync(dir, 0o555);
  try {
    assert.throws(() => atomicWrite(file, "REPLACEMENT"));
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  assert.equal(fs.readFileSync(file, "utf8"), "ORIGINAL");
});

test("a store write that fails keeps memory and file consistent", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-store-fail-"));
  const file = path.join(dir, "plan.json");
  const store = createStore(file);
  const before = store.get();
  fs.chmodSync(dir, 0o555);
  try {
    assert.throws(() => store.createPerson({ name: "Lucky", availability: 100 }));
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  assert.deepEqual(store.get(), before);
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(before, null, 2) + "\n");
});
