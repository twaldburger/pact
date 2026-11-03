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
  growRange,
  fromISO,
  todayISO,
  ValidationError,
  NotFoundError
} from "../lib/plan.mjs";

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-plan-"));
  return path.join(dir, "pact.json");
}

test("the seeded plan is valid", () => {
  assert.deepEqual(validatePlan(seedPlan()), []);
});

// A range wide enough for its assignments and for today: the two months before
// today through the next eleven months, both ends on whole months.
const RANGE = { start: "2026-09-01", end: "2027-10-31" };
const TODAY = "2026-11-03";
const assignment = (start, end) => ({ start: start, end: end });

function isMonthAligned(date) {
  const d = fromISO(date);
  const start = date.slice(8) === "01";
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return start || d.getUTCDate() === lastDay;
}

test("work inside the range leaves it alone", () => {
  const grown = growRange(RANGE, [assignment("2026-10-01", "2027-08-31")], TODAY);
  assert.deepEqual(grown, RANGE);
});

test("work past either end extends it, with a clear margin", () => {
  const earlier = growRange(RANGE, [assignment("2026-05-15", "2026-06-15")], TODAY);
  assert.equal(earlier.start, "2026-04-01");
  assert.equal(earlier.end, RANGE.end);

  const later = growRange(RANGE, [assignment("2027-01-01", "2027-10-15")], TODAY);
  assert.equal(later.start, RANGE.start);
  assert.equal(later.end, "2027-11-30");

  const both = growRange(RANGE, [assignment("2024-01-01", "2029-12-31")], TODAY);
  assert.equal(both.start, "2023-12-01");
  assert.equal(both.end, "2030-01-31");
});

test("today near an edge extends it on both sides", () => {
  const stored = { start: "2026-11-01", end: "2026-12-31" };
  const grown = growRange(stored, [], "2026-11-03");
  assert.equal(grown.start, "2026-09-01");
  assert.equal(grown.end, "2027-10-31");
});

test("both ends of the grown range land on whole months", () => {
  const grown = growRange({ start: "2026-11-10", end: "2026-12-05" }, [assignment("2025-03-17", "2028-08-02")], TODAY);
  assert.ok(isMonthAligned(grown.start), grown.start);
  assert.ok(isMonthAligned(grown.end), grown.end);
  assert.equal(grown.start.slice(8), "01");
  assert.equal(grown.end, "2028-09-30");
});

test("growing is idempotent and keeps a wider stored range as a floor", () => {
  const once = growRange(RANGE, [assignment("2024-01-01", "2029-12-31")], TODAY);
  assert.deepEqual(growRange(once, [assignment("2024-01-01", "2029-12-31")], TODAY), once);

  const wide = { start: "2000-01-01", end: "2040-12-31" };
  assert.deepEqual(growRange(wide, [assignment("2026-06-01", "2026-06-30")], TODAY), wide);
});

test("a write past the edge grows the stored range", () => {
  const store = createStore(tempFile());
  const before = store.get().range;
  // A date safely before any range the seed can hold, whatever today is.
  const longAgo = (+todayISO().slice(0, 4) - 2) + "-01-05";
  store.createAssignment({
    projectId: "atlas",
    personId: "anna",
    start: longAgo,
    end: longAgo.slice(0, 8) + "05",
    share: 10
  });
  const after = store.get().range;
  assert.ok(after.start < before.start, after.start + " should precede " + before.start);
  assert.ok(isMonthAligned(after.start), after.start);
  assert.ok(isMonthAligned(after.end), after.end);
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
    start: "2026-05-04",
    end: "2026-05-08",
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
    start: "2026-06-01",
    end: "2026-06-05",
    share: 50
  });
  assert.equal(created.share, 50);

  const moved = store.updateAssignment(created.id, { start: "2026-06-03", end: "2026-06-10", share: 80 });
  assert.equal(moved.start, "2026-06-03");
  assert.equal(moved.end, "2026-06-10");
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
    start: "2026-07-01",
    end: "2026-07-10",
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
    projectId: "atlas", personId: person.id, start: "2026-05-04", end: "2026-05-08", share: 50
  });
  const archived = store.createAssignment({
    projectId: "borealis", personId: person.id, start: "2026-06-01", end: "2026-06-05", share: 30
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
    projectId: project.id, personId: "anna", start: "2026-05-04", end: "2026-05-08", share: 40
  });
  const other = store.createAssignment({
    projectId: "atlas", personId: "anna", start: "2026-05-04", end: "2026-05-08", share: 40
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
    projectId: "atlas", personId: "anna", start: "2026-05-04", end: "2026-05-08", share: 40
  });
  const two = store.createAssignment({
    projectId: "atlas", personId: "anna", start: "2026-05-11", end: "2026-05-15", share: 60
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
