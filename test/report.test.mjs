import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import {
  topbarMarkup,
  mountTopbar,
  reportDisabledControlIds,
  PLAN_PATH,
  REPORT_PATH,
  VIEW_PLAN,
  VIEW_REPORT,
  isReportView,
  viewFromAttribute
} from "../public/lib/topbar.mjs";
import { reportDisabledOptionKeys } from "../public/lib/options.mjs";
import {
  reportBucketLabel,
  serializeFilterHandoff,
  parseFilterHandoff,
  FILTER_HANDOFF_KEY
} from "../public/lib/report.mjs";
import { normalizeView, VIEW_DEFAULTS } from "../public/lib/view.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");

/* --- one bar, two pages --------------------------------------------------- */

test("the plan and the report mount the same bar from one source", () => {
  const plan = topbarMarkup(VIEW_PLAN);
  const report = topbarMarkup(VIEW_REPORT);
  // Every element is in the same place; the only difference is which page the
  // switch marks as current.
  assert.equal(plan.replace(/ aria-current="page"/, ""), report.replace(/ aria-current="page"/, ""));
  assert.match(plan, /class="viewswitch__btn" href="\/" data-view-link="plan" aria-current="page"/);
  assert.match(report, /class="viewswitch__btn" href="\/report.html" data-view-link="report" aria-current="page"/);
});

test("the switch opens the instruments, before the Filter, in both views", () => {
  // One bar from one source: read the identity and instruments zones of each
  // view's markup and check the switch sits in the instruments, first, ahead
  // of the Filter, with the view's own link still marked current.
  [VIEW_PLAN, VIEW_REPORT].forEach((view) => {
    const markup = topbarMarkup(view);
    const identity = markup.match(/<div class="topbar__identity">([\s\S]*?)<\/div>/)[1];
    const instruments = markup.match(/<div class="topbar__instruments">([\s\S]*)/)[1];
    assert.doesNotMatch(identity, /viewswitch/, "the switch is still in the identity zone");
    const switchAt = instruments.search(/class="viewswitch"/);
    const filterAt = instruments.search(/class="filter"/);
    assert.notEqual(switchAt, -1, "the switch is not in the instruments zone");
    assert.ok(switchAt < filterAt, "the switch does not precede the Filter");
    assert.match(instruments, new RegExp(`data-view-link="${view}" aria-current="page"`));
  });
});

test("the switch moves between the report's own path and the plan's", () => {
  assert.equal(PLAN_PATH, "/");
  assert.equal(REPORT_PATH, "/report.html");
  assert.equal(isReportView("report"), true);
  assert.equal(isReportView("plan"), false);
  assert.equal(viewFromAttribute("report"), VIEW_REPORT);
  assert.equal(viewFromAttribute(undefined), VIEW_PLAN);
});

test("mounting fills a host and leaves a missing host alone", () => {
  const host = { innerHTML: "" };
  assert.equal(mountTopbar(host, VIEW_REPORT), host);
  assert.match(host.innerHTML, /data-view-link="report"/);
  assert.equal(mountTopbar(null, VIEW_PLAN), null);
});

test("both pages carry the empty bar host and load the one script", () => {
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const report = fs.readFileSync(path.join(PUBLIC, "report.html"), "utf8");
  [index, report].forEach((html) => {
    assert.match(html, /<header class="topbar" id="topbar"><\/header>/);
    assert.match(html, /<script type="module" src="app\.js">/);
    // The bar is not written into either page; it is mounted from topbar.mjs.
    assert.doesNotMatch(html, /topbar__instruments/);
  });
  assert.match(index, /<html lang="en"[^>]*data-view="plan"/);
  assert.match(report, /<html lang="en"[^>]*data-view="report"/);
});

/* --- the report's own rail ------------------------------------------------ */

// The panel the report mounts: the plan's rail, at the same width and folded by
// the same control, with the report's own list in place of Projects.
const REPORT_RAIL = [
  '<aside class="stack"',
  'id="report-views"',
  'class="rail-toggle"',
  'id="rail-toggle"'
];

// Everything that makes the plan's rail a list of Projects to drag onto the
// timeline. A report has no timeline to drop one onto, so it mounts none of it.
const PLAN_ONLY_RAIL = [
  'id="stack-list"',
  'id="stack-hint"',
  'id="add-project"'
];

test("the report mounts the same rail as the plan, holding views instead of Projects", () => {
  const index = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const report = fs.readFileSync(path.join(PUBLIC, "report.html"), "utf8");
  REPORT_RAIL.forEach((part) => {
    assert.equal(report.includes(part), true, "the report does not mount " + part);
  });
  PLAN_ONLY_RAIL.forEach((part) => {
    assert.equal(report.includes(part), false, "the report still mounts " + part);
  });
  // And the plan keeps its own list, hint and add control.
  PLAN_ONLY_RAIL.forEach((part) => {
    assert.equal(index.includes(part), true, "the plan lost " + part);
  });
  // One panel, so its own label says which list it holds.
  assert.match(report, /<aside class="stack" id="stack" aria-label="Report views">/);
  assert.match(index, /<aside class="stack" id="stack" aria-label="Projects">/);
});

test("the report's board is the plan's: two tracks, and one collapsed rule for both", () => {
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const planBoard = STYLE.match(/^\.board\s*\{([^}]*)\}/m);
  assert.ok(planBoard, "the board rule is missing");
  // One board rule for both pages, so the report's content sits in the same
  // second track the timeline does, at the same rail width.
  assert.match(planBoard[1], /grid-template-columns:\s*minmax\(0, var\(--rail-w\)\) minmax\(0, 1fr\);/);
  assert.equal(STYLE.match(/html\[data-view="report"\] \.board\s*\{/), null,
    "the report overrides the board again");
  // Collapsed, the panel takes no width - the same single rule for the report.
  const collapsed = STYLE.match(/\.board\.is-collapsed\s*\{([^}]*)\}/);
  assert.ok(collapsed, "the collapsed track is missing");
  assert.match(collapsed[1], /grid-template-columns:\s*minmax\(0, 0px\) minmax\(0, 1fr\);/);
});

// The report page's own draw, cut at the rail's section: what renderReport
// builds and nothing of the builders beside it.
function reportRenderSource() {
  const app = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const start = app.indexOf("function renderReport() {");
  const end = app.indexOf("/* --- the report's rail");
  return start >= 0 && end > start ? app.slice(start, end) : "";
}

test("the panel lists the five views and marks the one showing", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const nav = APP.slice(APP.indexOf("function drawReportNav() {"),
    APP.indexOf("function selectReportView(key) {"));
  assert.ok(nav.length > 0, "drawReportNav is missing");
  // One row per view from the report's own list, so the panel and the content
  // cannot drift, and the selected row marked the way the view switch marks the
  // current page.
  assert.match(nav, /REPORT_VIEWS\.forEach/);
  assert.match(nav, /item\.setAttribute\("aria-current", "true"\)/);
  assert.match(nav, /if \(entry\.key === reportView\)/);
  // The current row wears the switch's own treatment.
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const current = STYLE.match(/\.report-nav__item\[aria-current\]\s*\{([^}]*)\}/);
  assert.ok(current, "the selected row's rule is missing");
  assert.match(current[1], /background:\s*var\(--ink\);/);
  assert.match(current[1], /color:\s*var\(--canvas\);/);
});

test("one view is drawn at a time, and the selection decides which", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const reportRender = reportRenderSource();
  assert.ok(reportRender.length > 0, "renderReport is missing");
  // Every pivot and chart goes into the one section the selection names.
  const appends = reportRender.match(/box\.appendChild\(/g) || [];
  assert.equal(appends.length, 2, "renderReport appends more than its head and its view");
  assert.match(reportRender, /box\.appendChild\(reportViewSection\(model\)\);/);
  assert.doesNotMatch(reportRender, /reportProjectSection|reportPersonSection|reportTagSection/);
  // The switch hands back exactly one section, chosen by the stored selection.
  const chooser = APP.slice(APP.indexOf("function reportViewSection(model) {"),
    APP.indexOf("// The bucket headings every matrix shares"));
  assert.ok(chooser.length > 0, "reportViewSection is missing");
  ["by-person", "by-tag", "by-tag-over-time", "allocation"].forEach((key) => {
    assert.match(chooser, new RegExp(`reportView === "${key}"`), key + " has no section");
  });
  assert.match(chooser, /return reportProjectSection\(model\);/);
});

/* --- the line under each view, and the one under its content --------------- */

// One function's source, from its own line to the next closing brace at column
// zero, so an assertion can be made of that builder alone.
function functionSource(APP, name) {
  const start = APP.indexOf("function " + name + "(");
  const end = start < 0 ? -1 : APP.indexOf("\n}\n", start);
  return end > start ? APP.slice(start, end + 3) : "";
}

// Whitespace collapsed, so a sentence split over two source lines still matches
// as the one sentence it renders as.
function flatSource(text) {
  return text.replace(/\s+/g, " ");
}

// The owner's own sentences, decided with him in #153. Each names only what its
// view's heading and column heads cannot say.
test("each view's heading carries its own sentence, in the owner's words", () => {
  const APP = flatSource(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"));
  const calls = {
    byProject: 'reportSection(reportViewLabel("by-project"), ' +
      '"A project with two tags has its FTE-days split between them.")',
    byPerson: 'reportSection(reportViewLabel("by-person"), ' +
      '"The percentage is of what that person offers, not of a full week.")',
    byTag: 'reportSection(reportViewLabel("by-tag"), ' +
      '"Each project\'s days are split between its tags, so the totals fit the plan.")',
    byTagOverTime: 'reportChartSection("by-tag-over-time", ' +
      '"Colours follow the plan\'s colour keys.",',
    // The bucket stays the report's own zoom word, not a fixed "month".
    allocation: 'reportChartSection("allocation", "What the plan offers each " + ' +
      'reportBucketWord() + ", against what is allocated.",'
  };
  Object.keys(calls).forEach((view) => {
    assert.ok(APP.includes(calls[view]), view + " does not carry its own sentence");
  });
  // The dynamic bucket word is still the zoom's own label, in the sentence's case.
  assert.match(APP, /function reportBucketWord\(\) \{ return reportBucketLabel\(reportZoom\)\.toLowerCase\(\); \}/);
});

test("the line under the content says absences are left out, in every view", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // One line, defined once, so the five views cannot drift apart on it.
  assert.equal((APP.match(/"Absences are left out\."/g) || []).length, 1,
    "the absences line is defined more than once or not at all");
  // Appended where each view builds its body: the three tables, and the chart
  // card both chart views share. Below that body, never between it and the
  // heading.
  const body = {
    reportProjectSection: "reportTable(headers, rows)",
    reportPersonSection: "reportTable(headers, rows)",
    reportTagSection: "reportTable(headers, rows)",
    reportChartSection: "appendChild(card)"
  };
  Object.keys(body).forEach((name) => {
    const source = functionSource(APP, name);
    assert.ok(source.length > 0, name + " is missing");
    assert.match(source, /section\.appendChild\(reportAbsencesNote\(\)\);/, name);
    assert.ok(source.lastIndexOf("reportAbsencesNote()") > source.indexOf(body[name]),
      name + " puts the absences line above its content");
  });
  assert.equal((APP.match(/section\.appendChild\(reportAbsencesNote\(\)\);/g) || []).length, 4,
    "a view appends the absences line twice, or one does not append it");
  // The line wears the sub line's quiet treatment rather than the browser's
  // default paragraph, and the sub keeps its own class for its own place.
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const note = STYLE.match(/\.report__sub,\s*\.report__note\s*\{([^}]*)\}/);
  assert.ok(note, "the absences line has no style of its own");
  assert.match(note[1], /font-size: var\(--fs-data\);/);
  assert.match(note[1], /color: var\(--ink-soft\);/);
});

test("no view still carries the machinery the new lines replaced", () => {
  const APP = flatSource(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"));
  [
    "with the tags an even split divides them over",
    "so the tag totals reconcile with the plan",
    "so the totals reconcile with the plan",
    "against what they offer over the period",
    "'s allocation against the capacity the plan offers",
    "Each project's FTE-days in every",
    "Each person's FTE-days in every"
  ].forEach((old) => {
    assert.equal(APP.includes(old), false, "the old wording is still there: " + old);
  });
});

test("the panel's fold is the grid's one collapsed setting", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // One stored key, one setter and one board class for both pages: a report
  // adds no second collapse state that could disagree with the grid's.
  assert.equal((APP.match(/var stackCollapsed = /g) || []).length, 1);
  assert.equal((APP.match(/stackCollapsed = collapsed === true;/g) || []).length, 1);
  assert.equal((APP.match(/boardEl\.classList\.toggle\("is-collapsed", collapsed\)/g) || []).length, 1);
  // Both pages run the one init, which syncs and binds the one toggle.
  assert.equal((APP.match(/initStackToggle\(\)/g) || []).length, 2);
  // The sync reads the panel's own label, so the fold control says what it folds
  // on both pages while folding the same state.
  assert.match(APP, /stackToggleLabel\(collapsed, panel\)/);
  assert.match(APP, /var panel = stackPanel \? stackPanel\.getAttribute\("aria-label"\) : null;/);
});

test("the report's rail holds no sort control, and the plan keeps its own", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // The rail's sort control is the grid's: it orders the Projects list and the
  // People column, and a report's pivots read the sort the plan stored. With a
  // rail back on the report, the control must not follow it there.
  const sortInit = APP.slice(APP.indexOf("function initSortControls() {"),
    APP.indexOf("/* --- view state"));
  assert.ok(sortInit.length > 0, "initSortControls is missing");
  assert.match(sortInit, /if \(isReport\) return;/);
  assert.match(sortInit, /stackHead\.appendChild\(buildSortControl\("projects"\)\);/);
});

test("the report draws no Projects list, and the plan keeps it", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const reportRender = reportRenderSource();
  // No Project list to draw, and no hint about dropping a Project on a row - a
  // report has no rows to drop onto.
  assert.doesNotMatch(reportRender, /drawStack\(|stackHint/);
  // The shared draw is still wired for the plan, which is what owns them.
  assert.match(APP, /\n  drawStack\(\);\n/);
});

/* --- what a report withdraws ---------------------------------------------- */

test("a report withdraws exactly the grid's own controls", () => {
  assert.deepEqual(reportDisabledControlIds(), [
    "today",
    "row-decrease",
    "row-increase",
    "spacing-decrease",
    "spacing-increase",
    "undo-btn",
    "redo-btn"
  ]);
});

test("a report withdraws the grid-only Options entries and no plan-facing one", () => {
  assert.deepEqual(reportDisabledOptionKeys(), [
    "weekends",
    "holidays",
    "dividers",
    "minimap",
    "reset-view"
  ]);
  // The plan-facing entries - the period, the step, the palette, Sprints, the
  // Holidays panel, the Plan file panel - and Show archived, which acts on the
  // rail, all stay live in a report.
  ["archived", "palette", "range", "step", "sprints", "plan-file"].forEach((key) => {
    assert.equal(reportDisabledOptionKeys().includes(key), false, key + " must stay live");
  });
});

/* --- the report's own zoom is independent of the grid's ------------------- */

test("a report remembers its own zoom level, apart from the grid's", () => {
  assert.equal(normalizeView({}).reportZoom, "month");
  // Moving the grid to Day leaves the report at its own level.
  assert.equal(normalizeView({ zoom: "day" }).reportZoom, "month");
  // And the other way round: the stored report level does not move the grid.
  assert.deepEqual(normalizeView({ reportZoom: "day" }), Object.assign({}, VIEW_DEFAULTS, {
    reportZoom: "day"
  }));
  assert.equal(normalizeView({ zoom: "day", reportZoom: "week" }).zoom, "day");
  assert.equal(normalizeView({ zoom: "day", reportZoom: "week" }).reportZoom, "week");
  // A malformed level falls back on its own, keeping the other.
  assert.equal(normalizeView({ zoom: "day", reportZoom: "year" }).reportZoom, "month");
  assert.equal(normalizeView({ zoom: "day", reportZoom: "year" }).zoom, "day");
});

test("the four zoom levels name the report's buckets literally", () => {
  assert.equal(reportBucketLabel("day"), "Day");
  assert.equal(reportBucketLabel("week"), "Week");
  assert.equal(reportBucketLabel("sprint"), "Sprint");
  assert.equal(reportBucketLabel("month"), "Month");
  assert.equal(reportBucketLabel("nonsense"), "Month");
});

/* --- the Filter reaches the report ---------------------------------------- */

test("a carried Filter round-trips its text and Look in scope", () => {
  const carried = serializeFilterHandoff("project tag: Platform", {
    people: false, projects: true, assignments: true
  });
  assert.deepEqual(parseFilterHandoff(carried), {
    query: "project tag: Platform",
    scopes: { people: false, projects: true, assignments: true }
  });
  // The key is this module's own; the browser uses it verbatim.
  assert.equal(typeof FILTER_HANDOFF_KEY, "string");
  assert.ok(FILTER_HANDOFF_KEY.length);
});

test("a missing or malformed carried Filter reads as none, not an error", () => {
  [undefined, null, "", "not json", "[]", '{"scopes":{}}', '{"query":1}', '{"query":"x"}']
    .forEach((raw) => assert.equal(parseFilterHandoff(raw), null));
});

/* --- the pages load at their own paths ------------------------------------ */

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-report-"));
  const store = createStore(path.join(dir, "default.pact.json"));
  const server = createServer(store, { configPath: path.join(dir, "config.json") });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ base: "http://127.0.0.1:" + server.address().port, server: server });
    });
  });
}

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((done) => s.close(done)))));

async function page(base, urlPath) {
  const res = await fetch(base + urlPath);
  return { status: res.status, type: res.headers.get("content-type"), body: await res.text() };
}

test("both the plan and the report load over HTTP at their own paths", async () => {
  const started = await startServer();
  servers.push(started.server);
  const plan = await page(started.base, "/");
  assert.equal(plan.status, 200);
  assert.match(plan.type, /text\/html/);
  assert.match(plan.body, /data-view="plan"/);
  const report = await page(started.base, "/report.html");
  assert.equal(report.status, 200);
  assert.match(report.type, /text\/html/);
  assert.match(report.body, /data-view="report"/);
  assert.match(report.body, /id="topbar"/);
});

/* --- the API keeps the two zoom levels apart ------------------------------ */

function post(base, urlPath, body) {
  return fetch(base + urlPath, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  }).then((res) => res.json());
}

test("the stored view keeps the grid's zoom and the report's apart", async () => {
  const started = await startServer();
  servers.push(started.server);
  const day = await post(started.base, "/api/view", { zoom: "day" });
  assert.equal(day.zoom, "day");
  assert.equal(day.reportZoom, "month");
  const week = await post(started.base, "/api/view", { reportZoom: "week" });
  assert.equal(week.zoom, "day");
  assert.equal(week.reportZoom, "week");
});

/* --- the selected view and the fold are remembered ------------------------ */

test("a report remembers which view it was on, beside the grid's fold", async () => {
  const started = await startServer();
  servers.push(started.server);
  // The selection is stored like any other view setting.
  const chosen = await post(started.base, "/api/view", { reportView: "by-tag-over-time" });
  assert.equal(chosen.reportView, "by-tag-over-time");
  // One collapsed key for both pages: collapsing the report's panel is the same
  // setting the grid's rail reads.
  const folded = await post(started.base, "/api/view", { stackCollapsed: true });
  assert.equal(folded.reportView, "by-tag-over-time");
  assert.equal(folded.stackCollapsed, true);
  // A view that no longer exists falls back to the first one alone, leaving the
  // fold as the owner left it.
  const stale = await post(started.base, "/api/view", { reportView: "by-chart" });
  assert.equal(stale.reportView, "by-project");
  assert.equal(stale.stackCollapsed, true);
});
