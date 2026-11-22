/*
 * PACT's one write: reschedule or resize an Assignment through the running app.
 *
 * The rules here are the ones that make a write safe rather than the ones that
 * make it work: the diff is the default and touches nothing, the write changes
 * exactly what the diff said and nothing else, it is the app's own change so
 * the app's Undo takes it back, a plan the app is not holding is refused rather
 * than changed, and nothing answering at the address is a sentence rather than
 * a stack trace. A write is asserted by reading the file on disk and the app's
 * plan back, never by the reply to the request.
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

/* --- usage --------------------------------------------------------------- */

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
