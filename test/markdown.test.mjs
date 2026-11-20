/*
 * The Markdown subset the in-app help draws, construct by construct.
 *
 * The help shows `docs/features.md` and `GLOSSARY.md` in a panel, so every
 * construct those two documents use has to come out as something a reader can
 * read. This file checks the renderer against each construct on its own - the
 * ones the documents use today and the ones the subset promises - and
 * `test/help.test.mjs` checks the same renderer against the real documents.
 *
 * Tables and ordered lists are drawn but not yet used by either document: they
 * are in the subset because the reference will grow them, and a help surface
 * that draws a table as a row of pipes would look broken the first time one
 * appeared. They are checked here with their own text.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKDOWN_CONSTRUCTS,
  escapeHtml,
  plainText,
  renderMarkdown,
  resolveHelpTarget,
  slugFor,
  splitFrontMatter,
  termOf
} from "../public/lib/markdown.mjs";

// The two documents the help may link between, as the caller hands them over.
const DOCUMENTS = [
  { key: "features", label: "Feature reference", path: "docs/features.md" },
  { key: "glossary", label: "Glossary", path: "GLOSSARY.md" }
];

// The reference, drawn as the panel draws it.
function renderFeatures(markdown, extra) {
  return renderMarkdown(markdown, {
    doc: "features",
    path: "docs/features.md",
    documents: DOCUMENTS,
    ...extra
  });
}

function renderGlossary(markdown, extra) {
  return renderMarkdown(markdown, {
    doc: "glossary",
    path: "GLOSSARY.md",
    documents: DOCUMENTS,
    ...extra
  });
}

test("the subset names every construct it promises to draw", () => {
  assert.deepEqual([...MARKDOWN_CONSTRUCTS].sort(), [
    "code",
    "emphasis",
    "frontmatter",
    "heading",
    "link",
    "ordered-list",
    "paragraph",
    "rule",
    "table",
    "unordered-list"
  ]);
});

/* --- front matter --------------------------------------------------------- */

test("a page's front matter is metadata, and is stripped rather than drawn", () => {
  const page = ["---", "type: Reference", "title: PACT feature reference", "---", "", "# PACT feature reference", "", "Opening prose."].join("\n");
  const { fields, body } = splitFrontMatter(page);
  assert.deepEqual(fields, { type: "Reference", title: "PACT feature reference" });
  assert.equal(body.trim().startsWith("# PACT feature reference"), true);
  const html = renderFeatures(page);
  assert.doesNotMatch(html, /type: Reference/);
  assert.doesNotMatch(html, /md-rule/, "the front matter's own dashes are not a rule");
  assert.match(html, /<h1 [^>]*>PACT feature reference<\/h1>/);
});

test("a page with no front matter is returned whole", () => {
  const page = "# PACT\n\nPeople Allocation & Capacity Tracker.";
  assert.deepEqual(splitFrontMatter(page), { fields: {}, body: page });
});

/* --- headings ------------------------------------------------------------- */

test("a heading is drawn at its own rank, with an anchor from its words", () => {
  const html = renderFeatures("# PACT feature reference\n\n## The Options menu\n\n### A deeper heading\n");
  assert.match(html, /<h1 class="md-h md-h1" id="pact-feature-reference">PACT feature reference<\/h1>/);
  assert.match(html, /<h2 class="md-h md-h2" id="the-options-menu">The Options menu<\/h2>/);
  assert.match(html, /<h3 class="md-h md-h3" id="a-deeper-heading">A deeper heading<\/h3>/);
});

test("an anchor drops punctuation and turns the spaces into hyphens", () => {
  // The rule the documents' own links already use: `#the-reports-time-buckets`
  // is what `## The report's time buckets` must answer to.
  assert.equal(slugFor("The report's time buckets"), "the-reports-time-buckets");
  assert.equal(slugFor("FTE-day"), "fte-day");
  assert.equal(slugFor("Tags, typed tags and colour by key"), "tags-typed-tags-and-colour-by-key");
  assert.equal(slugFor("The Filter and its Look-in scope"), "the-filter-and-its-look-in-scope");
  assert.equal(slugFor("`Plan file...`"), "plan-file");
  assert.equal(slugFor("**Person**:"), "person");
});

test("the anchor prefix keeps a heading out of the page's own element ids", () => {
  const html = renderFeatures("## Filter\n", { idPrefix: "help-" });
  assert.match(html, /id="help-filter"/);
});

/* --- paragraphs and inline emphasis -------------------------------------- */

test("hard-wrapped prose joins back into one paragraph", () => {
  const html = renderFeatures("The plan is one JSON file holding the plan period,\nthe People, the Projects.\n\nA second paragraph.\n");
  assert.deepEqual(html.split("\n"), [
    "<p>The plan is one JSON file holding the plan period, the People, the Projects.</p>",
    "<p>A second paragraph.</p>"
  ]);
});

test("a code span that spans a line break comes back as one span", () => {
  const html = renderFeatures("The field at the left of the top bar; the `in N\nareas` button beside it.\n");
  assert.match(html, /<code class="md-code">in N areas<\/code>/);
});

test("inline emphasis is drawn for both spellings, and for a code span", () => {
  const html = renderFeatures("**Where the controls are.** The `+` in the header.\n\n_Avoid_: resource, user\n");
  assert.match(html, /<strong>Where the controls are.<\/strong> The <code class="md-code">\+<\/code> in the header./);
  assert.match(html, /<p class="md-avoid"><em>Avoid<\/em>: resource, user<\/p>/);
});

test("emphasis nested in a link's label is drawn inside the link", () => {
  const html = renderFeatures("See [**Undo**](../GLOSSARY.md#undo).\n");
  assert.match(html, /<a class="md-link" href="#" data-help-doc="glossary" data-help-anchor="undo"><strong>Undo<\/strong><\/a>/);
});

/* --- the glossary's own shape -------------------------------------------- */

test("a glossary entry is one bold term and a colon, and takes the term's own id", () => {
  assert.equal(termOf("**Person**:"), "Person");
  assert.equal(termOf("**Where the controls are.** The Options glyph"), null);
  assert.equal(termOf("**Availability line**:"), "Availability line");
  const html = renderGlossary("**Person**:\nSomeone whose time the plan schedules.\n");
  assert.match(html, /<p class="md-term" id="person"><strong>Person<\/strong>: Someone whose time the plan schedules.<\/p>/);
});

test("the _Avoid_ line begins its own paragraph rather than running into the definition", () => {
  const html = renderGlossary("**Person**:\nSomeone whose time the plan schedules.\n_Avoid_: resource, user\n");
  assert.equal(html.split("\n").length, 2);
  assert.match(html, /^<p class="md-term" id="person">/);
  assert.match(html, /<p class="md-avoid"><em>Avoid<\/em>: resource, user<\/p>$/);
});

/* --- lists ---------------------------------------------------------------- */

test("an unordered list is drawn as a list, wrapped lines joined to their item", () => {
  const html = renderFeatures("- the view settings: `Weekends`, `Holidays`,\n  `Milestones`;\n- `Show archived`, alone.\n");
  assert.match(html, /^<ul class="md-list md-list-ul">/);
  assert.match(html, /<li>the view settings: <code class="md-code">Weekends<\/code>, <code class="md-code">Holidays<\/code>, <code class="md-code">Milestones<\/code>;<\/li>/);
  assert.match(html, /<li><code class="md-code">Show archived<\/code>, alone.<\/li><\/ul>$/);
});

test("an ordered list keeps its own numbers", () => {
  const html = renderFeatures("1. The first step.\n2. The second step.\n");
  assert.match(html, /<ol class="md-list md-list-ol"><li>The first step.<\/li><li>The second step.<\/li><\/ol>/);
});

test("a list ends where the prose after it begins", () => {
  const html = renderFeatures("- one item\n\nThe paragraph after the list.\n");
  assert.match(html, /<\/ul>\n<p>The paragraph after the list.<\/p>$/);
});

/* --- tables --------------------------------------------------------------- */

test("a table is drawn as a table, its header row apart from its body", () => {
  const html = renderFeatures("| Control | Where |\n| --- | --- |\n| `Zoom` | the top bar |\n| `Today` | before Zoom |\n");
  assert.match(html, /^<table class="md-table"><thead><tr><th>Control<\/th><th>Where<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td><code class="md-code">Zoom<\/code><\/td><td>the top bar<\/td><\/tr>/);
  assert.match(html, /<tr><td><code class="md-code">Today<\/code><\/td><td>before Zoom<\/td><\/tr><\/tbody><\/table>$/);
});

test("a table cell holds inline markup, and the alignment row is not a row", () => {
  const html = renderFeatures("| a | b |\n| :-- | --: |\n| **bold** | [Undo](../GLOSSARY.md#undo) |\n");
  assert.match(html, /<th>a<\/th><th>b<\/th>/);
  assert.doesNotMatch(html, /:--/);
  assert.match(html, /<td><strong>bold<\/strong><\/td><td><a class="md-link"/);
});

/* --- links ---------------------------------------------------------------- */

test("a link between the two documents becomes a control the panel can follow", () => {
  const fromReference = renderFeatures("See [Assignment](../GLOSSARY.md#assignment).\n");
  assert.match(fromReference, /<a class="md-link" href="#" data-help-doc="glossary" data-help-anchor="assignment">Assignment<\/a>/);
  const fromGlossary = renderGlossary("See [the plan](../docs/features.md#the-plan-and-its-file).\n");
  assert.match(fromGlossary, /data-help-doc="features" data-help-anchor="the-plan-and-its-file"/);
});

test("an anchor-only link stays in the document it is written in", () => {
  const html = renderFeatures("Start with [the plan and its file](#the-plan-and-its-file).\n");
  assert.match(html, /data-help-doc="features" data-help-anchor="the-plan-and-its-file"/);
});

test("a link to anything else is plain text, never a control", () => {
  const targets = ["../README.md", "adr/0001-store.md", "https://example.com/x", "mailto:someone@example.com"];
  for (const target of targets) {
    const html = renderFeatures("See [the README](" + target + ").\n");
    assert.equal(resolveHelpTarget(target, { path: "docs/features.md", documents: DOCUMENTS }), null, target);
    assert.match(html, /<span class="md-plainlink">the README<\/span>/, target);
    assert.doesNotMatch(html, /<a /, target);
  }
});

test("a link to a heading that is not there is plain text", () => {
  const html = renderGlossary("See [Undo](../docs/features.md#undo).\n", {
    anchors: { features: ["the-plan-and-its-file"], glossary: ["person"] }
  });
  assert.match(html, /<span class="md-plainlink">Undo<\/span>/);
  const known = renderGlossary("See [Person](#person).\n", { anchors: { glossary: ["person"] } });
  assert.match(known, /<a class="md-link" href="#" data-help-doc="glossary" data-help-anchor="person">Person<\/a>/);
});

test("a path is resolved against the document that wrote it, and cannot leave the two", () => {
  assert.deepEqual(resolveHelpTarget("../GLOSSARY.md#undo", { path: "docs/features.md", documents: DOCUMENTS }),
    { doc: "glossary", label: "Glossary", anchor: "undo" });
  assert.deepEqual(resolveHelpTarget("#undo", { path: "GLOSSARY.md", documents: DOCUMENTS }),
    { doc: "glossary", label: "Glossary", anchor: "undo" });
  assert.equal(resolveHelpTarget("../docs/../GLOSSARY.md", { path: "docs/features.md", documents: DOCUMENTS }).doc, "glossary");
  assert.equal(resolveHelpTarget("../../../etc/passwd", { path: "docs/features.md", documents: DOCUMENTS }), null);
});

/* --- rules, escaping and the rest ---------------------------------------- */

test("a rule is a rule, not a paragraph of dashes", () => {
  const html = renderFeatures("Before.\n\n---\n\nAfter.\n");
  assert.match(html, /<p>Before.<\/p>\n<hr class="md-rule">\n<p>After.<\/p>/);
});

test("document text is escaped rather than kept as markup", () => {
  const html = renderFeatures("<script>alert(1)</script> and a < b & c\n");
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; and a &lt; b &amp; c/);
  assert.equal(escapeHtml('a "b" & <c>'), 'a "b" &amp; &lt;c&gt;');
});

test("the words of a line survive plainText for an anchor", () => {
  assert.equal(plainText("**Undo** and `Redo` in [the top bar](#x)"), "Undo and Redo in the top bar");
});
