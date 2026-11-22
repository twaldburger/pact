/*
 * PACT's writes: create a Person, create a Project, create an Assignment,
 * reschedule or resize one, and archive and restore any of the three, through
 * the running app.
 *
 * The rules here are the ones that make a write safe rather than the ones that
 * make it work: the preview is the default and touches nothing, the write
 * changes exactly what the preview said and nothing else, it is the app's own
 * change so the app's Undo takes it back, a plan the app is not holding is
 * refused rather than changed, and nothing answering at the address is a
 * sentence rather than a stack trace. A write is asserted by reading the file
 * on disk and the app's plan back, never by the reply to the request.
 *
 * The tool never deletes anything, and that is asserted here too: no action, no
 * option and no code path in the tool reaches a deletion. Archiving is the one
 * thing here that looks like a removal and is not one, so it is asserted the
 * same way - by the record and its Assignments still being in the file after
 * it, and by the read back asking for both halves of an archive rather than
 * for an absence the tool could not tell from a deletion.
 *
 * Every case runs its own app over its own plan in a temporary directory: the
 * repository's plan is never read, and never written.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { scratch } from "../test-support/scratch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const BIN = path.join(REPO, "bin", "pact.mjs");

const scratchDir = scratch("pact-write");

// November 2026 has 21 weekdays and Berlin's holiday on the 11th leaves 20
// working days: Anna offers 20 FTE-days, holds 9 on Atlas and 6 on Borealis, and
// Atlas to the 20th is 14 FTE-days. Hand-checkable, so the diff's figures are.
function fixture() {
  return {
    range: { start: "2026-11-01", end: "2026-12-31" },
    step: 10,
    cadence: { start: "2026-11-02", length: 14, namePrefix: "Sprint ", nameNumber: 1 },
    people: [
      { id: "anna", name: "Anna Meier", availability: 100, location: "Berlin", tags: ["lead"], note: "" },
      { id: "ben", name: "Ben Falk", availability: 50, location: "Berlin", tags: [], note: "" }
    ],
    projects: [
      { id: "atlas", name: "Atlas", colour: 0, tags: ["api:Solar"], notes: "" },
      { id: "borealis", name: "Borealis", colour: 3, tags: ["api:Stellar"], notes: "" },
      { id: "leave", name: "Annual Leave", colour: 4, absence: true, tags: ["Absence"], notes: "" }
    ],
    assignments: [
      { id: "a-atlas-anna", projectId: "atlas", personId: "anna", start: "2026-11-02", end: "2026-11-13", share: 100, tags: ["lead"], note: "kick-off" },
      { id: "a-borealis-anna", projectId: "borealis", personId: "anna", start: "2026-11-02", end: "2026-11-30", share: 30, tags: [], note: "" },
      { id: "a-leave-ben", projectId: "leave", personId: "ben", start: "2026-11-16", end: "2026-11-20", share: 100, tags: [], note: "" }
    ],
    holidays: [{ location: "Berlin", dates: [{ date: "2026-11-11", kind: "full" }] }]
  };
}

// The same plan with a second Atlas Assignment on Anna, for the ambiguous case.
function withSecondAtlas(plan) {
  const next = structuredClone(plan);
  next.assignments.push({
    id: "a-atlas-anna-2", projectId: "atlas", personId: "anna",
    start: "2026-12-01", end: "2026-12-11", share: 50, tags: [], note: ""
  });
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

// The move every case asks for, spelled once so a case that changes the
// arguments says so in its own call.
function move(planPath, extra, env) {
  return cli(["assignment", "move", "Atlas", "--person", "Anna Meier",
    "--period", "2026-11", "--plan", planPath].concat(extra || []), { env: env });
}

// A creation of Atlas on a Person over a stretch, the shape the issue asked
// for. `extra` carries the dates, the Allocation and --apply.
function add(planPath, extra, env) {
  return cli(["assignment", "add", "Atlas", "--person", "Anna Meier",
    "--period", "2026-11", "--plan", planPath].concat(extra || []), { env: env });
}

async function json(base, urlPath, method, body) {
  const options = { method: method || "GET", headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(base + urlPath, options);
  return { status: response.status, body: await response.json() };
}

function assignment(plan, id) {
  return plan.assignments.find((entry) => entry.id === id);
}

/* --- the diff is the default, and writes nothing -------------------------- */

test("the diff is the default and the plan file is not touched", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await move(started.planPath, ["--to", "2026-11-20"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // The shape the issue asked for: the dates, the FTE-days and the Person's
  // Allocated of their Capacity, old and new, then what to run to apply it.
  assert.match(result.stdout, /Assignment Atlas \/ Anna Meier/);
  assert.match(result.stdout, /2026-11-02 to 2026-11-13 {2}-> {2}2026-11-02 to 2026-11-20/);
  assert.match(result.stdout, /9\.0 FTE-days {3,}-> {2}14\.0 FTE-days/);
  assert.match(result.stdout, /Anna Meier: 15\.0 of 20\.0 {2}-> {2}20\.0 of 20\.0/);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("--dry-run is the same thing said on purpose", async () => {
  const started = await app(fixture());
  const quiet = await move(started.planPath, ["--to", "2026-11-20"]);
  const stated = await move(started.planPath, ["--to", "2026-11-20", "--dry-run"]);
  assert.equal(stated.status, 0, stated.stderr);
  assert.equal(stated.stdout, quiet.stdout);
  assert.equal(assignment(started.file(), "a-atlas-anna").end, "2026-11-13");
});

test("a resize shows the Allocation that moved, and the over-allocation before it is made", async () => {
  const started = await app(fixture());
  const result = await move(started.planPath, ["--share", "50"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /100% {1,}-> {2}50%/);
  assert.match(result.stdout, /9\.0 FTE-days {3,}-> {2}4\.5 FTE-days/);
  assert.match(result.stdout, /15\.0 of 20\.0 {2}-> {2}10\.5 of 20\.0/);

  // A move that goes over says so in the diff rather than after the fact.
  const over = await move(started.planPath, ["--to", "2026-11-30", "--share", "100"]);
  assert.match(over.stdout, /\(over by 6\.0\)/);
});

/* --- --apply changes exactly what it said -------------------------------- */

test("--apply changes only the fields the diff named", async () => {
  const started = await app(fixture());
  const original = started.file();

  const result = await move(started.planPath, ["--to", "2026-11-20", "--share", "80", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout, /read back from its plan: 2026-11-02 to 2026-11-20 at 80%\./);
  assert.match(result.stdout, /Undo: the change is one step back with the app's Undo control\./);

  const after = started.file();
  const moved = assignment(after, "a-atlas-anna");
  assert.equal(moved.end, "2026-11-20");
  assert.equal(moved.share, 80);
  // What the write was not asked about is what it was.
  assert.equal(moved.start, "2026-11-02");
  assert.deepEqual(moved.tags, ["lead"]);
  assert.equal(moved.note, "kick-off");
  assert.equal(moved.projectId, "atlas");
  assert.equal(moved.personId, "anna");

  // Nothing else in the plan moved: put the Assignment back as it was and the
  // file is the plan it started from, field for field.
  const expected = structuredClone(original);
  const restored = assignment(expected, "a-atlas-anna");
  restored.end = "2026-11-20";
  restored.share = 80;
  assert.deepEqual(after, expected);

  // The app's own plan holds it too, which is what the tool read back.
  const plan = await json(started.base, "/api/plan");
  assert.equal(assignment(plan.body, "a-atlas-anna").end, "2026-11-20");
});

test("the app's Undo steps it back to the plan it was", async () => {
  const started = await app(fixture());
  const original = started.file();

  const result = await move(started.planPath, ["--to", "2026-11-20", "--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(assignment(started.file(), "a-atlas-anna").end, "2026-11-20");

  const undone = await json(started.base, "/api/undo", "POST");
  assert.equal(undone.status, 200);
  assert.deepEqual(started.file(), original, "Undo must restore the file");
});

test("a plan the app is not holding is refused, and nothing is written", async () => {
  const started = await app(fixture());
  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(fixture(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);

  const result = await move(elsewhere, ["--to", "2026-11-20", "--apply"], { PACT_URL: started.base });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to write: the app at .* has a different plan open/);
  assert.match(result.stderr, new RegExp(started.planPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");
  assert.equal(assignment(started.file(), "a-atlas-anna").end, "2026-11-13");
});

test("the same plan by another spelling of its path is the same plan", async () => {
  // The app holds the temp directory's real path; the command is handed a
  // symlink to it. Comparing the paths as typed would refuse a plan that is the
  // app's own, so this is the check that the comparison is of real paths.
  const started = await app(fixture());
  const link = path.join(started.dir, "linked.pact.json");
  fs.symlinkSync(started.planPath, link);

  const result = await move(link, ["--to", "2026-11-20", "--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(assignment(started.file(), "a-atlas-anna").end, "2026-11-20");
});

/* --- creating an Assignment ---------------------------------------------- */

// Ben's November is hand-checkable: 20 working days, five of them taken as
// leave, so he offers 7.5 FTE-days at half Availability and is Allocated 0.
// Atlas over 2026-11-02 to 2026-11-13 is nine working days: at 50% that is 4.5
// FTE-days, and Atlas itself goes from 9.0 to 13.5.
test("the add preview is the default and the plan file is not touched", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--from", "2026-11-02", "--to", "2026-11-13", "--share", "50",
    "--period", "2026-11", "--plan", started.planPath]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // What it would create, its size, the Person after it, the Project's new
  // total, and that nobody else is on those dates.
  assert.match(result.stdout, /New Assignment/);
  assert.match(result.stdout, /Atlas \/ Ben Falk/);
  assert.match(result.stdout, /2026-11-02 to 2026-11-13, 50%/);
  assert.match(result.stdout, /4\.5 FTE-days/);
  assert.match(result.stdout, /Ben Falk: 0\.0 of 7\.5 {2}-> {2}4\.5 of 7\.5/);
  assert.match(result.stdout, /Atlas: 9\.0 FTE-days {3}-> {2}13\.5 FTE-days/);
  assert.match(result.stdout, /No other Assignment of Ben Falk meets 2026-11-02 to 2026-11-13\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("--dry-run on a creation is the same thing said on purpose", async () => {
  const started = await app(fixture());
  const args = ["--from", "2026-11-02", "--to", "2026-11-13", "--share", "50"];
  const quiet = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--period", "2026-11", "--plan", started.planPath].concat(args));
  const stated = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--period", "2026-11", "--plan", started.planPath].concat(args, ["--dry-run"]));
  assert.equal(stated.status, 0, stated.stderr);
  assert.equal(stated.stdout, quiet.stdout);
  assert.equal(started.file().assignments.length, 3);
});

test("--apply creates exactly one Assignment with the Project, Person, dates and share asked for", async () => {
  const started = await app(fixture());
  const original = started.file();

  const result = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--from", "2026-11-02", "--to", "2026-11-13", "--share", "50",
    "--period", "2026-11", "--plan", started.planPath, "--apply"],
  { env: { PACT_URL: started.base } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout, /read back from its plan: assignment-[a-z0-9-]+,/);
  assert.match(result.stdout, /Atlas \/ Ben Falk {2}2026-11-02 to 2026-11-13 at 50%\./);
  assert.match(result.stdout, /Undo: the creation is one step back with the app's Undo control\./);

  const after = started.file();
  const added = after.assignments.filter((entry) =>
    !original.assignments.some((before) => before.id === entry.id));
  assert.equal(added.length, 1, "exactly one Assignment is created");
  const created = added[0];
  assert.equal(created.projectId, "atlas");
  assert.equal(created.personId, "ben");
  assert.equal(created.start, "2026-11-02");
  assert.equal(created.end, "2026-11-13");
  assert.equal(created.share, 50);
  assert.deepEqual(created.tags, []);
  assert.equal(created.note, "");
  // The id is the app's, minted on the write: the tool sent none.
  assert.notEqual(created.id, "");

  // Nothing else in the plan changed: the plan it started from plus the one
  // record, field for field.
  const expected = structuredClone(original);
  expected.assignments.push(created);
  assert.deepEqual(after, expected);

  // The app's own plan holds it too, which is what the tool read back.
  const plan = await json(started.base, "/api/plan");
  assert.deepEqual(assignment(plan.body, created.id), created);
});

test("the over-allocation a creation makes is stated before it is made", async () => {
  const started = await app(fixture());
  // Anna is Allocated 15.0 of the 20.0 she offers; seven more FTE-days put her
  // over, and the preview says so rather than the report afterwards.
  const result = await add(started.planPath, ["--from", "2026-11-20", "--to", "2026-11-30", "--share", "100"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /7\.0 FTE-days/);
  assert.match(result.stdout, /Anna Meier: 15\.0 of 20\.0 {2}-> {2}22\.0 of 20\.0 {2}\(over by 2\.0\)/);
  assert.equal(started.file().assignments.length, 3, "the preview must not write");
});

test("an existing Assignment on those dates is named in the preview", async () => {
  const started = await app(fixture());
  const result = await add(started.planPath, ["--from", "2026-11-16", "--to", "2026-11-19", "--share", "20"]);
  assert.equal(result.status, 0, result.stderr);
  // Anna holds Borealis across the whole month, so the stretch she is already
  // committed on is named, with the days the two share.
  assert.match(result.stdout, /Anna Meier already holds an Assignment on those dates:/);
  assert.match(result.stdout, /Borealis {2}2026-11-02 {2}2026-11-30 +30 {2}2026-11-16 to 2026-11-19/);
  assert.equal(started.file().assignments.length, 3);
});

test("the app's Undo removes the created Assignment", async () => {
  const started = await app(fixture());
  const original = started.file();

  const result = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--from", "2026-11-02", "--to", "2026-11-13", "--share", "50",
    "--period", "2026-11", "--plan", started.planPath, "--apply"],
  { env: { PACT_URL: started.base } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(started.file().assignments.length, 4);

  const undone = await json(started.base, "/api/undo", "POST");
  assert.equal(undone.status, 200);
  assert.deepEqual(started.file(), original, "Undo must take the creation back");
});

test("the --json preview carries the create body, the positions and the overlaps", async () => {
  const started = await app(fixture());
  const result = await cli(["assignment", "add", "Atlas", "--person", "Anna Meier",
    "--from", "2026-11-16", "--to", "2026-11-19", "--share", "20",
    "--period", "2026-11", "--plan", started.planPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.action, "add");
  assert.equal(data.applied, false);
  assert.deepEqual(data.create, {
    projectId: "atlas", personId: "anna",
    start: "2026-11-16", end: "2026-11-19", share: 20
  });
  assert.equal(data.assignment.absence, false);
  assert.equal(data.project.before.allocated, 9);
  assert.equal(data.project.after.allocated, 9.8);
  assert.equal(data.person.after.overAllocated, false);
  assert.equal(data.overlaps.length, 1);
  assert.equal(data.overlaps[0].project, "Borealis");
  assert.equal(data.overlaps[0].overlapStart, "2026-11-16");
  assert.equal(data.overlaps[0].overlapEnd, "2026-11-19");
});

/* --- honest errors ------------------------------------------------------- */

test("with no app answering, the error says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  // Port 1 is never served by this user, so the connection is refused at once.
  const result = await move(started.planPath, ["--to", "2026-11-20", "--apply"],
    { PACT_URL: "http://127.0.0.1:1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
  assert.match(result.stderr, /start it with node server\.mjs/);
  assert.equal(/\n\s+at /.test(result.stderr), false, "no stack trace");
  assert.equal(result.stdout, "");
  assert.deepEqual(started.bytes(), before);
});

test("more than one Assignment of a Project on a Person is refused with both named", async () => {
  const started = await app(withSecondAtlas(fixture()));
  const before = started.bytes();

  const result = await move(started.planPath, ["--to", "2026-11-20", "--apply"], { PACT_URL: started.base });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /more than one Assignment of Atlas on Anna Meier/);
  assert.match(result.stderr, /2026-11-02 to 2026-11-13 \(100%\)/);
  assert.match(result.stderr, /2026-12-01 to 2026-12-11 \(50%\)/);
  assert.deepEqual(started.bytes(), before);
});

test("an unknown Person is the read commands' nearest-match error", async () => {
  const started = await app(fixture());
  const result = await move(started.planPath, ["--person", "Ann Meier", "--to", "2026-11-20"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown person "Ann Meier"/);
  assert.match(result.stderr, /nearest: "Anna Meier"/);
});

test("a create refuses an unknown Person, an unknown Project and an impossible span", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const person = await add(started.planPath, ["--person", "Ann Meier",
    "--from", "2026-11-16", "--to", "2026-11-19"]);
  assert.equal(person.status, 1);
  assert.match(person.stderr, /unknown person "Ann Meier"/);
  assert.match(person.stderr, /nearest: "Anna Meier"/);

  const project = await cli(["assignment", "add", "Atlaz", "--person", "Anna Meier",
    "--from", "2026-11-16", "--to", "2026-11-19", "--period", "2026-11",
    "--plan", started.planPath]);
  assert.equal(project.status, 1);
  assert.match(project.stderr, /unknown project "Atlaz"/);
  assert.match(project.stderr, /nearest: "Atlas"/);

  const reversed = await add(started.planPath, ["--from", "2026-11-19", "--to", "2026-11-16"]);
  assert.equal(reversed.status, 1);
  assert.match(reversed.stderr, /would end before it starts: 2026-11-19 to 2026-11-16/);

  // The app's own rule: an Assignment must fall inside the plan's period, so a
  // preview never offers a creation the write would refuse.
  const outside = await add(started.planPath, ["--from", "2027-01-04", "--to", "2027-01-08"]);
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /must fall inside the plan's period, 2026-11-01 to 2026-12-31/);

  assert.deepEqual(started.bytes(), before);
});

test("creating on a plan the app is not holding is refused, and nothing is written", async () => {
  const started = await app(fixture());
  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(fixture(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);

  const result = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--from", "2026-11-02", "--to", "2026-11-13", "--share", "50",
    "--period", "2026-11", "--plan", elsewhere, "--apply"],
  { env: { PACT_URL: started.base } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to write: the app at .* has a different plan open/);
  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");
  assert.equal(started.file().assignments.length, 3);
});

test("with no app answering, a create says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const result = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
    "--from", "2026-11-02", "--to", "2026-11-13", "--share", "50",
    "--period", "2026-11", "--plan", started.planPath, "--apply"],
  { env: { PACT_URL: "http://127.0.0.1:1" } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
  assert.match(result.stderr, /start it with node server\.mjs/);
  assert.equal(/\n\s+at /.test(result.stderr), false, "no stack trace");
  assert.equal(result.stdout, "");
  assert.deepEqual(started.bytes(), before);
});

test("a creation the app accepts but does not hold is not reported as done", async () => {
  // An app that answers 201 to the POST and then serves a plan without the new
  // Assignment: the tool has to say the creation did not land rather than trust
  // the reply, which is the difference between a verified write and a hoped one.
  const dir = scratchDir();
  const planPath = path.join(dir, "stub-add.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(fixture(), null, 2) + "\n");
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/plan-file") {
      return send(200, { path: planPath, source: "default", locked: false, notice: "" });
    }
    if (req.method === "GET" && req.url === "/api/plan") return send(200, fixture());
    req.on("data", () => {});
    req.on("end", () => send(201, { id: "assignment-stub" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;

  let result;
  try {
    result = await cli(["assignment", "add", "Atlas", "--person", "Ben Falk",
      "--from", "2026-11-02", "--to", "2026-11-13", "--share", "50",
      "--period", "2026-11", "--plan", planPath, "--apply"],
    { env: { PACT_URL: base } });
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the creation did not land/);
  assert.match(result.stderr, /assignment-stub/);
  assert.doesNotMatch(result.stdout, /Applied through/);
});

test("a request that changes nothing, or a date it could not write, is refused", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const same = await move(started.planPath, ["--to", "2026-11-13", "--apply"], { PACT_URL: started.base });
  assert.notEqual(same.status, 0);
  assert.match(same.stderr, /already runs 2026-11-02 to 2026-11-13 at 100%; nothing to change/);

  const reversed = await move(started.planPath, ["--from", "2026-12-01"]);
  assert.notEqual(reversed.status, 0);
  assert.match(reversed.stderr, /would end before it starts: 2026-12-01 to 2026-11-13/);

  const share = await move(started.planPath, ["--share", "120"]);
  assert.notEqual(share.status, 0);
  assert.match(share.stderr, /--share must be a whole number from 1 to 100/);

  const date = await move(started.planPath, ["--to", "20 November"]);
  assert.notEqual(date.status, 0);
  assert.match(date.stderr, /--to must be a date like 2026-11-02/);

  assert.deepEqual(started.bytes(), before);
});

test("a write the app accepts but does not hold is not reported as done", async () => {
  // An app that answers 200 to the PATCH and then serves a plan without the
  // change: the tool has to say the write did not land rather than trust the
  // reply, which is the difference between a verified write and a hoped one.
  const dir = scratchDir();
  const planPath = path.join(dir, "stub.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(fixture(), null, 2) + "\n");
  const stale = {
    assignments: [{ id: "a-atlas-anna", projectId: "atlas", personId: "anna",
      start: "2026-11-02", end: "2026-11-13", share: 100 }]
  };
  const server = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/plan-file") {
      return send({ path: planPath, source: "default", locked: false, notice: "" });
    }
    if (req.url === "/api/plan") return send(stale);
    req.on("data", () => {});
    req.on("end", () => send({ id: "a-atlas-anna" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;

  let result;
  try {
    result = await cli(["assignment", "move", "Atlas", "--person", "Anna Meier",
      "--to", "2026-11-20", "--period", "2026-11", "--plan", planPath, "--apply"],
    { env: { PACT_URL: base } });
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the write did not land/);
  assert.match(result.stderr, /2026-11-02 to 2026-11-13/);
  assert.doesNotMatch(result.stdout, /Applied through/);
});

/* --- creating a Person and a Project ------------------------------------- */

// Clara in Berlin over November: 21 weekdays, the 11th a holiday, so 20 working
// days, and 80% of them is 16.0 FTE-days. In Lisbon, where no holiday is
// configured, the same Availability is 21 days and 16.8 FTE-days: the
// difference is the Location's holidays and nothing else.
function personCreate(planPath, extra, env) {
  return cli(["person", "add", "Clara Nowak", "--period", "2026-11",
    "--plan", planPath].concat(extra || []), { env: env });
}

function projectCreate(planPath, extra, env) {
  return cli(["project", "add", "Northwind", "--plan", planPath].concat(extra || []), { env: env });
}

test("the person add preview is the default and the plan file is not touched", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await personCreate(started.planPath, [
    "--location", "Berlin", "--availability", "80",
    "--tag", "skill:frontend", "--tag", "team:atlas"
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // The shape the issue asked for: who it is, their Availability, their tags,
  // and what that Availability is worth over the period.
  assert.match(result.stdout, /New Person/);
  assert.match(result.stdout, /Clara Nowak, Berlin, available 80%/);
  assert.match(result.stdout, /Tags: skill:frontend, team:atlas/);
  assert.match(result.stdout, /Nov 2026: 16\.0 FTE-days offered \(20 working days at 80%\)/);
  assert.match(result.stdout, /Berlin holidays take 1 working day out of it: 2026-11-11/);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("--dry-run on a Person or a Project is the same thing said on purpose", async () => {
  const started = await app(fixture());
  const personQuiet = await personCreate(started.planPath, ["--location", "Berlin", "--tag", "team:atlas"]);
  const personStated = await personCreate(started.planPath,
    ["--location", "Berlin", "--tag", "team:atlas", "--dry-run"]);
  assert.equal(personStated.status, 0, personStated.stderr);
  assert.equal(personStated.stdout, personQuiet.stdout);

  const projectQuiet = await projectCreate(started.planPath, ["--tag", "api:Northwind"]);
  const projectStated = await projectCreate(started.planPath, ["--tag", "api:Northwind", "--dry-run"]);
  assert.equal(projectStated.status, 0, projectStated.stderr);
  assert.equal(projectStated.stdout, projectQuiet.stdout);

  assert.equal(started.file().people.length, 2);
  assert.equal(started.file().projects.length, 3);
});

test("--apply creates exactly one Person with the name, Location, Availability and tags asked for", async () => {
  const started = await app(fixture());
  const original = started.file();

  const result = await personCreate(started.planPath, [
    "--location", "Berlin", "--availability", "80", "--tag", "skill:frontend",
    "--tag", "team:atlas", "--note", "starts in November", "--apply"
  ], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout, /read back from its plan: person-[a-z0-9-]+,/);
  assert.match(result.stdout, /Clara Nowak, Berlin, available 80%\./);
  assert.match(result.stdout, /Undo: the creation is one step back with the app's Undo control\./);

  const after = started.file();
  const added = after.people.filter((person) =>
    !original.people.some((existing) => existing.id === person.id));
  assert.equal(added.length, 1, "exactly one Person is created");
  const created = added[0];
  assert.equal(created.name, "Clara Nowak");
  assert.equal(created.location, "Berlin");
  assert.equal(created.availability, 80);
  assert.deepEqual(created.tags, ["skill:frontend", "team:atlas"]);
  assert.equal(created.note, "starts in November");
  // The id is the app's, minted on the write: the tool sent none.
  assert.match(created.id, /^person-/);

  // Nothing else in the plan changed: the plan it started from plus the one
  // record, field for field.
  const expected = structuredClone(original);
  expected.people.push(created);
  assert.deepEqual(after, expected);

  // The Capacity the preview promised is the Capacity the plan now holds.
  const read = await cli(["person", "Clara Nowak", "--period", "2026-11", "--plan", started.planPath]);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /Capacity\s+16\.0 FTE-days/);
});

test("the Availability defaults to 100%, and the write carries it", async () => {
  const started = await app(fixture());
  const preview = await personCreate(started.planPath, ["--location", "Berlin"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Clara Nowak, Berlin, available 100%/);
  assert.match(preview.stdout, /Nov 2026: 20\.0 FTE-days offered \(20 working days at 100%\)/);
  assert.equal(started.file().people.length, 2, "the preview must not write");

  const applied = await personCreate(started.planPath, ["--location", "Berlin", "--apply"],
    { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(started.file().people.find((person) => person.name === "Clara Nowak").availability, 100);
});

test("a Person's offer is counted after their Location's holidays, and nowhere else", async () => {
  const berlin = await app(fixture());
  const lisbon = await app(fixture());

  const berlinPreview = await personCreate(berlin.planPath, ["--location", "Berlin", "--availability", "80"]);
  const lisbonPreview = await personCreate(lisbon.planPath, ["--location", "Lisbon", "--availability", "80"]);
  assert.equal(berlinPreview.status, 0, berlinPreview.stderr);
  assert.equal(lisbonPreview.status, 0, lisbonPreview.stderr);

  // One working day apart, because Berlin takes the 11th off and Lisbon does not.
  assert.match(berlinPreview.stdout, /16\.0 FTE-days offered \(20 working days at 80%\)/);
  assert.match(berlinPreview.stdout, /Berlin holidays take 1 working day out of it: 2026-11-11/);
  assert.match(lisbonPreview.stdout, /16\.8 FTE-days offered \(21 working days at 80%\)/);
  assert.doesNotMatch(lisbonPreview.stdout, /holidays take/);

  const applied = await personCreate(berlin.planPath, ["--location", "Berlin", "--availability", "80", "--apply"],
    { PACT_URL: berlin.base });
  assert.equal(applied.status, 0, applied.stderr);
  const read = await cli(["person", "Clara Nowak", "--period", "2026-11", "--plan", berlin.planPath]);
  assert.match(read.stdout, /Capacity\s+16\.0 FTE-days/);
});

test("a name the live plan already answers to is refused, and the record that holds it is named", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  // By name, in another case, and by id: reads find a Person by either, so both
  // spellings would make every later command ambiguous.
  for (const name of ["Anna Meier", "anna meier", "anna"]) {
    const result = await cli(["person", "add", name, "--period", "2026-11",
      "--plan", started.planPath, "--apply"], { env: { PACT_URL: started.base } });
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /already holds a person called "Anna Meier" \(anna\)/, name);
    assert.equal(result.stdout, "", name);
  }

  const project = await cli(["project", "add", "atlas", "--plan", started.planPath, "--apply"],
    { env: { PACT_URL: started.base } });
  assert.equal(project.status, 1);
  assert.match(project.stderr, /already holds a project called "Atlas" \(atlas\)/);

  assert.deepEqual(started.bytes(), before, "a refusal writes nothing");
});

test("a Person's tags and a Project's are separate lists, and a typed tag is kept as typed", async () => {
  const started = await app(fixture());
  // The by-tag read pivots Project tags only, so it is the measure of whether a
  // Person's tag leaked into the Project vocabulary.
  const tagsBefore = await cli(["tags", "--period", "2026-11", "--plan", started.planPath]);

  const person = await personCreate(started.planPath,
    ["--location", "Berlin", "--tag", "skill:Frontend", "--apply"], { PACT_URL: started.base });
  assert.equal(person.status, 0, person.stderr);
  assert.deepEqual(started.file().people.find((entry) => entry.name === "Clara Nowak").tags,
    ["skill:Frontend"], "the tag is stored exactly as typed");

  const tagsAfterPerson = await cli(["tags", "--period", "2026-11", "--plan", started.planPath]);
  assert.equal(tagsAfterPerson.stdout.replace(/^Plan file.*\n/m, ""),
    tagsBefore.stdout.replace(/^Plan file.*\n/m, ""),
    "a Person's tags are not the Project vocabulary");

  const project = await projectCreate(started.planPath,
    ["--tag", "api:Northwind", "--tag", "skill:Frontend", "--apply"], { PACT_URL: started.base });
  assert.equal(project.status, 0, project.stderr);
  assert.deepEqual(started.file().projects.find((entry) => entry.name === "Northwind").tags,
    ["api:Northwind", "skill:Frontend"],
    "the same spelling is a Project's own tag, kept exactly as typed");
});

test("the project add preview names the colour slot it would take and that it starts empty", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  // The plan's Projects sit in slots 0, 3 and 4, so the least used is 1.
  const result = await projectCreate(started.planPath, ["--tag", "api:Northwind"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /New Project/);
  assert.match(result.stdout, /Northwind, colour slot 1 \(the least used\)/);
  assert.match(result.stdout, /Tags: api:Northwind/);
  assert.match(result.stdout, /No Assignments yet\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("--apply creates exactly one Project in the colour slot the preview named", async () => {
  const started = await app(fixture());
  const original = started.file();

  const result = await projectCreate(started.planPath,
    ["--tag", "api:Northwind", "--note", "phase three", "--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /read back from its plan: project-[a-z0-9-]+,/);
  assert.match(result.stdout, /Northwind, colour slot 1, no Assignments\./);

  const after = started.file();
  const added = after.projects.filter((project) =>
    !original.projects.some((existing) => existing.id === project.id));
  assert.equal(added.length, 1, "exactly one Project is created");
  const created = added[0];
  assert.equal(created.name, "Northwind");
  assert.equal(created.colour, 1, "the least-used slot, chosen by the app");
  assert.equal(created.notes, "phase three");
  assert.deepEqual(created.tags, ["api:Northwind"]);
  assert.match(created.id, /^project-/);

  const expected = structuredClone(original);
  expected.projects.push(created);
  assert.deepEqual(after, expected);

  // A Project that starts empty has no Assignment hanging off it, in the app's
  // plan as well as in the file.
  const plan = await json(started.base, "/api/plan");
  assert.equal(plan.body.assignments.filter((entry) => entry.projectId === created.id).length, 0);
});

test("a colour named is the colour taken, and the preview says it was named", async () => {
  const started = await app(fixture());
  const preview = await projectCreate(started.planPath, ["--colour", "7"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Northwind, colour slot 7 \(as named\)/);

  const applied = await projectCreate(started.planPath, ["--colour", "7", "--apply"],
    { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(started.file().projects.find((project) => project.name === "Northwind").colour, 7);
});

test("the app's Undo takes the created Person and Project back, one step each", async () => {
  const started = await app(fixture());
  const original = started.file();

  const person = await personCreate(started.planPath,
    ["--location", "Berlin", "--availability", "80", "--tag", "skill:frontend", "--apply"],
    { PACT_URL: started.base });
  assert.equal(person.status, 0, person.stderr);
  const project = await projectCreate(started.planPath, ["--tag", "api:Northwind", "--apply"],
    { PACT_URL: started.base });
  assert.equal(project.status, 0, project.stderr);
  assert.equal(started.file().people.length, 3);
  assert.equal(started.file().projects.length, 4);

  const first = await json(started.base, "/api/undo", "POST");
  assert.equal(first.status, 200);
  assert.equal(started.file().projects.length, 3, "Undo removes the created Project");
  assert.equal(started.file().people.length, 3, "and leaves the Person alone");

  const second = await json(started.base, "/api/undo", "POST");
  assert.equal(second.status, 200);
  assert.deepEqual(started.file(), original, "Undo removes the created Person too");
});

test("the --json preview carries the create body and what the Availability is worth", async () => {
  const started = await app(fixture());
  const person = await personCreate(started.planPath,
    ["--location", "Berlin", "--availability", "80", "--tag", "skill:frontend", "--json"]);
  assert.equal(person.status, 0, person.stderr);
  const data = JSON.parse(person.stdout);
  assert.equal(data.command, "person");
  assert.equal(data.action, "add");
  assert.equal(data.applied, false);
  assert.deepEqual(data.create, {
    name: "Clara Nowak", location: "Berlin", availability: 80,
    tags: ["skill:frontend"], note: ""
  });
  assert.equal(data.offered.workingDays, 20);
  assert.equal(data.offered.holidayDays, 1);
  assert.equal(data.offered.fteDays, 16);

  const project = await projectCreate(started.planPath, ["--tag", "api:Northwind", "--json"]);
  assert.equal(project.status, 0, project.stderr);
  const projectData = JSON.parse(project.stdout);
  assert.deepEqual(projectData.create, { name: "Northwind", notes: "", tags: ["api:Northwind"] });
  assert.deepEqual(projectData.colour, { slot: 1, named: false });
});

test("creating a Person or a Project on a plan the app is not holding is refused", async () => {
  const started = await app(fixture());
  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(fixture(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);

  const person = await cli(["person", "add", "Clara Nowak", "--period", "2026-11",
    "--plan", elsewhere, "--apply"], { env: { PACT_URL: started.base } });
  assert.notEqual(person.status, 0);
  assert.match(person.stderr, /refusing to write: the app at .* has a different plan open/);

  const project = await cli(["project", "add", "Northwind", "--plan", elsewhere, "--apply"],
    { env: { PACT_URL: started.base } });
  assert.notEqual(project.status, 0);
  assert.match(project.stderr, /refusing to write: the app at .* has a different plan open/);

  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");
  assert.equal(started.file().people.length, 2);
  assert.equal(started.file().projects.length, 3);
});

test("with no app answering, creating a Person or a Project says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  for (const result of [
    await personCreate(started.planPath, ["--location", "Berlin", "--apply"],
      { PACT_URL: "http://127.0.0.1:1" }),
    await projectCreate(started.planPath, ["--apply"], { PACT_URL: "http://127.0.0.1:1" })
  ]) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
    assert.match(result.stderr, /start it with node server\.mjs/);
    assert.equal(/\n\s+at /.test(result.stderr), false, "no stack trace");
    assert.equal(result.stdout, "");
  }
  assert.deepEqual(started.bytes(), before);
});

test("a Person the app accepts but does not hold is not reported as done", async () => {
  // An app that answers 201 to the POST and then serves a plan without the new
  // Person: the tool has to say the creation did not land rather than trust the
  // reply, exactly as the Assignment create does.
  const dir = scratchDir();
  const planPath = path.join(dir, "stub-person.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(fixture(), null, 2) + "\n");
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/plan-file") {
      return send(200, { path: planPath, source: "default", locked: false, notice: "" });
    }
    if (req.method === "GET" && req.url === "/api/plan") return send(200, fixture());
    req.on("data", () => {});
    req.on("end", () => send(201, { id: "person-stub" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;

  let result;
  try {
    result = await cli(["person", "add", "Clara Nowak", "--location", "Berlin",
      "--period", "2026-11", "--plan", planPath, "--apply"],
    { env: { PACT_URL: base } });
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the creation did not land/);
  assert.match(result.stderr, /person-stub/);
  assert.doesNotMatch(result.stdout, /Applied through/);
});

test("person add and project add state what they need, and refuse what is not theirs", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const noName = await cli(["person", "add", "--plan", started.planPath]);
  assert.equal(noName.status, 2);
  assert.match(noName.stderr, /person add needs a name/);

  const noProjectName = await cli(["project", "add", "--plan", started.planPath]);
  assert.equal(noProjectName.status, 2);
  assert.match(noProjectName.stderr, /project add needs a name/);

  const both = await personCreate(started.planPath, ["--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  // A percentage the app would refuse is the app's to say, but a value that is
  // not a whole percentage at all is not a figure the preview could compute.
  const notANumber = await personCreate(started.planPath, ["--availability", "eighty"]);
  assert.equal(notANumber.status, 1);
  assert.match(notANumber.stderr, /--availability must be a whole percentage/);

  const badColour = await projectCreate(started.planPath, ["--colour", "12"]);
  assert.equal(badColour.status, 1);
  assert.match(badColour.stderr, /--colour must be a slot 0\.\.9/);

  // The options that belong to the other create, and to the reads.
  const share = await personCreate(started.planPath, ["--share", "50"]);
  assert.equal(share.status, 2);
  assert.match(share.stderr, /person does not take --share/);

  const location = await projectCreate(started.planPath, ["--location", "Berlin"]);
  assert.equal(location.status, 2);
  assert.match(location.stderr, /project does not take --location/);

  const period = await projectCreate(started.planPath, ["--period", "2026-11"]);
  assert.equal(period.status, 2);
  assert.match(period.stderr, /project add does not take a period/);

  // A read does not take a write's option. (The narrows a read does take, and
  // the ones it refuses, are test/narrow.test.mjs' own.)
  const readPerson = await cli(["people", "--person", "Anna Meier", "--plan", started.planPath]);
  assert.equal(readPerson.status, 2);
  assert.match(readPerson.stderr, /people does not take --person/);

  const assignmentTag = await cli(["assignment", "add", "Atlas", "--person", "Anna Meier",
    "--from", "2026-11-16", "--to", "2026-11-19", "--tag", "api", "--plan", started.planPath]);
  assert.equal(assignmentTag.status, 2);
  assert.match(assignmentTag.stderr, /assignment does not take --tag/);

  assert.deepEqual(started.bytes(), before);
});

/* --- archiving and restoring --------------------------------------------- */

// The three archive and restore pairs, each spelled once so a case that changes
// the arguments says so in its own call.
function personMove(planPath, action, extra, env) {
  return cli(["person", action, "Anna Meier", "--period", "2026-11",
    "--plan", planPath].concat(extra || []), { env: env });
}

function projectMove(planPath, action, extra, env) {
  return cli(["project", action, "Atlas", "--period", "2026-11",
    "--plan", planPath].concat(extra || []), { env: env });
}

function pairMove(planPath, action, extra, env) {
  return cli(["assignment", action, "Atlas", "--person", "Anna Meier", "--period", "2026-11",
    "--plan", planPath].concat(extra || []), { env: env });
}

// Anna's November is 20 working days after Berlin's holiday, so she offers 20.0
// FTE-days and holds 15.0 of them: 9.0 on Atlas and 6.0 on Borealis. Archiving
// her leaves the plan holding nothing, because Ben's only work is leave.
test("the archive preview is the default, writes nothing, and says what leaves the plan", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await personMove(started.planPath, "archive");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // The shape the issue asked for: who leaves, what stays behind, and the two
  // figures - the Person's own going to nothing, and the plan's total.
  assert.match(result.stdout, /Archive Person/);
  assert.match(result.stdout, /Anna Meier leaves the plan: available 100%, Berlin, 1 tag/);
  assert.match(result.stdout, /Anna Meier's 2 Assignments stay in the file and stop counting/);
  assert.match(result.stdout,
    /Nov 2026: 15\.0 of 20\.0 FTE-days -> 0\.0 of 0\.0, plan total 15\.0 -> 0\.0/);
  assert.match(result.stdout, /Plan Capacity: 27\.5 -> 7\.5 FTE-days/);
  assert.match(result.stdout, /Further commands will not find this Person until it is restored\./);
  assert.match(result.stdout, /Bring it back with: person restore "Anna Meier"\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("--dry-run on an archive or a restore is the same thing said on purpose", async () => {
  const started = await app(fixture());
  const quiet = await personMove(started.planPath, "archive");
  const stated = await personMove(started.planPath, "archive", ["--dry-run"]);
  assert.equal(stated.status, 0, stated.stderr);
  assert.equal(stated.stdout, quiet.stdout);

  const once = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(once.status, 0, once.stderr);
  const quietRestore = await personMove(started.planPath, "restore");
  const statedRestore = await personMove(started.planPath, "restore", ["--dry-run"]);
  assert.equal(statedRestore.status, 0, statedRestore.stderr);
  assert.equal(statedRestore.stdout, quietRestore.stdout);
  assert.equal(started.file().people.find((p) => p.id === "anna").archived, true);
});

test("--apply archives: the record leaves every read and its Assignments stay in the file", async () => {
  const started = await app(fixture());

  const result = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout,
    /read back from its plan: Anna Meier \(anna\) is out of the live plan and still in the file, archived\./);
  assert.match(result.stdout, /Undo: the archive is one step back with the app's Undo control\./);

  // The file is where the evidence is: the Person is marked, and every
  // Assignment they ever held is still there, untouched.
  const file = started.file();
  assert.equal(file.people.length, 2);
  assert.equal(file.people.find((p) => p.id === "anna").archived, true);
  assert.equal(file.assignments.length, 3);
  assert.equal(file.assignments.find((a) => a.id === "a-atlas-anna").archived, undefined);
  assert.equal(file.assignments.find((a) => a.id === "a-atlas-anna").personId, "anna");

  // The app's live plan is the plan without them; its archive view still has them.
  const live = await json(started.base, "/api/plan");
  assert.equal(live.body.people.some((p) => p.id === "anna"), false);
  assert.equal(live.body.assignments.some((a) => a.personId === "anna"), false);
  const kept = await json(started.base, "/api/plan?archived=1");
  assert.equal(kept.body.people.find((p) => p.id === "anna").archived, true);
  assert.equal(kept.body.assignments.filter((a) => a.personId === "anna").length, 2);

  // And every read the tool has: the list leaves her out, and so do the counts.
  const people = await cli(["people", "--period", "2026-11", "--plan", started.planPath]);
  assert.equal(people.status, 0, people.stderr);
  assert.doesNotMatch(people.stdout, /Anna Meier/);
  const person = await cli(["person", "Anna Meier", "--period", "2026-11", "--plan", started.planPath]);
  assert.equal(person.status, 1);
  assert.match(person.stderr, /unknown person "Anna Meier"/);
  const plan = JSON.parse((await cli(["plan", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout);
  assert.equal(plan.counts.people, 1);
  assert.equal(plan.counts.assignments, 1, "Ben's leave is all that is left");
  assert.equal(plan.totals.allocated, 0);
  assert.equal(plan.totals.capacity, 7.5);
});

test("the preview's FTE-days are the ones the plan holds after the archive", async () => {
  const started = await app(fixture());
  const preview = await personMove(started.planPath, "archive", ["--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const said = JSON.parse(preview.stdout);
  assert.equal(said.kind, "person");
  assert.equal(said.action, "archive");
  assert.equal(said.applied, false);
  assert.equal(said.subject.archived, false);
  assert.equal(said.before.plan.allocated, 15);
  assert.equal(said.after.plan.allocated, 0);
  assert.equal(said.before.person.allocated, 15);
  assert.equal(said.after.person, null, "a Person the plan no longer holds has no figures");
  assert.equal(said.assignments.length, 2);

  const applied = await personMove(started.planPath, "archive", ["--apply", "--json"],
    { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).applied, true);

  const plan = JSON.parse((await cli(["plan", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout);
  assert.equal(plan.totals.allocated, said.after.plan.allocated,
    "what the preview said leaves the plan is what the plan holds now");
  assert.equal(plan.totals.capacity, said.after.plan.capacity);
});

test("a restore brings the record and its Assignments back, and the totals return", async () => {
  const started = await app(fixture());
  const original = started.file();
  const archived = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(archived.status, 0, archived.stderr);

  const preview = await personMove(started.planPath, "restore", ["--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const said = JSON.parse(preview.stdout);
  assert.equal(said.subject.archived, true);
  assert.equal(said.before.plan.allocated, 0);
  assert.equal(said.after.plan.allocated, 15);
  assert.equal(said.assignments.length, 2);

  const applied = await personMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Restore Person/);
  assert.match(applied.stdout, /Anna Meier returns to the plan: available 100%, Berlin, 1 tag/);
  assert.match(applied.stdout, /Anna Meier's 2 Assignments come back and count again/);
  assert.match(applied.stdout,
    /Nov 2026: 0\.0 of 0\.0 FTE-days -> 15\.0 of 20\.0, plan total 0\.0 -> 15\.0/);
  assert.match(applied.stdout, /read back from its plan: Anna Meier \(anna\) is in the live plan again\./);

  // The figures are the plan's own again, read by the tool, not added up here.
  const plan = JSON.parse((await cli(["plan", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout);
  assert.equal(plan.totals.allocated, 15);
  assert.equal(plan.totals.capacity, 27.5);
  assert.equal(plan.counts.people, 2);
  assert.equal(plan.counts.assignments, 3);

  // The plan is the plan it was, apart from the one flag the restore wrote.
  const expected = structuredClone(original);
  expected.people.find((p) => p.id === "anna").archived = false;
  assert.deepEqual(started.file(), expected);
});

test("Undo steps an archive and a restore back, one step each", async () => {
  const started = await app(fixture());
  const original = started.file();

  const archived = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(archived.status, 0, archived.stderr);
  assert.equal(started.file().people.find((p) => p.id === "anna").archived, true);

  const restored = await personMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(started.file().people.find((p) => p.id === "anna").archived, false);

  const back = await json(started.base, "/api/undo", "POST");
  assert.equal(back.status, 200);
  assert.equal(started.file().people.find((p) => p.id === "anna").archived, true,
    "Undo takes the restore back");

  const again = await json(started.base, "/api/undo", "POST");
  assert.equal(again.status, 200);
  assert.deepEqual(started.file(), original, "and the archive too");
});

test("an archived record is found by restore, and not by archive", async () => {
  const started = await app(fixture());
  const first = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(first.status, 0, first.stderr);
  const before = started.bytes();

  // Archiving again cannot find her: every read leaves her out, and this is one.
  const twice = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(twice.status, 1);
  assert.match(twice.stderr, /"Anna Meier" \(anna, archived\) is archived, so it is not in the plan/);
  assert.match(twice.stderr, /person restore "Anna Meier" brings it back/);
  assert.deepEqual(started.bytes(), before);

  // Restoring is the one lookup that looks past the reads, so it finds her.
  const restore = await personMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(restore.status, 0, restore.stderr);
  assert.match(restore.stdout, /Restore Person/);

  // And once she is back, there is nothing archived to restore.
  const nothing = await personMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(nothing.status, 1);
  assert.match(nothing.stderr, /"Anna Meier" \(anna, live\) is not archived; there is nothing to restore/);
});

test("a live record and an archived one of one name are refused, and both are named", async () => {
  const started = await app(fixture());
  const archived = await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(archived.status, 0, archived.stderr);

  // The name is live again the moment she is archived, so a second Anna can be
  // created beside the archived one - which is how one name comes to mean two
  // records, one of which no read can see.
  const created = await cli(["person", "add", "Anna Meier", "--location", "Berlin",
    "--plan", started.planPath, "--apply"], { env: { PACT_URL: started.base } });
  assert.equal(created.status, 0, created.stderr);
  const before = started.bytes();

  const result = await personMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /both a live and an archived person answer to "Anna Meier"/);
  assert.match(result.stderr, /"Anna Meier" \(anna, archived\) is archived/);
  assert.match(result.stderr, /\(person-[^,]+, live\) is live/);
  assert.match(result.stderr, /a restore names one record/);
  assert.deepEqual(started.bytes(), before, "a refusal writes nothing");
});

test("a Project archives and restores the same way, and states its own figure", async () => {
  const started = await app(fixture());
  const archived = await projectMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(archived.status, 0, archived.stderr);
  assert.match(archived.stdout, /Archive Project/);
  assert.match(archived.stdout, /Atlas leaves the plan: colour slot 0, 1 tag/);
  assert.match(archived.stdout, /Atlas's 1 Assignment stays in the file and stops counting/);
  assert.match(archived.stdout, /Nov 2026: 9\.0 FTE-days -> 0\.0, plan total 15\.0 -> 6\.0/);

  const file = started.file();
  assert.equal(file.projects.find((p) => p.id === "atlas").archived, true);
  assert.equal(file.assignments.length, 3);
  const projects = JSON.parse((await cli(["projects", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout);
  assert.equal(projects.projects.some((p) => p.id === "atlas"), false);

  const restored = await projectMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(started.file().projects.find((p) => p.id === "atlas").archived, false);
  const totals = JSON.parse((await cli(["plan", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout).totals;
  assert.equal(totals.allocated, 15);
});

test("an Assignment archives and restores the same way, and says which side of over-allocation it leaves", async () => {
  // Anna at half Availability offers 10.0 FTE-days and holds 15.0, so she is
  // over-allocated by 5.0 until the Atlas block is archived - 9.0 of it.
  const plan = fixture();
  plan.people.find((p) => p.id === "anna").availability = 50;
  const started = await app(plan);

  const preview = await pairMove(started.planPath, "archive");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Archive Assignment/);
  assert.match(preview.stdout, /Atlas \/ Anna Meier, 2026-11-02 to 2026-11-13 at 100%/);
  assert.match(preview.stdout, /9\.0 FTE-days leave the plan\./);
  assert.match(preview.stdout,
    /Anna Meier: 15\.0 of 10\.0 FTE-days {2}-> {2}6\.0 of 10\.0, no longer over-allocated/);
  assert.match(preview.stdout, /Nov 2026: plan total 15\.0 -> 6\.0/);
  assert.match(preview.stdout, /Bring it back with: assignment restore Atlas --person "Anna Meier"\./);

  const archived = await pairMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });
  assert.equal(archived.status, 0, archived.stderr);
  assert.equal(started.file().assignments.find((a) => a.id === "a-atlas-anna").archived, true);
  const person = JSON.parse((await cli(["person", "Anna Meier", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout);
  assert.equal(person.assignments.length, 1, "the archived block is not in her work any more");
  assert.equal(person.person.allocated, 6);

  const restored = await pairMove(started.planPath, "restore", ["--apply"], { PACT_URL: started.base });
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /9\.0 FTE-days return to the plan\./);
  assert.match(restored.stdout, /over-allocated by 5\.0/);
  assert.equal(started.file().assignments.find((a) => a.id === "a-atlas-anna").archived, false);
  const back = JSON.parse((await cli(["person", "Anna Meier", "--period", "2026-11",
    "--plan", started.planPath, "--json"])).stdout);
  assert.equal(back.person.allocated, 15);
});

test("an archive or a restore the app accepts but does not hold is not reported as done", async () => {
  // An app that answers 200 to the DELETE or the PATCH and then serves a plan
  // that does not show it. The archive's read back asks two questions - out of
  // the live plan, and still in the file as archived - because "gone" on its
  // own cannot tell an archive from a deletion, and this is the case that has
  // to be refused rather than reported.
  const dir = scratchDir();
  const planPath = path.join(dir, "stub.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(fixture(), null, 2) + "\n");
  const anna = { id: "anna", name: "Anna Meier", availability: 100, location: "Berlin", tags: [], note: "" };
  let live = [anna];
  let kept = [Object.assign({}, anna, { archived: true })];
  const server = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/plan-file") {
      return send({ path: planPath, source: "default", locked: false, notice: "" });
    }
    if (req.url === "/api/plan?archived=1") {
      return send({ people: kept, projects: [], assignments: [] });
    }
    if (req.url === "/api/plan") return send({ people: live, projects: [], assignments: [] });
    req.on("data", () => {});
    req.on("end", () => send({ archived: "anna" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;
  const run = (action) => cli(["person", action, "Anna Meier", "--period", "2026-11",
    "--plan", planPath, "--apply"], { env: { PACT_URL: base } });

  try {
    // The reply said archived, and the live plan still holds her.
    const stillThere = await run("archive");
    assert.notEqual(stillThere.status, 0);
    assert.match(stillThere.stderr, /the archive did not land: the app's live plan still holds anna/);
    assert.doesNotMatch(stillThere.stdout, /Applied through/);

    // Out of the live plan and out of the file is a deletion, not an archive.
    live = [];
    kept = [];
    const gone = await run("archive");
    assert.notEqual(gone.status, 0);
    assert.match(gone.stderr,
      /the archive did not land: the app's file does not hold anna as archived, so the record is gone from the plan rather than archived/);

    // And a restore the live plan does not show is not done either. The file on
    // disk is the one an archive left behind, so the subject is there to find.
    const archived = fixture();
    archived.people.find((person) => person.id === "anna").archived = true;
    fs.writeFileSync(planPath, JSON.stringify(archived, null, 2) + "\n");
    const notBack = await run("restore");
    assert.notEqual(notBack.status, 0);
    assert.match(notBack.stderr, /the restore did not land: the app's live plan does not hold anna/);
    assert.doesNotMatch(notBack.stdout, /Applied through/);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("an archive or a restore on a plan the app is not holding is refused, and nothing is written", async () => {
  const started = await app(fixture());
  await personMove(started.planPath, "archive", ["--apply"], { PACT_URL: started.base });

  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(started.file(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);
  const result = await personMove(elsewhere, "restore", ["--apply"], { PACT_URL: started.base });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to write: the app at .* has a different plan open/);
  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");
  assert.equal(started.file().people.find((p) => p.id === "anna").archived, true);
});

test("with no app answering, an archive says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const result = await personMove(started.planPath, "archive", ["--apply"],
    { PACT_URL: "http://127.0.0.1:1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
  assert.match(result.stderr, /start it with node server\.mjs/);
  assert.equal(/\n\s+at /.test(result.stderr), false, "no stack trace");
  assert.equal(result.stdout, "");
  assert.deepEqual(started.bytes(), before);
});

test("the six archive and restore commands state what they need, and refuse what is not theirs", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const noName = await cli(["person", "archive", "--plan", started.planPath]);
  assert.equal(noName.status, 2);
  assert.match(noName.stderr, /person archive needs a name/);

  const noProject = await cli(["assignment", "archive", "--person", "anna", "--plan", started.planPath]);
  assert.equal(noProject.status, 2);
  assert.match(noProject.stderr, /assignment archive needs a Project name/);

  const noPerson = await cli(["assignment", "restore", "Atlas", "--plan", started.planPath]);
  assert.equal(noPerson.status, 2);
  assert.match(noPerson.stderr, /assignment restore needs --person/);

  const both = await personMove(started.planPath, "archive", ["--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  // An archive changes no date and no Allocation, and takes no tag or colour:
  // the options that would say otherwise are refused before the plan is read.
  for (const flag of ["--tag", "--location", "--colour", "--note"]) {
    const result = await personMove(started.planPath, "archive", [flag, "x"]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /does not take/);
  }
  for (const flag of ["--from", "--to", "--share"]) {
    const result = await pairMove(started.planPath, "archive", [flag, flag === "--share" ? "50" : "2026-11-02"]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /assignment does not take/);
  }
  assert.deepEqual(started.bytes(), before);
});

/* --- the tool never deletes anything ------------------------------------- */

test("no action, option or code path in the tool deletes anything", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  // Every spelling of a deletion is refused before the plan is even read.
  for (const action of ["destroy", "delete", "remove"]) {
    const result = await cli(["assignment", action, "Atlas", "--person", "Anna Meier",
      "--period", "2026-11", "--plan", started.planPath, "--apply"],
    { env: { PACT_URL: started.base } });
    assert.equal(result.status, 2, action);
    assert.match(result.stderr, /unknown assignment action "/);
  }
  // Nor through a Person or a Project command: an action that would destroy is
  // read as a name, and finds nothing, because there is no such record and no
  // such write. `archive` is a command, and the one that proves it deletes
  // nothing: the record and its work are still in the file afterwards.
  for (const action of ["destroy", "delete", "remove"]) {
    for (const command of ["person", "project"]) {
      const result = await cli([command, action, "Atlas", "--plan", started.planPath]);
      assert.notEqual(result.status, 0, command + " " + action);
      assert.match(result.stderr, /unknown (person|project) "/);
    }
  }
  for (const flag of ["--force", "--destroy", "--delete", "--archive"]) {
    const result = await add(started.planPath, ["--from", "2026-11-16", "--to", "2026-11-19", flag]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /unknown option "/);

    const person = await personCreate(started.planPath, [flag]);
    assert.equal(person.status, 2, flag);
    assert.match(person.stderr, /unknown option "/);

    const project = await projectCreate(started.planPath, [flag]);
    assert.equal(project.status, 2, flag);
    assert.match(project.stderr, /unknown option "/);

    // Nor on the archive, which is the closest thing here to a removal.
    const archive = await personMove(started.planPath, "archive", [flag]);
    assert.equal(archive.status, 2, flag);
    assert.match(archive.stderr, /unknown option "/);
  }

  // The boundary is in the help, in plain words, where the writes are described:
  // what the tool can do, that archiving is the reversible way out, and that a
  // Milestone has no archived state for it to reach.
  const help = await cli(["--help"]);
  assert.match(help.stdout, /The tool never deletes anything\./);
  assert.match(help.stdout, /Fourteen commands change a plan/);
  assert.match(help.stdout, /Archiving is how work leaves a plan reversibly/);
  assert.match(help.stdout, /and no --force to\s+reach one/);
  assert.match(help.stdout, /person archive <name>/);
  assert.match(help.stdout, /A Milestone has no archived state/);
  assert.match(help.stdout, /this tool cannot take one out of a plan at all/);
  // Removing a holiday date is the one removal here, and the help says what it
  // is: one plan setting edited, not a record destroyed.
  assert.match(help.stdout, /holiday remove is not a deletion either/);

  // And in the code: the one DELETE the tool sends is the record's own archive
  // route, and the destruction route is named nowhere, so no code path here can
  // reach it.
  const source = fs.readFileSync(BIN, "utf8");
  assert.equal((source.match(/"DELETE"/g) || []).length, 1, "one DELETE, and it is the archive");
  assert.doesNotMatch(source, /\/destroy/);
  // A Milestone has no archived state, so its only routes here are the app's own
  // create and edit - POST and PATCH on the collection - and no removal.
  assert.match(source, /readBackCreate\(base, "\/api\/milestones"/);
  assert.match(source, /"PATCH", "\/api\/milestones\/" \+ encodeURIComponent\(id\)/);

  assert.deepEqual(started.bytes(), before);
});

/* --- usage --------------------------------------------------------------- */

test("assignment add states what it needs", async () => {
  const started = await app(fixture());
  const noProject = await cli(["assignment", "add", "--person", "anna",
    "--from", "2026-11-16", "--to", "2026-11-19", "--plan", started.planPath]);
  assert.equal(noProject.status, 2);
  assert.match(noProject.stderr, /assignment add needs a Project name/);

  const noPerson = await cli(["assignment", "add", "Atlas",
    "--from", "2026-11-16", "--to", "2026-11-19", "--plan", started.planPath]);
  assert.equal(noPerson.status, 2);
  assert.match(noPerson.stderr, /assignment add needs --person/);

  const noFrom = await cli(["assignment", "add", "Atlas", "--person", "anna",
    "--to", "2026-11-19", "--plan", started.planPath]);
  assert.equal(noFrom.status, 2);
  assert.match(noFrom.stderr, /assignment add needs --from/);

  const noTo = await cli(["assignment", "add", "Atlas", "--person", "anna",
    "--from", "2026-11-16", "--plan", started.planPath]);
  assert.equal(noTo.status, 2);
  assert.match(noTo.stderr, /assignment add needs --to/);

  const both = await add(started.planPath, ["--from", "2026-11-16", "--to", "2026-11-19",
    "--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  const share = await add(started.planPath, ["--from", "2026-11-16", "--to", "2026-11-19",
    "--share", "120"]);
  assert.equal(share.status, 1);
  assert.match(share.stderr, /--share must be a whole number from 1 to 100/);

  const date = await add(started.planPath, ["--from", "16 November", "--to", "2026-11-19"]);
  assert.equal(date.status, 1);
  assert.match(date.stderr, /--from must be a date like 2026-11-02/);

  const action = await cli(["assignment", "--plan", started.planPath]);
  assert.equal(action.status, 2);
  assert.match(action.stderr, /the actions are move, add, archive and restore/);
});

test("assignment move states what it needs", async () => {
  const started = await app(fixture());
  const noAction = await cli(["assignment", "--plan", started.planPath]);
  assert.equal(noAction.status, 2);
  assert.match(noAction.stderr, /assignment needs an action/);

  const noPerson = await cli(["assignment", "move", "Atlas", "--to", "2026-11-20", "--plan", started.planPath]);
  assert.equal(noPerson.status, 2);
  assert.match(noPerson.stderr, /needs --person/);

  const noChange = await cli(["assignment", "move", "Atlas", "--person", "anna", "--plan", started.planPath]);
  assert.equal(noChange.status, 2);
  assert.match(noChange.stderr, /needs at least one of --from, --to or --share/);

  const both = await move(started.planPath, ["--to", "2026-11-20", "--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  // A read command has no business taking the write's options.
  const read = await cli(["people", "--from", "2026-11-02", "--plan", started.planPath]);
  assert.equal(read.status, 2);
  assert.match(read.stderr, /people does not take --from/);
});

/* --- one Milestone created, and one edited ------------------------------- */

// The fixture's two Milestones both sit in slot 0, so the least-used Milestone
// slot is 1 - the same prediction a new Project would get, since the Projects
// sit in 0, 3 and 4: each collection counts its own colours.
function milestoneFixture() {
  const plan = fixture();
  plan.milestones = [
    { id: "m-launch", name: "Launch", date: "2026-11-20", colour: 0, tags: ["delivery"], notes: "", projectIds: ["atlas"] },
    { id: "m-review", name: "Review", date: "2026-11-25", colour: 0, tags: [], notes: "plan-wide", projectIds: [] }
  ];
  return plan;
}

function milestoneCreate(planPath, extra, env) {
  return cli(["milestone", "add", "API launch", "--plan", planPath].concat(extra || []),
    { env: env });
}

function milestoneEdit(planPath, name, extra, env) {
  return cli(["milestone", "edit", name, "--plan", planPath].concat(extra || []),
    { env: env });
}

function milestoneOf(plan, id) {
  return (plan.milestones || []).find((entry) => entry.id === id);
}

test("the Milestone add preview is the default and the plan file is not touched", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await milestoneCreate(started.planPath, ["--date", "2026-12-04",
    "--project", "Atlas", "--tag", "delivery:phase-2"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // The shape the issue asked for: the date and its weekday, the colour slot,
  // the tags, where the rule is drawn, and that no figure counts a Milestone.
  assert.match(result.stdout, /New Milestone/);
  assert.match(result.stdout,
    /API launch, 2026-12-04, a Friday, colour slot 1 \(the least used\)/);
  assert.match(result.stdout, /Tags: delivery:phase-2/);
  assert.match(result.stdout, /Related to Atlas, so the rule is drawn while Atlas is in view\./);
  assert.match(result.stdout,
    /Milestones are annotations: no total, share or over-allocation check counts them\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);

  // --dry-run is the same thing said on purpose, and a Milestone related to no
  // Project says it is plan-wide rather than leaving the reader to work it out.
  const stated = await milestoneCreate(started.planPath, ["--date", "2026-12-04", "--dry-run"]);
  assert.equal(stated.status, 0, stated.stderr);
  assert.equal(stated.stdout, result.stdout.replace(
    "Related to Atlas, so the rule is drawn while Atlas is in view.",
    "Related to no Project, so the rule is plan-wide.").replace(
    "Tags: delivery:phase-2", "Tags: none"));
  assert.match(stated.stdout, /Related to no Project, so the rule is plan-wide\./);
  assert.deepEqual(started.bytes(), before);
});

test("--apply creates exactly one Milestone with the name, date, tags and Projects asked for", async () => {
  const started = await app(milestoneFixture());
  const original = started.file();

  const result = await milestoneCreate(started.planPath, ["--date", "2026-12-04",
    "--project", "Atlas", "--tag", "delivery:phase-2", "--note", "signed off", "--apply"],
  { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout, /read back from its plan: milestone-[a-z0-9-]+,/);
  assert.match(result.stdout, /API launch, 2026-12-04, colour slot 1, 1 tag, related to 1 Project\./);
  assert.match(result.stdout, /Undo: the creation is one step back with the app's Undo control\./);

  const after = started.file();
  const added = after.milestones.filter((entry) =>
    !original.milestones.some((existing) => existing.id === entry.id));
  assert.equal(added.length, 1, "exactly one Milestone is created");
  const created = added[0];
  assert.match(created.id, /^milestone-/);
  assert.equal(created.name, "API launch");
  assert.equal(created.date, "2026-12-04");
  assert.equal(created.colour, 1, "the least-used Milestone slot, chosen by the app");
  assert.deepEqual(created.tags, ["delivery:phase-2"]);
  assert.equal(created.notes, "signed off");
  assert.deepEqual(created.projectIds, ["atlas"], "the related Project is stored by id");

  // Nothing else moved: the plan is the one it started from plus the new record.
  const expected = structuredClone(original);
  expected.milestones.push(created);
  assert.deepEqual(after, expected);

  // And the app's plan holds it, which is what the read back asked.
  const plan = await json(started.base, "/api/plan");
  const held = plan.body.milestones.find((entry) => entry.id === created.id);
  assert.equal(held.date, "2026-12-04");
  assert.deepEqual(held.projectIds, ["atlas"]);
  assert.deepEqual(held.tags, ["delivery:phase-2"]);
});

test("a colour is only sent when it is named, and the predicted slot is only reported", async () => {
  const started = await app(milestoneFixture());

  // The preview predicts slot 1, and the create body carries no colour at all:
  // the server takes the least-used slot, not the tool.
  const preview = await milestoneCreate(started.planPath, ["--date", "2026-12-04", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const data = JSON.parse(preview.stdout);
  assert.deepEqual(data.colour, { slot: 1, named: false });
  assert.equal("colour" in data.create, false, "the predicted slot is never sent");

  const applied = await milestoneCreate(started.planPath, ["--date", "2026-12-04", "--apply"],
    { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  const chosen = started.file().milestones.find((entry) => entry.name === "API launch");
  assert.equal(chosen.colour, 1, "the app's own least-used slot, which matched the prediction");

  // A named colour is said to be named rather than predicted, and it is sent.
  const named = await cli(["milestone", "add", "API beta", "--date", "2026-12-05",
    "--colour", "7", "--plan", started.planPath, "--json"]);
  assert.equal(named.status, 0, named.stderr);
  const namedData = JSON.parse(named.stdout);
  assert.deepEqual(namedData.colour, { slot: 7, named: true });
  assert.equal(namedData.create.colour, 7, "a named colour is in the body");

  const namedText = await cli(["milestone", "add", "API beta", "--date", "2026-12-05",
    "--colour", "7", "--plan", started.planPath]);
  assert.match(namedText.stdout, /API beta, 2026-12-05, a Saturday, colour slot 7 \(as named\)/);

  const namedApplied = await cli(["milestone", "add", "API beta", "--date", "2026-12-05",
    "--colour", "7", "--plan", started.planPath, "--apply"], { env: { PACT_URL: started.base } });
  assert.equal(namedApplied.status, 0, namedApplied.stderr);
  assert.equal(started.file().milestones.find((entry) => entry.name === "API beta").colour, 7);
});

test("an edit prints the diff of exactly the fields it changes, and --apply writes those", async () => {
  const started = await app(milestoneFixture());
  const original = started.file();
  const before = started.bytes();

  // The preview names every value that moves, the weekday of the new date, the
  // tags and the Projects as words rather than ids, and writes nothing.
  const preview = await milestoneEdit(started.planPath, "Review", ["--date", "2026-12-01",
    "--colour", "4", "--tag", "signed", "--project", "Borealis", "--note", "internal review"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /Milestone Review/);
  assert.match(preview.stdout, /2026-11-25 {2,}-> {2}2026-12-01/);
  assert.match(preview.stdout, /colour slot 0 {2,}-> {2}colour slot 4/);
  assert.match(preview.stdout, /Tags: none {2,}-> {2}Tags: signed/);
  assert.match(preview.stdout, /Notes: plan-wide {2,}-> {2}Notes: internal review/);
  assert.match(preview.stdout, /Related to no Project {2,}-> {2}Related to Borealis/);
  assert.match(preview.stdout, /2026-12-01 is a Tuesday\./);
  assert.match(preview.stdout, /Related to Borealis, so the rule is drawn while Borealis is in view\./);
  assert.match(preview.stdout, /Nothing written\. Re-run with --apply\./);
  assert.deepEqual(started.bytes(), before, "the preview must not write");

  // The JSON carries exactly what the apply will send, and nothing more.
  const asJson = await milestoneEdit(started.planPath, "Review", ["--colour", "4", "--json"]);
  assert.equal(asJson.status, 0, asJson.stderr);
  const previewData = JSON.parse(asJson.stdout);
  assert.deepEqual(previewData.change, { colour: 4 });
  assert.deepEqual(previewData.diff, [{ field: "colour", before: 0, after: 4 }]);
  assert.equal(previewData.subject.name, "Review");
  assert.equal(previewData.applied, false);

  const applied = await milestoneEdit(started.planPath, "Review", ["--date", "2026-12-01",
    "--colour", "4", "--tag", "signed", "--project", "Borealis", "--note", "internal review",
    "--apply"], { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /read back from its plan: m-review,/);
  assert.match(applied.stdout, /Review, 2026-12-01, colour slot 4, 1 tag, related to 1 Project\./);
  assert.match(applied.stdout, /Undo: the change is one step back with the app's Undo control\./);

  // The diff named five fields and those five are the only ones that moved.
  const after = started.file();
  const edited = milestoneOf(after, "m-review");
  assert.equal(edited.date, "2026-12-01");
  assert.equal(edited.colour, 4);
  assert.deepEqual(edited.tags, ["signed"]);
  assert.equal(edited.notes, "internal review");
  assert.deepEqual(edited.projectIds, ["borealis"]);
  assert.equal(edited.name, "Review");
  assert.equal(edited.id, "m-review");

  const expected = structuredClone(original);
  Object.assign(milestoneOf(expected, "m-review"), {
    date: "2026-12-01", colour: 4, tags: ["signed"], notes: "internal review",
    projectIds: ["borealis"]
  });
  assert.deepEqual(after, expected, "nothing the diff did not name moved");

  // A one-field edit says one line, and leaves the rest as it was.
  const oneLine = await milestoneEdit(started.planPath, "Launch", ["--date", "2026-11-19", "--apply"],
    { PACT_URL: started.base });
  assert.equal(oneLine.status, 0, oneLine.stderr);
  assert.match(oneLine.stdout, /2026-11-20 {2,}-> {2}2026-11-19/);
  assert.doesNotMatch(oneLine.stdout.split("Applied through")[0], /colour slot|Tags:|Notes:/);
  const launch = milestoneOf(started.file(), "m-launch");
  assert.equal(launch.date, "2026-11-19");
  assert.equal(launch.colour, 0);
  assert.deepEqual(launch.tags, ["delivery"]);
  assert.deepEqual(launch.projectIds, ["atlas"]);
});

test("a name a Milestone already answers to is refused, and nothing is written", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();

  const byName = await cli(["milestone", "add", "Review", "--date", "2026-12-04",
    "--plan", started.planPath]);
  assert.equal(byName.status, 1);
  assert.match(byName.stderr, /the plan already holds a Milestone called "Review" \(m-review\)/);
  assert.match(byName.stderr, /would make every later command ambiguous/);

  const byId = await cli(["milestone", "add", "m-launch", "--date", "2026-12-04",
    "--plan", started.planPath]);
  assert.equal(byId.status, 1);
  assert.match(byId.stderr, /the plan already holds a Milestone called "Launch" \(m-launch\)/);

  assert.deepEqual(started.bytes(), before);
});

test("an unknown Project, colour or date is refused with the reads' own words", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();

  const project = await milestoneCreate(started.planPath, ["--date", "2026-12-04",
    "--project", "Atls"]);
  assert.equal(project.status, 1);
  assert.match(project.stderr, /unknown project "Atls"/);
  assert.match(project.stderr, /nearest: "Atlas"/);

  const colour = await milestoneCreate(started.planPath, ["--date", "2026-12-04",
    "--colour", "10"]);
  assert.equal(colour.status, 1);
  assert.match(colour.stderr, /--colour must be a slot 0\.\.9/);

  const date = await milestoneCreate(started.planPath, ["--date", "4 December"]);
  assert.equal(date.status, 1);
  assert.match(date.stderr, /--date must be a date like 2026-11-02/);

  const subject = await milestoneEdit(started.planPath, "Nope", ["--colour", "3"]);
  assert.equal(subject.status, 1);
  assert.match(subject.stderr, /unknown milestone "Nope"/);

  const editProject = await milestoneEdit(started.planPath, "Review", ["--project", "Atls"]);
  assert.equal(editProject.status, 1);
  assert.match(editProject.stderr, /unknown project "Atls"/);

  assert.deepEqual(started.bytes(), before);
});

test("an edit that would change nothing is refused", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();

  const same = await milestoneEdit(started.planPath, "Review",
    ["--date", "2026-11-25", "--colour", "0"]);
  assert.equal(same.status, 1);
  assert.match(same.stderr, /"Review" already holds every value this edit names/);

  // A value the Milestone already holds is no change either.
  const reordered = await milestoneEdit(started.planPath, "Review", ["--note", "plan-wide"]);
  assert.equal(reordered.status, 1);
  assert.match(reordered.stderr, /nothing to change/);
  assert.deepEqual(started.bytes(), before);
});

test("the app's Undo steps a creation and an edit back, and Redo puts them forward again", async () => {
  const started = await app(milestoneFixture());
  const original = started.file();

  const created = await milestoneCreate(started.planPath, ["--date", "2026-12-04", "--apply"],
    { PACT_URL: started.base });
  assert.equal(created.status, 0, created.stderr);
  assert.equal(started.file().milestones.length, 3);

  const undone = await json(started.base, "/api/undo", "POST");
  assert.equal(undone.status, 200);
  assert.deepEqual(started.file(), original, "Undo removes the created Milestone");

  const redone = await json(started.base, "/api/redo", "POST");
  assert.equal(redone.status, 200);
  assert.equal(started.file().milestones.length, 3, "Redo puts the Milestone back");

  const edited = await milestoneEdit(started.planPath, "Review", ["--colour", "4", "--apply"],
    { PACT_URL: started.base });
  assert.equal(edited.status, 0, edited.stderr);
  assert.equal(milestoneOf(started.file(), "m-review").colour, 4);

  const undoneEdit = await json(started.base, "/api/undo", "POST");
  assert.equal(undoneEdit.status, 200);
  assert.equal(milestoneOf(started.file(), "m-review").colour, 0, "Undo returns the old colour");
  assert.equal(started.file().milestones.length, 3, "and leaves the record in the plan");

  // One Undo per write, and the creation is the step behind this one.
  const undoAgain = await json(started.base, "/api/undo", "POST");
  assert.equal(undoAgain.status, 200);
  assert.deepEqual(started.file(), original, "the plan is the one the write started from");
});

test("a Milestone write on a plan the app is not holding is refused, and nothing is written", async () => {
  const started = await app(milestoneFixture());
  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(milestoneFixture(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);

  for (const result of [
    await cli(["milestone", "add", "API launch", "--date", "2026-12-04", "--plan", elsewhere,
      "--apply"], { env: { PACT_URL: started.base } }),
    await cli(["milestone", "edit", "Review", "--colour", "4", "--plan", elsewhere,
      "--apply"], { env: { PACT_URL: started.base } })
  ]) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /refusing to write: the app at .* has a different plan open/);
  }
  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");
  assert.equal(started.file().milestones.length, 2);
  assert.equal(milestoneOf(started.file(), "m-review").colour, 0);
});

test("with no app answering, a Milestone write says how to start one", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();

  // Port 1 is never served by this user, so the connection is refused at once.
  for (const result of [
    await milestoneCreate(started.planPath, ["--date", "2026-12-04", "--apply"],
      { PACT_URL: "http://127.0.0.1:1" }),
    await milestoneEdit(started.planPath, "Review", ["--colour", "4", "--apply"],
      { PACT_URL: "http://127.0.0.1:1" })
  ]) {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
    assert.match(result.stderr, /start it with node server\.mjs/);
    assert.equal(/\n\s+at /.test(result.stderr), false, "no stack trace");
    assert.equal(result.stdout, "", "a write that never left says nothing it did");
  }
  assert.deepEqual(started.bytes(), before);
});

test("no action, option or code path in the tool removes a Milestone", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();

  // A removal is not an action, and archiving is not one either: a Milestone
  // has no archived state, so both are refused before the plan is read.
  for (const action of ["destroy", "delete", "remove", "archive", "restore"]) {
    const result = await cli(["milestone", action, "Review", "--plan", started.planPath, "--apply"],
      { env: { PACT_URL: started.base } });
    assert.equal(result.status, 2, action);
    assert.match(result.stderr, /unknown milestone action "/, action);
    assert.match(result.stderr, /A Milestone is never removed from this tool/, action);
  }
  for (const flag of ["--force", "--destroy", "--delete", "--archive", "--remove"]) {
    const result = await milestoneCreate(started.planPath, ["--date", "2026-12-04", flag]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /unknown option "/, flag);
  }

  // The help keeps the boundary true and now names the two writes it does have.
  const help = await cli(["--help"]);
  assert.match(help.stdout, /milestone add <name>/);
  assert.match(help.stdout, /milestone edit <name>/);
  assert.match(help.stdout, /It never removes a Milestone/);
  assert.match(help.stdout, /this tool cannot take one out of a plan at all/);

  // And the routes: the app's own POST and PATCH, and the destruction route
  // named nowhere, so no code path here can reach it.
  const source = fs.readFileSync(BIN, "utf8");
  assert.match(source, /readBackCreate\(base, "\/api\/milestones"/);
  assert.match(source, /"PATCH", "\/api\/milestones\/" \+ encodeURIComponent\(id\)/);
  assert.doesNotMatch(source, /destroyMilestone|\/destroy/);
  // The one DELETE in the file is the archive route, and no DELETE names the
  // milestones collection at all.
  assert.equal((source.match(/"DELETE"/g) || []).length, 1);
  assert.doesNotMatch(source, /"DELETE", "\/api\/milestones/);

  assert.deepEqual(started.bytes(), before);
});

test("milestone add and milestone edit state what they need, and refuse what is not theirs", async () => {
  const started = await app(milestoneFixture());
  const before = started.bytes();

  const noAction = await cli(["milestone", "--plan", started.planPath]);
  assert.equal(noAction.status, 2);
  assert.match(noAction.stderr, /milestone needs an action/);

  const noName = await cli(["milestone", "add", "--date", "2026-12-04", "--plan", started.planPath]);
  assert.equal(noName.status, 2);
  assert.match(noName.stderr, /milestone add needs a name/);

  const noDate = await milestoneCreate(started.planPath, []);
  assert.equal(noDate.status, 2);
  assert.match(noDate.stderr, /milestone add needs --date/);

  const editNothing = await milestoneEdit(started.planPath, "Review", []);
  assert.equal(editNothing.status, 2);
  assert.match(editNothing.stderr,
    /needs at least one of --date, --colour, --tag, --project or --note/);

  const both = await milestoneCreate(started.planPath,
    ["--date", "2026-12-04", "--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  // A period counts work, and a Milestone is not work.
  const period = await milestoneCreate(started.planPath, ["--date", "2026-12-04",
    "--period", "2026-11"]);
  assert.equal(period.status, 2);
  assert.match(period.stderr, /milestone add does not take a period/);

  // Nor do the other commands' own options belong on a Milestone.
  for (const flag of ["--person", "--share", "--location", "--availability", "--kind"]) {
    const result = await milestoneCreate(started.planPath, ["--date", "2026-12-04", flag, "x"]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /milestone does not take /, flag);
  }

  // And a read has no business with a Milestone write's options.
  const read = await cli(["milestones", "--date", "2026-12-04", "--plan", started.planPath]);
  assert.equal(read.status, 2);
  assert.match(read.stderr, /milestones does not take --date/);

  assert.deepEqual(started.bytes(), before);
});
