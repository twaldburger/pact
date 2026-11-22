/*
 * PACT's view command: what the app is displaying, and one setting of it.
 *
 * The rules here are the ones that make the command trustworthy: the read is
 * the app's own View settings and the app's own plan-level settings, printed in
 * words a reader can act on; the write is one key, sent over the stored view,
 * verified by reading the app's view back and asserting that nothing else
 * moved; a key or a value the app does not take is refused with the ones it
 * does; and the plan-level settings are read-only here, with the refusal naming
 * the app's own control. Both commands read the running app, so a machine with
 * nothing answering gets a sentence rather than a stack trace.
 *
 * What this cannot do is see the screen: the assertions are the stored view, the
 * config file on disk and the rendered text. That the app then draws the
 * setting as it reads it is the appearance check's job, documented at
 * docs/checking-appearance.md - which is why this file also holds that page to
 * being listed in the index and routed from the map.
 *
 * Every case runs its own app over its own plan and its own config in a
 * temporary directory: the repository's own data is never read and never
 * written.
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
import { VIEW_DEFAULTS } from "../public/lib/view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const BIN = path.join(REPO, "bin", "pact.mjs");

const scratchDir = scratch("pact-view");

// One month, one Person, one Project and one Assignment: enough for the plan
// period to read as one month and for the cadence to derive, so the read's
// plan-level rows are hand-checkable.
function fixture() {
  return {
    range: { start: "2026-11-01", end: "2026-11-30" },
    step: 10,
    cadence: { start: "2026-01-05", length: 14, namePrefix: "Sprint ", nameNumber: 1 },
    people: [
      { id: "anna", name: "Anna Meier", availability: 100, location: "Berlin", tags: [], note: "" }
    ],
    projects: [
      { id: "atlas", name: "Atlas", colour: 0, tags: [], notes: "" }
    ],
    assignments: [
      { id: "a-atlas-anna", projectId: "atlas", personId: "anna", start: "2026-11-02", end: "2026-11-13", share: 100, tags: [], note: "" }
    ],
    holidays: [],
    milestones: []
  };
}

// A view that is nowhere near the defaults, so a write that leaked into another
// key is visible: every key below is asserted again after a one-key write.
const STORED_VIEW = {
  zoom: "week",
  reportZoom: "day",
  reportView: "allocation-by-tag",
  rowHeight: 64,
  gridSpacing: { day: 30, week: 20, sprint: 10, month: 6 },
  weekends: true,
  holidays: true,
  milestones: true,
  availabilityLines: false,
  assignments: false,
  dividers: false,
  minimap: true,
  marker: false,
  palette: "set3",
  stackCollapsed: true,
  sort: {
    projects: { key: "fte", direction: "asc" },
    people: { key: "name", direction: "desc" }
  }
};

const apps = [];
after(() => Promise.all(apps.map((entry) => new Promise((done) => entry.server.close(done)))));

// A real app over a real plan and a real config in this case's own temporary
// directory. `view` seeds the stored View settings; absent means the app's
// own defaults.
function app(options) {
  const opts = options || {};
  const dir = scratchDir();
  const planPath = path.join(dir, "case.pact.json");
  const configPath = path.join(dir, "config.json");
  fs.writeFileSync(planPath, JSON.stringify(opts.plan || fixture(), null, 2) + "\n");
  if (opts.view !== undefined) fs.writeFileSync(configPath, JSON.stringify({ view: opts.view }, null, 2) + "\n");
  const store = createStore(planPath);
  const server = createServer(store, { configPath: configPath });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const base = "http://127.0.0.1:" + server.address().port;
      apps.push({ server: server });
      resolve({
        base: base,
        planPath: planPath,
        configPath: configPath,
        // Every check of what was written reads the files, never the store.
        config: () => JSON.parse(fs.readFileSync(configPath, "utf8")),
        configBytes: () => fs.readFileSync(configPath),
        planBytes: () => fs.readFileSync(planPath)
      });
    });
  });
}

// The tool runs as a child process, and never synchronously: a case's app is a
// server in this process, so a blocked event loop could not answer it.
function cli(args, env) {
  const merged = Object.assign({}, process.env, env || {});
  delete merged.PACT_DATA;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN].concat(args), { cwd: REPO, env: merged });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status: status, stdout: stdout, stderr: stderr }));
  });
}

function view(started, extra) {
  return cli(["view"].concat(extra || []), { PACT_URL: started.base });
}

function set(started, key, value, extra) {
  return cli(["view", "set", key, value].concat(extra || []), { PACT_URL: started.base });
}

function viewJSON(started) {
  return view(started, ["--json"]).then((result) => {
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
}

// A labelled row's value, as the text renderer prints it.
function row(text, label) {
  const found = new RegExp("^" + label + " {2,}(.*)$", "m").exec(text);
  assert.ok(found, "no " + label + " row in:\n" + text);
  return found[1];
}

// The wrapped Overlays row, rejoined: the renderer wraps it at a comma, and the
// value is what the reader gets once the lines are read in order.
function overlays(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((line) => line.startsWith("Overlays"));
  assert.notEqual(at, -1, "no Overlays row in:\n" + text);
  const parts = [lines[at].replace(/^Overlays\s+/, "")];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (!/^\s{2,}\S/.test(lines[i])) break;
    parts.push(lines[i].trim());
  }
  return parts.join(" ");
}

/* --- the read ------------------------------------------------------------ */

test("view reads the stored View settings in plain words", async () => {
  const started = await app({ view: STORED_VIEW });
  const result = await view(started);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");

  // Where to look, and which plan the app is showing.
  assert.equal(row(result.stdout, "Plan file"), started.planPath + " (default)");
  assert.equal(row(result.stdout, "Open"), started.base + "/");

  // The plan-level settings a display rests on, as the plan stores them.
  assert.equal(row(result.stdout, "Plan"), "Nov 2026, step 10%");
  assert.match(row(result.stdout, "Cadence"),
    /^first sprint Sprint 1 starts 2026-01-05, 14 days each, named "Sprint 1", "Sprint 2"/);

  // The View settings, each stored value as a sentence.
  assert.equal(row(result.stdout, "Grid"), "zoom week, row height 64, spacing day 30 / week 20 / sprint 10 / month 6");
  assert.equal(overlays(result.stdout),
    "weekends on, holidays on, milestones on, availability lines off, assignments off, " +
    "dividers off, minimap on, marker off");
  assert.equal(row(result.stdout, "Palette"), "set3");
  assert.equal(row(result.stdout, "Report"), "zoom day, Allocation by tag");
  assert.equal(row(result.stdout, "Sort"), "projects: Total assigned FTE, ascending, people: Name, descending");
  assert.equal(row(result.stdout, "Rail"), "folded away");
});

test("view --json carries the same facts under the store's own keys", async () => {
  const started = await app({ view: STORED_VIEW });
  const data = await viewJSON(started);

  assert.equal(data.command, "view");
  assert.equal(data.planFile, started.planPath);
  assert.equal(data.planSource, "default");
  assert.equal(data.open, started.base + "/");
  assert.deepEqual(data.period, {
    kind: "plan", label: "Nov 2026", start: "2026-11-01", end: "2026-11-30", outsidePlan: false
  });
  assert.deepEqual(data.planPeriod, { start: "2026-11-01", end: "2026-11-30" });
  assert.equal(data.step, 10);
  assert.deepEqual(data.cadence, { start: "2026-01-05", length: 14, namePrefix: "Sprint ", nameNumber: "1" });
  // The store exactly as it is stored: every key, no sentence, no default.
  assert.deepEqual(data.view, STORED_VIEW);
});

test("with nothing stored the read is the app's own defaults", async () => {
  const started = await app({});
  const data = await viewJSON(started);
  assert.deepEqual(data.view, VIEW_DEFAULTS);
  const text = await view(started);
  assert.equal(row(text.stdout, "Sort"), "projects: none, people: none");
  assert.equal(row(text.stdout, "Rail"), "open");
});

test("a plan with no cadence says so rather than inventing one", async () => {
  const plan = fixture();
  delete plan.cadence;
  const started = await app({ plan: plan });
  const data = await viewJSON(started);
  assert.equal(data.cadence, null);
  const text = await view(started);
  assert.match(row(text.stdout, "Cadence"), /^none/);
});

/* --- the write ----------------------------------------------------------- */

test("view set previews and writes exactly the one key, leaving the rest as stored", async () => {
  const started = await app({ view: STORED_VIEW });
  const before = started.configBytes();
  const planBefore = started.planBytes();

  // The preview is the default: it names the setting, its old and new value,
  // and writes nothing at all.
  const preview = await set(started, "zoom", "week");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /zoom: week -> week/);
  assert.match(preview.stdout, /Nothing written\. Re-run with --apply\./);
  assert.deepEqual(started.configBytes(), before);

  const applied = await set(started, "zoom", "sprint", ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /zoom: week -> sprint/);
  assert.match(applied.stdout, /read back from its view: zoom is sprint/);
  assert.match(applied.stdout, /every other setting is exactly as it was/);
  assert.match(applied.stdout, /not one of the app's Undo steps/);
  assert.match(applied.stdout, /view set zoom week --apply/);

  // Exactly one key changed, and the config's other fields are untouched.
  const config = started.config();
  assert.equal(config.view.zoom, "sprint");
  assert.deepEqual(Object.assign({}, config.view, { zoom: STORED_VIEW.zoom }), STORED_VIEW);
  // Nothing of the plan moved: a view write is not a plan write.
  assert.deepEqual(started.planBytes(), planBefore);
});

test("a nested key writes its own part and leaves the others in that object", async () => {
  const started = await app({ view: STORED_VIEW });

  const spacing = await set(started, "gridSpacing.day", "44", ["--apply"]);
  assert.equal(spacing.status, 0, spacing.stderr);
  assert.match(spacing.stdout, /gridSpacing\.day: 30 -> 44/);
  assert.deepEqual(started.config().view.gridSpacing, { day: 44, week: 20, sprint: 10, month: 6 });

  // The sort is the second object-valued key, and the one a one-level merge
  // would silently empty: the other list's order has to survive the write.
  const sort = await set(started, "sort.projects", "name", ["--apply"]);
  assert.equal(sort.status, 0, sort.stderr);
  assert.match(sort.stdout, /sort\.projects: Total assigned FTE, ascending -> Name, ascending/);
  assert.deepEqual(started.config().view.sort, {
    projects: { key: "name", direction: "asc" },
    people: { key: "name", direction: "desc" }
  });
});

test("a toggle is written as on or off, the app's own boolean", async () => {
  const started = await app({ view: STORED_VIEW });
  const off = await set(started, "weekends", "off", ["--apply"]);
  assert.equal(off.status, 0, off.stderr);
  assert.equal(started.config().view.weekends, false);
  const on = await set(started, "marker", "on", ["--apply"]);
  assert.equal(on.status, 0, on.stderr);
  assert.equal(started.config().view.marker, true);
});

test("a setting another hand moved in between the preview and the write is kept", async () => {
  const started = await app({ view: STORED_VIEW });
  const preview = await set(started, "gridSpacing.week", "24");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /gridSpacing\.week: 20 -> 24/);

  // The person at the screen changes another zoom's spacing in between, by a
  // write the app itself merges one level deep: day 12 lands, and the zooms it
  // did not name fall back to their defaults. The tool's write must then be
  // rebuilt from the app's own read - day 12 kept - rather than from the
  // preview's whole object, which would have put the old three back.
  const moved = await fetch(started.base + "/api/view", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gridSpacing: { day: 12 } })
  });
  assert.equal(moved.status, 200);
  assert.deepEqual(started.config().view.gridSpacing, { day: 12, week: 16, sprint: 8, month: 5 });

  const applied = await set(started, "gridSpacing.week", "24", ["--apply"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(started.config().view.gridSpacing, { day: 12, week: 24, sprint: 8, month: 5 });
});

/* --- the refusals -------------------------------------------------------- */

test("an unknown key names the keys view set does write", async () => {
  const started = await app({ view: STORED_VIEW });
  const result = await set(started, "contrast", "high");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown view key "contrast"/);
  for (const key of ["zoom", "rowHeight", "gridSpacing.day", "weekends", "palette", "sort.people"]) {
    assert.ok(result.stderr.includes(key), key);
  }
  // It says what the keys are before the app is asked anything, so it answers
  // the same with no app running at all.
  const offline = await cli(["view", "set", "contrast", "high"], { PACT_URL: "http://127.0.0.1:1" });
  assert.equal(offline.status, 1);
  assert.match(offline.stderr, /unknown view key "contrast"/);
});

test("a value the app would refuse, or store as something else, names what it takes", async () => {
  const started = await app({ view: STORED_VIEW });
  const cases = [
    { key: "zoom", value: "year", says: /the zooms are day, week, sprint and month/ },
    { key: "rowHeight", value: "50", says: /the app would store 48 instead/ },
    { key: "gridSpacing.week", value: "60", says: /a whole number of pixels from 2 to 48/ },
    { key: "weekends", value: "yes", says: /a toggle is on or off/ },
    { key: "palette", value: "neon", says: /the palettes are paired and set3/ },
    { key: "reportView", value: "nope", says: /they are by-project, by-person, by-tag/ },
    { key: "sort.projects", value: "bogus", says: /they are name, start, end and fte/ }
  ];
  for (const entry of cases) {
    const result = await set(started, entry.key, entry.value);
    assert.equal(result.status, 1, entry.key);
    assert.match(result.stderr, entry.says, entry.key);
  }
  // And nothing was written by any of them.
  assert.deepEqual(started.config().view, STORED_VIEW);
});

test("the plan-level settings are read-only here and say where they are set", async () => {
  const started = await app({ view: STORED_VIEW });
  const cases = [
    { key: "step", says: /Options > Percentage step/ },
    { key: "range", says: /Options > Plan period/ },
    { key: "cadence", says: /Options > Sprints/ },
    { key: "tagSplit", says: /Options > Tags/ }
  ];
  for (const entry of cases) {
    const result = await set(started, entry.key, "5");
    assert.equal(result.status, 1, entry.key);
    assert.match(result.stderr, new RegExp(entry.key + " is not a View setting"), entry.key);
    assert.match(result.stderr, entry.says, entry.key);
    assert.match(result.stderr, /Only the View settings are written here/, entry.key);
  }
  assert.deepEqual(started.config().view, STORED_VIEW);
});

test("view takes no plan file, no period and no narrowing of its own", async () => {
  const started = await app({ view: STORED_VIEW });
  const refusals = [
    { args: ["--plan", started.planPath], says: /view does not take --plan/ },
    { args: ["--period", "2026-11"], says: /view does not take --period/ },
    { args: ["--apply"], says: /view does not take --apply/ },
    { args: ["--over"], says: /view does not take --over/ },
    { args: ["--location", "Berlin"], says: /view does not take --location/ },
    { args: ["--tag", "api"], says: /view does not take --tag/ }
  ];
  for (const entry of refusals) {
    const result = await view(started, entry.args);
    assert.equal(result.status, 2, entry.args.join(" "));
    assert.match(result.stderr, entry.says);
  }
  // The two refused for the same reasons on the write, which does take --apply.
  const plan = await set(started, "zoom", "week", ["--plan", started.planPath]);
  assert.equal(plan.status, 2);
  assert.match(plan.stderr, /view does not take --plan/);
});

test("both commands read the running app and say so when nothing answers", async () => {
  const read = await cli(["view"], { PACT_URL: "http://127.0.0.1:1" });
  assert.equal(read.status, 1);
  assert.match(read.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
  assert.match(read.stderr, /start it with node server\.mjs/);
  assert.equal(/\n\s+at /.test(read.stderr), false, "no stack trace");

  const write = await cli(["view", "set", "zoom", "week"], { PACT_URL: "http://127.0.0.1:1" });
  assert.equal(write.status, 1);
  assert.match(write.stderr, /no PACT server at http:\/\/127\.0\.0\.1:1/);
});

/* --- the boundary -------------------------------------------------------- */

test("view set has no --force and nothing here deletes", async () => {
  const started = await app({ view: STORED_VIEW });
  const before = started.configBytes();
  for (const flag of ["--force", "--destroy", "--delete"]) {
    const result = await set(started, "zoom", "week", [flag]);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /unknown option "/, flag);
  }
  assert.deepEqual(started.configBytes(), before);

  // The help keeps the boundary true: the fourteen plan writes are still
  // fourteen, and a view write is said to be a different thing.
  const help = await cli(["--help"]);
  assert.match(help.stdout, /Fourteen commands change a plan/);
  assert.match(help.stdout, /Nothing here is one of the fourteen commands above that change a plan/);
  assert.match(help.stdout, /view set <key> <value>/);
  // `view` is not a plan write, so it has no --force and no delete to suggest.
  assert.match(help.stdout, /The tool never deletes anything\./);
});

/* --- the appearance check, and the map that routes to it ------------------ */

test("docs/checking-appearance.md delivers the appearance rule and is findable", () => {
  const page = fs.readFileSync(path.join(REPO, "docs", "checking-appearance.md"), "utf8");
  // What #218 promised: measured or looked at, how to start the app, where it
  // serves, and the rule when neither is possible.
  assert.match(page, /node server\.mjs/);
  assert.match(page, /localhost:4173/);
  assert.match(page, /measured or .*looked at/);
  assert.match(page, /say what changed,? and ask/i);
  // The capture example is labelled as an example, in a repository with no
  // dependencies to install.
  assert.match(page, /example/i);
  assert.match(page, /no\s+dependencies/i);

  // Listed where the index rule requires it, and routed from the map.
  const index = fs.readFileSync(path.join(REPO, "docs", "index.md"), "utf8");
  assert.match(index, /\]\(checking-appearance\.md\)/);
  const map = fs.readFileSync(path.join(REPO, "AGENTS.md"), "utf8");
  assert.match(map, /\]\(docs\/checking-appearance\.md\)/);
});

test("the view's own module doc names both commands' contracts", () => {
  const source = fs.readFileSync(path.join(REPO, "lib", "query.mjs"), "utf8");
  assert.match(source, /^ \*   view\(plan, storedView\)/m);
  assert.match(source, /^ \*   viewSet\(storedView, key, value\)/m);
  // The CLI renders; the module never prints, reads a file or exits.
  const cli = fs.readFileSync(BIN, "utf8");
  assert.match(cli, /query\.view\(read\.plan, read\.stored\)/);
  assert.match(cli, /query\.viewSet\(stored, key, typed\)/);
});
