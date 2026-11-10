import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createStore,
  seedPlan,
  emptyPlan,
  defaultRange,
  validatePlan,
  atomicWrite,
  fromISO,
  toISO,
  todayISO,
  ValidationError,
  NotFoundError,
  PlanFileError
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

test("the server accepts any whole percent, on or off the plan's step", () => {
  const file = tempFile();
  const store = createStore(file);
  // The step is the interface's rule, not the server's: a value the previous
  // step-by-10 code refused is now stored, so changing the step never
  // invalidates what a plan already holds.
  const person = store.createPerson({ name: "Dana Vo", availability: 55 });
  assert.equal(person.availability, 55);
  const assignment = store.createAssignment({
    projectId: "atlas", personId: person.id, start: day(0), end: day(4), share: 35
  });
  assert.equal(assignment.share, 35);
  // Both ends of the range are whole percents and are accepted.
  assert.equal(store.updatePerson(person.id, { availability: 1 }).availability, 1);
  assert.equal(store.updateAssignment(assignment.id, { share: 100 }).share, 100);
});

test("the step is stored beside the period, and absent it reads as 10", () => {
  const file = tempFile();
  const store = createStore(file);
  // The seed leaves the step out, so an existing-style plan carries none.
  assert.equal(store.get().step, undefined);
  assert.deepEqual(store.setStep({ step: 5 }), { step: 5 });
  assert.equal(store.get().step, 5);
  // It survives a reload, and changing it rewrites no stored Availability or
  // Share: a value off the new step is left exactly as it was.
  const person = store.createPerson({ name: "Dana Vo", availability: 55 });
  const reloaded = createStore(file);
  assert.equal(reloaded.get().step, 5);
  assert.equal(store.setStep({ step: 1 }).step, 1);
  assert.equal(store.get().people.find((p) => p.id === person.id).availability, 55);
  assert.equal(createStore(file).get().step, 1);
});

test("the step is validated when it is set and nothing is written on refusal", () => {
  const file = tempFile();
  const store = createStore(file);
  const before = fs.readFileSync(file, "utf8");

  assert.throws(() => store.setStep({ step: 0 }), /whole number from 1 to 100/);
  assert.throws(() => store.setStep({ step: 101 }), /whole number from 1 to 100/);
  assert.throws(() => store.setStep({ step: 5.5 }), /whole number from 1 to 100/);
  assert.throws(() => store.setStep({ step: "5" }), /whole number from 1 to 100/);
  assert.throws(() => store.setStep({ step: 5, extra: 1 }), ValidationError);
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

test("a stored legacy colour name migrates to its slot and is persisted", () => {
  const file = tempFile();
  const store = createStore(file);
  const plan = store.get();
  plan.projects[0].colour = "steel";
  plan.projects[1].colour = "moss";
  plan.projects[2].colour = "iris";
  plan.projects[3].colour = "teal";
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + "\n");

  const reloaded = createStore(file).get();
  assert.deepEqual(reloaded.projects.map((p) => p.colour), [1, 3, 9, 0]);
  // The migrated slots are written back to the file, not left as names.
  const filed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(filed.projects.map((p) => p.colour), [1, 3, 9, 0]);
});

test("a new Project takes the least-used colour slot among the plan's Projects", () => {
  const store = createStore(tempFile());
  // The seed uses slots 1, 3, 9 and 0, so the first free slot is 2.
  const first = store.createProject({ name: "Summit", notes: "" });
  assert.equal(first.colour, 2);
  // A colour named by the caller is honoured, and a legacy name migrates.
  assert.equal(store.createProject({ name: "Vale", colour: "plum", notes: "" }).colour, 5);
  assert.equal(store.createProject({ name: "Ridge", colour: 4, notes: "" }).colour, 4);
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

test("a Person's Location is optional free text", () => {
  const file = tempFile();
  const store = createStore(file);
  const person = store.createPerson({ name: "Dana Vo", availability: 90, location: "Switzerland" });
  assert.equal(person.location, "Switzerland");
  assert.equal(store.updatePerson(person.id, { location: "Portugal" }).location, "Portugal");
  // It survives a reload like any other field.
  assert.equal(createStore(file).get().people.find((p) => p.id === person.id).location, "Portugal");
  // A Person may have none, and clearing it is an ordinary edit.
  assert.equal(store.updatePerson(person.id, { location: "" }).location, "");
  assert.equal(createStore(file).get().people.find((p) => p.id === person.id).location, "");
});

test("a Person's Location must be a string when it is given", () => {
  const store = createStore(tempFile());
  assert.throws(() => store.createPerson({ name: "Dana Vo", availability: 90, location: 5 }),
    /person\.location must be a string/);
  const person = store.createPerson({ name: "Dana Vo", availability: 90 });
  assert.throws(() => store.updatePerson(person.id, { location: ["Switzerland"] }),
    /person\.location must be a string/);
  assert.throws(() => store.createPerson({ name: "Dana Vo", availability: 90, location: 5 }), ValidationError);
});

test("a Project's tags are optional free text, stored A-Z", () => {
  const file = tempFile();
  const store = createStore(file);
  const project = store.createProject({ name: "Summit", notes: "", tags: ["Platform", "delivery"] });
  assert.deepEqual(project.tags, ["delivery", "Platform"]);
  assert.deepEqual(store.updateProject(project.id, { tags: ["ops", "Atlas", "billing"] }).tags,
    ["Atlas", "billing", "ops"]);
  // Clearing the list is an ordinary edit.
  assert.deepEqual(store.updateProject(project.id, { tags: [] }).tags, []);
  // It survives a reload like any other field.
  store.updateProject(project.id, { tags: ["Zeta", "alpha"] });
  assert.deepEqual(createStore(file).get().projects.find((p) => p.id === project.id).tags, ["alpha", "Zeta"]);
});

test("a Project's tags must be an array of strings when given", () => {
  const store = createStore(tempFile());
  assert.throws(() => store.createProject({ name: "Summit", notes: "", tags: "Platform" }),
    /project\.tags must be an array of strings/);
  assert.throws(() => store.createProject({ name: "Vale", notes: "", tags: [1] }),
    /project\.tags must be an array of strings/);
  const project = store.createProject({ name: "Ridge", notes: "" });
  assert.throws(() => store.updateProject(project.id, { tags: [null] }),
    /project\.tags must be an array of strings/);
});

test("the validator accepts project tags and refuses a bad array by name", () => {
  const plan = seedPlan();
  plan.projects[0].tags = ["Platform"];
  assert.deepEqual(validatePlan(plan), []);
  plan.projects[0].tags = "Platform";
  assert.deepEqual(validatePlan(plan), ["projects.tags must be an array of strings"]);
  plan.projects[0].tags = ["ok", 7];
  assert.deepEqual(validatePlan(plan), ["projects.tags must be an array of strings"]);
});

test("a multi-tag edit is stored A-Z for every kind of element", () => {
  const store = createStore(tempFile());
  const person = store.createPerson({ name: "Dana Vo", availability: 90, tags: ["qa", "React", "ops"] });
  assert.deepEqual(person.tags, ["ops", "qa", "React"]);
  const project = store.createProject({ name: "Summit", notes: "", tags: ["b", "A"] });
  assert.deepEqual(project.tags, ["A", "b"]);
  const assignment = store.createAssignment({
    projectId: "atlas", personId: "anna", start: day(0), end: day(2), share: 10,
    tags: ["zeta", "Alpha", "beta"]
  });
  assert.deepEqual(assignment.tags, ["Alpha", "beta", "zeta"]);
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
  assert.equal(renamed.colour, 7);

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
  assert.throws(() => store.createPerson({ name: "Over", availability: 101 }), ValidationError);
  assert.throws(() => store.createPerson({ name: "Fractional", availability: 55.5 }), ValidationError);
  assert.throws(() => store.createPerson({ name: "", availability: 100 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "nope", personId: "anna", start: "2026-01-01", end: "2026-01-02", share: 10 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "atlas", personId: "anna", start: "2026-01-02", end: "2026-01-01", share: 10 }), ValidationError);
  assert.throws(() => store.createAssignment({ projectId: "atlas", personId: "anna", start: "2026-01-01", end: "2026-01-02", share: 0 }), ValidationError);
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

/* --- history -------------------------------------------------------------- */

test("a change is one undo step, and undo restores the plan", () => {
  const file = tempFile();
  const store = createStore(file);
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), false);
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 0 });

  const before = store.get();
  const person = store.createPerson({ name: "Dana Vo", availability: 90 });
  const afterCreate = store.get();
  assert.equal(store.canUndo(), true);
  assert.equal(store.canRedo(), false);
  assert.deepEqual(store.historyDepth(), { undo: 1, redo: 0 });

  store.undo();
  assert.deepEqual(store.get(), before);
  assert.equal(store.get().people.some((p) => p.id === person.id), false);
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 1 });
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), true);
  // The file on disk matches the restored plan, not the one that was undone.
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(before, null, 2) + "\n");

  store.redo();
  assert.deepEqual(store.get(), afterCreate);
  assert.deepEqual(store.historyDepth(), { undo: 1, redo: 0 });
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(afterCreate, null, 2) + "\n");
});

test("every kind of change costs exactly one undo step", () => {
  const store = createStore(tempFile());
  const person = store.createPerson({ name: "Dana Vo", availability: 90 });
  const project = store.createProject({ name: "Summit", notes: "" });
  const assignment = store.createAssignment({
    projectId: project.id, personId: person.id, start: day(0), end: day(4), share: 40
  });
  // A create, a panel save, a drag (move, reassign or resize), an archive, a
  // restore, a delete and a Plan period change: each is one write, so one step.
  const actions = [
    ["a move", () => store.updateAssignment(assignment.id, { start: day(2), end: day(6) })],
    ["a resize", () => store.updateAssignment(assignment.id, { end: day(9) })],
    ["a reassign", () => store.updateAssignment(assignment.id, { share: 70 })],
    ["a panel save", () => store.updatePerson(person.id, { availability: 60 })],
    ["an archive", () => store.archiveAssignment(assignment.id)],
    ["a restore", () => store.updateAssignment(assignment.id, { archived: false })],
    ["a delete", () => store.destroyAssignment(assignment.id)],
    ["a period change", () => store.setRange({ start: store.get().range.start, end: day(30) })]
  ];
  let expected = 3;
  for (const [what, action] of actions) {
    const before = store.historyDepth().undo;
    action();
    expected += 1;
    assert.equal(store.historyDepth().undo, before + 1, what + " should cost one step");
  }
  assert.equal(store.historyDepth().undo, expected);
});

test("undo brings back a deleted Person and every Assignment", () => {
  const store = createStore(tempFile());
  const person = store.createPerson({ name: "Nina Roth", availability: 100 });
  const live = store.createAssignment({
    projectId: "atlas", personId: person.id, start: day(0), end: day(4), share: 50
  });
  const archived = store.createAssignment({
    projectId: "borealis", personId: person.id, start: day(30), end: day(34), share: 30
  });
  store.archiveAssignment(archived.id);

  const beforeDelete = store.get();
  assert.deepEqual(store.destroyPerson(person.id), { deleted: person.id, assignments: 2 });
  assert.equal(store.get().people.some((p) => p.id === person.id), false);

  store.undo();
  const restored = store.get();
  assert.deepEqual(restored, beforeDelete);
  assert.equal(restored.people.some((p) => p.id === person.id), true);
  assert.equal(restored.assignments.some((a) => a.id === live.id), true);
  assert.equal(restored.assignments.some((a) => a.id === archived.id), true);
});

test("a new change after an undo clears the redo stack", () => {
  const store = createStore(tempFile());
  store.createPerson({ name: "Dana Vo", availability: 90 });
  store.undo();
  assert.equal(store.canRedo(), true);

  store.createProject({ name: "Summit", notes: "" });
  assert.equal(store.canRedo(), false);
  assert.deepEqual(store.historyDepth(), { undo: 1, redo: 0 });
  assert.throws(() => store.redo(), /nothing to redo/);
});

test("the 101st change drops the oldest step", () => {
  const store = createStore(tempFile());
  for (let i = 0; i < 101; i += 1) {
    store.createPerson({ name: "Person " + i, availability: 100 });
  }
  // 101 changes leave the 100 most recent snapshots, so the seed has fallen off
  // the bottom of the stack.
  assert.equal(store.historyDepth().undo, 100);
  for (let i = 0; i < 100; i += 1) store.undo();
  assert.equal(store.canUndo(), false);
  // The oldest reachable plan is the one after the first change: Person 0 is
  // still there, the change that added Person 1 has fallen off.
  const at = store.get();
  assert.equal(at.people.some((p) => p.name === "Person 0"), true);
  assert.equal(at.people.some((p) => p.name === "Person 1"), false);
  assert.throws(() => store.undo(), /nothing to undo/);
});

test("a refused write records no history step", () => {
  const store = createStore(tempFile());
  assert.throws(() => store.createPerson({ name: "", availability: 100 }), ValidationError);
  assert.throws(() => store.updatePerson("missing", { name: "X" }), NotFoundError);
  assert.throws(() => store.setRange({ start: "2026-12-31", end: "2026-01-01" }), ValidationError);
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 0 });
  assert.equal(store.canUndo(), false);
});

test("a failed write records no history step", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-history-fail-"));
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
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 0 });
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(before, null, 2) + "\n");
});

test("undo and redo refuse at the ends of the history", () => {
  const file = tempFile();
  const store = createStore(file);
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => store.undo(), /nothing to undo/);
  assert.throws(() => store.redo(), /nothing to redo/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 0 });
});

test("a failed undo leaves the file, the plan and the history unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-undo-fail-"));
  const file = path.join(dir, "plan.json");
  const store = createStore(file);
  store.createPerson({ name: "Dana Vo", availability: 90 });
  const before = store.get();
  const depth = store.historyDepth();

  fs.chmodSync(dir, 0o555);
  try {
    assert.throws(() => store.undo());
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  assert.deepEqual(store.get(), before);
  assert.deepEqual(store.historyDepth(), depth);
  assert.equal(fs.readFileSync(file, "utf8"), JSON.stringify(before, null, 2) + "\n");
});

test("the history lives in memory: a fresh store on the same file starts empty", () => {
  const file = tempFile();
  const store = createStore(file);
  store.createPerson({ name: "Dana Vo", availability: 90 });
  assert.equal(store.canUndo(), true);

  // A second store over the same file is a restart: the change is on disk, but
  // the history that could step back over it is gone.
  const fresh = createStore(file);
  assert.equal(fresh.canUndo(), false);
  assert.equal(fresh.canRedo(), false);
  assert.equal(fresh.get().people.some((p) => p.name === "Dana Vo"), true);
});

/* --- sprints ------------------------------------------------------------- */

test("the seed leaves sprints out, so an existing plan is unchanged", () => {
  const seed = seedPlan();
  assert.equal(seed.cadence, undefined);
  assert.equal(seed.sprints, undefined);
});

test("a plan with a cadence and per-sprint adjustments validates", () => {
  const plan = seedPlan();
  plan.cadence = { start: plan.range.start, length: 14, namePrefix: "Sprint", nameNumber: 24 };
  plan.sprints = [{ index: 2, length: 21 }, { index: 3, name: "Sprint 30 - hardening" }];
  assert.deepEqual(validatePlan(plan), []);

  // The first number may be a whole number or the digits that set the padding
  // width, leading zeros included.
  plan.cadence = { start: plan.range.start, length: 7, namePrefix: "26-", nameNumber: "01" };
  assert.deepEqual(validatePlan(plan), []);
});

test("a malformed cadence is refused by name", () => {
  const plan = seedPlan();
  plan.cadence = { start: "not-a-date", length: 0, namePrefix: 5, nameNumber: -1 };
  const errors = validatePlan(plan);
  assert.ok(errors.some((e) => e.includes("cadence.start")), "cadence.start");
  assert.ok(errors.some((e) => e.includes("cadence.length")), "cadence.length");
  assert.ok(errors.some((e) => e.includes("cadence.namePrefix")), "cadence.namePrefix");
  assert.ok(errors.some((e) => e.includes("cadence.nameNumber")), "cadence.nameNumber");

  plan.cadence = 14;
  assert.deepEqual(validatePlan(plan), ["cadence must be an object"]);
});

test("a malformed sprint adjustment is refused by name", () => {
  const plan = seedPlan();
  plan.sprints = [{ index: 0, length: -1, name: 5 }];
  const errors = validatePlan(plan);
  assert.ok(errors.some((e) => e.includes("sprints[0].index")), "sprints.index");
  assert.ok(errors.some((e) => e.includes("sprints[0].length")), "sprints.length");
  assert.ok(errors.some((e) => e.includes("sprints[0].name")), "sprints.name");

  plan.sprints = "nope";
  assert.deepEqual(validatePlan(plan), ["sprints must be an array"]);
});

test("the store sets the cadence and adjustments and reloads them", () => {
  const file = tempFile();
  const store = createStore(file);
  const cadence = { start: day(0), length: 14, namePrefix: "26-", nameNumber: "01" };
  const set = store.setSprints({ cadence: cadence, sprints: [{ index: 2, length: 21 }] });
  assert.deepEqual(set.cadence, cadence);
  assert.deepEqual(set.sprints, [{ index: 2, length: 21 }]);
  assert.deepEqual(store.get().cadence, cadence);
  // Both travel with the plan through a reload.
  const reloaded = createStore(file);
  assert.deepEqual(reloaded.get().cadence, cadence);
  assert.deepEqual(reloaded.get().sprints, [{ index: 2, length: 21 }]);
});

test("clearing the cadence removes it and its adjustments", () => {
  const store = createStore(tempFile());
  store.setSprints({
    cadence: { start: day(0), length: 14, namePrefix: "Sprint", nameNumber: 1 },
    sprints: [{ index: 1, length: 7 }]
  });
  store.setSprints({ cadence: null, sprints: null });
  assert.equal(store.get().cadence, undefined);
  assert.equal(store.get().sprints, undefined);
});

test("a refused cadence writes nothing and records no history", () => {
  const file = tempFile();
  const store = createStore(file);
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => store.setSprints({
    cadence: { start: "not-a-date", length: 14, namePrefix: "Sprint", nameNumber: 1 },
    sprints: []
  }), /cadence.start/);
  assert.throws(() => store.setSprints({ cadence: null, sprints: [{ index: 0 }] }), /sprints\[0\]\.index/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 0 });
});

test("setting the sprints is one undo step, like any other change", () => {
  const store = createStore(tempFile());
  const cadence = { start: day(0), length: 14, namePrefix: "Sprint", nameNumber: 1 };
  store.setSprints({ cadence: cadence, sprints: [{ index: 1, length: 7 }] });
  store.setSprints({ cadence: cadence, sprints: [{ index: 1, length: 21 }] });
  assert.deepEqual(store.historyDepth(), { undo: 2, redo: 0 });
  store.undo();
  assert.deepEqual(store.get().sprints, [{ index: 1, length: 7 }]);
});

/* --- choosing the plan file ----------------------------------------------- */

test("an empty plan is valid, has no content, and keeps a period", () => {
  const plan = emptyPlan();
  assert.deepEqual(validatePlan(plan), []);
  assert.deepEqual(plan.people, []);
  assert.deepEqual(plan.projects, []);
  assert.deepEqual(plan.assignments, []);
  // The period is the same neighbourhood the seed draws; a plan is never
  // without an explicit extent.
  assert.deepEqual(plan.range, defaultRange(fromISO(todayISO())));
});

test("the store opens an existing plan file and switches to it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-open-"));
  const first = path.join(dir, "first.pact.json");
  const second = path.join(dir, "second.pact.json");
  const store = createStore(first);
  store.setRange({ start: "2026-01-01", end: "2026-12-31" });
  fs.writeFileSync(second, JSON.stringify({
    range: { start: "2030-01-01", end: "2030-12-31" },
    people: [], projects: [], assignments: []
  }, null, 2) + "\n");

  const opened = store.openPlan(second);
  assert.deepEqual(opened, { path: second });
  assert.equal(store.planFilePath(), second);
  assert.deepEqual(store.get().range, { start: "2030-01-01", end: "2030-12-31" });
  // Switching files clears a history that described the other plan.
  assert.deepEqual(store.historyDepth(), { undo: 0, redo: 0 });
});

test("a missing plan file is refused and never created", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-missing-"));
  const active = path.join(dir, "default.pact.json");
  const store = createStore(active);
  const before = store.get();
  const missing = path.join(dir, "not-there.pact.json");

  assert.throws(() => store.openPlan(missing), /no plan file at/);
  assert.equal(fs.existsSync(missing), false);
  // The running plan and the active file are untouched.
  assert.deepEqual(store.get(), before);
  assert.equal(store.planFilePath(), active);
});

test("a read-only plan file is refused plainly", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-ro-"));
  const writable = path.join(dir, "writable.pact.json");
  const store = createStore(writable);
  const readOnly = path.join(dir, "readonly.pact.json");
  fs.copyFileSync(writable, readOnly);
  fs.chmodSync(readOnly, 0o444);
  try {
    assert.throws(() => store.openPlan(readOnly), /not writable/);
  } finally {
    fs.chmodSync(readOnly, 0o644);
  }
  assert.equal(store.planFilePath(), writable);
});

test("a new plan is created truly empty and never over an existing file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-new-"));
  const store = createStore(path.join(dir, "default.pact.json"));
  const fresh = path.join(dir, "fresh.pact.json");

  const created = store.newPlan(fresh);
  assert.deepEqual(created, { path: fresh });
  assert.equal(store.planFilePath(), fresh);
  assert.deepEqual(store.get().people, []);
  assert.deepEqual(store.get().projects, []);
  assert.deepEqual(store.get().assignments, []);
  // It is on disk as a valid plan and reloads as the same empty one.
  assert.deepEqual(validatePlan(JSON.parse(fs.readFileSync(fresh, "utf8"))), []);
  assert.deepEqual(createStore(fresh).get(), store.get());

  // Creating over a file that is already there is refused, not truncated.
  fs.writeFileSync(fresh, "KEEP");
  assert.throws(() => store.newPlan(fresh), /already exists/);
  assert.equal(fs.readFileSync(fresh, "utf8"), "KEEP");
});

test("a plan file changed underneath refuses the next write", () => {
  const file = tempFile();
  const store = createStore(file);
  const before = store.get();
  // Something else writes the file with a change the store did not read.
  const other = seedPlan();
  other.people.push({ id: "zoe", name: "Zoe", availability: 100, tags: [], note: "" });
  fs.writeFileSync(file, JSON.stringify(other, null, 2) + "\n");

  const error = (() => {
    try {
      store.createPerson({ name: "Dana Vo", availability: 90 });
      return null;
    } catch (err) {
      return err;
    }
  })();
  assert.ok(error instanceof PlanFileError);
  assert.match(error.message, /changed on disk/);
  // Nothing was written, and the running plan is the one it last read.
  assert.deepEqual(store.get(), before);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).people.some((p) => p.id === "zoe"), true);
});

test("a deleted plan file refuses the next write", () => {
  const file = tempFile();
  const store = createStore(file);
  fs.rmSync(file);
  assert.throws(() => store.setStep({ step: 5 }), /changed on disk/);
});

test("the store trusts its own write, so the next write is no false conflict", () => {
  const file = tempFile();
  const store = createStore(file);
  store.createPerson({ name: "Dana Vo", availability: 90 });
  store.createPerson({ name: "Erin Sol", availability: 70 });
  assert.equal(store.get().people.length, 5);
});
