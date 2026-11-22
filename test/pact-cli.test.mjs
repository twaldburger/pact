/*
 * PACT's read tool: the command line over the plan, and the query module it
 * stands on.
 *
 * The figures are checked against `report-content.mjs` for the same period, so
 * the tool cannot drift from the report page. The corresponding checks are the
 * report's own: one fixture with hand-checkable arithmetic, a November of 21
 * working days in which Anna takes five off and is over-allocated, Ben is at
 * half Availability, and one Project is an absence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { scratch } from "../test-support/scratch.mjs";
import { reportContent } from "../public/lib/report-content.mjs";
import * as query from "../lib/query.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const BIN = path.join(REPO, "bin", "pact.mjs");
const QUERY = path.join(REPO, "lib", "query.mjs");
const DEFAULT_PLAN = path.join(REPO, "data", "default.pact.json");

const FIXTURE = {
  range: { start: "2026-11-01", end: "2026-11-30" },
  step: 10,
  cadence: { start: "2026-11-02", length: 14, namePrefix: "Sprint ", nameNumber: 1 },
  people: [
    { id: "anna", name: "Anna Meier", availability: 100, location: "Berlin", tags: ["lead", "React"], note: "leads Atlas" },
    { id: "ben", name: "Ben Falk", availability: 50, location: "Berlin", tags: ["React"], note: "" }
  ],
  projects: [
    { id: "solar", name: "Solar", colour: 0, tags: ["api:Solar", "Testing"], notes: "phase one" },
    { id: "borealis", name: "Borealis", colour: 3, tags: ["api:Stellar"], notes: "" },
    { id: "leave", name: "Annual Leave", colour: 4, absence: true, tags: ["Absence"], notes: "" }
  ],
  assignments: [
    { id: "a-solar-anna", projectId: "solar", personId: "anna", start: "2026-11-01", end: "2026-11-30", share: 100, tags: [], note: "" },
    { id: "a-borealis-anna", projectId: "borealis", personId: "anna", start: "2026-11-01", end: "2026-11-30", share: 20, tags: [], note: "" },
    { id: "a-solar-ben", projectId: "solar", personId: "ben", start: "2026-11-01", end: "2026-11-30", share: 50, tags: [], note: "" },
    { id: "a-leave-anna", projectId: "leave", personId: "anna", start: "2026-11-09", end: "2026-11-13", share: 100, tags: [], note: "" },
    { id: "a-leave-ben", projectId: "leave", personId: "ben", start: "2026-11-16", end: "2026-11-20", share: 100, tags: [], note: "" }
  ],
  holidays: [{ location: "Lisbon", dates: [{ date: "2026-11-30", kind: "full" }] }],
  milestones: [
    { id: "m-launch", name: "Launch", date: "2026-11-20", colour: 2, tags: ["delivery"], notes: "", projectIds: ["solar"] },
    { id: "m-review", name: "Review", date: "2026-11-25", colour: 5, tags: [], notes: "plan-wide", projectIds: [] }
  ]
};

const scratchDir = scratch("pact-cli");
const DIR = scratchDir();
const PLAN = path.join(DIR, "fixture.pact.json");
fs.writeFileSync(PLAN, JSON.stringify(FIXTURE, null, 2) + "\n");

// The fixture with one record of each kind archived, so the restore path has a
// subject the reads cannot see. One plan per kind: an Assignment is only found
// on a Project and a Person that are themselves live.
const ARCHIVED_PERSON = Object.assign({}, FIXTURE, {
  people: FIXTURE.people.map((p) => (p.id === "anna" ? Object.assign({}, p, { archived: true }) : p))
});
const ARCHIVED_PROJECT = Object.assign({}, FIXTURE, {
  projects: FIXTURE.projects.map((p) => (p.id === "solar" ? Object.assign({}, p, { archived: true }) : p))
});
const ARCHIVED_ASSIGNMENT = Object.assign({}, FIXTURE, {
  assignments: FIXTURE.assignments.map((a) =>
    (a.id === "a-borealis-anna" ? Object.assign({}, a, { archived: true }) : a))
});

// A plan with two People of one name, for the ambiguous-subject path.
const DUPLICATE = Object.assign({}, FIXTURE, {
  people: [
    { id: "sam-one", name: "Sam", availability: 100, tags: [], note: "" },
    { id: "sam-two", name: "Sam", availability: 100, tags: [], note: "" }
  ],
  assignments: []
});
const DUPLICATE_PLAN = path.join(DIR, "duplicate.pact.json");
fs.writeFileSync(DUPLICATE_PLAN, JSON.stringify(DUPLICATE, null, 2) + "\n");

// A plan whose one Project carries no tag, for the by-tag pivot's Untagged row.
const UNTAGGED = Object.assign({}, FIXTURE, {
  projects: [{ id: "plain", name: "Plain", colour: 0, tags: [], notes: "" }],
  assignments: []
});
const UNTAGGED_PLAN = path.join(DIR, "untagged.pact.json");
fs.writeFileSync(UNTAGGED_PLAN, JSON.stringify(UNTAGGED, null, 2) + "\n");

// The plan a new PACT starts from: no records at all.
const EMPTY = { range: { start: "2026-01-01", end: "2026-01-31" }, people: [], projects: [], assignments: [] };
const EMPTY_PLAN = path.join(DIR, "empty.pact.json");
fs.writeFileSync(EMPTY_PLAN, JSON.stringify(EMPTY, null, 2) + "\n");

function env(extra) {
  const out = Object.assign({}, process.env);
  delete out.PACT_DATA;
  return Object.assign(out, extra || {});
}

function cli(args, options) {
  const opts = options || {};
  const result = spawnSync(process.execPath, [BIN].concat(args), {
    cwd: opts.cwd || DIR,
    env: env(opts.env),
    encoding: "utf8"
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function okJSON(args, options) {
  const result = cli(args.concat(["--json"]), options);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (label || "") + ": " + actual + " != " + expected);
}

// The text renderer's own rounding, so the two renderings can be compared on
// the values the text shows.
function figure(value) {
  if (value === null || value === undefined) return "-";
  const rounded = Math.round(Number(value) * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

function percent(fraction) {
  if (fraction === null || fraction === undefined) return "-";
  return Math.round(Number(fraction) * 100) + "%";
}

/* --- figures are the report's -------------------------------------------- */

function reportModel() {
  const ranged = Object.assign({}, FIXTURE, {
    range: { start: "2026-11-01", end: "2026-11-30" }
  });
  return reportContent(
    { people: ranged.people, projects: ranged.projects, assignments: ranged.assignments },
    ranged,
    { zoom: "month", sprints: [], tagSlots: {} }
  );
}

test("people, projects, tags and capacity are the report's figures for the period", () => {
  const model = reportModel();
  const people = okJSON(["people", "--plan", PLAN, "--period", "2026-11"]);
  const projects = okJSON(["projects", "--plan", PLAN, "--period", "2026-11"]);
  const tags = okJSON(["tags", "--plan", PLAN, "--period", "2026-11"]);
  const capacity = okJSON(["capacity", "--plan", PLAN, "--period", "2026-11"]);

  near(people.totals.capacity, model.offeredTotal, "capacity");
  near(people.totals.allocated, model.planTotal, "allocated");
  near(people.totals.remaining, model.offeredTotal - model.planTotal, "remaining");
  near(people.totals.ofCapacity, model.allocationByPerson.total.total, "of capacity");

  model.byPerson.rows.forEach((row) => {
    const found = people.people.find((person) => person.id === row.id);
    assert.ok(found, row.id);
    near(found.capacity, row.offered, row.id + " capacity");
    near(found.allocated, row.total, row.id + " allocated");
    near(found.remaining, row.offered - row.total, row.id + " remaining");
    near(found.ofOffer === null ? 0 : found.ofOffer, row.offered > 0 ? row.pct : 0, row.id + " of offer");
    assert.equal(found.overAllocated, row.total > row.offered + 1e-9, row.id + " over");
  });

  model.byProject.rows.forEach((row) => {
    const found = projects.projects.find((project) => project.id === row.id);
    assert.ok(found, row.id);
    near(found.allocated, row.total, row.id + " allocated");
    near(found.ofPlan, row.share, row.id + " of plan");
    const allocation = model.allocationByProject.rows.find((entry) => entry.id === row.id);
    near(found.ofCapacity, allocation.total, row.id + " of capacity");
  });

  model.byTag.rows.forEach((row) => {
    const found = tags.tags.find((tag) => tag.tag === row.tag);
    assert.ok(found, row.tag);
    near(found.allocated, row.total, row.label + " allocated");
    near(found.ofPlan, row.share, row.label + " of plan");
    assert.equal(found.projects, row.projects, row.label + " projects");
  });

  near(capacity.capacity, model.offeredTotal, "capacity command capacity");
  near(capacity.allocated, model.planTotal, "capacity command allocated");
  near(capacity.remaining, model.offeredTotal - model.planTotal, "capacity command remaining");
  near(capacity.ofCapacity, model.allocationByPerson.total.total, "capacity command of capacity");
  assert.equal(capacity.buckets.length, model.buckets.length);
  capacity.buckets.forEach((bucket, i) => {
    near(bucket.capacity, model.chart[i].capacity, "bucket " + i + " capacity");
    near(bucket.allocated, model.chart[i].alloc, "bucket " + i + " allocated");
    near(bucket.remaining, model.chart[i].capacity - model.chart[i].alloc, "bucket " + i + " remaining");
    near(bucket.ofCapacity === null ? 0 : bucket.ofCapacity,
      model.allocationByPerson.total.cells[i] === null ? 0 : model.allocationByPerson.total.cells[i],
      "bucket " + i + " of capacity");
  });
});

test("the fixture's hand-checkable figures are the ones printed", () => {
  const people = okJSON(["people", "--plan", PLAN, "--period", "2026-11"]);
  const anna = people.people.find((person) => person.id === "anna");
  const ben = people.people.find((person) => person.id === "ben");
  // November 2026 has 21 weekdays. Anna takes five off, so she offers 16
  // FTE-days, is Allocated 16 on Solar and 3.2 on Borealis, and is over.
  near(anna.capacity, 16);
  near(anna.allocated, 19.2);
  near(anna.remaining, -3.2);
  near(anna.ofOffer, 1.2);
  assert.equal(anna.overAllocated, true);
  // Ben is at 50% Availability and takes the same five days off: 8 offered,
  // 8 allocated.
  near(ben.capacity, 8);
  near(ben.allocated, 8);
  near(ben.ofOffer, 1);
  assert.equal(ben.overAllocated, false);
  near(people.totals.capacity, 24);
  near(people.totals.allocated, 27.2);

  const tags = okJSON(["tags", "--plan", PLAN, "--period", "2026-11"]);
  assert.deepEqual(tags.tags.map((tag) => tag.tag).sort(),
    ["Testing", "api:Solar", "api:Stellar"]);
  const solar = tags.tags.find((tag) => tag.tag === "api:Solar");
  // Solar's 24 FTE-days split over its two tags.
  near(solar.allocated, 12);

  const key = okJSON(["tag", "api", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(key.match, "key");
  near(key.allocated, 15.2);
  near(key.ofPlan, 15.2 / 27.2);

  const sprint = okJSON(["people", "--plan", PLAN, "--period", "Sprint 2"]);
  assert.deepEqual(sprint.period, {
    kind: "sprint", label: "Sprint 2", start: "2026-11-16", end: "2026-11-29", outsidePlan: false
  });
  near(sprint.totals.capacity, 12.5);
  near(sprint.totals.allocated, 14.5);
});

test("an absence Project is listed with no figures, and its tags are not rows", () => {
  const projects = okJSON(["projects", "--plan", PLAN, "--period", "2026-11"]);
  const leave = projects.projects.find((project) => project.id === "leave");
  assert.equal(leave.absence, true);
  assert.equal(leave.allocated, null);
  assert.equal(leave.ofPlan, null);
  assert.equal(leave.ofCapacity, null);
  const tags = okJSON(["tags", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(tags.tags.some((tag) => tag.tag === "Absence"), false);

  const anna = okJSON(["person", "anna", "--plan", PLAN, "--period", "2026-11"]);
  const absence = anna.assignments.find((assignment) => assignment.id === "a-leave-anna");
  assert.equal(absence.absence, true);
});

/* --- the seam: the CLI is the module plus a rendering -------------------- */

test("importing lib/query.mjs is silent and side-effect free", () => {
  const url = pathToFileURL(QUERY).href;
  const code = "process.stdout.write('before');" +
    " const m = await import(" + JSON.stringify(url) + ");" +
    " process.stdout.write(Object.keys(m).sort().join(','));";
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    cwd: DIR, env: env(), encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "before" + [
    "QueryError", "archive", "assignmentAdd", "assignmentMove", "capacity", "holidays", "milestones",
    "people", "person", "personAdd", "planSummary", "project", "projectAdd", "projects", "resolvePeriod",
    "restore", "tag", "tags"
  ].join(","));
});

test("every query result survives JSON round-tripping", () => {
  const period = query.resolvePeriod(FIXTURE, "2026-11");
  const results = [
    query.planSummary(FIXTURE, period),
    query.people(FIXTURE, period),
    query.person(FIXTURE, period, "Anna Meier"),
    query.projects(FIXTURE, period),
    query.project(FIXTURE, period, "Solar"),
    query.tags(FIXTURE, period),
    query.tag(FIXTURE, period, "api"),
    query.tag(FIXTURE, period, "api:Solar"),
    query.capacity(FIXTURE, period),
    query.holidays(FIXTURE),
    query.milestones(FIXTURE),
    query.assignmentMove(FIXTURE, { project: "Solar", person: "Anna Meier", to: "2026-11-20", period: period }),
    query.assignmentAdd(FIXTURE, { project: "Borealis", person: "Ben Falk", from: "2026-11-02", to: "2026-11-06", share: 50, period: period }),
    query.personAdd(FIXTURE, { name: "Clara Nowak", location: "Berlin", availability: 80, tags: ["skill:frontend"], period: period }),
    query.projectAdd(FIXTURE, { name: "Northwind", tags: ["api:Northwind"] }),
    query.archive(FIXTURE, { kind: "person", subject: "Anna Meier", period: period }),
    query.archive(FIXTURE, { kind: "project", subject: "Solar", period: period }),
    query.archive(FIXTURE, { kind: "assignment", project: "Solar", person: "Anna Meier", period: period }),
    query.restore(ARCHIVED_PERSON, { kind: "person", subject: "Anna Meier", period: period }),
    query.restore(ARCHIVED_PROJECT, { kind: "project", subject: "Solar", period: period }),
    query.restore(ARCHIVED_ASSIGNMENT,
      { kind: "assignment", project: "Borealis", person: "Anna Meier", period: period })
  ];
  results.forEach((result) => {
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
  });
});

test("the CLI's payload is exactly the query module's result, with the envelope added", () => {
  const period = query.resolvePeriod(FIXTURE, "2026-11");
  const cases = [
    { command: "plan", args: [], direct: query.planSummary(FIXTURE, period) },
    { command: "people", args: [], direct: query.people(FIXTURE, period) },
    { command: "person", args: ["Anna Meier"], direct: query.person(FIXTURE, period, "Anna Meier") },
    { command: "projects", args: [], direct: query.projects(FIXTURE, period) },
    { command: "project", args: ["Solar"], direct: query.project(FIXTURE, period, "Solar") },
    { command: "tags", args: [], direct: query.tags(FIXTURE, period) },
    { command: "tag", args: ["api"], direct: query.tag(FIXTURE, period, "api") },
    { command: "capacity", args: [], direct: query.capacity(FIXTURE, period) },
    { command: "holidays", args: [], direct: query.holidays(FIXTURE), noPeriod: true },
    { command: "milestones", args: [], direct: query.milestones(FIXTURE), noPeriod: true }
  ];
  cases.forEach((entry) => {
    const args = [entry.command].concat(entry.args, ["--plan", PLAN]);
    if (!entry.noPeriod) args.push("--period", "2026-11");
    const data = okJSON(args);
    const envelope = {
      command: data.command,
      planFile: data.planFile,
      planSource: data.planSource
    };
    assert.equal(envelope.command, entry.command);
    assert.equal(envelope.planFile, PLAN);
    assert.equal(envelope.planSource, "--plan");
    const payload = Object.assign({}, data);
    delete payload.command;
    delete payload.planFile;
    delete payload.planSource;
    assert.deepEqual(payload, entry.direct, entry.command);
  });
});

/* --- the two renderings agree ------------------------------------------- */

test("text and --json show the same period, rows and figures", () => {
  const data = okJSON(["people", "--plan", PLAN, "--period", "2026-11"]);
  const text = cli(["people", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(text.status, 0, text.stderr);
  assert.ok(text.stdout.includes(data.planFile));
  assert.ok(text.stdout.includes(data.period.start + " to " + data.period.end));
  data.people.forEach((person) => {
    assert.ok(text.stdout.includes(person.name), person.name);
    assert.ok(text.stdout.includes(figure(person.allocated)), person.name + " allocated");
    assert.ok(text.stdout.includes(figure(person.capacity)), person.name + " capacity");
    assert.ok(text.stdout.includes(percent(person.ofOffer)), person.name + " of offer");
  });
  assert.ok(text.stdout.includes(figure(data.totals.allocated)));

  const capacity = okJSON(["capacity", "--plan", PLAN, "--period", "2026-11"]);
  const capacityText = cli(["capacity", "--plan", PLAN, "--period", "2026-11"]);
  assert.ok(capacityText.stdout.includes(figure(capacity.capacity) + " FTE-days"));
  assert.ok(capacityText.stdout.includes(figure(capacity.allocated) + " FTE-days"));
  assert.ok(capacityText.stdout.includes(figure(capacity.remaining) + " FTE-days"));
  assert.ok(capacityText.stdout.includes(percent(capacity.ofCapacity)));

  const person = okJSON(["person", "anna", "--plan", PLAN, "--period", "2026-11"]);
  const personText = cli(["person", "anna", "--plan", PLAN, "--period", "2026-11"]);
  assert.ok(personText.stdout.includes(percent(person.person.ofOffer)));
  assert.ok(personText.stdout.includes("over-allocated"));
});

/* --- period resolution --------------------------------------------------- */

test("a period resolves to the range the app's period control would set", () => {
  const month = okJSON(["plan", "--plan", PLAN, "--period", "2026-11"]);
  assert.deepEqual(month.period, {
    kind: "month", label: "Nov 2026", start: "2026-11-01", end: "2026-11-30", outsidePlan: false
  });
  assert.deepEqual(month.period, query.resolvePeriod(FIXTURE, "2026-11"));

  const sprint = okJSON(["plan", "--plan", PLAN, "--period", "Sprint 2"]);
  assert.deepEqual(sprint.period, {
    kind: "sprint", label: "Sprint 2", start: "2026-11-16", end: "2026-11-29", outsidePlan: false
  });

  const ordinal = okJSON(["plan", "--plan", PLAN, "--period", "sprint 1"]);
  assert.equal(ordinal.period.start, "2026-11-02");
  assert.equal(ordinal.period.end, "2026-11-15");
  assert.equal(ordinal.period.label, "Sprint 1");

  const range = okJSON(["plan", "--plan", PLAN, "--period", "2026-11-16..2026-11-29"]);
  assert.equal(range.period.kind, "range");
  assert.equal(range.period.start, "2026-11-16");
  assert.equal(range.period.end, "2026-11-29");

  const equalsForm = okJSON(["plan", "--plan", PLAN, "--period=2026-11"]);
  assert.deepEqual(equalsForm.period, month.period);
});

test("with no period the plan's own period is used, and an outside period says so", () => {
  const defaults = okJSON(["plan", "--plan", PLAN]);
  assert.equal(defaults.period.kind, "plan");
  assert.equal(defaults.period.start, FIXTURE.range.start);
  assert.equal(defaults.period.end, FIXTURE.range.end);

  const outside = okJSON(["plan", "--plan", PLAN, "--period", "2027-01"]);
  assert.equal(outside.period.outsidePlan, true);
  const text = cli(["plan", "--plan", PLAN, "--period", "2027-01"]);
  assert.ok(text.stdout.includes("the period lies wholly outside the plan period"));
});

test("an unusable period exits non-zero and names the accepted forms", () => {
  const badMonth = cli(["plan", "--plan", PLAN, "--period", "2026-13"]);
  assert.notEqual(badMonth.status, 0);
  assert.match(badMonth.stderr, /unusable month/);
  assert.match(badMonth.stderr, /2026-11/);

  const badRange = cli(["plan", "--plan", PLAN, "--period", "2026-11-30..2026-11-01"]);
  assert.notEqual(badRange.status, 0);
  assert.match(badRange.stderr, /unusable range/);
  assert.match(badRange.stderr, /2026-11-01\.\.2026-11-30/);

  const badSprint = cli(["plan", "--plan", PLAN, "--period", "Sprint 9"]);
  assert.notEqual(badSprint.status, 0);
  assert.match(badSprint.stderr, /no sprint named "Sprint 9"/);
  assert.match(badSprint.stderr, /nearest: "Sprint 1"/);

  const nonsense = cli(["plan", "--plan", PLAN, "--period", "not-a-period"]);
  assert.notEqual(nonsense.status, 0);
  assert.match(nonsense.stderr, /no sprint named "not-a-period"/);

  // A range written with months, or a bare date, is a range mistake, not a
  // missing sprint.
  const monthRange = cli(["plan", "--plan", PLAN, "--period", "2026-11..2027-01"]);
  assert.notEqual(monthRange.status, 0);
  assert.match(monthRange.stderr, /unusable period "2026-11\.\.2027-01"/);
  assert.match(monthRange.stderr, /2026-11-01\.\.2026-11-30/);

  const bareDate = cli(["plan", "--plan", PLAN, "--period", "2026-11-01"]);
  assert.notEqual(bareDate.status, 0);
  assert.match(bareDate.stderr, /unusable period "2026-11-01"/);
});

/* --- honest errors ------------------------------------------------------- */

test("an unknown subject exits non-zero and names the nearest matches", () => {
  const person = cli(["person", "Ann Meier", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(person.status, 1);
  assert.match(person.stderr, /unknown person "Ann Meier"/);
  assert.match(person.stderr, /Anna Meier/);

  const project = cli(["project", "Solr", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(project.status, 1);
  assert.match(project.stderr, /unknown project "Solr"/);
  assert.match(project.stderr, /Solar/);

  const tag = cli(["tag", "api:Sola", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(tag.status, 1);
  assert.match(tag.stderr, /unknown tag "api:Sola"/);
  assert.match(tag.stderr, /api:Solar/);
});

test("an ambiguous name is an error rather than a silent pick", () => {
  const result = cli(["person", "Sam", "--plan", DUPLICATE_PLAN, "--period", "2026-11"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /more than one person matches "Sam"/);
});

test("the Untagged row is a tag by its label, and a tag key groups its tags", () => {
  const rows = okJSON(["tags", "--plan", UNTAGGED_PLAN]);
  assert.equal(rows.tags.length, 1);
  assert.equal(rows.tags[0].tag, "");
  assert.equal(rows.tags[0].label, "Untagged");
  const untagged = okJSON(["tag", "Untagged", "--plan", UNTAGGED_PLAN]);
  assert.equal(untagged.match, "tag");
  assert.equal(untagged.tags[0].tag, "");
});

test("an empty plan answers zero rather than failing", () => {
  const plan = okJSON(["plan", "--plan", EMPTY_PLAN]);
  assert.deepEqual(plan.counts, { people: 0, projects: 0, assignments: 0, milestones: 0 });
  near(plan.totals.capacity, 0);
  near(plan.totals.allocated, 0);
  assert.equal(plan.totals.ofCapacity, null);
  assert.deepEqual(okJSON(["people", "--plan", EMPTY_PLAN]).people, []);
  assert.deepEqual(okJSON(["tags", "--plan", EMPTY_PLAN]).tags, []);
});

test("a --json error is JSON on stderr, with a code and the suggestions", () => {
  const result = cli(["person", "Ann Meier", "--plan", PLAN, "--json"]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  const body = JSON.parse(result.stderr);
  assert.equal(body.code, "unknown-subject");
  assert.match(body.error, /unknown person "Ann Meier"/);
  assert.deepEqual(body.suggestions, ["Anna Meier"]);
});

test("a bad command or option is a usage error", () => {
  const command = cli(["nope"]);
  assert.equal(command.status, 2);
  assert.match(command.stderr, /unknown command "nope"/);
  assert.match(command.stderr, /plan, people, person/);

  const option = cli(["plan", "--nope"]);
  assert.equal(option.status, 2);
  assert.match(option.stderr, /unknown option "--nope"/);

  const subject = cli(["plan", "Anna"]);
  assert.equal(subject.status, 2);
  assert.match(subject.stderr, /plan takes no subject/);

  const missing = cli(["person", "--plan", PLAN]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /person needs a name/);

  const period = cli(["holidays", "--period", "2026-11"]);
  assert.equal(period.status, 2);
  assert.match(period.stderr, /does not take a period/);
});

/* --- finding the plan ---------------------------------------------------- */

test("the plan file is --plan, then PACT_DATA, then the repository default", () => {
  const other = path.join(DIR, "other.pact.json");
  const otherPlan = Object.assign({}, FIXTURE, { range: { start: "2026-01-01", end: "2026-01-31" } });
  fs.writeFileSync(other, JSON.stringify(otherPlan, null, 2) + "\n");

  const chosen = okJSON(["plan", "--plan", PLAN], { env: { PACT_DATA: other } });
  assert.equal(chosen.planSource, "--plan");
  assert.equal(chosen.planFile, PLAN);
  assert.equal(chosen.period.start, "2026-11-01");

  const fromEnv = okJSON(["plan"], { env: { PACT_DATA: other } });
  assert.equal(fromEnv.planSource, "PACT_DATA");
  assert.equal(fromEnv.planFile, other);
  assert.equal(fromEnv.period.start, "2026-01-01");

  const relative = okJSON(["plan", "--plan", "fixture.pact.json"], { cwd: DIR });
  assert.equal(relative.planFile, PLAN);

  // A fresh checkout has no plan until the server seeds one; either way the
  // tool never writes and says plainly where it looked.
  const defaults = cli(["plan", "--json"], { cwd: DIR });
  if (fs.existsSync(DEFAULT_PLAN)) {
    assert.equal(defaults.status, 0, defaults.stderr);
    const body = JSON.parse(defaults.stdout);
    assert.equal(body.planSource, "default");
    assert.equal(body.planFile, DEFAULT_PLAN);
  } else {
    assert.equal(defaults.status, 1);
    assert.match(defaults.stderr, /data\/default\.pact\.json/);
    assert.match(defaults.stderr, /node server\.mjs/);
  }
});

test("answers from the plan file with no server running", () => {
  // Every test here spawns the tool with no server: this one states the fact
  // and checks the figure it is meant to answer.
  const result = cli(["people", "--plan", PLAN, "--period", "2026-11"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Anna Meier/);
  assert.match(result.stdout, /over-allocated/);
});

test("the tool only reads the plan file", () => {
  const before = fs.readFileSync(PLAN);
  const mtime = fs.statSync(PLAN).mtimeMs;
  ["plan", "people", "person anna", "projects", "project solar", "tags",
    "tag api", "capacity", "holidays", "milestones"].forEach((line) => {
    const args = line.split(" ");
    const full = args.concat(["--plan", PLAN]);
    if (line !== "holidays" && line !== "milestones") full.push("--period", "2026-11");
    const result = cli(full);
    assert.equal(result.status, 0, line + ": " + result.stderr);
  });
  assert.deepEqual(fs.readFileSync(PLAN), before);
  assert.equal(fs.statSync(PLAN).mtimeMs, mtime);
});

/* --- holidays, milestones and help -------------------------------------- */

test("holidays and milestones are the plan's stored facts", () => {
  const holidays = okJSON(["holidays", "--plan", PLAN]);
  assert.deepEqual(holidays.holidays, [
    { location: "Lisbon", dates: [{ date: "2026-11-30", kind: "full" }] }
  ]);
  const holidaysText = cli(["holidays", "--plan", PLAN]);
  assert.match(holidaysText.stdout, /Lisbon/);
  assert.match(holidaysText.stdout, /2026-11-30/);

  const milestones = okJSON(["milestones", "--plan", PLAN]);
  assert.equal(milestones.milestones.length, 2);
  const launch = milestones.milestones.find((milestone) => milestone.id === "m-launch");
  assert.deepEqual(launch.projects, [{ id: "solar", name: "Solar" }]);
  const review = milestones.milestones.find((milestone) => milestone.id === "m-review");
  assert.deepEqual(review.projects, []);
  const milestonesText = cli(["milestones", "--plan", PLAN]);
  assert.match(milestonesText.stdout, /2026-11-20/);
  assert.match(milestonesText.stdout, /Launch/);
});

test("--help lists the commands and one worked example for each", () => {
  const help = cli(["--help"]);
  assert.equal(help.status, 0);
  assert.equal(help.stderr, "");
  ["plan", "people", "person", "projects", "project", "tags", "tag",
    "capacity", "holidays", "milestones"].forEach((command) => {
    assert.ok(help.stdout.includes(command), command);
  });
  assert.match(help.stdout, /node bin\/pact\.mjs plan --period 2026-11/);
  assert.match(help.stdout, /--json/);
  assert.match(help.stdout, /"units"/);

  // The same help before or after a command, and as `pact help`.
  const noArgs = cli([]);
  assert.equal(noArgs.status, 0);
  assert.equal(noArgs.stdout, help.stdout);
  const after = cli(["people", "--help"]);
  assert.equal(after.stdout, help.stdout);
  const word = cli(["help"]);
  assert.equal(word.stdout, help.stdout);
});
