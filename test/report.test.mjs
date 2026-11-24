import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
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
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("report");

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

test("the switch gives its two links equal columns, sized by the longer label", () => {
  // The links once took their width from their own text, so Plan and Report
  // rendered at different widths. Two equal tracks on a container left to its
  // content put both at the wider label's width, and keep them equal when a
  // label grows, which a pinned px width would not.
  const style = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const nav = style.match(/\.viewswitch\s*\{([^}]*)\}/);
  assert.ok(nav, "the .viewswitch rule is missing");
  assert.match(nav[1], /display:\s*grid;/);
  assert.match(nav[1], /grid-template-columns:\s*1fr 1fr;/);
  // The bar's height and border are the switch's own, unchanged.
  assert.match(nav[1], /height:\s*var\(--control-h\);/);
  assert.match(nav[1], /border:\s*1px solid var\(--rule\);/);
  // No button pins a width of its own; the columns are the only width rule.
  const btn = style.match(/\.viewswitch__btn\s*\{([^}]*)\}/);
  assert.ok(btn, "the .viewswitch__btn rule is missing");
  assert.doesNotMatch(btn[1], /(^|[;{\s])(min-|max-)?width\s*:/);
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

test("the panel lists the seven views and marks the one showing", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const nav = APP.slice(APP.indexOf("function drawReportNav() {"),
    APP.indexOf("function selectReportView("));
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

/* --- the rail's focus, and the two other reads of it --------------------- */

// The keyboard ring is the keyboard's, and only the keyboard's press needs the
// focus put back on the redrawn row. "Focused" is not "keyboard": a mouse press
// focuses the button it lands on, so the rail's press has to say which it was -
// the click's own detail, 0 for the keyboard and non-zero for a pointer.
test("a pointer press on a view leaves focus where it is, and the keyboard's does not", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const nav = APP.slice(APP.indexOf("function drawReportNav() {"),
    APP.indexOf("function selectReportView("));
  assert.ok(nav.length > 0, "drawReportNav is missing");
  assert.match(flatSource(nav),
    /item\.addEventListener\("click", function \(e\) \{ selectReportView\(entry\.key, e\.detail === 0\); \}\)/);
  const select = functionSource(APP, "selectReportView");
  assert.ok(select.length > 0, "selectReportView is missing");
  // The decision is the press's own kind, never "something in the list has
  // focus"; the refocus then happens for the keyboard alone, and the ring it
  // draws stays the ring the keyboard needs.
  assert.doesNotMatch(select, /document\.activeElement/);
  assert.match(select, /if \(pressedWithKeyboard\) \{/);
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const ring = STYLE.match(/(^|\n):focus-visible\s*\{([^}]*)\}/);
  assert.ok(ring, "the global focus ring rule is missing");
  assert.match(ring[2], /outline:\s*2px solid var\(--ink\);/);
  assert.match(ring[2], /outline-offset:\s*2px;/);
});

// The app's two other reads of document.activeElement were checked for the same
// conflation and are right as they are: the filter's blur guard asks whether
// focus left the filter (an outside pointer is handled by its own pointerdown,
// and a suggestion's own mousedown keeps the input focused), and the sort
// menu's arrow keys start from the focused item in a keydown handler, which no
// pointer can reach.
test("the filter's guard and the menu's arrow keys ask about focus, and mean it", () => {
  const APP = flatSource(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"));
  assert.match(APP, /if \(!filterEl\.contains\(document\.activeElement\)\) hideSuggestions\(\);/);
  assert.match(APP, /var i = items\.indexOf\(document\.activeElement\);/);
});

test("one view is drawn at a time, and the selection decides which", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const reportRender = reportRenderSource();
  assert.ok(reportRender.length > 0, "renderReport is missing");
  // Every pivot and chart goes into the one section the selection names, and
  // the report's head carries no title or lead above it.
  const appends = reportRender.match(/box\.appendChild\(/g) || [];
  assert.equal(appends.length, 1, "renderReport appends more than its view");
  assert.doesNotMatch(reportRender, /report__head|report__title|report__lead/);
  assert.match(reportRender, /box\.appendChild\(reportViewSection\(model\)\);/);
  assert.doesNotMatch(reportRender, /reportProjectSection|reportPersonSection|reportTagSection/);
  // The switch hands back exactly one section, chosen by the stored selection.
  const chooser = APP.slice(APP.indexOf("function reportViewSection(model) {"),
    APP.indexOf("// The bucket headings every matrix shares"));
  assert.ok(chooser.length > 0, "reportViewSection is missing");
  ["by-person", "by-tag", "allocation-by-project", "allocation-by-person", "allocation-by-tag",
    "allocation"].forEach((key) => {
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
      '"Of offer is against each person\'s own availability, so someone at 80% can reach 100%.")',
    allocationByProject: 'reportSection(reportViewLabel("allocation-by-project"), ' +
      '"Each project\'s FTE-days as a share of the capacity the plan offers in the " + ' +
      '"same stretch of time; above 100% is over-allocation.")',
    allocationByPerson: 'reportSection(reportViewLabel("allocation-by-person"), ' +
      '"Each person\'s FTE-days as a share of what they offer in the same stretch of time; ' +
      'above 100% is over-allocation.")',
    allocationByTag: 'reportSection(reportViewLabel("allocation-by-tag"), ' +
      '"Each tag\'s FTE-days as a share of the capacity the plan offers in the same " + ' +
      '"stretch of time; above 100% is over-allocation.")',
    byTag: 'reportSection(reportViewLabel("by-tag"), ' +
      '"The rows are the tags you tick; ticking a key ticks all of its tags at once, " + ' +
      '"and the tags you leave out are gathered under Other tags.")',
    // The bucket stays the report's own zoom word, not a fixed "month".
    allocation: 'reportSection(reportViewLabel("allocation"), ' +
      '"What the plan offers each " + reportBucketWord() + ", against what is allocated.")'
  };
  Object.keys(calls).forEach((view) => {
    assert.ok(APP.includes(calls[view]), view + " does not carry its own sentence");
  });
  // The dynamic bucket word is still the zoom's own label, in the sentence's case.
  assert.match(APP, /function reportBucketWord\(\) \{ return reportBucketLabel\(reportZoom\)\.toLowerCase\(\); \}/);
});

test("the line under the content says absences are left out, in every view", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // One line, defined once, so the seven views cannot drift apart on it.
  assert.equal((APP.match(/"Absences are left out\."/g) || []).length, 1,
    "the absences line is defined more than once or not at all");
  // Appended where each view builds its content: the six tables, and the chart
  // card. Below that content, never between it and the heading.
  const body = {
    reportProjectSection: "reportTable(headers, rows)",
    reportPersonSection: "reportTable(headers, rows)",
    reportAllocationProjectSection: "reportTable(headers, rows)",
    reportAllocationPersonSection: "reportTable(headers, rows)",
    reportTagSection: "reportTable(headers, rows)",
    reportAllocationTagSection: "reportTable(headers, rows)",
    reportAllocationSection: "appendChild(card)"
  };
  Object.keys(body).forEach((name) => {
    const source = functionSource(APP, name);
    assert.ok(source.length > 0, name + " is missing");
    assert.match(source, /section\.appendChild\(reportAbsencesNote\(\)\);/, name);
    assert.ok(source.lastIndexOf("reportAbsencesNote()") > source.indexOf(body[name]),
      name + " puts the absences line above its content");
  });
  assert.equal((APP.match(/section\.appendChild\(reportAbsencesNote\(\)\);/g) || []).length, 7,
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
    "Each person's FTE-days in every",
    // The caption's old claim: it named a week the report never counts, and a
    // year-long zoom disproves it.
    "not of a full week"
  ].forEach((old) => {
    assert.equal(APP.includes(old), false, "the old wording is still there: " + old);
  });
});

test("all three tables mark the column their row totals land in", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const column = APP.match(/var REPORT_TOTAL_COL = "([^"]+)";/);
  assert.ok(column, "the marked column's class is missing");
  assert.match(column[1], /\breport-table__total\b/);
  // The header over the marked column is marked too: a heading over a marked
  // column is not a plain one singled out by a stray line.
  const heads = {
    reportProjectSection: ["Total", "byProject"],
    reportPersonSection: ["Total", "byPerson"],
    reportTagSection: ["Total", "byTag"]
  };
  Object.keys(heads).forEach((name) => {
    const pivot = functionSource(APP, name);
    assert.ok(pivot.length > 0, name + " is missing");
    assert.match(pivot, new RegExp('\\{ text: "' + heads[name][0] + '", cls: REPORT_TOTAL_COL \\}'),
      name + " leaves its column's header unmarked");
    // Each row's figure and the Total row's own figure both take it.
    assert.equal((pivot.match(/reportTotalCell\(r\.total\)/g) || []).length, 1,
      name + " does not mark its rows' totals");
    assert.match(pivot, new RegExp("reportTotalCell\\(model\\." + heads[name][1] + "\\.total\\.total\\)"),
      name + " does not mark the Total row's own cell");
    // Nothing else in the column is marked through a second class or a rule of
    // its own: the one class is the whole mark.
    assert.doesNotMatch(pivot, /report-row--total[^\n]*report-table__total/);
  });
});

test("all three tables head their share column Of plan", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // The owner renamed the head so both denominators are named rather than one,
  // so no copy of either old head may survive anywhere in the app.
  ["Share of plan", "% of offer", '{ text: "Share"'].forEach((old) => {
    assert.equal(APP.includes(old), false, "the old head is still there: " + old);
  });
  const heads = {
    reportProjectSection: "byProject",
    reportPersonSection: "byPerson",
    reportTagSection: "byTag"
  };
  Object.keys(heads).forEach((name) => {
    const pivot = functionSource(APP, name);
    assert.ok(pivot.length > 0, name + " is missing");
    // The head keeps the figures' class, so the column stays right-aligned.
    assert.equal((pivot.match(/\{ text: "Of plan", cls: "report-table__num" \}/g) || []).length, 1,
      name + " does not head its share column Of plan");
  });
  // Three tables, so three heads of plan and no fourth table that missed it.
  assert.equal((APP.match(/\{ text: "Of plan", cls: "report-table__num" \}/g) || []).length, 3);
  // Only the by-person table carries the second denominator, and it names it the
  // same way, so the pair reads as the two fractions it is.
  const person = functionSource(APP, "reportPersonSection");
  assert.equal((person.match(/\{ text: "Of offer", cls: "report-table__num"/g) || []).length, 1,
    "the by-person table does not head its second percentage Of offer");
  assert.equal((APP.match(/"Of offer"/g) || []).length, 1, "Of offer appears outside the one head");
});

test("all six tables head their total column Total", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // The owner's consistency pass: the by-person table named the unit where the
  // other two name the figure, so every copy of the old head is gone.
  assert.equal(APP.includes('{ text: "FTE-days", cls: REPORT_TOTAL_COL }'), false,
    "the by-person table still heads its total column with the unit");
  const tables = ["reportProjectSection", "reportPersonSection",
    "reportAllocationProjectSection", "reportAllocationPersonSection", "reportTagSection",
    "reportAllocationTagSection"];
  tables.forEach((name) => {
    const pivot = functionSource(APP, name);
    assert.ok(pivot.length > 0, name + " is missing");
    assert.equal((pivot.match(/\{ text: "Total", cls: REPORT_TOTAL_COL \}/g) || []).length, 1,
      name + " does not head its total column Total");
  });
  // Six tables, six heads: no seventh table and no drift back to the unit.
  assert.equal((APP.match(/\{ text: "Total", cls: REPORT_TOTAL_COL \}/g) || []).length, 6);
});

/* --- the by-tag head is two rows of chips (issue #175) -------------------- */

test("the by-tag head offers two flat rows of chips, keys over tags", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const head = functionSource(APP, "reportTagSplit");
  assert.ok(head.length > 0, "reportTagSplit is missing");
  // The two rows come from the one function that says what a key is and the one
  // that says what is offered, so a second tag source widens the chips there
  // alone. The keys are drawn first and the tags under them.
  assert.match(head, /var keys = tagKeyGroups\(data\);/);
  assert.match(head, /var tags = tagChoices\(data\);/);
  assert.ok(head.indexOf("report-tags--keys") < head.indexOf("report-tags--tags"),
    "the tag row is drawn above the key row");
  assert.equal((head.match(/report-tags--(keys|tags)/g) || []).length, 2, "the head is not two rows");
  // Keyless tags are chips in the tag row only: no key chip stands for them,
  // and no grouping heading is drawn at all.
  assert.equal(/No key|UNTYPED|"" tags/.test(head), false, "a keyless key chip is still drawn");
  assert.equal(/report-tags__(group|key|keyname|count|tag|label)"/.test(head), false,
    "a grouping heading or its count is still drawn");
  // No checkbox anywhere: the chip is the control.
  assert.equal(/checkbox|createElement\("input"\)|type = "input"/.test(head), false,
    "the choose-the-tags control is still a checkbox");
  // A key's chip ticks or clears its whole group, a tag's own chip one tag, and
  // either way the write replaces the plan's own set of tags.
  assert.match(head, /return tagToggled\(selected, group\.tags\);/);
  assert.match(head, /return tagToggled\(selected, \[tag\]\);/);
  assert.match(head, /api\("PATCH", "\/api\/plan", \{ tagSplit: \{ tags: next \} \}\)/);
  // The old dropdown and the ticks it became are gone, from the script and
  // from the stylesheet both.
  ["report-split__select", "Choose a key", "tagSplitSuggestions", "report-split__field",
    "report-tags__label", "Split by"].forEach((old) => {
    assert.equal(APP.includes(old), false, "the old head is still there: " + old);
  });
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  [".report-split", ".report-tags__label", ".report-tags__group", ".report-tags__key",
    ".report-tags__count", ".report-tags__tag", ".report-tags input"].forEach((old) => {
    assert.equal(STYLE.includes(old), false, "the old head's rules are still there: " + old);
  });
});

test("a key's chip state is derived from its tags, and none is stored", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const head = functionSource(APP, "reportTagSplit");
  assert.match(head, /tagKeyState\(group\.tags, selected\)/);
  // Two states and no third: a key is selected when all of its tags are, and
  // is drawn as not selected for every other reading of them.
  assert.match(head, /state\.all \? "on" : "off"/);
  // A tag chip is selected by the tag row's own set, which is the truth the
  // key's state is read from.
  assert.match(head, /selected\.indexOf\(tag\) !== -1 \? "on" : "off"/);
  // No key state is ever written: the plan stores the tag set alone.
  assert.equal(APP.includes("tagSplit: { key"), false, "a key is still written to the plan");
});

test("the two rows are named inline, so the chooser gains no height", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const head = functionSource(APP, "reportTagSplit");
  // Each row is its name and its chips together, built once for both rows.
  assert.match(head, /var keysRow = row\("Keys", "report-tags--keys"\);/);
  assert.match(head, /var tagsRow = row\("Tags", "report-tags--tags"\);/);
  assert.match(head, /var label = el\("span", "report-taghead__label"\);/);
  assert.ok(head.indexOf("line.appendChild(label)") < head.indexOf("line.appendChild(chips)"),
    "the name is drawn after its chips");
  // The row is a flex line: the name cannot shrink or wrap, and the chips take
  // the rest of the line and wrap inside it. A name that could wrap would take
  // a line of its own and grow the chooser by a line.
  const line = STYLE.match(/\.report-taghead__row\s*\{([^}]*)\}/);
  assert.ok(line, "the named row has no rule of its own");
  assert.match(line[1], /display: flex;/);
  assert.match(line[1], /align-items: baseline;/);
  const label = STYLE.match(/\.report-taghead__label\s*\{([^}]*)\}/);
  assert.ok(label, "the row's name has no rule of its own");
  assert.match(label[1], /flex: none;/);
  assert.equal(/white-space/.test(label[1]), false,
    "the name is held to one line by its flex item, not by nowrap");
  const chips = STYLE.match(/\.report-taghead__row \.report-tags\s*\{([^}]*)\}/);
  assert.ok(chips, "the chips in a named row have no rule of their own");
  assert.match(chips[1], /flex: 1 1 auto;/);
  assert.match(chips[1], /min-width: 0;/);
  // The name wears the small label the report's column heads wear, so it reads
  // as a name rather than as the first chip of its row.
  assert.match(label[1], /font-size: var\(--fs-axis\);/);
  assert.match(label[1], /color: var\(--ink-soft\);/);
  assert.match(label[1], /text-transform: uppercase;/);
  assert.match(label[1], /letter-spacing: 0\.02em;/);
});

test("the TAGS column and the two chip rows are one chip, not two drawings", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const chip = functionSource(APP, "reportTagChip");
  assert.ok(chip.length > 0, "reportTagChip is missing");
  // The states ride on the one chip: data-state for the drawing, aria-pressed
  // for the reading, so a chip's state is a property of the element rather than
  // a second kind of chip with its own colour.
  assert.match(chip, /chip\.setAttribute\("data-state", choice\.state\);/);
  assert.match(chip, /chip\.setAttribute\("aria-pressed",/);
  // Two values, not three: a pressed chip says so and every other state says
  // not pressed, because there is no third state left to read.
  assert.match(chip, /choice\.state === "on" \? "true" : "false"/);
  assert.match(chip, /choice \? el\("button", "report-tag report-tag--choice"\) : el\("span", "report-tag"\)/);
  // The swatch is the only thing that carries a tag's colour: the chip itself
  // sets no fill, so every selected chip fills alike.
  assert.match(chip, /swatch\.style\.background = activeColour\(slot\);/);
  assert.equal(/--tag-fill|--tag-ink/.test(chip), false, "a chip still sets a fill per tag");
  assert.equal(/setProperty\(/.test(chip), false, "the chip still sets a colour of its own");
  // One drawing, two callers: the TAGS column and the head both build the chip
  // through this function, and nothing else builds a `.report-tag`.
  assert.match(functionSource(APP, "reportTagList"), /reportTagChip\(tag, slot\)/);
  assert.match(functionSource(APP, "reportTagSplit"), /return reportTagChip\(tag, slot, \{/);
  assert.equal((APP.match(/el\("span", "report-tag"\)/g) || []).length, 1,
    "a second chip drawing is built beside reportTagChip");
});

test("the chip takes its width from its text in both places", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const tag = STYLE.match(/\.report-tag\s*\{([^}]*)\}/);
  assert.ok(tag, "the chip has no rule of its own");
  // A chip that cannot shrink keeps its own width: in the TAGS column it was
  // being squeezed to the column and wrapping its label.
  assert.match(tag[1], /flex: none;/);
  assert.match(tag[1], /white-space: nowrap;/);
  // One rule for the list of chips, which the TAGS column and both chip rows
  // share. A second rule for the same class was what imposed the by-tag head's
  // own layout on the column's chips and squeezed them; the head has a class of
  // its own so the two cannot reach into each other.
  assert.equal((STYLE.match(/^\.report-tags\s*\{/gm) || []).length, 1,
    "the list of chips is styled more than once");
  assert.match(STYLE, /\.report-taghead\s*\{/);
  assert.match(functionSource(APP, "reportTagList"), /reportTagChip\(tag, slot\)/);
  assert.match(functionSource(APP, "reportTagSplit"), /el\("div", "report-taghead"\)/);
});

test("a selected chip's fill is the app's ink, whatever colour its tag has", () => {
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const on = STYLE.match(/\.report-tag--choice\[data-state="on"\]\s*\{([^}]*)\}/);
  const off = STYLE.match(/\.report-tag--choice\s*\{([^}]*)\}/);
  assert.ok(on, "a selected chip has no rule of its own");
  assert.ok(off, "the chip's resting state has no rule of its own");
  // One fill for every selected chip - the app's ink, which is what a tag with
  // no colour always filled with - so a coloured tag and a plain one are
  // selected in the same way. The paper is the label ink on that fill.
  assert.match(on[1], /background: var\(--ink\);/);
  assert.match(on[1], /border-color: var\(--ink\);/);
  assert.match(on[1], /color: var\(--canvas\);/);
  // No per-tag fill is left for a rule to read: the swatch carries the colour
  // and nothing else does.
  assert.equal(/--tag-fill|--tag-ink/.test(STYLE), false, "a per-tag fill is still styled");
});

test("a chip has two states, and no partial one is drawn or set", () => {
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.equal(/data-state="some"/.test(STYLE + APP), false, "a partial chip state is still drawn");
  assert.equal(/state\.some/.test(APP), false, "a key still reads a partial state");
  assert.equal(/"mixed"/.test(APP), false, "a chip still reports a mixed press");
  // The chip is selected or it is not: those are the only two states any rule
  // or any attribute draws on.
  const states = [...STYLE.matchAll(/\.report-tag--choice\[data-state="([a-z]+)"\]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(states)].sort(), ["off", "on"]);
});

test("the chooser is capped at about three lines, and scrolls inside them", () => {
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const list = STYLE.match(/\.report-taghead__list\s*\{([^}]*)\}/);
  assert.ok(list, "the by-tag list has no rule of its own");
  assert.match(list[1], /max-height: var\(--chooser-h\);/);
  assert.match(list[1], /overflow-y: auto;/);
  // The cap is a height in the tokens, not a share of the window: three chip
  // lines is roughly 3rem of type at the chip's own scale, and it is stated
  // once so the rows and the table below it cannot disagree.
  const token = STYLE.match(/--chooser-h:\s*([0-9.]+)rem;/);
  assert.ok(token, "the chooser's cap is not a rem token");
  const px = Number(token[1]) * 16;
  assert.ok(px >= 48 && px <= 72, "the chooser's cap is " + px + "px, not about three lines");
});

test("an empty selection says so, in the view's own words", () => {
  const APP = flatSource(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"));
  assert.match(APP, /"Nothing is selected yet - tick the tags the rows should split by\."/);
  const head = functionSource(fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8"), "reportTagSection");
  assert.ok(head.length > 0, "reportTagSection is missing");
  assert.match(head, /if \(!split\) \{/);
});

test("a share past the person's own offer reads as over-allocation", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const cell = functionSource(APP, "reportShareCell");
  assert.ok(cell.length > 0, "reportShareCell is missing");
  // The mark is decided on the same whole figure the cell prints, as the grid
  // decides it for a row head's assigned figure, so a 101% cell can never be
  // left plain and a printout can never disagree with its own colour.
  assert.match(cell, /var shown = Math\.round\(value \* 100\);/);
  assert.match(cell, /shown > 100 \? cls \+ " is-over" : cls/);
  // Every bucket cell, each row's Total and the Total row's own cells take it:
  // the pressure the view exists to show is marked wherever it appears.
  const table = functionSource(APP, "reportAllocationPersonSection");
  assert.ok(table.length > 0, "reportAllocationPersonSection is missing");
  assert.match(table, /r\.cells\.forEach\(function \(v\) \{ cells\.push\(reportShareCell\(v\)\); \}\);/);
  assert.match(table, /cells\.push\(reportShareCell\(r\.total, true\)\);/);
  assert.match(table, /model\.allocationByPerson\.total\.cells\.forEach\(function \(v\) \{ totalCells\.push\(reportShareCell\(v\)\); \}\);/);
  assert.match(table, /totalCells\.push\(reportShareCell\(model\.allocationByPerson\.total\.total, true\)\);/);
  // The grid's own over-allocated figure and this cell read in the one signal
  // colour, so the same fact never wears two colours.
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const grid = STYLE.match(/\.rowhead__fig\.is-over\s*\{([^}]*)\}/);
  const share = STYLE.match(/\.report-table__num\.is-over\s*\{([^}]*)\}/);
  assert.ok(grid, "the grid's over-allocation rule is missing");
  assert.ok(share, "the share cell's over-allocation rule is missing");
  assert.match(grid[1], /color:\s*var\(--signal\);/);
  assert.match(share[1], /color:\s*var\(--signal\);/);
});

test("a bucket a person offers nothing in reads as the report's missing figure", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const cell = functionSource(APP, "reportShareCell");
  assert.ok(cell.length > 0, "reportShareCell is missing");
  // No offer is no share: the cell takes the dash a figure with no value takes,
  // ahead of the rounding, so it can never print Infinity or a 0% that claims
  // the person was free.
  assert.match(cell, /if \(typeof value !== "number" \|\| !isFinite\(value\)\) return \{ text: "-", cls: cls \};/);
  assert.ok(cell.indexOf('text: "-"') < cell.indexOf("Math.round"), "the dash is decided after the rounding");
  // One missing figure in the report, not a second convention beside it.
  assert.match(APP, /function reportFigure\(value\) \{\n  if \(!isFinite\(value\)\) return "-";/);
});

/* --- allocation by project (issue #169) ---------------------------------- */

test("the allocation-by-project table heads the buckets and Total, and no Of plan", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const table = functionSource(APP, "reportAllocationProjectSection");
  assert.ok(table.length > 0, "reportAllocationProjectSection is missing");
  const heads = table.match(/var headers = \[[\s\S]*?\n  var rows/);
  assert.ok(heads, "the allocation-by-project table has no headers");
  const head = heads[0];
  // Project, the buckets, Total: the same table as the tag view with a project
  // where a tag was, so Of plan - a share of delivered work - stays out of it.
  assert.match(head, /\{ text: "Project", cls: "report-table__name" \}/);
  assert.match(head, /\.concat\(reportBucketHeaders\(model\)\)/);
  assert.match(head, /\{ text: "Total", cls: REPORT_TOTAL_COL \}/);
  assert.equal((head.match(/\{ text: "([^"]*)"/g) || []).length, 2,
    "the allocation-by-project table heads a column the rule does not name");
  assert.doesNotMatch(table, /Of plan|Of offer|reportPercent/);
  // Three tables head Of plan, unchanged: this view adds no fourth copy.
  assert.equal((APP.match(/\{ text: "Of plan", cls: "report-table__num" \}/g) || []).length, 3);
});

test("a project's share wears the cell, the colour mark and the total its siblings do", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const table = functionSource(APP, "reportAllocationProjectSection");
  assert.ok(table.length > 0, "reportAllocationProjectSection is missing");
  // The very cell the person and tag views draw, in all four places a figure
  // lands: the same whole-percentage rounding, the same signal mark past 100%,
  // the same dash where the plan offers nothing. No second share style.
  assert.equal((table.match(/reportShareCell\(/g) || []).length, 4,
    "a project's figure is drawn by some other rule");
  assert.match(table, /r\.cells\.forEach\(function \(v\) \{ cells\.push\(reportShareCell\(v\)\); \}\);/);
  assert.match(table, /cells\.push\(reportShareCell\(r\.total, true\)\);/);
  assert.match(table,
    /model\.allocationByProject\.total\.cells\.forEach\(function \(v\) \{ totalCells\.push\(reportShareCell\(v\)\); \}\);/);
  assert.match(table, /totalCells\.push\(reportShareCell\(model\.allocationByProject\.total\.total, true\)\);/);
  // A project is marked as the by-project table marks it: its own palette
  // colour, not a tag slot and not a person's resolved one.
  assert.match(table, /reportNameCell\(r\.name, r\.colour\)/);
  // And it draws no tag chooser: the rows are the projects, not a selection.
  assert.doesNotMatch(table, /reportTagSplit|reportNothingSelected/);
});

/* --- allocation by tag (issue #170) --------------------------------------- */

test("the allocation-by-tag table heads the buckets and Total, and no Of plan", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const table = functionSource(APP, "reportAllocationTagSection");
  assert.ok(table.length > 0, "reportAllocationTagSection is missing");
  const heads = table.slice(table.indexOf("var headers"), table.indexOf("var split"));
  // Name, the buckets, Total: this is a share of the capacity the plan offers,
  // so the Of plan column - a share of delivered work - stays out of it and the
  // pair of denominators the tables were cleaned of does not come back.
  assert.match(heads, /\{ text: "Tag", cls: "report-table__name" \}/);
  assert.match(heads, /\.concat\(reportBucketHeaders\(model\)\)/);
  assert.match(heads, /\{ text: "Total", cls: REPORT_TOTAL_COL \}/);
  assert.equal((heads.match(/\{ text: "([^"]*)"/g) || []).length, 2,
    "the allocation-by-tag table heads a column the rule does not name");
  assert.doesNotMatch(table, /Of plan|Of offer|reportPercent/);
  // Three tables head Of plan and this view adds no fourth copy of it.
  assert.equal((APP.match(/\{ text: "Of plan", cls: "report-table__num" \}/g) || []).length, 3);
});

test("a tag's share wears the person view's over-allocation and missing figure", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const table = functionSource(APP, "reportAllocationTagSection");
  assert.ok(table.length > 0, "reportAllocationTagSection is missing");
  // The very cell the person view draws, in all four places a figure lands: the
  // same whole-percentage rounding, the same signal mark past 100%, the same
  // dash where the plan offers nothing. No second share style beside it.
  assert.equal((table.match(/reportShareCell\(/g) || []).length, 4,
    "a tag's figure is drawn by some other rule");
  assert.match(table, /r\.cells\.forEach\(function \(v\) \{ cells\.push\(reportShareCell\(v\)\); \}\);/);
  assert.match(table, /cells\.push\(reportShareCell\(r\.total, true\)\);/);
  assert.match(table, /split\.total\.cells\.forEach\(function \(v\) \{ totalCells\.push\(reportShareCell\(v\)\); \}\);/);
  assert.match(table, /totalCells\.push\(reportShareCell\(split\.total\.total, true\)\);/);
  // And a tag is marked as the TAGS column and the FTE-days view mark it: its
  // own colour slot where it has one, nothing where it has none.
  assert.match(table, /reportNameCell\(r\.label, r\.slot\)/);
});

test("one stored selection serves both tag views, and one line says it is empty", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  ["reportTagSection", "reportAllocationTagSection"].forEach((name) => {
    const source = functionSource(APP, name);
    assert.ok(source.length > 0, name + " is missing");
    // The same chooser, writing the plan's own `tagSplit`, so a tag ticked in
    // either view is ticked in both.
    assert.match(source, /section\.appendChild\(reportTagSplit\(\)\);/, name);
    // And the same sentence where nothing is ticked, from one definition.
    assert.match(source, /reportNothingSelected\(\)/, name);
  });
  assert.equal((APP.match(/Nothing is selected yet - tick the tags the rows should split by\./g) || []).length, 1,
    "the empty selection's line has a second copy");
});

test("the by-project table carries the project's tags, and the by-person table has none", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const person = functionSource(APP, "reportPersonSection");
  const project = functionSource(APP, "reportProjectSection");
  assert.ok(person.length > 0 && project.length > 0, "a table is missing");
  // The by-project table keeps the tags column: the head class, the list helper,
  // and the empty cell on the Total row.
  assert.match(project, /\{ text: "Tags", cls: "report-table__tags" \}/);
  assert.match(project, /cells\.push\(\{ node: reportTagList\(r\.tags\), cls: "report-table__tags" \}\);/);
  assert.match(project, /totalCells\.push\(\{ text: "", cls: "report-table__tags" \}\);/);
  // The by-person table ends at Of offer: the owner asked for the column back
  // out (#166), so no head, no row cell and no Total-row placeholder remain.
  assert.equal((person.match(/report-table__tags/g) || []).length, 0,
    "the by-person table still carries the tags column");
  assert.doesNotMatch(person, /reportTagList/);
  assert.doesNotMatch(person, /"Tags"/);
  // Both tables keep their tags list: the one helper still describes a Person's
  // tags too, which the by-person table's colour mark reads.
  assert.match(functionSource(APP, "reportTagList"), /none/);
});

test("each person table marks a person with the colour the grid marks them with", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const person = functionSource(APP, "reportPersonSection");
  // The grid's own row head resolves a Person's slot from the people key; the
  // table passes that same resolution, so the two marks cannot disagree.
  assert.match(APP, /var markSlot = personSlot\(person\.tags, tagKeyMap, tagSlotMap\);/);
  assert.match(person, /reportNameCell\(r\.name, personSlot\(r\.tags, tagKeyMap, tagSlotMap\)\)/);
  // No slot in place of the resolved one: a Person with no colour under the
  // people key keeps no swatch rather than wearing a wrong one.
  assert.doesNotMatch(person, /reportNameCell\(r\.name, null\)/);
  // The share table beside it is the third caller, and resolves the slot the
  // same way, so the pair of person tables cannot disagree either.
  assert.match(functionSource(APP, "reportAllocationPersonSection"),
    /reportNameCell\(r\.name, personSlot\(r\.tags, tagKeyMap, tagSlotMap\)\)/);
  assert.equal((APP.match(/personSlot\(/g) || []).length, 3,
    "a caller resolves a person's colour some other way");
});

test("all three tables order their columns the same way", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // Name, the buckets, Total, Of plan, then the extras each view adds.
  const COMMON = [
    'cls: "report-table__name" }',
    "reportBucketHeaders(model)",
    "cls: REPORT_TOTAL_COL }",
    '{ text: "Of plan"'
  ];
  const EXTRAS = {
    reportProjectSection: ['{ text: "Tags", cls: "report-table__tags" }'],
    reportPersonSection: ['{ text: "Of offer"'],
    reportTagSection: []
  };
  Object.keys(EXTRAS).forEach((name) => {
    const pivot = functionSource(APP, name);
    assert.ok(pivot.length > 0, name + " is missing");
    const marks = COMMON.concat(EXTRAS[name]).map((needle) => {
      const at = pivot.indexOf(needle);
      assert.notEqual(at, -1, name + " has no " + needle + " column");
      return at;
    });
    assert.deepEqual(marks.slice().sort((a, b) => a - b), marks,
      name + " orders its columns against the rule");
  });
  // The by-person table ends at Of offer: no column follows it there, while the
  // by-project table's tags column remains its last one.
  const person = functionSource(APP, "reportPersonSection");
  const personHeads = person.slice(person.indexOf("var headers"), person.indexOf("var rows"));
  const named = (personHeads.match(/\{ text: "([^"]+)"/g) || []);
  assert.equal(named.length, 4, "the by-person table heads a column the rule does not name");
  assert.match(named[3], /Of offer/, "a column follows Of offer in the by-person table");
  const project = functionSource(APP, "reportProjectSection");
  assert.ok(project.lastIndexOf('cls: "report-table__tags"') > project.indexOf('{ text: "Of plan"'),
    "the tags column follows Of plan in the by-project table");
});

test("the report's outline closes up: the rail's h1, then the view's h2", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  const section = APP.slice(APP.indexOf("function reportSection(title, sub) {"),
    APP.indexOf("/* --- the chart,"));
  assert.ok(section.length > 0, "reportSection is missing");
  // The only heading the content draws is the section's own, one level under
  // the rail's h1: no h3 hangs beneath a title that is no longer there.
  assert.match(section, /el\("h2", "report__heading"\)/);
  assert.doesNotMatch(APP, /el\("h3"/);
  const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  ["report__head", "report__title", "report__lead"].forEach((name) => {
    assert.doesNotMatch(STYLE, new RegExp("\\." + name + "\\b"), name + " rule is still styled");
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
    "availabilityLines",
    "assignments",
    "dividers",
    "minimap",
    "marker",
    "blockLabel",
    "reset-view"
  ]);
  // Block label names what a block says, and a report page draws no blocks at
  // all, so it has nothing to act on there.
  // The plan-facing entries - the period, the step, the palette, Sprints, the
  // Holidays panel, the Plan file panel - Help and Show archived, which acts on
  // the rail, all stay live in a report.
  ["help", "archived", "palette", "range", "step", "sprints", "plan-file"].forEach((key) => {
    assert.equal(reportDisabledOptionKeys().includes(key), false, key + " must stay live");
  });
  // Milestones acts on a report too: its chart draws the rules, so the row
  // stays live there and the one switch governs the chart and the grid alike.
  assert.equal(reportDisabledOptionKeys().includes("milestones"), false,
    "a report can no longer switch the milestones it draws");
});

/* --- the milestones, on the chart and nowhere else ------------------------ */

test("the chart is the only report view that shows a milestone", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // The seven views' builders, from the section that names them to the render
  // that draws one: no row, no column and no figure mentions a milestone.
  const start = APP.indexOf("/* --- the seven views");
  const end = APP.indexOf("function render(opts)");
  assert.ok(start > -1 && end > start, "the seven views are missing");
  assert.doesNotMatch(APP.slice(start, end), /milestone/i,
    "a report view other than the chart draws a milestone");
  // And no milestone reaches the figures either: the report's own content is
  // built from the plan's work, never from its annotations.
  const content = fs.readFileSync(path.join(PUBLIC, "lib", "report-content.mjs"), "utf8");
  assert.doesNotMatch(content, /milestone/i, "the report's figures count a milestone");
});

test("the chart and the grid read one stored Milestones switch", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  // One setting, restored on load and stored back, for both pages: the report
  // page adopts the same key the grid does rather than keeping a second one.
  assert.equal((APP.match(/var milestoneRules = /g) || []).length, 1);
  assert.match(APP, /milestoneRules = v\.milestones;/);
  assert.match(APP, /milestones: milestoneRules,/);
  // And one answer to "are they drawn": the chart draws from the grid's own
  // marks and asks that answer, so neither surface can be showing while the
  // other is not.
  const drawn = APP.slice(APP.indexOf("function milestonesDrawn()"));
  const body = drawn.slice(0, drawn.indexOf("\n}\n"));
  assert.match(body, /return milestoneRules && milestoneMarkList\.length > 0;/);
  const chart = APP.slice(APP.indexOf("function reportChartMilestones("),
    APP.indexOf("function reportChartAxis("));
  assert.match(chart, /milestoneMarkList, milestonesDrawn\(\)/);
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
  const dir = tempDir();
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
  const chosen = await post(started.base, "/api/view", { reportView: "allocation-by-tag" });
  assert.equal(chosen.reportView, "allocation-by-tag");
  // One collapsed key for both pages: collapsing the report's panel is the same
  // setting the grid's rail reads.
  const folded = await post(started.base, "/api/view", { stackCollapsed: true });
  assert.equal(folded.reportView, "allocation-by-tag");
  assert.equal(folded.stackCollapsed, true);
  // A view that no longer exists opens the report on its default - the view
  // removed in #171 included - and leaves the rest of the view alone.
  for (const gone of ["by-chart", "by-tag-over-time"]) {
    const stale = await post(started.base, "/api/view", { reportView: gone });
    assert.equal(stale.reportView, "by-project", gone);
    assert.equal(stale.stackCollapsed, true, gone);
  }
});
