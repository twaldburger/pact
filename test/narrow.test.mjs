/*
 * PACT's narrowed reads: the five options that ask `people` and `projects` for
 * less than the whole plan, and the line that keeps a short list from being
 * read as the plan.
 *
 * The fixture is hand-checkable: a November of 21 working days, five People
 * with known Locations, tag families and Allocations, one Person over their
 * Capacity at each of two Locations, one at exactly theirs and two under, and
 * two People tied at 8.4 FTE-days for the cut to fall inside. The figures here
 * are the report's own, and every count is taken against them rather than
 * written from memory - so a change to the report turns this file red instead of
 * quietly narrowing to a different list.
 *
 * What this cannot see is the terminal: it reads the renderer's text, so a line
 * that is right in the data and unreadable on screen passes.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scratch } from "../test-support/scratch.mjs";
import * as query from "../lib/query.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const BIN = path.join(REPO, "bin", "pact.mjs");

const FIXTURE = {
  range: { start: "2026-11-01", end: "2026-11-30" },
  step: 10,
  cadence: { start: "2026-11-02", length: 14, namePrefix: "Sprint ", nameNumber: 1 },
  people: [
    // November 2026 has 21 working days, so a 100% Availability offers 21
    // FTE-days and a 50% one offers 10.5. Allocations are absolute, so Cara's
    // 40% Assignment is 8.4 FTE-days against the 10.5 she offers.
    { id: "anna", name: "Anna Meier", location: "Berlin", availability: 100, tags: ["team:atlas", "lead"], note: "leads Atlas" },
    { id: "ben", name: "Ben Falk", location: "Berlin", availability: 100, tags: ["team:atlas", "skill:frontend"], note: "" },
    { id: "cara", name: "Cara Nowak", location: "Lisbon", availability: 50, tags: ["team:atlas"], note: "part-time" },
    { id: "dana", name: "Dana Vogel", location: "Berlin", availability: 100, tags: ["team:borealis", "Design"], note: "" },
    { id: "eva", name: "Eva Lund", location: "Lisbon", availability: 100, tags: ["skill:backend"], note: "" }
  ],
  projects: [
    { id: "solar", name: "Solar", colour: 0, tags: ["api:Solar", "Testing"], notes: "phase one" },
    { id: "borealis", name: "Borealis", colour: 3, tags: ["api:Stellar", "Testing"], notes: "" },
    { id: "leave", name: "Annual Leave", colour: 4, absence: true, tags: ["Absence"], notes: "" }
  ],
  assignments: [
    { id: "a-solar-anna", projectId: "solar", personId: "anna", start: "2026-11-01", end: "2026-11-30", share: 100, tags: [], note: "" },
    { id: "a-solar-ben", projectId: "solar", personId: "ben", start: "2026-11-01", end: "2026-11-30", share: 80, tags: [], note: "" },
    { id: "a-borealis-ben", projectId: "borealis", personId: "ben", start: "2026-11-01", end: "2026-11-30", share: 60, tags: [], note: "" },
    { id: "a-solar-cara", projectId: "solar", personId: "cara", start: "2026-11-01", end: "2026-11-30", share: 40, tags: [], note: "" },
    { id: "a-borealis-dana", projectId: "borealis", personId: "dana", start: "2026-11-01", end: "2026-11-30", share: 40, tags: [], note: "" },
    { id: "a-solar-eva", projectId: "solar", personId: "eva", start: "2026-11-01", end: "2026-11-30", share: 100, tags: [], note: "" },
    { id: "a-borealis-eva", projectId: "borealis", personId: "eva", start: "2026-11-01", end: "2026-11-30", share: 50, tags: [], note: "" }
  ],
  holidays: [],
  milestones: []
};

const scratchDir = scratch("pact-narrow");
const DIR = scratchDir();
const PLAN = path.join(DIR, "fixture.pact.json");
fs.writeFileSync(PLAN, JSON.stringify(FIXTURE, null, 2) + "\n");

function env() {
  const out = Object.assign({}, process.env);
  delete out.PACT_DATA;
  return out;
}

function cli(args) {
  const result = spawnSync(process.execPath, [BIN].concat(args), {
    cwd: DIR, env: env(), encoding: "utf8"
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// A read of the fixture for November, in either rendering.
function read(command, options) {
  const args = [command, "--plan", PLAN, "--period", "2026-11"].concat(options || []);
  const text = cli(args);
  return { status: text.status, stdout: text.stdout, stderr: text.stderr };
}

function readJSON(command, options) {
  const result = read(command, (options || []).concat(["--json"]));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

function names(rows) {
  return rows.map(function (row) { return row.name || row.tag; });
}

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-9, (label || "") + ": " + actual + " != " + expected);
}

function nearAll(actual, expected, label) {
  assert.equal(actual.length, expected.length, label);
  expected.forEach(function (value, i) { near(actual[i], value, (label || "") + "[" + i + "]"); });
}

// "Matched 2 of 5 People" as the header states it, split back into its counts.
function matched(text) {
  const found = text.match(/^Matched +(\d+) of (\d+) (People|Projects)$/m);
  assert.ok(found, "no Matched line in:\n" + text);
  return { matched: Number(found[1]), total: Number(found[2]), unit: found[3] };
}

function filterLine(text) {
  const found = text.match(/^Filter +(.*)$/m);
  assert.ok(found, "no Filter line in:\n" + text);
  return found[1];
}

/* --- one flag at a time -------------------------------------------------- */

test("--location narrows to the People at one Location, case-insensitively", () => {
  const berlin = read("people", ["--location", "Berlin"]);
  assert.equal(berlin.status, 0, berlin.stderr);
  assert.match(berlin.stdout, /^Anna Meier/m);
  assert.match(berlin.stdout, /^Ben Falk/m);
  assert.match(berlin.stdout, /^Dana Vogel/m);
  assert.doesNotMatch(berlin.stdout, /Cara Nowak/);
  assert.doesNotMatch(berlin.stdout, /Eva Lund/);
  assert.equal(filterLine(berlin.stdout), "location: Berlin");
  assert.deepEqual(matched(berlin.stdout), { matched: 3, total: 5, unit: "People" });

  // The Location is a Person's own field, so its case is not what it is matched on.
  const lower = read("people", ["--location", "berlin"]);
  assert.equal(lower.status, 0, lower.stderr);
  assert.deepEqual(matched(lower.stdout), matched(berlin.stdout));
  const data = readJSON("people", ["--location", "bErLiN"]);
  assert.deepEqual(names(data.people), ["Anna Meier", "Ben Falk", "Dana Vogel"]);
});

test("--over and --under read Allocated against Capacity, and agree with the figures", () => {
  const all = readJSON("people");
  const over = readJSON("people", ["--over"]);
  const under = readJSON("people", ["--under"]);

  // The flags say exactly what the unfiltered rows' own figures say.
  assert.deepEqual(names(over.people),
    all.people.filter(function (p) { return p.allocated > p.capacity + 1e-9; }).map(function (p) { return p.name; }));
  assert.deepEqual(names(under.people),
    all.people.filter(function (p) { return p.allocated < p.capacity - 1e-9; }).map(function (p) { return p.name; }));
  assert.deepEqual(names(over.people), ["Ben Falk", "Eva Lund"]);
  assert.deepEqual(names(under.people), ["Cara Nowak", "Dana Vogel"]);

  // A Person at exactly their Capacity is in neither: Anna offers 21 and is
  // Allocated 21.
  assert.equal(names(over.people).concat(names(under.people)).includes("Anna Meier"), false);

  assert.equal(over.filter.text, "over capacity");
  assert.equal(under.filter.text, "under capacity");
  assert.equal(over.filter.matched, 2);
  assert.equal(over.filter.total, 5);
});

test("--tag names a tag exactly, and a tag key names its whole family", () => {
  const family = readJSON("people", ["--tag", "team"]);
  assert.deepEqual(names(family.people), ["Anna Meier", "Ben Falk", "Cara Nowak", "Dana Vogel"]);

  const value = readJSON("people", ["--tag", "team:atlas"]);
  assert.deepEqual(names(value.people), ["Anna Meier", "Ben Falk", "Cara Nowak"]);

  // Case is ignored on both sides, as it is where the reads resolve a tag.
  assert.deepEqual(names(readJSON("people", ["--tag", "TEAM"]).people), names(family.people));
  assert.deepEqual(names(readJSON("people", ["--tag", "Team:Atlas"]).people), names(value.people));

  // An untyped tag is named by its own text and belongs to no family: `Design`
  // is Dana's and matches only her.
  assert.deepEqual(names(readJSON("people", ["--tag", "design"]).people), ["Dana Vogel"]);
  // A key nobody carries is an empty result, not an error.
  assert.deepEqual(readJSON("people", ["--tag", "nobody"]).people, []);
});

test("--tag repeated requires every one of them", () => {
  const both = readJSON("people", ["--tag", "team:atlas", "--tag", "skill"]);
  assert.deepEqual(names(both.people), ["Ben Falk"]);
  assert.equal(both.filter.text, "tags: team:atlas and skill");
  assert.equal(both.filter.matched, 1);
  // One term that every Person carries keeps every Person.
  assert.equal(readJSON("people", ["--tag", "team", "--tag", "team:atlas"]).filter.matched, 3);
});

test("a --tag term is resolved by the rule tag <key> already resolves with", () => {
  const key = query.tag(FIXTURE, "2026-11", "api");
  assert.equal(key.match, "key");
  const projects = readJSON("projects", ["--tag", "api"]);
  const carried = new Set();
  projects.projects.forEach(function (project) {
    project.tags.forEach(function (tag) { carried.add(tag); });
  });
  // Every tag the read resolves under the key is on a Project the filter kept.
  assert.deepEqual(key.tags.map(function (row) { return row.tag; }).sort(), ["api:Solar", "api:Stellar"]);
  key.tags.forEach(function (row) { assert.ok(carried.has(row.tag), row.tag); });
  assert.deepEqual(names(projects.projects), ["Solar", "Borealis"]);
});

/* --- where each flag applies --------------------------------------------- */

test("projects take --tag and --top, and their figures are the report's", () => {
  const all = readJSON("projects");
  const testing = readJSON("projects", ["--tag", "Testing"]);
  assert.deepEqual(names(testing.projects), ["Solar", "Borealis"]);
  assert.equal(testing.filter.text, "tag: Testing");
  assert.equal(testing.filter.total, all.projects.length);

  // A term naming one tag matches that tag alone, so the family is not swept in.
  const one = readJSON("projects", ["--tag", "api:Solar"]);
  assert.deepEqual(names(one.projects), ["Solar"]);

  // An Absence Project is a Project in the list, so a Project tag finds it.
  const absence = readJSON("projects", ["--tag", "Absence"]);
  assert.deepEqual(names(absence.projects), ["Annual Leave"]);
  assert.equal(absence.projects[0].allocated, null);
});

test("a flag a command does not take is refused, never silently ignored", () => {
  const refusals = [
    { args: ["person", "anna", "--location", "Berlin"], says: /person anna does not take --location/, why: /already one Person/ },
    { args: ["person", "anna", "--over"], says: /person anna does not take --over/, why: /already one Person/ },
    { args: ["project", "solar", "--tag", "api"], says: /project solar does not take --tag/, why: /already one Project/ },
    { args: ["project", "solar", "--top", "2"], says: /project solar does not take --top/, why: /already one Project/ },
    { args: ["projects", "--over"], says: /projects does not take --over/, why: /only the people command/ },
    { args: ["projects", "--location", "Berlin"], says: /projects does not take --location/, why: /only the people command/ },
    { args: ["capacity", "--location", "Berlin"], says: /capacity does not take --location/ },
    { args: ["tags", "--tag", "api"], says: /tags does not take --tag/ },
    { args: ["plan", "--over"], says: /plan does not take --over/ },
    { args: ["person", "add", "Clara Nowak", "--over"], says: /person add does not take --over/ },
    { args: ["assignment", "move", "Solar", "--person", "anna", "--share", "20", "--top", "2"],
      says: /assignment move does not take --top/ }
  ];
  refusals.forEach(function (entry) {
    const refused = cli(entry.args.concat(["--plan", PLAN, "--period", "2026-11"]));
    assert.equal(refused.status, 2, entry.args.join(" "));
    assert.equal(refused.stdout, "", entry.args.join(" "));
    assert.match(refused.stderr, entry.says, entry.args.join(" "));
    if (entry.why) assert.match(refused.stderr, entry.why, entry.args.join(" "));
  });
});

test("the option that cannot be given twice, or to nothing, is refused", () => {
  const both = read("people", ["--over", "--under"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--over and --under contradict each other/);

  const zero = read("people", ["--top", "0"]);
  assert.equal(zero.status, 2);
  assert.match(zero.stderr, /--top needs a whole number of 1 or more/);

  const word = read("people", ["--top", "two"]);
  assert.equal(word.status, 2);
  assert.match(word.stderr, /--top needs a whole number/);
});

/* --- ordering ------------------------------------------------------------ */

test("--top keeps the largest by the printed FTE-days and states the order", () => {
  const all = readJSON("people");
  const top = readJSON("people", ["--top", "2"]);
  // The order is the figure the answer prints, highest first - measured against
  // the unfiltered rows, so the cut can never disagrees with the column.
  const largest = all.people.slice().sort(function (a, b) { return b.allocated - a.allocated; });
  assert.deepEqual(names(top.people), names(largest).slice(0, 2));
  assert.deepEqual(names(top.people), ["Eva Lund", "Ben Falk"]);
  nearAll(top.people.map(function (p) { return p.allocated; }), [31.5, 29.4], "top people");
  assert.equal(top.filter.matched, 2);
  assert.equal(top.filter.total, 5);
  assert.equal(top.filter.text, "top 2 by FTE-days");
  assert.equal(top.filter.ordering, "FTE-days, highest first");
  assert.equal(top.filter.tie, undefined);

  const text = read("people", ["--top", "2"]);
  assert.equal(text.status, 0, text.stderr);
  assert.equal(filterLine(text.stdout), "top 2 by FTE-days");
  assert.match(text.stdout, /^Order +FTE-days, highest first$/m);
  assert.deepEqual(matched(text.stdout), { matched: 2, total: 5, unit: "People" });
  // The rows come in the order the line promises.
  assert.ok(text.stdout.indexOf("Eva Lund") < text.stdout.indexOf("Ben Falk"));
});

test("--top orders Projects by the same figure and keeps an Absence Project last", () => {
  const all = readJSON("projects");
  const top = readJSON("projects", ["--top", "2"]);
  assert.deepEqual(names(top.projects), ["Solar", "Borealis"]);
  nearAll(top.projects.map(function (p) { return p.allocated; }), [67.2, 31.5], "top projects");
  assert.equal(top.filter.unit, "Projects");
  assert.equal(top.filter.ordering, "FTE-days, highest first");

  // A row with no figure is below every row with one, so a cut of three keeps
  // the Absence Project last rather than first.
  const three = readJSON("projects", ["--top", "3"]);
  assert.deepEqual(names(three.projects), names(all.projects));
  assert.equal(three.projects[2].allocated, null);
});

test("a cut inside a tie says so, and says the plan's own order decided", () => {
  // Cara and Dana are both Allocated 8.4 FTE-days: a cut of four falls inside
  // that tie and keeps them in the plan's order.
  const four = read("people", ["--top", "4"]);
  assert.equal(four.status, 0, four.stderr);
  assert.match(four.stdout, /^Note +1 of 2 People share 8.4 FTE-days at the cut; /m);
  assert.match(four.stdout, /the plan's own order decides which of them are shown/);
  // Cara comes first in the plan, so she is the one of the two that is shown.
  assert.match(four.stdout, /^Cara Nowak/m);
  assert.doesNotMatch(four.stdout, /Dana Vogel/);

  const data = readJSON("people", ["--top", "4"]);
  assert.deepEqual(data.filter.tie, { figure: 8.4, tied: 2, shown: 1, unit: "People" });
  assert.deepEqual(names(data.people), ["Eva Lund", "Ben Falk", "Anna Meier", "Cara Nowak"]);

  // A cut that splits nothing owes no note: five of five keeps the whole tie.
  assert.equal(readJSON("people", ["--top", "5"]).filter.tie, undefined);
  assert.doesNotMatch(read("people", ["--top", "5"]).stdout, /^Note .*tie/m);
});

/* --- an empty result is a result ----------------------------------------- */

test("an empty result names the filter, counts zero, and exits zero", () => {
  const nobody = read("people", ["--location", "Nowhere", "--over"]);
  assert.equal(nobody.status, 0, nobody.stderr);
  assert.equal(nobody.stderr, "");
  assert.equal(filterLine(nobody.stdout), "location: Nowhere, over capacity");
  assert.deepEqual(matched(nobody.stdout), { matched: 0, total: 5, unit: "People" });
  assert.match(nobody.stdout, /^No Person matched: location: Nowhere, over capacity\.$/m);
  // An empty list is said in words, not printed as an empty table.
  assert.doesNotMatch(nobody.stdout, /^Person +Capacity/m);
  assert.doesNotMatch(nobody.stdout, /^Plan total/m);

  const noProject = read("projects", ["--tag", "nobody"]);
  assert.equal(noProject.status, 0, noProject.stderr);
  assert.match(noProject.stdout, /^No Project matched: tag: nobody\.$/m);
  assert.deepEqual(matched(noProject.stdout), { matched: 0, total: 3, unit: "Projects" });

  const data = readJSON("people", ["--location", "Nowhere"]);
  assert.deepEqual(data.people, []);
  assert.equal(data.filter.matched, 0);
  assert.equal(data.filter.total, 5);
});

/* --- the two renderings say the same thing -------------------------------- */

test("the filter and the counts are the same in text and --json", () => {
  const cases = [
    ["people", ["--location", "Berlin", "--over"]],
    ["people", ["--tag", "team", "--top", "3"]],
    ["people", ["--under"]],
    ["projects", ["--tag", "api"]],
    ["projects", ["--top", "1"]]
  ];
  cases.forEach(function (entry) {
    const text = read(entry[0], entry[1]);
    const data = readJSON(entry[0], entry[1]);
    assert.equal(text.status, 0, text.stderr);
    assert.equal(filterLine(text.stdout), data.filter.text);
    assert.deepEqual(matched(text.stdout), {
      matched: data.filter.matched,
      total: data.filter.total,
      unit: data.filter.unit
    });
    const rows = entry[0] === "people" ? data.people : data.projects;
    assert.equal(rows.length, data.filter.matched);
    // Every row is on screen, in the order the answer holds it.
    let last = -1;
    rows.forEach(function (row) {
      const at = text.stdout.indexOf(row.name, last + 1);
      assert.ok(at > last, row.name + " is out of order or missing");
      last = at;
    });
  });

  // The filter carries the terms it was given, not only their words.
  const narrowed = readJSON("people", ["--location", "Berlin", "--tag", "team", "--top", "2"]);
  assert.deepEqual(narrowed.filter, {
    text: "location: Berlin, tag: team, top 2 by FTE-days",
    matched: 2,
    total: 5,
    unit: "People",
    location: "Berlin",
    tags: ["team"],
    top: 2,
    ordering: "FTE-days, highest first"
  });
});

test("the plan's own total stays the plan's, and says so", () => {
  const text = read("people", ["--location", "Berlin"]);
  // 3 of 5 rows are shown, and the total row is still the whole plan's.
  assert.match(text.stdout, /^Plan total +94\.5 +98\.7 +-4\.2 +104%$/m);
  assert.doesNotMatch(text.stdout, /^Total /m);
  const data = readJSON("people", ["--location", "Berlin"]);
  near(data.totals.allocated, 98.7, "plan allocated");
  near(data.totals.capacity, 94.5, "plan capacity");
});

/* --- nothing changed when nothing was asked for --------------------------- */

// The output these two commands printed before the narrows existed, captured
// from the tool as it was and kept here so an unfiltered answer can never drift.
const PEOPLE_TEXT = `Plan file  {PLAN}
Period     Nov 2026 (2026-11-01 to 2026-11-30)

Person      Capacity (FTE-days)  Allocated (FTE-days)  Remaining (FTE-days)  Of offer (%)  State
Anna Meier                 21.0                  21.0                   0.0          100%
Ben Falk                   21.0                  29.4                  -8.4          140%  over-allocated
Cara Nowak                 10.5                   8.4                   2.1           80%
Dana Vogel                 21.0                   8.4                  12.6           40%
Eva Lund                   21.0                  31.5                 -10.5          150%  over-allocated
Total                      94.5                  98.7                  -4.2          104%

Absence Projects are left out of every figure.
`;

const PROJECTS_TEXT = `Plan file  {PLAN}
Period     Nov 2026 (2026-11-01 to 2026-11-30)

Project                 Allocated (FTE-days)  Of plan (%)  Of capacity (%)
Solar                                   67.2          68%              71%
Borealis                                31.5          32%              33%
Annual Leave (absence)                     -            -                -
Total                                   98.7         100%             104%

Absence Projects are left out of every figure.
`;

function withPlan(text) {
  return text.split("{PLAN}").join(PLAN);
}

test("an unfiltered answer is byte-for-byte what it was before there were narrows", () => {
  assert.equal(read("people").stdout, withPlan(PEOPLE_TEXT));
  assert.equal(read("projects").stdout, withPlan(PROJECTS_TEXT));
});

test("an unfiltered answer carries no filter field at all", () => {
  const people = readJSON("people");
  const projects = readJSON("projects");
  assert.deepEqual(Object.keys(people).sort(),
    ["command", "people", "period", "planFile", "planSource", "totals", "units"]);
  assert.deepEqual(Object.keys(projects).sort(),
    ["command", "period", "planFile", "planSource", "projects", "totals", "units"]);
  assert.equal("filter" in people, false);
  assert.equal("filter" in projects, false);
});

test("a request with no term is no request", () => {
  // The seam itself: an empty narrow is the whole list, with no filter added.
  const plain = query.people(FIXTURE, "2026-11");
  assert.deepEqual(query.people(FIXTURE, "2026-11", {}), plain);
  assert.deepEqual(query.people(FIXTURE, "2026-11", { tags: [] }), plain);
  assert.deepEqual(query.projects(FIXTURE, "2026-11", {}), query.projects(FIXTURE, "2026-11"));

  // And a narrowed answer keeps every row's own figures, untouched.
  const narrowed = query.people(FIXTURE, "2026-11", { location: "Berlin" });
  const rows = plain.people.filter(function (p) { return p.location === "Berlin"; });
  assert.deepEqual(narrowed.people, rows);
  assert.deepEqual(narrowed.totals, plain.totals);
});
