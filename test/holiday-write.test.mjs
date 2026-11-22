/*
 * PACT's holiday write: one holiday date added to, or removed from, one
 * Location, through the running app.
 *
 * The app has exactly one holiday write - `setHolidays`, which replaces every
 * Location's dates at once - so the safety of this command is not in a narrow
 * route, it is in the rebuild: the tool reads the plan, changes one date, sends
 * the whole list back, and then asks the app's plan for that exact array. What
 * is asserted here is the rules that make that safe rather than the ones that
 * make it work: the preview is the default and touches nothing, the write adds
 * or removes exactly one date and leaves every other Location's dates byte for
 * byte as they were, the figure the preview states is the figure the plan shows
 * after the write, the app's Undo steps it back, a plan the app is not holding
 * is refused, and nothing answering at the address is a sentence rather than a
 * stack trace. A write is asserted by reading the file on disk and the app's
 * plan back, never by the reply to the request.
 *
 * Every case runs its own app over its own plan in a temporary directory: the
 * repository's plan is never read, and never written.
 *
 * November 2026 has 21 weekdays, and Berlin's holiday on the 11th leaves 20
 * working days: Anna offers 20 FTE-days and Ben, at half Availability, 10.
 * Adding 2026-11-18 takes one working day off each of them, so the preview's
 * figure is -1.5 FTE-days and the plan's own figures after the write say 19 and
 * 9.5. Hand-checkable, so the arithmetic is.
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

const scratchDir = scratch("pact-holiday-write");

// Two Locations, so "the other Locations are untouched" has something to be
// measured against: two People at Berlin, where the writes happen, and one at
// Munich, whose holidays and whose Capacity must not move.
function fixture() {
  return {
    range: { start: "2026-11-01", end: "2026-12-31" },
    step: 10,
    people: [
      { id: "anna", name: "Anna Meier", availability: 100, location: "Berlin", tags: [], note: "" },
      { id: "ben", name: "Ben Falk", availability: 50, location: "Berlin", tags: [], note: "" },
      { id: "cara", name: "Cara Nowak", availability: 80, location: "Munich", tags: [], note: "" }
    ],
    projects: [{ id: "atlas", name: "Atlas", colour: 0, tags: [], notes: "" }],
    assignments: [],
    holidays: [
      { location: "Berlin", dates: [{ date: "2026-11-11", kind: "full" }] },
      { location: "Munich", dates: [{ date: "2026-12-24", kind: "half" }] }
    ]
  };
}

// The same plan with Berlin as the only Location, for the case where a removal
// empties the list the plan stores.
function onlyBerlin() {
  const plan = fixture();
  plan.holidays = [{ location: "Berlin", dates: [{ date: "2026-11-11", kind: "full" }] }];
  return plan;
}

// A plan with no holidays key at all, which is what a plan that never had one
// looks like: the first date is what brings the list into being.
function noHolidays() {
  const plan = fixture();
  delete plan.holidays;
  return plan;
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

// One holiday write over the November figures, spelled once so a case that
// changes the arguments says so in its own call.
function holiday(planPath, args, env) {
  return cli(["holiday"].concat(args, ["--period", "2026-11", "--plan", planPath]), { env: env });
}

// The people command's own figures, which is what the preview's FTE-days have
// to match after the write.
async function capacities(planPath) {
  const result = await cli(["people", "--period", "2026-11", "--plan", planPath, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  const byId = {};
  data.people.forEach((person) => { byId[person.id] = person.capacity; });
  return byId;
}

async function json(base, urlPath, method) {
  const response = await fetch(base + urlPath, { method: method || "GET" });
  return { status: response.status, body: await response.json() };
}

// One Location's dates as the file stores them, and the other groups' entries
// as JSON text - the strictest form of "unchanged" a test can ask for.
function group(plan, location) {
  const found = (plan.holidays || []).filter((entry) => entry.location === location);
  assert.equal(found.length, 1, "exactly one group for " + location);
  return found[0].dates;
}

function otherGroups(plan, location) {
  return (plan.holidays || [])
    .filter((entry) => entry.location !== location)
    .map((entry) => JSON.stringify(entry));
}

// Everything but the holidays, so "and nothing else changed" is one assertion.
function withoutHolidays(plan) {
  return Object.assign({}, plan, { holidays: undefined });
}

/* --- the preview is the default, and writes nothing ---------------------- */

test("the preview is the default and the plan file is not touched", async () => {
  const started = await app(fixture());
  const before = started.bytes();
  const mtime = fs.statSync(started.planPath).mtimeMs;

  const result = await holiday(started.planPath, ["add", "Berlin", "2026-11-18"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // The date, its weekday, its kind, the People it affects and the FTE-days it
  // takes off them, the Location's whole list after it, and that no other
  // Location moves.
  assert.match(result.stdout, /Holiday/);
  assert.match(result.stdout, /Berlin, 2026-11-18, a Wednesday, full day/);
  assert.match(result.stdout, /Affects 2 People at Berlin: 1\.5 FTE-days off Nov 2026 figures/);
  assert.match(result.stdout, /Berlin's holidays after this: 2026-11-11, 2026-11-18/);
  assert.match(result.stdout, /Other Locations' holidays are untouched: Munich\./);
  assert.match(result.stdout, /Nothing written\. Re-run with --apply\./);

  assert.deepEqual(started.bytes(), before, "the default must not write");
  assert.equal(fs.statSync(started.planPath).mtimeMs, mtime, "the default must not touch the file");
});

test("--dry-run is the same thing said on purpose", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const preview = await holiday(started.planPath, ["add", "Berlin", "2026-11-18"]);
  const dry = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stdout, preview.stdout);
  assert.deepEqual(started.bytes(), before);
});

test("the --json preview carries the rebuilt list and the body that would be sent", async () => {
  const started = await app(fixture());
  const preview = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const data = JSON.parse(preview.stdout);

  assert.equal(data.command, "holiday");
  assert.equal(data.action, "add");
  assert.equal(data.applied, false);
  assert.equal(data.location, "Berlin");
  assert.equal(data.kind, "full");
  assert.equal(data.weekday, "Wednesday");
  assert.equal(data.weekend, false);
  assert.equal(data.outsidePlan, false);
  assert.deepEqual(data.before, [{ date: "2026-11-11", kind: "full" }]);
  assert.deepEqual(data.after, [
    { date: "2026-11-11", kind: "full" },
    { date: "2026-11-18", kind: "full" }
  ]);
  assert.deepEqual(data.others, ["Munich"]);
  assert.equal(data.fteDays, -1.5);
  assert.deepEqual(data.people.map((person) => [person.id, person.before, person.after, person.fteDays]), [
    ["anna", 20, 19, -1],
    ["ben", 10, 9.5, -0.5]
  ]);
  // The body the app's PATCH takes: the whole list, Munich's group included and
  // carried through exactly as the file had it, so the write cannot drop it.
  const before = started.file();
  assert.deepEqual(data.change.holidays, [
    { location: "Berlin", dates: [{ date: "2026-11-11", kind: "full" }, { date: "2026-11-18", kind: "full" }] },
    { location: "Munich", dates: [{ date: "2026-12-24", kind: "half" }] }
  ]);
  assert.deepEqual(otherGroups(data.change, "Berlin"), otherGroups(before, "Berlin"));
});

/* --- the write ----------------------------------------------------------- */

test("--apply adds exactly one date with the kind asked for, and leaves every other Location's dates as they were", async () => {
  const started = await app(fixture());
  const before = started.file();

  const result = await holiday(started.planPath,
    ["add", "Berlin", "2026-11-18", "--kind", "half", "--apply"], { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Applied through http:\/\/127\.0\.0\.1:\d+/);
  assert.match(result.stdout, /read back from its plan: Berlin holds 2 dates/);
  assert.match(result.stdout, /Undo: the change is one step back/);

  const after = started.file();
  assert.deepEqual(group(after, "Berlin"), [
    { date: "2026-11-11", kind: "full" },
    { date: "2026-11-18", kind: "half" }
  ]);
  // The other Locations' entries, byte for byte: the same JSON text per group,
  // so a lost field, a re-sorted date list or a dropped group would fail here.
  assert.deepEqual(otherGroups(after, "Berlin"), otherGroups(before, "Berlin"));
  // And nothing else in the plan moved at all.
  assert.deepEqual(withoutHolidays(after), withoutHolidays(before));
});

test("the kind defaults to a full day, and the app's own list is the only one accepted", async () => {
  const started = await app(fixture());

  const full = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(full.status, 0, full.stderr);
  assert.deepEqual(group(started.file(), "Berlin").find((day) => day.date === "2026-11-18"),
    { date: "2026-11-18", kind: "full" });

  const half = await holiday(started.planPath, ["add", "Berlin", "2026-11-19", "--kind", "half", "--apply"],
    { PACT_URL: started.base });
  assert.equal(half.status, 0, half.stderr);
  assert.deepEqual(group(started.file(), "Berlin").find((day) => day.date === "2026-11-19"),
    { date: "2026-11-19", kind: "half" });

  // A spelling the app does not have is refused before anything is written.
  for (const kind of ["Full", "whole", "half-day"]) {
    const refused = await holiday(started.planPath, ["add", "Berlin", "2026-11-20", "--kind", kind]);
    assert.notEqual(refused.status, 0, kind);
    assert.match(refused.stderr, /--kind must be one of the app's own: full or half/);
  }
  assert.equal(group(started.file(), "Berlin").some((day) => day.date === "2026-11-20"), false);
});

test("a remove takes exactly one date and leaves every other Location's dates as they were", async () => {
  const started = await app(fixture());
  // Two dates at Berlin first, so the removal has one to leave behind.
  const added = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(added.status, 0, added.stderr);
  const before = started.file();

  const result = await holiday(started.planPath, ["remove", "Berlin", "2026-11-11", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Berlin's holidays after this: 2026-11-18/);
  assert.match(result.stdout, /read back from its plan: Berlin holds 1 date/);
  // A removal is one plan setting edited, and the help's command for putting it
  // back is on the screen rather than in a manual.
  assert.match(result.stdout, /a holiday date is one plan setting, not a record/);
  assert.match(result.stdout, /Put it back with: holiday add "Berlin" 2026-11-11/);

  const after = started.file();
  assert.deepEqual(group(after, "Berlin"), [{ date: "2026-11-18", kind: "full" }]);
  assert.deepEqual(otherGroups(after, "Berlin"), otherGroups(before, "Berlin"));
  assert.deepEqual(withoutHolidays(after), withoutHolidays(before));
});

test("removing a Location's last date leaves no empty group behind", async () => {
  const started = await app(onlyBerlin());
  const result = await holiday(started.planPath, ["remove", "Berlin", "2026-11-11", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Berlin's holidays after this: none/);
  assert.deepEqual(started.file().holidays, [], "no group with no dates in it");
  // And the read command agrees there is nothing configured.
  const read = await cli(["holidays", "--plan", started.planPath]);
  assert.match(read.stdout, /\(no holidays configured\)/);
});

test("the first date brings the holiday list into being, and removes it again", async () => {
  const started = await app(noHolidays());
  assert.equal(started.file().holidays, undefined);

  const added = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(added.status, 0, added.stderr);
  assert.deepEqual(started.file().holidays, [
    { location: "Berlin", dates: [{ date: "2026-11-18", kind: "full" }] }
  ]);

  const removed = await holiday(started.planPath, ["remove", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(started.file().holidays, []);
});

/* --- what the preview says is what the plan then shows ------------------- */

test("a weekend date says it changes nothing, and it changes nothing", async () => {
  const started = await app(fixture());
  const before = await capacities(started.planPath);

  // 2026-11-14 is a Saturday: recorded, and no working day to take off.
  const result = await holiday(started.planPath, ["add", "Berlin", "2026-11-14", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Berlin, 2026-11-14, a Saturday, full day/);
  assert.match(result.stdout, /no FTE-day changes over Nov 2026 figures/);
  assert.match(result.stdout, /a weekend date\. It changes\s*\n?no working day/);
  assert.match(result.stdout, /no figure moves/);

  assert.deepEqual(group(started.file(), "Berlin"), [
    { date: "2026-11-11", kind: "full" },
    { date: "2026-11-14", kind: "full" }
  ], "the date is still recorded");
  assert.deepEqual(await capacities(started.planPath), before, "and no Capacity moved");
});

test("the FTE-days the preview states are the ones the plan shows after the write", async () => {
  const started = await app(fixture());
  const before = await capacities(started.planPath);
  assert.deepEqual(before, { anna: 20, ben: 10, cara: 16.8 });

  const preview = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--json"]);
  assert.equal(preview.status, 0, preview.stderr);
  const stated = JSON.parse(preview.stdout);

  const result = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  const after = await capacities(started.planPath);

  // The figure the report now shows, less the figure it showed before, is the
  // preview's own figure for every Person the Location affects.
  stated.people.forEach((person) => {
    assert.equal(after[person.id] - before[person.id], person.fteDays,
      person.name + "'s Capacity moved by the preview's figure");
  });
  const total = stated.people.reduce((sum, person) => sum + (after[person.id] - before[person.id]), 0);
  assert.equal(total, stated.fteDays, "the total is the sum of the Persons' moves");
  assert.equal(stated.fteDays, -1.5);
  // The Person at the other Location is not affected at all.
  assert.equal(after.cara, before.cara, "Munich's Person is untouched");
});

test("a removed date puts the FTE-days back, and the preview says so", async () => {
  const started = await app(fixture());
  const before = await capacities(started.planPath);

  const result = await holiday(started.planPath, ["remove", "Berlin", "2026-11-11", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Affects 2 People at Berlin: 1\.5 FTE-days put back over Nov 2026 figures/);

  const after = await capacities(started.planPath);
  assert.equal(after.anna - before.anna, 1);
  assert.equal(after.ben - before.ben, 0.5);
  assert.equal(after.cara, before.cara);
});

test("a date outside the counted period or outside the plan period is allowed and noted", async () => {
  const started = await app(fixture());

  // Inside the plan's period, outside November, which is what is counted.
  const outsideCount = await holiday(started.planPath, ["add", "Berlin", "2026-12-24"]);
  assert.equal(outsideCount.status, 0, outsideCount.stderr);
  assert.match(outsideCount.stdout, /no FTE-day changes over Nov 2026 figures/);
  assert.match(outsideCount.stdout, /the date lies outside Nov 2026, the period counted/);
  assert.doesNotMatch(outsideCount.stdout, /outside the plan period/);

  // Outside the plan's own period: recorded, noted, and no band drawn for it.
  const outsidePlan = await holiday(started.planPath, ["add", "Berlin", "2027-01-05"]);
  assert.equal(outsidePlan.status, 0, outsidePlan.stderr);
  assert.match(outsidePlan.stdout, /the date lies outside the plan period \(2026-11-01 to 2026-12-31\)/);
  assert.match(outsidePlan.stdout, /the plan still records it/);
});

/* --- Undo ---------------------------------------------------------------- */

test("Undo steps the add and the remove back, one step each", async () => {
  const started = await app(fixture());
  const original = started.file();

  const added = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(added.status, 0, added.stderr);
  const afterAdd = started.file();
  assert.deepEqual(group(afterAdd, "Berlin"), [
    { date: "2026-11-11", kind: "full" },
    { date: "2026-11-18", kind: "full" }
  ]);

  const removed = await holiday(started.planPath, ["remove", "Berlin", "2026-11-11", "--apply"],
    { PACT_URL: started.base });
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(group(started.file(), "Berlin"), [{ date: "2026-11-18", kind: "full" }]);

  // Back one step takes the removal back, and one more takes the add.
  assert.equal((await json(started.base, "/api/undo", "POST")).status, 200);
  assert.deepEqual(started.file(), afterAdd, "one step back is the plan after the add");
  assert.equal((await json(started.base, "/api/undo", "POST")).status, 200);
  assert.deepEqual(started.file(), original, "two steps back is the plan before either");
});

/* --- refusals ------------------------------------------------------------ */

test("a date already a holiday there is refused, and nothing is written", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const same = await holiday(started.planPath, ["add", "Berlin", "2026-11-11"]);
  assert.notEqual(same.status, 0);
  assert.match(same.stderr, /2026-11-11 is already a holiday at Berlin, a full day; nothing to add/);

  // A kind that differs is refused too, rather than quietly replacing the one
  // the plan holds: only a removal followed by an add may change a kind.
  const other = await holiday(started.planPath, ["add", "Berlin", "2026-11-11", "--kind", "half"]);
  assert.notEqual(other.status, 0);
  assert.match(other.stderr,
    /already a holiday at Berlin, a full day; remove it first to record it as a half day/);

  assert.deepEqual(started.bytes(), before);
});

test("a date that is not a holiday there is refused, and the dates it has are named", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const result = await holiday(started.planPath, ["remove", "Berlin", "2026-12-25"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /2026-12-25 is not a holiday at Berlin; its dates are 2026-11-11/);
  assert.deepEqual(started.bytes(), before);
});

test("a Location no Person is at is refused, because the holiday would change nothing", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const result = await holiday(started.planPath, ["add", "Vienna", "2026-11-18"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no Person is at "Vienna", so a holiday there would change no figure/);
  assert.deepEqual(started.bytes(), before);
});

test("a date the plan's own format does not accept is refused", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  for (const date of ["2026-02-30", "18-11-2026", "2026-11-18T00:00", "next monday"]) {
    const result = await holiday(started.planPath, ["add", "Berlin", date]);
    assert.notEqual(result.status, 0, date);
    assert.match(result.stderr, /the holiday date must be a date like 2026-11-02/, date);
  }
  assert.deepEqual(started.bytes(), before);
});

test("holiday add and holiday remove state what they need, and refuse what is not theirs", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  const noDate = await holiday(started.planPath, ["add", "Berlin"]);
  assert.equal(noDate.status, 2);
  assert.match(noDate.stderr, /holiday add needs a Location and a date/);

  const noLocation = await holiday(started.planPath, ["remove", "2026-11-11"]);
  assert.equal(noLocation.status, 2);
  assert.match(noLocation.stderr, /holiday remove needs a Location and a date/);

  const both = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply", "--dry-run"]);
  assert.equal(both.status, 2);
  assert.match(both.stderr, /--apply and --dry-run contradict each other/);

  const action = await cli(["holiday", "move", "Berlin", "2026-11-18", "--plan", started.planPath]);
  assert.equal(action.status, 2);
  assert.match(action.stderr, /unknown holiday action "move"/);

  // Another record's options are not a holiday's.
  for (const flag of [["--person", "Anna Meier"], ["--from", "2026-11-18"], ["--share", "50"],
    ["--colour", "3"], ["--availability", "80"], ["--note", "x"], ["--tag", "y"]]) {
    const refused = await holiday(started.planPath, ["add", "Berlin", "2026-11-18"].concat(flag));
    assert.equal(refused.status, 2, flag.join(" "));
    assert.match(refused.stderr, /holiday does not take --/, flag.join(" "));
  }

  // A removal carries no kind: the date goes as the plan stores it.
  const kind = await holiday(started.planPath, ["remove", "Berlin", "2026-11-11", "--kind", "half"]);
  assert.equal(kind.status, 2);
  assert.match(kind.stderr, /holiday remove does not take --kind/);

  // And the read command does not take the write's options.
  const read = await cli(["holidays", "--kind", "half", "--plan", started.planPath]);
  assert.equal(read.status, 2);
  assert.match(read.stderr, /holidays does not take --kind/);

  assert.deepEqual(started.bytes(), before, "no usage error writes");
});

/* --- the guard and the app that is not there ----------------------------- */

test("a plan the app is not holding is refused, and nothing is written", async () => {
  const started = await app(fixture());
  const elsewhere = path.join(started.dir, "elsewhere.pact.json");
  fs.writeFileSync(elsewhere, JSON.stringify(fixture(), null, 2) + "\n");
  const before = fs.readFileSync(elsewhere);

  const result = await holiday(elsewhere, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to write: the app at .* has a different plan open/);
  assert.match(result.stderr, new RegExp(escapeRegExp(started.planPath)));
  assert.deepEqual(fs.readFileSync(elsewhere), before, "the file it read must not be written");
  assert.deepEqual(group(started.file(), "Berlin"), [{ date: "2026-11-11", kind: "full" }]);
});

test("with no app answering, the error says how to start one", async () => {
  const started = await app(fixture());
  const before = started.bytes();

  // Port 1 is never served by this user, so the connection is refused at once.
  const result = await holiday(started.planPath, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: "http://127.0.0.1:1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
  assert.match(result.stderr, /start it with node server\.mjs/);
  assert.equal(/\n\s+at /.test(result.stderr), false, "no stack trace");
  assert.equal(result.stdout, "");
  assert.deepEqual(started.bytes(), before);
});

test("a write the app accepts but does not hold is not reported as done", async () => {
  // An app that accepts the PATCH and then serves a plan whose holidays are not
  // the ones sent - the one case the read back exists for, since the app itself
  // would have taken the whole array without complaint.
  const dir = scratchDir();
  const planPath = path.join(dir, "stub-holiday.pact.json");
  fs.writeFileSync(planPath, JSON.stringify(fixture(), null, 2) + "\n");
  const stored = fixture().holidays;
  const server = http.createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/plan-file") {
      return send(200, { path: planPath, source: "default", locked: false, notice: "" });
    }
    if (req.method === "GET" && req.url === "/api/plan") {
      return send(200, { people: [], projects: [], assignments: [], holidays: stored });
    }
    req.on("data", () => {});
    req.on("end", () => send(200, { holidays: stored }));
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const base = "http://127.0.0.1:" + server.address().port;

  let result;
  try {
    result = await holiday(planPath, ["add", "Berlin", "2026-11-18", "--apply"], { PACT_URL: base });
  } finally {
    await new Promise((done) => server.close(done));
  }
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /the write did not land: the app's plan holds different holidays/);
  assert.match(result.stderr, /the Locations that differ: Berlin/);
  assert.doesNotMatch(result.stdout, /Applied through/);
});

test("the same plan by another spelling of its path is the same plan", async () => {
  // The app holds the temp directory's real path; the command is handed a
  // symlink to it. Comparing the paths as typed would refuse a plan that is the
  // app's own, so this is the check that the comparison is of real paths.
  const started = await app(fixture());
  const link = path.join(started.dir, "linked.pact.json");
  fs.symlinkSync(started.planPath, link);

  const result = await holiday(link, ["add", "Berlin", "2026-11-18", "--apply"],
    { PACT_URL: started.base });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(group(started.file(), "Berlin"), [
    { date: "2026-11-11", kind: "full" },
    { date: "2026-11-18", kind: "full" }
  ]);
});

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
