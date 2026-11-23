/*
 * PACT's edits: change a Person or a Project that already exists, through the
 * running app.
 *
 * The rules here are the ones that make an edit safe rather than the ones that
 * make it work: the diff is the default and touches nothing, --apply changes
 * exactly the fields the diff named and leaves every other field of the record
 * and of the plan as stored, a tag is added or removed rather than replaced so
 * nobody's tag is dropped silently, the preview's figures are the plan's own
 * after the write, a rename cannot create a second live record of one name, an
 * edit that would change nothing is refused rather than printed as an empty
 * diff, and a plan the app is not holding is refused rather than changed. The
 * app made the change, so the app's Undo takes it back.
 *
 * The tool never deletes anything, and that is asserted here too, for the two
 * commands this file is about: no action, option or code path reaches a
 * deletion, and an edit changes fields without ever removing the record.
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

const scratchDir = scratch("pact-edit");

// November 2026 has 21 weekdays and Berlin's holiday on the 11th leaves 20
// working days: Anna offers 20 FTE-days at 100% and holds 9 on Atlas and 6 on
// Borealis; Ben offers 7.5, five of his working days being an absence. The plan's
// Capacity is 27.5 and its Allocated 15, so an Availability change and an absence
// switch are both hand-checkable.
function fixture() {
  return {
    range: { start: "2026-11-01", end: "2026-12-31" },
    step: 10,
    cadence: { start: "2026-11-02", length: 14, namePrefix: "Sprint ", nameNumber: 1 },
    people: [
      { id: "anna", name: "Anna Meier", availability: 100, location: "Berlin",
        tags: ["lead", "skill:backend"], note: "" },
      { id: "ben", name: "Ben Falk", availability: 50, location: "Berlin", tags: [], note: "" }
    ],
    projects: [
      { id: "atlas", name: "Atlas", colour: 0, tags: ["api:Solar"], notes: "" },
      { id: "borealis", name: "Borealis", colour: 3, tags: ["api:Stellar"], notes: "" },
      { id: "leave", name: "Annual Leave", colour: 4, absence: true, tags: ["Absence"], notes: "" }
    ],
    assignments: [
      { id: "a-atlas-anna", projectId: "atlas", personId: "anna", start: "2026-11-02",
        end: "2026-11-13", share: 100, tags: ["lead"], note: "kick-off" },
      { id: "a-borealis-anna", projectId: "borealis", personId: "anna", start: "2026-11-02",
        end: "2026-11-30", share: 30, tags: [], note: "" },
      { id: "a-leave-ben", projectId: "leave", personId: "ben", start: "2026-11-16",
        end: "2026-11-20", share: 100, tags: [], note: "" }
    ],
    holidays: [{ location: "Berlin", dates: [{ date: "2026-11-11", kind: "full" }] }]
  };
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

// The edit of one Person over the plan's own period, spelled once so a case that
// changes the subject or the plan says so in its own call.
function editPerson(planPath, extra, env, subject) {
  return cli(["person", "edit", subject || "Anna Meier", "--plan", planPath].concat(extra || []),
    { env: env });
}

function editProject(planPath, extra, env, subject) {
  return cli(["project", "edit", subject || "Atlas", "--plan", planPath].concat(extra || []),
    { env: env });
}

function personOf(plan, id) {
  return plan.people.find((entry) => entry.id === id);
}

function projectOf(plan, id) {
  return plan.projects.find((entry) => entry.id === id);
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

// What the plan would be with one field of one record changed, so "and nothing
// else moved" is asserted against the whole file rather than a field list.
function changed(plan, collection, id, field, value) {
  const next = structuredClone(plan);
  next[collection].find((entry) => entry.id === id)[field] = value;
  return next;
}

/* --- the diff is the default, and writes nothing -------------------------- */

test("the Person diff is the default, and the plan file is not touched", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await editPerson(started.planPath, ["--availability", "80", "--period", "2026-11"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // The shape the issue asked for: the record, the field, old and new, what the
  // Availability costs over the period, and the rest of the record in full.
  assert.match(result.stdout, /Edit Person Anna Meier/);
  assert.match(result.stdout, /Availability {2}100% {2}-> {2}80%/);
  assert.match(result.stdout, /Nov 2026: 20\.0 FTE-days offered {2}-> {2}16\.0 FTE-days {2}\(of 20 working days\)/);
  assert.match(result.stdout, /Everything else stays: Name Anna Meier, Location Berlin, Note -, Tags lead, skill:backend\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime);
});

test("the Project diff is the default, and it states what an absence switch costs", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const result = await editProject(started.planPath, ["--absence", "on", "--period", "2026-11"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Edit Project Atlas/);
  assert.match(result.stdout, /Absence {2}no {2}-> {2}yes/);
  // The figure either way, and which way it now goes.
  assert.match(result.stdout, /Its 1 Assignment is worth 9\.0 FTE-days over Nov 2026, and it now takes that time out of Capacity rather than adding it to Allocated\./);
  assert.match(result.stdout, /Nov 2026: Capacity 27\.5 {2}-> {2}18\.5 FTE-days, Allocated 15\.0 {2}-> {2}3\.3 FTE-days/);
  assert.match(result.stdout, /Everything else stays: Name Atlas, Colour slot 0, Notes -, Tags api:Solar\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  // The other direction says the other thing, from the plan that holds it.
  const archivedOff = await app(Object.assign(fixture(), {
    projects: fixture().projects.map((project) => {
      return project.id === "atlas" ? Object.assign({}, project, { absence: true }) : project;
    })
  }));
  const back = await editProject(archivedOff.planPath, ["--absence", "off", "--period", "2026-11"]);
  assert.equal(back.status, 0, back.stderr);
  assert.match(back.stdout, /Absence {2}yes {2}-> {2}no/);
  assert.match(back.stdout, /now adds that work to Allocated rather than taking it out of Capacity/);

  assert.deepEqual(started.bytes(), before, "the default must not write");
});

test("--dry-run is the same thing said on purpose", async () => {
  const started = await app(fixture());
  const quietPerson = await editPerson(started.planPath, ["--availability", "80"]);
  const statedPerson = await editPerson(started.planPath, ["--availability", "80", "--dry-run"]);
  assert.equal(statedPerson.status, 0, statedPerson.stderr);
  assert.equal(statedPerson.stdout, quietPerson.stdout);

  const quietProject = await editProject(started.planPath, ["--colour", "5"]);
  const statedProject = await editProject(started.planPath, ["--colour", "5", "--dry-run"]);
  assert.equal(statedProject.status, 0, statedProject.stderr);
  assert.equal(statedProject.stdout, quietProject.stdout);

  assert.equal(personOf(started.file(), "anna").availability, 100);
  assert.equal(projectOf(started.file(), "atlas").colour, 0);
});

/* --- --apply changes exactly what it said -------------------------------- */

// Each field on its own: the named field changes, and every other field of the
// record, and of the plan, is what it was.
const PERSON_FIELDS = [
  { args: ["--name", "Anna Weber"], field: "name", after: "Anna Weber" },
  { args: ["--location", "Munich"], field: "location", after: "Munich" },
  { args: ["--availability", "80"], field: "availability", after: 80 },
  { args: ["--tag", "team:atlas"], field: "tags", after: ["lead", "skill:backend", "team:atlas"] },
  { args: ["--untag", "skill:backend"], field: "tags", after: ["lead"] }
];

const PROJECT_FIELDS = [
  { args: ["--name", "Northwind"], field: "name", after: "Northwind" },
  { args: ["--colour", "5"], field: "colour", after: 5 },
  { args: ["--absence", "on"], field: "absence", after: true },
  { args: ["--tag", "team:solar"], field: "tags", after: ["api:Solar", "team:solar"] },
  { args: ["--untag", "api:Solar"], field: "tags", after: [] }
];

test("a Person's fields each change alone, and leave the record and the plan as stored", async () => {
  for (const entry of PERSON_FIELDS) {
    const started = await app(fixture());
    const original = started.file();
    const result = await editPerson(started.planPath, entry.args.concat(["--apply"]),
      { PACT_URL: started.base });
    assert.equal(result.status, 0, entry.args.join(" ") + ": " + result.stderr);
    assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+; read back from its plan: /);
    assert.match(result.stdout, /Undo: the change is one step back with the app's Undo control\./);

    const after = started.file();
    assert.deepEqual(after, changed(original, "people", "anna", entry.field, entry.after),
      entry.args.join(" ") + " changed more than " + entry.field);
    assert.deepEqual(personOf(after, "anna")[entry.field], entry.after, entry.field);

    // The app's own plan holds it too, which is what the tool read back.
    const plan = await json(started.base, "/api/plan");
    assert.deepEqual(personOf(plan.body, "anna")[entry.field], entry.after, entry.field);
  }
});

test("a Project's fields each change alone, and leave the record and the plan as stored", async () => {
  for (const entry of PROJECT_FIELDS) {
    const started = await app(fixture());
    const original = started.file();
    const result = await editProject(started.planPath, entry.args.concat(["--apply"]),
      { PACT_URL: started.base });
    assert.equal(result.status, 0, entry.args.join(" ") + ": " + result.stderr);

    const after = started.file();
    assert.deepEqual(after, changed(original, "projects", "atlas", entry.field, entry.after),
      entry.args.join(" ") + " changed more than " + entry.field);
  }
});

test("the note lands in a Person's note and in a Project's notes", async () => {
  const started = await app(fixture());
  const person = await editPerson(started.planPath, ["--note", "leads design", "--apply"],
    { PACT_URL: started.base });
  assert.equal(person.status, 0, person.stderr);
  assert.equal(personOf(started.file(), "anna").note, "leads design");
  assert.equal(personOf(started.file(), "anna").availability, 100);

  const project = await editProject(started.planPath, ["--note", "the plan of record", "--apply"],
    { PACT_URL: started.base });
  assert.equal(project.status, 0, project.stderr);
  assert.equal(projectOf(started.file(), "atlas").notes, "the plan of record");
  // A Project has notes, not a note, and no field of the other name is invented.
  assert.equal(Object.prototype.hasOwnProperty.call(projectOf(started.file(), "atlas"), "note"), false);
});

test("--tag adds and --untag removes, and the rest of the tag list is untouched", async () => {
  const started = await app(fixture());

  const added = await editPerson(started.planPath, ["--tag", "team:atlas", "--apply"],
    { PACT_URL: started.base });
  assert.equal(added.status, 0, added.stderr);
  assert.deepEqual(personOf(started.file(), "anna").tags, ["lead", "skill:backend", "team:atlas"]);

  const removed = await editPerson(started.planPath, ["--untag", "skill:backend", "--apply"],
    { PACT_URL: started.base });
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(personOf(started.file(), "anna").tags, ["lead", "team:atlas"],
    "the tags nobody named are still there");

  // A tag differing only in case is the same tag, by the app's own rule.
  const twice = await editPerson(started.planPath, ["--tag", "LEAD", "--json"]);
  assert.notEqual(twice.status, 0);
  assert.equal(JSON.parse(twice.stderr).code, "duplicate-tag");

  const onProject = await editProject(started.planPath, ["--tag", "team:solar", "--untag", "api:Solar", "--apply"],
    { PACT_URL: started.base });
  assert.equal(onProject.status, 0, onProject.stderr);
  assert.deepEqual(projectOf(started.file(), "atlas").tags, ["team:solar"]);
});

test("the preview prints the resulting tag list in full, so a lost tag is visible", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const result = await editPerson(started.planPath, ["--tag", "team:atlas"]);
  assert.equal(result.status, 0, result.stderr);
  // The whole list, not the one tag that was added.
  assert.match(result.stdout, /Tags {2}lead, skill:backend {2}-> {2}lead, skill:backend, team:atlas/);
  assert.deepEqual(started.bytes(), before);
});

/* --- the figures are the plan's own after the write ---------------------- */

test("the Availability preview states the FTE-days the plan then shows", async () => {
  const started = await app(fixture());
  const preview = await editPerson(started.planPath, ["--availability", "80", "--period", "2026-11", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const diff = JSON.parse(preview.stdout);
  assert.equal(diff.offered.before.fteDays, 20);
  assert.equal(diff.offered.before.workingDays, 20, "the holiday on the 11th is out of the count");
  assert.equal(diff.offered.after.fteDays, 16);
  assert.match(preview.stdout, /"change": \{\n {4}"availability": 80\n {2}\}/);

  const applied = await editPerson(started.planPath, ["--availability", "80", "--period", "2026-11", "--apply"],
    { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);

  // The read the tool's own preview promised: the Person's Capacity, which is
  // the report's figure, is the one the preview's "after" stated.
  const read = await cli(["person", "Anna Meier", "--period", "2026-11", "--json",
    "--plan", started.planPath]);
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).person.capacity, diff.offered.after.fteDays);
  assert.match(applied.stdout, /Nov 2026: 20\.0 FTE-days offered {2}-> {2}16\.0 FTE-days/);
});

test("the absence preview's figures are the plan's own after the switch", async () => {
  const started = await app(fixture());
  const preview = await editProject(started.planPath, ["--absence", "on", "--period", "2026-11", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const diff = JSON.parse(preview.stdout);
  assert.equal(diff.absence.on, true);
  assert.equal(diff.absence.fteDays, -9, "the Assignments take 9 FTE-days out of Capacity");
  assert.equal(diff.absence.plan.before.capacity, 27.5);
  assert.equal(diff.absence.plan.after.capacity, 18.5);
  assert.deepEqual(diff.assignments, undefined);

  const applied = await editProject(started.planPath, ["--absence", "on", "--period", "2026-11", "--apply"],
    { PACT_URL: started.base });
  assert.equal(applied.status, 0, applied.stderr);

  const plan = await cli(["plan", "--period", "2026-11", "--json", "--plan", started.planPath]);
  assert.equal(plan.status, 0, plan.stderr);
  const totals = JSON.parse(plan.stdout).totals;
  assert.equal(totals.capacity, diff.absence.plan.after.capacity);
  assert.equal(totals.allocated, diff.absence.plan.after.allocated);
});

/* --- names --------------------------------------------------------------- */

test("a rename refuses a live duplicate and accepts a free name", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const clash = await editPerson(started.planPath, ["--name", "Ben Falk", "--json"]);
  assert.notEqual(clash.status, 0);
  const said = JSON.parse(clash.stderr);
  assert.equal(said.code, "duplicate-name");
  assert.match(said.error, /the plan already holds a person called "Ben Falk" \(ben\)/);
  assert.deepEqual(started.bytes(), before, "a refused rename writes nothing");

  const free = await editPerson(started.planPath, ["--name", "Anna Weber", "--apply"],
    { PACT_URL: started.base });
  assert.equal(free.status, 0, free.stderr);
  assert.equal(personOf(started.file(), "anna").name, "Anna Weber");
  // Reads resolve by name, so the new name is the one that answers now.
  const read = await cli(["person", "Anna Weber", "--period", "2026-11", "--plan", started.planPath]);
  assert.equal(read.status, 0, read.stderr);
  const old = await cli(["person", "Anna Meier", "--period", "2026-11", "--plan", started.planPath]);
  assert.notEqual(old.status, 0);

  // A Project's rename follows the same rule, against the live Projects.
  const projectClash = await editProject(started.planPath, ["--name", "Borealis", "--json"]);
  assert.equal(JSON.parse(projectClash.stderr).code, "duplicate-name");
  const projectFree = await editProject(started.planPath, ["--name", "Northwind", "--apply"],
    { PACT_URL: started.base });
  assert.equal(projectFree.status, 0, projectFree.stderr);
  assert.equal(projectOf(started.file(), "atlas").name, "Northwind");
});

test("a rename shows the old and new name, and claims no figure", async () => {
  const started = await app(fixture());
  const result = await editPerson(started.planPath, ["--name", "Anna Weber"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Name {2}Anna Meier {2}-> {2}Anna Weber/);
  assert.doesNotMatch(result.stdout, /FTE-days offered/);
});

test("renaming a record to its own name changes nothing, and is refused as that", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const result = await editPerson(started.planPath, ["--name", "Anna Meier", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).code, "no-change");
  assert.deepEqual(started.bytes(), before);
});

/* --- refusals ------------------------------------------------------------ */

test("an edit that would change nothing is refused rather than printed as an empty diff", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  for (const [subject, args] of [["Anna Meier", ["--availability", "100"]],
    ["Anna Meier", ["--location", "Berlin"]],
    ["Atlas", ["--colour", "0"]], ["Atlas", ["--absence", "off"]]]) {
    const kind = subject === "Atlas" ? editProject : editPerson;
    const result = await kind(started.planPath, args.concat(["--json"]));
    assert.equal(result.status, 1, args.join(" "));
    const said = JSON.parse(result.stderr);
    assert.equal(said.code, "no-change", args.join(" "));
    assert.match(said.error, /already holds every value this edit names; there would be nothing to change/);
  }
  assert.deepEqual(started.bytes(), before);
});

test("a tag the record does not carry, an unknown colour and a bad --absence are refused", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const untag = await editPerson(started.planPath, ["--untag", "team:atlas", "--json"]);
  assert.equal(untag.status, 1);
  assert.equal(JSON.parse(untag.stderr).code, "unknown-tag");
  assert.match(JSON.parse(untag.stderr).error, /"Anna Meier" does not carry the tag "team:atlas"/);

  const tag = await editProject(started.planPath, ["--tag", "api:Solar", "--json"]);
  assert.equal(tag.status, 1);
  assert.equal(JSON.parse(tag.stderr).code, "duplicate-tag");

  const colour = await editProject(started.planPath, ["--colour", "12", "--json"]);
  assert.equal(colour.status, 1);
  assert.equal(JSON.parse(colour.stderr).code, "bad-value");
  assert.match(JSON.parse(colour.stderr).error, /--colour must be a slot 0\.\.9/);

  const absence = await editProject(started.planPath, ["--absence", "maybe", "--json"]);
  assert.equal(absence.status, 1);
  assert.equal(JSON.parse(absence.stderr).code, "bad-value");
  assert.match(JSON.parse(absence.stderr).error, /--absence takes on or off/);

  assert.deepEqual(started.bytes(), before);
});

test("an Availability the app will not take is refused in the app's own words", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const result = await editPerson(started.planPath, ["--availability", "150", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the app refused PATCH \/api\/people\/anna: /);
  assert.match(result.stderr, /person\.availability must be a whole number from 1 to 100/);
  assert.deepEqual(started.bytes(), before, "a refused write must not land");
});

test("an archived Person is not found by an edit, and the refusal says how to bring them back", async () => {
  const plan = fixture();
  plan.people.find((person) => person.id === "anna").archived = true;
  const started = await app(plan);
  const result = await editPerson(started.planPath, ["--availability", "80", "--json"]);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).code, "not-live");
  assert.match(JSON.parse(result.stderr).error, /person restore "Anna Meier" brings it back/);
});

test("person edit and project edit state what they need, and refuse what is not theirs", async () => {
  const started = await app(fixture());
  const noName = await cli(["person", "edit", "--plan", started.planPath]);
  assert.equal(noName.status, 2);
  assert.match(noName.stderr, /person edit needs a name/);

  const noFields = await editPerson(started.planPath, []);
  assert.equal(noFields.status, 2);
  assert.match(noFields.stderr,
    /person edit needs at least one of --name, --location, --availability, --note, --tag, --untag/);

  const noProjectFields = await editProject(started.planPath, []);
  assert.equal(noProjectFields.status, 2);
  assert.match(noProjectFields.stderr,
    /project edit needs at least one of --name, --colour, --absence, --note, --tag, --untag/);

  // A Person has no colour or absence flag, and a Project no Location or
  // Availability: each refuses the other's fields rather than ignoring them.
  const personForeign = await editPerson(started.planPath, ["--colour", "2"]);
  assert.equal(personForeign.status, 2);
  assert.match(personForeign.stderr, /person does not take --colour/);
  const personAbsence = await editPerson(started.planPath, ["--absence", "on"]);
  assert.equal(personAbsence.status, 2);
  assert.match(personAbsence.stderr, /person does not take --absence/);
  const projectForeign = await editProject(started.planPath, ["--location", "Munich"]);
  assert.equal(projectForeign.status, 2);
  assert.match(projectForeign.stderr, /project does not take --location/);
  const projectAvailability = await editProject(started.planPath, ["--availability", "80"]);
  assert.equal(projectAvailability.status, 2);
  assert.match(projectAvailability.stderr, /project does not take --availability/);

  const both = await editPerson(started.planPath, ["--availability", "80", "--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);
});

/* --- the app's own safety ------------------------------------------------ */

test("the app's Undo steps an edit back to the record it was", async () => {
  const started = await app(fixture());
  const original = started.file();

  const person = await editPerson(started.planPath, ["--availability", "80", "--tag", "team:atlas", "--apply"],
    { PACT_URL: started.base });
  assert.equal(person.status, 0, person.stderr);
  assert.equal(personOf(started.file(), "anna").availability, 80);

  const undonePerson = await json(started.base, "/api/undo", "POST");
  assert.equal(undonePerson.status, 200);
  assert.deepEqual(started.file(), original, "Undo must restore the Person");

  const project = await editProject(started.planPath, ["--colour", "5", "--apply"],
    { PACT_URL: started.base });
  assert.equal(project.status, 0, project.stderr);
  assert.equal(projectOf(started.file(), "atlas").colour, 5);

  const undoneProject = await json(started.base, "/api/undo", "POST");
  assert.equal(undoneProject.status, 200);
  assert.deepEqual(started.file(), original, "Undo must restore the Project");
});

test("a plan the app is not holding is refused, and nothing is written", async () => {
  const started = await app(fixture());
  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(fixture(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);

  const person = await editPerson(elsewhere, ["--availability", "80", "--apply"],
    { PACT_URL: started.base });
  assert.equal(person.status, 1);
  assert.match(person.stderr, /refusing to write: the app at .* has a different plan open/);
  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");

  const project = await editProject(elsewhere, ["--colour", "5", "--apply"],
    { PACT_URL: started.base });
  assert.equal(project.status, 1);
  assert.match(project.stderr, /refusing to write: the app at .* has a different plan open/);
  assert.deepEqual(fs.readFileSync(elsewhere), before);
  assert.equal(personOf(started.file(), "anna").availability, 100);
  assert.equal(projectOf(started.file(), "atlas").colour, 0);
});

test("with no app answering, an edit says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const result = await editPerson(started.planPath, ["--availability", "80", "--apply"],
    { PACT_URL: "http://127.0.0.1:1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
  assert.match(result.stderr, /start it with node server\.mjs/);
  assert.deepEqual(started.bytes(), before);
});

test("an edit the app accepts but does not hold is not reported as done", async () => {
  // An app that answers 200 to the PATCH and then serves a plan without the
  // change: the tool has to say the write did not land rather than trust the
  // reply, which is the difference between a verified write and a hoped one.
  const plan = fixture();
  const dir = scratchDir();
  const planPath = path.join(dir, "stub-edit.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");
  const server = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/plan-file") {
      return send({ path: planPath, source: "default", locked: false, notice: "" });
    }
    if (req.method === "GET" && req.url === "/api/plan") return send(plan);
    req.on("data", () => {});
    req.on("end", () => send({ id: "anna" }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;

  let result;
  try {
    result = await editPerson(planPath, ["--availability", "80", "--apply"], { PACT_URL: base });
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.equal(result.status, 1);
  assert.match(result.stderr, /the write did not land: the app's plan holds/);
  assert.match(result.stderr, /at 100%/, "the refusal names what the plan holds");
  assert.doesNotMatch(result.stdout, /Applied through/);
});

/* --- the boundary -------------------------------------------------------- */

test("an edit changes fields, and nothing here deletes", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  // The spellings of a deletion are unknown options, refused before anything is
  // read, and an action that would destroy is read as a name and finds no such
  // record rather than reaching a destruction.
  for (const flag of ["--force", "--destroy", "--delete", "--archive"]) {
    const person = await editPerson(started.planPath, ["--availability", "80", flag]);
    assert.equal(person.status, 2, flag);
    assert.match(person.stderr, /unknown option "/);
    const project = await editProject(started.planPath, ["--colour", "5", flag]);
    assert.equal(project.status, 2, flag);
    assert.match(project.stderr, /unknown option "/);
  }
  for (const action of ["destroy", "delete", "remove"]) {
    for (const command of ["person", "project"]) {
      const result = await cli([command, action, "Atlas", "--plan", started.planPath]);
      assert.notEqual(result.status, 0, command + " " + action);
      assert.match(result.stderr, new RegExp("unknown " + command));
    }
  }
  assert.deepEqual(started.bytes(), before);

  // And in the code: neither edit sends anything but the app's own PATCH on one
  // record, and the destruction route is named nowhere.
  const source = fs.readFileSync(BIN, "utf8");
  assert.doesNotMatch(source, /\/destroy/);
  assert.equal((source.match(/"DELETE"/g) || []).length, 1, "one DELETE, and it is the archive");
  assert.match(source, /async function applyRecordEdit/);
  assert.match(source, /"PATCH", recordRoute\(kind, id\)/);
});

test("the help says what an edit does, and keeps the boundary true", async () => {
  const help = await cli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Nineteen commands change a plan/);
  assert.match(help.stdout, /person edit <name>/);
  assert.match(help.stdout, /project edit <name>/);
  assert.match(help.stdout, /Editing a Person or a Project/);
  assert.match(help.stdout, /Tags are added and removed, never replaced/);
  assert.match(help.stdout, /The tool never deletes anything\./);
  assert.match(help.stdout, /edit a Person or a Project/);
  // The table carries both rows, in the order the writes come in.
  const table = await cli(["--help", "table"]);
  assert.match(table.stdout, /\| `person edit <name>` +\| change one Person's fields +\| the app +\|/);
  assert.match(table.stdout, /\| `project edit <name>` +\| change one Project's fields +\| the app +\|/);
});
