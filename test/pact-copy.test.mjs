/*
 * PACT's copies: a second Person, Project or Assignment from one that already
 * exists, through the running app.
 *
 * The rules here are the ones that make a copy the app's own copy rather than a
 * second, untested creation path: the preview is the default and touches
 * nothing, --apply lands exactly the fields the preview named and no work of the
 * source's, the name is the app's own rule (`X (copy)`, then `X (copy 2)`,
 * compared case-insensitively and numbered on rather than stacked), the source
 * is untouched, and the change is the app's, so the app's Undo takes it back.
 *
 * The tool never deletes anything, and that is asserted here too, for the three
 * commands this file is about: no option and no code path reaches a deletion,
 * and a copy adds a record rather than taking one away.
 *
 * Every case runs its own app over its own plan in a temporary directory: the
 * repository's plan is never read, and never written.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { scratch } from "../test-support/scratch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const BIN = path.join(REPO, "bin", "pact.mjs");

const scratchDir = scratch("pact-copy");

// A plan with one of each kind to copy, and one Absence Project so a copied
// Assignment can say what kind of time it holds.
function fixture() {
  return {
    range: { start: "2026-11-01", end: "2026-12-31" },
    step: 10,
    cadence: { start: "2026-11-02", length: 14, namePrefix: "Sprint ", nameNumber: 1 },
    people: [
      { id: "anna", name: "Anna Meier", availability: 80, location: "Berlin",
        tags: ["lead", "skill:design"], note: "leads design" },
      { id: "ben", name: "Ben Falk", availability: 50, location: "Berlin", tags: [], note: "" }
    ],
    projects: [
      { id: "atlas", name: "Atlas", colour: 0, tags: ["api:Solar"], notes: "the map" },
      { id: "borealis", name: "Borealis", colour: 3, tags: ["api:Stellar"], notes: "" },
      { id: "leave", name: "Annual Leave", colour: 4, absence: true, tags: ["Absence"], notes: "" }
    ],
    assignments: [
      { id: "a-atlas-anna", projectId: "atlas", personId: "anna", start: "2026-11-02",
        end: "2026-11-13", share: 100, name: "PDF export", tags: ["lead"], note: "kick-off" },
      { id: "a-borealis-anna", projectId: "borealis", personId: "anna", start: "2026-11-02",
        end: "2026-11-30", share: 30, tags: [], note: "" },
      { id: "a-leave-ben", projectId: "leave", personId: "ben", start: "2026-11-16",
        end: "2026-11-20", share: 100, tags: [], note: "" }
    ],
    holidays: [{ location: "Berlin", dates: [{ date: "2026-11-11", kind: "full" }] }],
    milestones: [
      { id: "m-launch", name: "Launch", date: "2026-11-20", colour: 0, tags: [],
        notes: "", projectIds: ["atlas"] }
    ]
  };
}

// The same plan with a live "Atlas (copy)" in it, so the name rule has a taken
// name to number past - spelled with capitals, because the rule compares
// case-insensitively.
function withTakenCopyName(plan) {
  const next = structuredClone(plan);
  next.projects.push({ id: "atlas-copy", name: "Atlas (COPY)", colour: 2, tags: [], notes: "" });
  return next;
}

const apps = [];
after(() => Promise.all(apps.map((entry) => new Promise((done) => entry.close(done)))));

// A real app over a real plan in this case's own temporary directory.
function app(plan) {
  const dir = scratchDir();
  const planPath = path.join(dir, "case.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
  const store = createStore(planPath);
  const server = createServer(store);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = "http://127.0.0.1:" + server.address().port;
      apps.push(server);
      resolve({
        dir: dir,
        planPath: planPath,
        base: base,
        close: (done) => server.close(done),
        // Every check of what was written reads the file, not the store.
        file: () => JSON.parse(fs.readFileSync(planPath, "utf8")),
        bytes: () => fs.readFileSync(planPath)
      });
    });
  });
}

// The tool runs as a child process, and never synchronously: a case's app is a
// server in this process, so a blocked event loop could not answer it.
function cli(args, options) {
  const opts = options || {};
  const env = Object.assign({}, process.env, opts.env || {});
  delete env.PACT_DATA;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN].concat(args), {
      cwd: opts.cwd || REPO, env: env
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status: status, stdout: stdout, stderr: stderr }));
  });
}

// The three copies, spelled once each so a case that changes the subject or the
// plan says so in its own call.
function copyProject(planPath, extra, env) {
  return cli(["project", "copy", "Atlas", "--plan", planPath].concat(extra || []), { env: env });
}

function copyPerson(planPath, extra, env) {
  return cli(["person", "copy", "Anna Meier", "--plan", planPath].concat(extra || []), { env: env });
}

function copyAssignment(planPath, extra, env) {
  return cli(["assignment", "copy", "Atlas", "--person", "Anna Meier", "--plan", planPath]
    .concat(extra || []), { env: env });
}

async function json(base, urlPath, method) {
  const response = await fetch(base + urlPath, { method: method || "GET" });
  return { status: response.status, body: await response.json() };
}

function projectOf(plan, name) {
  return plan.projects.find((entry) => entry.name === name);
}

function personOf(plan, name) {
  return plan.people.find((entry) => entry.name === name);
}

/* --- the preview is the default, and writes nothing ----------------------- */

test("the copy preview is the default and the plan file is not touched", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const project = await copyProject(started.planPath);
  assert.equal(project.status, 0, project.stderr);
  assert.equal(project.stderr, "");
  // The name, the fields it carries, what it does not carry, and the source
  // staying as it is: the copy's own list, not a guess at it.
  assert.match(project.stdout, /Copy of Project "Atlas"/);
  assert.match(project.stdout, /Name: Atlas \(copy\)/);
  assert.match(project.stdout, /Colour slot 0/);
  assert.match(project.stdout, /Tags: api:Solar/);
  assert.match(project.stdout, /Notes: the map/);
  assert.match(project.stdout, /Absence: no/);
  assert.match(project.stdout, /No Milestone relation/);
  assert.match(project.stdout, /No Assignments copied: 1 Assignment stays on "Atlas"\./);
  assert.match(project.stdout, /The source is untouched/);
  assert.match(project.stdout, /Nothing written\. Re-run with --apply\./);

  const person = await copyPerson(started.planPath);
  assert.equal(person.status, 0, person.stderr);
  assert.match(person.stdout, /Copy of Person "Anna Meier"/);
  assert.match(person.stdout, /Name: Anna Meier \(copy\)/);
  assert.match(person.stdout, /Location: Berlin, available 80%/);
  assert.match(person.stdout, /Tags: lead, skill:design/);
  assert.match(person.stdout, /Note: leads design/);
  assert.match(person.stdout, /No Assignments copied: 2 Assignments stay on "Anna Meier"\./);

  const assignment = await copyAssignment(started.planPath);
  assert.equal(assignment.status, 0, assignment.stderr);
  assert.match(assignment.stdout, /Copy of the Assignment/);
  assert.match(assignment.stdout, /Atlas \/ Anna Meier/);
  assert.match(assignment.stdout, /Name: PDF export/);
  assert.match(assignment.stdout, /2026-11-02 to 2026-11-13, 100%/);
  assert.match(assignment.stdout, /Tags: lead/);
  assert.match(assignment.stdout, /Note: kick-off/);
  assert.match(assignment.stdout, /draws as a second band/);

  // Nothing was written, by any of the three.
  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("--dry-run on a copy is the same thing said on purpose", async () => {
  const started = await app(fixture());
  for (const run of [copyProject, copyPerson, copyAssignment]) {
    const quiet = await run(started.planPath);
    const stated = await run(started.planPath, ["--dry-run"]);
    assert.equal(stated.status, 0, stated.stderr);
    assert.equal(stated.stdout, quiet.stdout);
  }
  assert.equal(started.file().people.length, 2);
  assert.equal(started.file().projects.length, 3);
  assert.equal(started.file().assignments.length, 3);
});

/* --- --apply lands exactly what the preview named ------------------------- */

test("--apply copies a Project with its colour, tags, notes and absence flag, and no work", async () => {
  const started = await app(fixture());
  const source = structuredClone(projectOf(started.file(), "Atlas"));

  const result = await copyProject(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+; read back from its plan: project-/);
  assert.match(result.stdout, /Atlas \(copy\), colour slot 0, not an Absence Project\./);
  assert.match(result.stdout, /Undo: the creation is one step back/);

  const plan = started.file();
  const copy = projectOf(plan, "Atlas (copy)");
  assert.ok(copy, "the copy is in the plan file");
  assert.equal(copy.colour, 0);
  assert.deepEqual(copy.tags, ["api:Solar"]);
  assert.equal(copy.notes, "the map");
  // The absence flag is carried the way the app's own Copy sends it: off, and
  // said so, rather than inherited from anything.
  assert.equal(copy.absence, false);
  // No work and no Milestone relation followed it: it is a Project alone.
  assert.deepEqual(plan.assignments.filter((entry) => entry.projectId === copy.id), []);
  assert.deepEqual((plan.milestones || []).filter((entry) => entry.projectIds.includes(copy.id)), []);
  // The source is exactly as it was.
  assert.deepEqual(projectOf(plan, "Atlas"), source);
  assert.equal(plan.assignments.filter((entry) => entry.projectId === "atlas").length, 1);
});

test("--apply copies a Person with Location, Availability, tags and note, and no work", async () => {
  const started = await app(fixture());
  const source = structuredClone(personOf(started.file(), "Anna Meier"));

  const result = await copyPerson(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /read back from its plan: person-/);
  assert.match(result.stdout, /Anna Meier \(copy\), Berlin, available 80%\./);

  const plan = started.file();
  const copy = personOf(plan, "Anna Meier (copy)");
  assert.ok(copy, "the copy is in the plan file");
  assert.equal(copy.location, "Berlin");
  assert.equal(copy.availability, 80);
  assert.deepEqual(copy.tags, ["lead", "skill:design"]);
  assert.equal(copy.note, "leads design");
  assert.deepEqual(plan.assignments.filter((entry) => entry.personId === copy.id), [],
    "a Person's work is their own: the copy holds none");
  assert.deepEqual(personOf(plan, "Anna Meier"), source);
  assert.equal(plan.assignments.filter((entry) => entry.personId === "anna").length, 2);
});

test("--apply copies an Assignment with the same Person, dates, Share, name, tags and note", async () => {
  const started = await app(fixture());
  const source = structuredClone(started.file().assignments.find((a) => a.id === "a-atlas-anna"));

  const result = await copyAssignment(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /read back from its plan: assignment-/);
  assert.match(result.stdout, /Atlas \/ Anna Meier {2}2026-11-02 to 2026-11-13 at 100%\./);

  const plan = started.file();
  const copies = plan.assignments.filter((entry) =>
    entry.id !== source.id && entry.projectId === "atlas" && entry.personId === "anna");
  assert.equal(copies.length, 1, "exactly one Assignment was added");
  const copy = copies[0];
  assert.deepEqual({
    projectId: copy.projectId, personId: copy.personId, start: copy.start,
    end: copy.end, share: copy.share, name: copy.name, tags: copy.tags, note: copy.note
  }, {
    projectId: "atlas", personId: "anna", start: "2026-11-02",
    end: "2026-11-13", share: 100, name: "PDF export", tags: ["lead"], note: "kick-off"
  });
  // The source is untouched, and no other record came with the copy.
  assert.deepEqual(plan.assignments.find((entry) => entry.id === "a-atlas-anna"), source);
  assert.equal(plan.assignments.length, 4);
  assert.equal(plan.people.length, 2);
  assert.equal(plan.projects.length, 3);
});

test("an Assignment copy carries the name the source holds, and says so", async () => {
  const started = await app(fixture());
  // In the body the app's own POST takes, where a nameless source reads as an
  // empty name rather than a missing key.
  const body = JSON.parse((await copyAssignment(started.planPath, ["--json"])).stdout);
  assert.equal(body.kind, "assignment");
  assert.equal(body.create.name, "PDF export");
  // A source with no name carries none, so a copy of it stays nameless.
  const nameless = fixture();
  nameless.assignments.find((a) => a.id === "a-borealis-anna").name = "";
  const other = await app(nameless);
  const otherBody = JSON.parse((await cli(["assignment", "copy", "Borealis", "--person",
    "Anna Meier", "--plan", other.planPath, "--json"])).stdout);
  assert.equal(otherBody.create.name, "");
  const preview = await cli(["assignment", "copy", "Borealis", "--person", "Anna Meier",
    "--plan", other.planPath]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.doesNotMatch(preview.stdout, /Name:/, "a nameless copy says nothing about a name");
});

test("a copied Absence Assignment says what kind of time it holds", async () => {
  const started = await app(fixture());
  const result = await cli(["assignment", "copy", "Annual Leave", "--person", "Ben Falk",
    "--plan", started.planPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Annual Leave is an Absence Project/);
  assert.match(result.stdout, /it changes Capacity, not Allocated/);
});

/* --- the name is the app's own rule -------------------------------------- */

test("the name numbers up past a live copy, compares case-insensitively, and numbers on", async () => {
  const started = await app(withTakenCopyName(fixture()));

  // A live "Atlas (COPY)" holds the first copy name, whatever its capitals.
  const first = await copyProject(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Name: Atlas \(copy 2\)/);
  assert.ok(projectOf(started.file(), "Atlas (copy 2)"));

  // Copying that copy numbers on from the base rather than stacking a suffix.
  const second = await cli(["project", "copy", "Atlas (copy 2)", "--apply", "--plan",
    started.planPath], { env: { PACT_URL: started.base } });
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /Name: Atlas \(copy 3\)/);
  const plan = started.file();
  assert.ok(projectOf(plan, "Atlas (copy 3)"));
  assert.equal(projectOf(plan, "Atlas (copy) (copy)"), undefined, "the rule did not stack a suffix");
  assert.equal(projectOf(plan, "Atlas (copy 2) (copy)"), undefined);

  // A Person's name is numbered by the same rule, over the People's own names.
  const person = await copyPerson(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(person.status, 0, person.stderr);
  const again = await copyPerson(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(again.status, 0, again.stderr);
  const people = started.file().people.map((entry) => entry.name);
  assert.deepEqual(people,
    ["Anna Meier", "Ben Falk", "Anna Meier (copy)", "Anna Meier (copy 2)"],
    "each copy took the next free name, in the order they were made");
});

/* --- the app's own write, and the app's own Undo ------------------------- */

test("the app's Undo removes the copy and leaves the source", async () => {
  const started = await app(fixture());
  const applied = await copyPerson(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  assert.ok(personOf(started.file(), "Anna Meier (copy)"));

  const undone = await json(started.base, "/api/undo", "POST");
  assert.equal(undone.status, 200);
  const plan = started.file();
  assert.equal(personOf(plan, "Anna Meier (copy)"), undefined, "Undo took the copy back");
  assert.ok(personOf(plan, "Anna Meier"), "the source is still there");
  assert.equal(plan.assignments.filter((entry) => entry.personId === "anna").length, 2);

  // The same for an Assignment: the copy goes, the original stays.
  const copied = await copyAssignment(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(copied.status, 0, copied.stderr);
  assert.equal(started.file().assignments.length, 4);
  await json(started.base, "/api/undo", "POST");
  assert.equal(started.file().assignments.length, 3);
  assert.ok(started.file().assignments.find((entry) => entry.id === "a-atlas-anna"));
});

/* --- the refusals -------------------------------------------------------- */

test("an unknown subject is the reads' nearest-match error, and nothing is written", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const project = await copyProject(started.planPath, null);
  assert.equal(project.status, 0, "Atlas is a subject");
  const unknown = await cli(["project", "copy", "Atlass", "--plan", started.planPath]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /unknown project "Atlass"/);
  assert.match(unknown.stderr, /nearest: "Atlas"/);

  const person = await cli(["person", "copy", "Ann", "--plan", started.planPath]);
  assert.equal(person.status, 1);
  assert.match(person.stderr, /unknown person "Ann"/);
  assert.match(person.stderr, /nearest: "Anna Meier"/);

  const assignment = await cli(["assignment", "copy", "Borealis", "--person", "Ben Falk",
    "--plan", started.planPath]);
  assert.equal(assignment.status, 1);
  assert.match(assignment.stderr, /no Assignment of Borealis on Ben Falk/);

  assert.deepEqual(started.bytes(), before);
});

test("more than one Assignment of a Project on a Person is refused with every one named", async () => {
  const plan = fixture();
  plan.assignments.push({
    id: "a-atlas-anna-2", projectId: "atlas", personId: "anna",
    start: "2026-12-01", end: "2026-12-11", share: 50, tags: [], note: ""
  });
  const started = await app(plan);
  const before = started.bytes();

  const result = await copyAssignment(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /more than one Assignment of Atlas on Anna Meier/);
  assert.match(result.stderr, /2026-11-02 to 2026-11-13 \(100%\)/);
  assert.match(result.stderr, /2026-12-01 to 2026-12-11 \(50%\)/);
  assert.match(result.stderr, /change these in the app/);
  assert.deepEqual(started.bytes(), before);
});

test("an archived Person, Project or Assignment is refused, and the restore is named", async () => {
  const plan = fixture();
  plan.people[0].archived = true;
  plan.assignments[0].archived = true;
  const started = await app(plan);
  const before = started.bytes();

  // The grid offers no copy of an archived record, and neither does this.
  const person = await copyPerson(started.planPath, ["--apply"], { PACT_URL: started.base });
  assert.equal(person.status, 1);
  assert.match(person.stderr, /"Anna Meier" \(anna, archived\) is archived, so it is not in the plan/);
  assert.match(person.stderr, /person restore "Anna Meier" brings it back/);

  const archivedProject = await app(withArchivedProject(fixture()));
  const project = await copyProject(archivedProject.planPath, ["--apply"],
    { PACT_URL: archivedProject.base });
  assert.equal(project.status, 1);
  assert.match(project.stderr, /is archived, so it is not in the plan/);
  assert.match(project.stderr, /project restore "Atlas" brings it back/);

  // An archived Assignment is history: there is nothing to duplicate.
  const archivedAssignment = await app(withArchivedAssignment(fixture()));
  const assignment = await copyAssignment(archivedAssignment.planPath, ["--apply"],
    { PACT_URL: archivedAssignment.base });
  assert.equal(assignment.status, 1);
  assert.match(assignment.stderr, /no live Assignment of Atlas on Anna Meier/);
  assert.match(assignment.stderr, /is archived, so there is nothing to copy/);
  assert.match(assignment.stderr, /assignment restore Atlas --person "Anna Meier" brings it back/);

  assert.deepEqual(started.bytes(), before);
});

function withArchivedProject(plan) {
  const next = structuredClone(plan);
  next.projects.find((entry) => entry.id === "atlas").archived = true;
  return next;
}

function withArchivedAssignment(plan) {
  const next = structuredClone(plan);
  next.assignments.find((entry) => entry.id === "a-atlas-anna").archived = true;
  return next;
}

test("a copy on a plan the app is not holding is refused, and nothing is written", async () => {
  const mine = await app(fixture());
  const other = await app(fixture());
  const before = mine.bytes();

  for (const run of [copyProject, copyPerson, copyAssignment]) {
    const result = await run(mine.planPath, ["--apply"], { PACT_URL: other.base });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /refusing to write: the app at .* has a different plan open/);
    assert.match(result.stderr, /pass --plan .* or open this plan in the app/);
  }
  assert.deepEqual(mine.bytes(), before);
  assert.equal(other.file().projects.filter((entry) => entry.name.startsWith("Atlas (")).length, 0);
});

test("with no app answering, a copy says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  for (const run of [copyProject, copyPerson, copyAssignment]) {
    const result = await run(started.planPath, ["--apply"], { PACT_URL: "http://127.0.0.1:1" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
    assert.match(result.stderr, /start it with node server\.mjs/);
  }
  assert.deepEqual(started.bytes(), before);
});

/* --- what a copy does not take ------------------------------------------- */

test("person copy, project copy and assignment copy state what they need", async () => {
  const started = await app(fixture());

  const noProjectName = await cli(["project", "copy", "--plan", started.planPath]);
  assert.equal(noProjectName.status, 2);
  assert.match(noProjectName.stderr, /project copy needs a name/);

  const noPersonName = await cli(["person", "copy", "--plan", started.planPath]);
  assert.equal(noPersonName.status, 2);
  assert.match(noPersonName.stderr, /person copy needs a name/);

  const noAssignmentProject = await cli(["assignment", "copy", "--person", "anna",
    "--plan", started.planPath]);
  assert.equal(noAssignmentProject.status, 2);
  assert.match(noAssignmentProject.stderr, /assignment copy needs a Project name/);

  const noAssignmentPerson = await cli(["assignment", "copy", "Atlas", "--plan", started.planPath]);
  assert.equal(noAssignmentPerson.status, 2);
  assert.match(noAssignmentPerson.stderr, /assignment copy needs --person/);

  const both = await copyProject(started.planPath, ["--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  // A copy carries the record's own fields, so every option that would set one
  // is refused rather than silently dropped.
  for (const [run, flag] of [
    [copyProject, "--name"], [copyProject, "--colour"], [copyProject, "--absence"],
    [copyProject, "--note"], [copyProject, "--tag"], [copyProject, "--period"],
    [copyPerson, "--location"], [copyPerson, "--availability"], [copyPerson, "--note"],
    [copyPerson, "--period"], [copyAssignment, "--share"], [copyAssignment, "--from"],
    [copyAssignment, "--period"]
  ]) {
    const result = await run(started.planPath, [flag, "x"]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /does not take /, flag);
  }
  // Nor does a Person's or a Project's copy take the Assignment's --person.
  const person = await copyPerson(started.planPath, ["--person", "anna"]);
  assert.equal(person.status, 2);
  assert.match(person.stderr, /person does not take --person/);
});

test("no option, action or code path in a copy deletes anything", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  for (const flag of ["--force", "--destroy", "--delete", "--archive"]) {
    for (const run of [copyProject, copyPerson, copyAssignment]) {
      const result = await run(started.planPath, [flag]);
      assert.equal(result.status, 2, flag);
      assert.match(result.stderr, /unknown option "/, flag);
    }
  }
  for (const action of ["destroy", "delete", "remove"]) {
    const result = await cli(["assignment", action, "Atlas", "--person", "anna",
      "--plan", started.planPath]);
    assert.equal(result.status, 2, action);
    assert.match(result.stderr, /unknown assignment action "/);
  }

  // The help keeps the boundary true, and says a copy is one of the writes.
  const help = await cli(["--help"]);
  assert.match(help.stdout, /The tool never deletes anything\./);
  assert.match(help.stdout, /Nineteen commands change a plan/);
  assert.match(help.stdout, /copy a Person, a Project or an Assignment, edit a Person or/);
  // There is no naming rule here: the app's own copy module is the one that
  // names a copy (lib/query.mjs imports it), so the two roads cannot drift.
  const source = fs.readFileSync(BIN, "utf8");
  const rule = fs.readFileSync(path.join(REPO, "lib", "query.mjs"), "utf8");
  assert.match(rule, /import \{ copyName \} from "\.\.\/public\/lib\/copy\.mjs"/);
  assert.doesNotMatch(source, /COPY_SUFFIX/, "the tool writes no second naming rule");
  // And the one DELETE the tool sends is still the archive's.
  assert.equal((source.match(/"DELETE"/g) || []).length, 1, "one DELETE, and it is the archive");
  assert.doesNotMatch(source, /\/destroy/);

  assert.deepEqual(started.bytes(), before);
});

/* --- the query seam, without a server ------------------------------------ */

test("the copy preview is a pure function of the plan, with no server and no file", async () => {
  const { copy } = await import("../lib/query.mjs");
  const plan = fixture();
  const answer = copy(plan, { kind: "project", subject: "atlas" });
  assert.deepEqual(answer.name, { from: "Atlas", to: "Atlas (copy)" });
  assert.deepEqual(answer.create, {
    name: "Atlas (copy)", tags: ["api:Solar"], notes: "the map", absence: false, colour: 0
  });
  // The source's own work is named, not copied, and the plan is untouched.
  assert.deepEqual(answer.assignments.map((entry) => entry.id), ["a-atlas-anna"]);
  assert.equal(plan.projects.length, 3);
  assert.equal(plan.assignments.length, 3);

  // The same for the reads' own subjects: case-insensitive, and no match is an
  // error naming the nearest.
  assert.equal(copy(plan, { kind: "person", subject: "anna meier" }).name.to, "Anna Meier (copy)");
  assert.throws(() => copy(plan, { kind: "person", subject: "Anaa" }), /unknown person "Anaa"/);
  assert.throws(() => copy(plan, { kind: "assignment", project: "atlas", person: "ben" }),
    /no Assignment of Atlas on Ben/);
});
