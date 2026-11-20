/*
 * The in-app help: the two documents it may serve, the route that serves them,
 * the rule that ranks a search, and the proof that the renderer draws every
 * construct those two documents actually contain.
 *
 * The documents are read here from the repository itself rather than from
 * fixtures, because the point of the help is that it shows the documentation
 * that ships. A construct added to `docs/features.md` or `GLOSSARY.md` that the
 * subset renderer does not draw turns this file red, which is the whole reason
 * the subset is a list (`MARKDOWN_CONSTRUCTS`) instead of a promise. So does a
 * link between the two documents pointing at a heading that is not there.
 *
 * What this cannot do is read the panel: that the menu's `Help...` entry opens
 * it, that Escape closes it and focus goes back, that the grid has not moved,
 * and that a press
 * on a switch marks it and moves the document, that the switches are reachable
 * by keyboard, and that a query survives the switch are checked in a browser,
 * not here. What is checked here is the material the panel is built from - the
 * documents, the search and the HTML - and the script and stylesheet the panel
 * is drawn by, read as the text they are.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { scratch } from "../test-support/scratch.mjs";
import { MARKDOWN_CONSTRUCTS, resolveHelpTarget, slugFor, termOf } from "../public/lib/markdown.mjs";
import {
  HELP_DOCUMENTS,
  HELP_DOCUMENT_DEFAULT,
  HELP_RESULT_LIMIT,
  helpAnchors,
  helpDocument,
  helpSections,
  renderHelpDocument,
  searchHelp
} from "../public/lib/help.mjs";
import { reportDisabledControlIds, topbarMarkup } from "../public/lib/topbar.mjs";
import { helpItem, optionDividerKeys, optionGroups, optionsItems, reportDisabledOptionKeys } from "../public/lib/options.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PUBLIC = path.join(ROOT, "public");
const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");

function read(key) {
  return fs.readFileSync(path.join(ROOT, helpDocument(key).path), "utf8");
}

// The two documents as the panel fetches them, in the allowlist's own order.
function documents() {
  return HELP_DOCUMENTS.map(function (entry) {
    return { key: entry.key, label: entry.label, markdown: read(entry.key) };
  });
}

const FEATURES = read("features");
const GLOSSARY = read("glossary");

/* --- the allowlist -------------------------------------------------------- */

test("the help may read exactly two documents, by name", () => {
  assert.deepEqual(HELP_DOCUMENTS.map((entry) => entry.key), ["features", "glossary"]);
  assert.deepEqual(HELP_DOCUMENTS.map((entry) => entry.path), ["docs/features.md", "GLOSSARY.md"]);
  assert.equal(HELP_DOCUMENT_DEFAULT, "features", "a first visit starts on the feature reference");
});

test("a name that is not on the allowlist resolves to nothing", () => {
  const refused = [
    "",
    "readme",
    "docs/features.md",
    "../README.md",
    "../GLOSSARY.md",
    "../../etc/passwd",
    "features/../../README.md",
    null,
    undefined,
    42
  ];
  for (const name of refused) {
    assert.equal(helpDocument(name), null, String(name));
  }
  assert.equal(helpDocument("features").label, "Feature reference");
  assert.equal(helpDocument("glossary").label, "Glossary");
});

/* --- the route ------------------------------------------------------------ */

const tempDir = scratch("help");
const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((done) => s.close(done)))));

function startServer(publicDir) {
  const store = createStore(path.join(tempDir(), "pact.json"));
  const server = createServer(store, publicDir ? { publicDir: publicDir } : undefined);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve("http://127.0.0.1:" + server.address().port);
    });
  });
}

async function get(base, urlPath, method) {
  const res = await fetch(base + urlPath, { method: method || "GET" });
  let body = null;
  try {
    body = await res.json();
  } catch (_) {
    body = null;
  }
  return { status: res.status, body };
}

test("the route serves each allowed document, and the file as it stands now", async () => {
  const base = await startServer();
  for (const entry of HELP_DOCUMENTS) {
    const res = await get(base, "/api/help/" + entry.key);
    assert.equal(res.status, 200);
    assert.equal(res.body.key, entry.key);
    assert.equal(res.body.label, entry.label);
    assert.equal(res.body.path, entry.path);
    // Read at request time: the answer is the file on disk, not a copy of it.
    assert.equal(res.body.markdown, fs.readFileSync(path.join(ROOT, entry.path), "utf8"));
  }
});

test("the route refuses every name the allowlist does not carry", async () => {
  const base = await startServer();
  const refused = [
    "/api/help",
    "/api/help/",
    "/api/help/readme",
    "/api/help/docs/features.md",
    "/api/help/../README.md",
    "/api/help/..%2F..%2Fetc%2Fpasswd",
    "/api/help/features%2F..%2F..%2FREADME.md",
    "/api/help/FEATURES"
  ];
  for (const urlPath of refused) {
    const res = await get(base, urlPath);
    assert.equal(res.status, 404, urlPath);
    assert.equal(typeof res.body.error, "string", urlPath);
    assert.equal(res.body.markdown, undefined, urlPath);
  }
});

test("the help route answers GET and nothing else, and never writes", async () => {
  const base = await startServer();
  for (const method of ["POST", "PATCH", "DELETE", "PUT"]) {
    const res = await get(base, "/api/help/features", method);
    assert.equal(res.status, 405, method);
  }
});

/* --- sections ------------------------------------------------------------- */

test("the feature reference sections at its own headings, its opening first", () => {
  const sections = helpSections(FEATURES);
  const headings = [...FEATURES.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(sections.slice(1).map((section) => section.title), headings);
  assert.equal(sections[0].title, "PACT feature reference", "the opening is named by the document's title");
  assert.equal(sections[0].anchor, "pact-feature-reference");
});

test("the glossary sections at its terms, and its group heading is not a term", () => {
  const sections = helpSections(GLOSSARY);
  const terms = GLOSSARY.split("\n").map((line) => termOf(line)).filter(Boolean);
  assert.deepEqual(sections.slice(1).map((section) => section.title), terms);
  assert.equal(sections[0].title, "PACT", "the opening is named by the document's title");
  assert.equal(sections.every((section) => section.anchor === slugFor(section.title)), true);
  assert.equal(sections.filter((section) => section.title === "Language").length, 0,
    "the glossary's ## Language heading carries nothing of its own");
});

test("no two sections of one document claim the same anchor", () => {
  for (const entry of HELP_DOCUMENTS) {
    const anchors = helpAnchors(read(entry.key));
    assert.deepEqual([...new Set(anchors)], anchors, entry.key);
  }
});

/* --- the search and its ranking ------------------------------------------- */

test("a heading's own match ranks above a section that only mentions the term", () => {
  const results = searchHelp(documents(), "assignment");
  assert.ok(results.length > 0, "assignment matches nothing");
  const firstBody = results.findIndex((result) => result.matched === "body");
  const lastTitle = results.map((result) => result.matched).lastIndexOf("title");
  assert.ok(lastTitle !== -1, "no heading matched assignment");
  if (firstBody !== -1) assert.ok(lastTitle < firstBody, "a body match ranked with the heading matches");
  // The issue's own two examples, both found by their own title.
  const titles = results.filter((result) => result.matched === "title").map((result) => result.title);
  assert.ok(titles.includes("Assignments"), titles.join(", "));
  assert.ok(titles.includes("Assignment"), titles.join(", "));
});

test("the search finds a section by its heading, and a glossary term by its own name", () => {
  const tagHits = searchHelp(documents(), "tags");
  assert.ok(tagHits.some((hit) => hit.doc === "features" && hit.title === "Tags, typed tags and colour by key"));
  assert.ok(tagHits.every((hit, index) => index === 0 || hit.rank >= tagHits[index - 1].rank));
  // `ruler` names a section of the reference and a glossary term, and both are
  // found by their own title rather than by a mention.
  const ruler = searchHelp(documents(), "ruler");
  const titles = ruler.map((hit) => hit.doc + ": " + hit.title);
  assert.ok(titles.includes("features: The chart and its ruler"), titles.join(", "));
  assert.ok(titles.includes("glossary: Ruler"), titles.join(", "));
  assert.equal(ruler.every((hit) => hit.matched === "title"), true);
});

test("the search is case-insensitive and reads the body, not only the headings", () => {
  const lower = searchHelp(documents(), "minimap");
  const upper = searchHelp(documents(), "TIMELINE");
  const mixed = searchHelp(documents(), "Timeline");
  assert.deepEqual(upper, mixed);
  assert.ok(lower.some((hit) => hit.matched === "body"), "a body-only match is missing");
});

test("one result per section, carrying the line that matched", () => {
  const results = searchHelp(documents(), "the");
  const keys = results.map((hit) => hit.doc + "#" + hit.anchor);
  assert.deepEqual([...new Set(keys)], keys, "a section produced two results");
  for (const hit of results.filter((entry) => entry.matched === "body")) {
    assert.match(hit.line.toLowerCase(), /the/, hit.title);
    assert.ok(hit.line.length <= 160, "a result's line is short enough for one row: " + hit.line.length);
  }
  for (const hit of results.filter((entry) => entry.matched === "title")) {
    assert.equal(hit.line, hit.title, "a heading match quotes the heading it matched in");
  }
});

test("a quoted line is the words it reads as, not the Markdown it was written in", () => {
  const body = searchHelp(documents(), "assignment").filter((hit) => hit.matched === "body");
  assert.ok(body.length > 0, "no body match for assignment");
  for (const hit of body) {
    assert.match(hit.line.toLowerCase(), /assignment/, hit.line);
    assert.doesNotMatch(hit.line, /\*\*|`|\]\(/, hit.line);
  }
  // A code span reads as its words, so a control's own name is quoted plainly.
  const reset = searchHelp(documents(), "reset view").find((hit) => hit.matched === "body");
  assert.ok(reset, "no body match for reset view");
  assert.match(reset.line, /Reset view/);
  assert.doesNotMatch(reset.line, /`/);
});

test("results stay in reading order within each rank, the reference first", () => {
  const results = searchHelp(documents(), "the");
  const order = results.map((hit) => hit.rank * 1000 + HELP_DOCUMENTS.findIndex((entry) => entry.key === hit.doc));
  assert.deepEqual(order, order.slice().sort((a, b) => a - b));
});

test("an empty or blank search returns nothing rather than everything", () => {
  assert.deepEqual(searchHelp(documents(), ""), []);
  assert.deepEqual(searchHelp(documents(), "   "), []);
  assert.deepEqual(searchHelp(documents(), null), []);
});

test("a search with no match returns no result", () => {
  assert.deepEqual(searchHelp(documents(), "zzqq-nothing-matches-this"), []);
});

test("the panel lists at most the stated number of results", () => {
  assert.equal(HELP_RESULT_LIMIT, 40);
  assert.ok(searchHelp(documents(), "the").length > 0);
});

/* --- links between the two documents -------------------------------------- */

function linksIn(markdown) {
  return [...markdown.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

test("every link in the two documents resolves to a section the help can open", () => {
  const anchors = {
    features: helpAnchors(FEATURES),
    glossary: helpAnchors(GLOSSARY)
  };
  const unresolved = [];
  for (const entry of HELP_DOCUMENTS) {
    const markdown = read(entry.key);
    for (const target of linksIn(markdown)) {
      const resolved = resolveHelpTarget(target, { path: entry.path, documents: HELP_DOCUMENTS });
      if (!resolved) {
        unresolved.push(entry.key + ": " + target + " (not a help document)");
        continue;
      }
      if (resolved.anchor && !anchors[resolved.doc].includes(resolved.anchor)) {
        unresolved.push(entry.key + ": " + target + " (no such heading)");
      }
    }
  }
  assert.deepEqual(unresolved, [], "these links would be dead ends in the panel");
});

test("a link between the documents is drawn as a control, and a link away as text", () => {
  // Every link target the documents use points between the two, so every one of
  // them must be followable inside the panel.
  for (const entry of HELP_DOCUMENTS) {
    const html = renderHelpDocument(helpDocument(entry.key), read(entry.key), null, "help-");
    const drawn = (html.match(/class="md-link"/g) || []).length;
    assert.equal(drawn, linksIn(read(entry.key)).length, entry.key);
    assert.doesNotMatch(html, /class="md-plainlink"/, entry.key);
  }
});

/* --- the renderer against the real documents ------------------------------ */

// The constructs a document actually contains, so a construct the subset does
// not list fails here rather than shipping as a run of asterisks.
function constructsIn(markdown) {
  const found = new Set(["paragraph"]);
  if (/^---\n/.test(markdown)) found.add("frontmatter");
  for (const line of markdown.split("\n")) {
    if (/^#{1,6}\s/.test(line)) found.add("heading");
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) found.add("rule");
    if (/^\s*[-*+]\s+\S/.test(line)) found.add("unordered-list");
    if (/^\s*\d+[.)]\s+\S/.test(line)) found.add("ordered-list");
    if (/^\s*\|/.test(line)) found.add("table");
    if (/`[^`\n]+`/.test(line)) found.add("code");
    if (/\*\*[^*\n]+\*\*/.test(line) || /(^|\s)_[^_\n]+_/.test(line)) found.add("emphasis");
    if (/\[[^\]\n]*\]\([^)\s]+\)/.test(line)) found.add("link");
  }
  return [...found].sort();
}

test("the documents use only constructs the subset names", () => {
  for (const entry of HELP_DOCUMENTS) {
    const used = constructsIn(read(entry.key));
    const unsupported = used.filter((construct) => !MARKDOWN_CONSTRUCTS.includes(construct));
    assert.deepEqual(unsupported, [], entry.key + " uses a construct the renderer does not draw");
  }
});

test("the documents really do use the constructs worth checking", () => {
  // Guards the check above from passing because the documents happen to be
  // plain prose today.
  const used = constructsIn(FEATURES).concat(constructsIn(GLOSSARY));
  for (const construct of ["frontmatter", "heading", "paragraph", "unordered-list", "link", "emphasis", "code"]) {
    assert.ok(used.includes(construct), "no " + construct + " found in the documents");
  }
});

test("the renderer draws every construct both documents contain", () => {
  for (const entry of HELP_DOCUMENTS) {
    const markdown = read(entry.key);
    const html = renderHelpDocument(helpDocument(entry.key), markdown, null, "help-");

    // Headings: each one, at its own rank, with the anchor its links use.
    for (const match of markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)) {
      const rank = match[1].length;
      assert.match(html, new RegExp('<h' + rank + ' class="md-h md-h' + rank + '" id="help-' +
        slugFor(match[2]) + '">'), entry.key + ": " + match[2]);
    }

    // Paragraphs, code spans, emphasis and lists.
    assert.ok((html.match(/<p[ >]/g) || []).length > 0, entry.key + " drew no paragraph");
    assert.ok((html.match(/<code class="md-code">/g) || []).length >= (markdown.match(/`[^`\n]+`/g) || []).length,
      entry.key + " lost a code span");
    assert.ok((html.match(/<strong>/g) || []).length >= (markdown.match(/\*\*[^*\n]+\*\*/g) || []).length,
      entry.key + " lost an emphasis");
    const items = markdown.split("\n").filter((line) => /^\s*[-*+]\s+\S/.test(line)).length;
    assert.equal((html.match(/<li>/g) || []).length, items, entry.key + " lost a list item");

    // Nothing is left as raw markup for a reader to trip over.
    assert.doesNotMatch(html, /\*\*/, entry.key + " left ** on screen");
    assert.doesNotMatch(html, /\]\(/, entry.key + " left a link's own syntax on screen");
    assert.doesNotMatch(html, /`/, entry.key + " left a backtick on screen");
    assert.doesNotMatch(html, /_Avoid_/, entry.key + " left the italic's underscores on screen");
    assert.doesNotMatch(html, /^(---|##)/m, entry.key + " drew a heading or a rule as text");
  }
});

test("the glossary's avoid lines read as their own lines", () => {
  const html = renderHelpDocument(helpDocument("glossary"), GLOSSARY, null, "help-");
  const avoidLines = GLOSSARY.split("\n").filter((line) => /^_Avoid_:/.test(line.trim())).length;
  assert.ok(avoidLines > 20, "the glossary has its _Avoid_ lines");
  assert.equal((html.match(/<p class="md-avoid">/g) || []).length, avoidLines);
});

/* --- the entrance --------------------------------------------------------- */

test("the bar carries no help control: the glyph is gone from both pages", () => {
  // One bar, one source: neither page's bar has the `?` that used to open the
  // help, and nothing is left over where it stood.
  ["plan", "report"].forEach((view) => {
    const bar = topbarMarkup(view);
    assert.equal(bar.includes("help-btn"), false, view + " still carries a help control");
    assert.equal(bar.includes("help__btn"), false, view + " still carries the help button's class");
    assert.doesNotMatch(bar, />\s*\?\s*</, view + " still draws a `?` glyph");
    assert.equal(reportDisabledControlIds().includes("help-btn"), false);
  });
  // Nor do the styles it needed, since nothing draws it any more.
  assert.doesNotMatch(STYLE, /\.help__btn/);
  assert.doesNotMatch(STYLE, /\.help__glyph/);
  assert.doesNotMatch(APP, /help-btn/);
});

test("Help is the Options menu's first entry, one divider below it and none above", () => {
  const items = optionsItems(false, false, true, false, false);
  const groups = optionGroups(items);
  assert.deepEqual(groups[0], ["help"]);
  const dividers = optionDividerKeys(items);
  // Its line falls on the row after it, and Help itself carries none.
  assert.equal(dividers.includes("help"), false);
  assert.equal(dividers[0], groups[1][0]);
  assert.equal(dividers.filter((key) => key === groups[1][0]).length, 1);
  assert.match(helpItem().label, /\.\.\.$/);
  // Live on a report: a report's own vocabulary needs the reference too.
  assert.equal(reportDisabledOptionKeys().includes("help"), false);
});

test("the menu's first row is built as an action that opens the panel over the board", () => {
  // Built in buildOptionsMenu ahead of every toggle, from helpItem, as the
  // Sprints, Holidays, Tags and Milestones entries are.
  assert.match(APP, /function buildOptionsMenu\(\) \{[\s\S]{0,600}optionGroupDividers = optionDividerKeys\(items\);[\s\S]{0,200}optionsMenu\.appendChild\(buildHelpItem\(\)\);/);
  assert.match(APP, /function buildHelpItem\(\) \{[\s\S]{0,400}openOptions\(false\);\s*openHelpPanel\(btn\);/);
  assert.match(APP, /btn\.id = "option-help";/);
  assert.match(APP, /btn\.setAttribute\("role", "menuitem"\)/);
  // And the row it opens is the same panel shell as any other panel's.
  assert.match(APP, /function openHelpPanel\(trigger\) \{\n\s+var node = panelShell\("Help"/);
  // Opened, never docked: the panel goes into the shared panel layer, which is
  // what Escape closes and what returns focus to the trigger.
  assert.match(APP, /if \(e\.key === "Escape" && panel\) closePanel\(true\);/);
});

test("the panel is wider than the other panels, and only its text scrolls", () => {
  assert.match(STYLE, /\.panel--help\s*\{[^}]*width:\s*34rem/);
  // The title, the close control and the search field stay put while a section
  // is read, so the close control cannot scroll out of the window.
  assert.match(STYLE, /\.panel--help\s*\{[^}]*overflow:\s*hidden/);
  assert.match(STYLE, /\.help__body\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(STYLE, /\.help__results\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(STYLE, /\.help__result\s*\{[^}]*display:\s*grid/);
  assert.match(STYLE, /\.md-table\s*\{/);
});

/* --- the document switch -------------------------------------------------- */

// The help panel as the script writes it, and one function of it, so a test
// reads what a press really does rather than a summary of it.
function helpPanel() {
  const at = APP.indexOf("function openHelpPanel(trigger)");
  assert.ok(at !== -1, "the help panel is gone");
  const end = APP.indexOf("\n/* The Colour palette disclosure", at);
  assert.ok(end !== -1, "the help panel does not end where the next panel begins");
  return APP.slice(at, end);
}

function helpFunction(source, name, next) {
  const at = source.indexOf("function " + name);
  assert.ok(at !== -1, name + " is gone");
  const end = source.indexOf(next, at);
  assert.ok(end !== -1, next + " is gone after " + name);
  return source.slice(at, end);
}

test("the subtitle row is the switch, named by the allowlist", () => {
  const panel = helpPanel();
  // The panel no longer passes a static subtitle: the row is the switch.
  assert.doesNotMatch(APP, /panelShell\("Help",/);
  // One button per document, each named by the allowlist's own label.
  assert.match(panel, /HELP_DOCUMENTS\.forEach\(function \(entry\) \{[\s\S]{0,300}help__switch-btn/);
  assert.match(panel, /button\.textContent = entry\.label;/);
  assert.match(panel, /switchDocument\(entry\.key\)/);
  // It sits where the subtitle was, over the search field.
  const row = panel.indexOf("node.appendChild(switcher);");
  assert.ok(row !== -1 && row < panel.indexOf("node.appendChild(search);"),
    "the switch is not above the search field");
  assert.doesNotMatch(panel, /"Feature reference"|"Glossary"/, "the switch restates a document's name");
});

test("the open document is the one marked, the way the app marks a page", () => {
  const panel = helpPanel();
  const mark = helpFunction(panel, "markOpen()", "markOpen();\n");
  assert.match(mark, /if \(entry\.key === openKey\) button\.setAttribute\("aria-current", "true"\);/);
  assert.match(mark, /else button\.removeAttribute\("aria-current"\);/);
  // A first visit marks the default document from the start.
  assert.match(panel, /var openKey = HELP_DOCUMENT_DEFAULT;/);
  assert.match(panel, /\n  markOpen\(\);\n/);
  // Following a link between the documents moves the marking with the text.
  const show = helpFunction(panel, "showDocument(key, anchorId)", "function switchDocument");
  assert.match(show, /openKey = key;\n\s+markOpen\(\);/);
  // One treatment for "this is the one showing", not a third: the switch's
  // marked rule is the report rail's own, at the panel's scale.
  const rail = STYLE.match(/\.report-nav__item\[aria-current\]\s*\{([^}]*)\}/);
  const marked = STYLE.match(/\.help__switch-btn\[aria-current\]\s*\{([^}]*)\}/);
  assert.ok(rail && marked, "a switch's marking rule is missing");
  assert.equal(marked[1], rail[1], "the switch invents a marking of its own");
  assert.match(STYLE, /\.help__switch\s*\{[^}]*display:\s*inline-flex/);
  // The row is a flex item in the panel's column, so it is told not to shrink:
  // a squeezed switch would be a control with no height.
  assert.match(STYLE, /\.help__switch\s*\{[^}]*flex:\s*0 0 auto/);
});

test("a typed query survives a switch and runs against the document now open", () => {
  const panel = helpPanel();
  const switched = helpFunction(panel, "switchDocument(key)", "function resultButton");
  // The press changes the document and nothing else about the field.
  assert.match(switched, /openKey = key;\n\s+markOpen\(\);/);
  assert.doesNotMatch(switched, /search\.value\s*=/, "the switch clears the box");
  assert.doesNotMatch(switched, /body\.innerHTML/, "the switch redraws the text itself");
  // The one search is re-run, and focus stays where the typing is.
  assert.match(switched, /updateSearch\(\);/);
  assert.match(switched, /search\.focus\(\);/);

  const search = helpFunction(panel, "updateSearch()", "search.addEventListener(\"input\"");
  // The query is answered from the open document alone, so a switch changes
  // what is listed rather than listing the same two documents again.
  assert.match(search, /searchHelp\(documents\.filter\(function \(doc\) \{ return doc\.key === openKey; \}\), query\)/);
  // A switch with the box empty draws the document now open at its opening.
  assert.match(search, /if \(renderedKey !== openKey\) renderBody\(null\);/);
  // A result still empties the box: the search that led to it is spent.
  const show = helpFunction(panel, "showDocument(key, anchorId)", "function switchDocument");
  assert.match(show, /search\.value = "";/);
});

test("a search of one document is answered from that document", () => {
  // What the panel hands the unchanged search: one entry, so the results are
  // that document's, in the same rank order.
  const reference = documents().filter((doc) => doc.key === "features");
  const glossary = documents().filter((doc) => doc.key === "glossary");
  const term = searchHelp(glossary, "ruler");
  assert.ok(term.length > 0, "ruler is not in the glossary");
  assert.equal(term.every((hit) => hit.doc === "glossary"), true);
  assert.equal(term.some((hit) => hit.title === "Ruler" && hit.matched === "title"), true);
  const work = searchHelp(reference, "assignment");
  assert.ok(work.length > 0, "assignment is not in the reference");
  assert.equal(work.every((hit) => hit.doc === "features"), true);
  // The ranking rule is untouched: a title match still comes before a mention.
  const firstBody = work.findIndex((hit) => hit.matched === "body");
  const lastTitle = work.map((hit) => hit.matched).lastIndexOf("title");
  if (firstBody !== -1) assert.ok(lastTitle < firstBody);
});

test("the panel still closes on Escape and gives focus back to the glyph", () => {
  // The switch adds a pair of buttons inside the panel and nothing to the
  // layer's own key handling, so the existing close and focus return hold.
  assert.match(APP, /if \(e\.key === "Escape" && panel\) closePanel\(true\);/);
  assert.match(APP, /function closePanel\(restoreFocus\)[\s\S]{0,400}panelTrigger\.focus\(\);/);
  // A switch is a real button, so the keyboard reaches and presses it.
  assert.match(helpPanel(), /var button = el\("button", "help__switch-btn"\);\n\s+button\.type = "button";/);
});
