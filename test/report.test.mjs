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
