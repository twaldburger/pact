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
 * What this cannot do is read the panel: that the glyph opens it, that Escape
 * closes it and focus goes back, and that the grid has not moved are checked in
 * a browser, not here. What is checked here is the material the panel is built
 * from - the documents, the search and the HTML.
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

test("the glyph sits between the redo control and the Options glyph", () => {
  const bar = topbarMarkup("plan");
  const historyAt = bar.search(/<div class="history"/);
  const helpAt = bar.search(/id="help-btn"/);
  const optionsAt = bar.search(/<div class="options"/);
  assert.ok(historyAt !== -1 && helpAt !== -1 && optionsAt !== -1);
  assert.ok(historyAt < helpAt && helpAt < optionsAt, "the help glyph is not where the bar says it is");
  assert.match(bar, /<button type="button" class="ghost help__btn" id="help-btn"\s+aria-haspopup="dialog" aria-label="Help" title="[^"]+">/);
  // A report keeps it: the report's own vocabulary needs the reference too.
  assert.equal(reportDisabledControlIds().includes("help-btn"), false);
  assert.equal(topbarMarkup("report").includes('id="help-btn"'), true);
});

test("the glyph is sized like the control beside it", () => {
  assert.match(STYLE, /\.help__btn\s*\{[^}]*min-width:\s*var\(--control-h\)/);
  assert.match(STYLE, /\.help__btn\s*\{[^}]*padding:\s*0/);
});

test("the panel is the app's own panel shell, over the board", () => {
  assert.match(APP, /function openHelpPanel\(trigger\) \{\n\s+var node = panelShell\("Help"/);
  assert.match(APP, /getElementById\("help-btn"\)[\s\S]{0,200}openHelpPanel\(e\.currentTarget\)/);
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
