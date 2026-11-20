/*
 * PACT's documentation, held to the capabilities the code itself enumerates.
 *
 * A feature reference rots the moment a capability is added and nobody writes
 * it up, because nothing fails when that happens. What is checked here is that
 * every capability listed in `public/lib/options.mjs` and every view listed in
 * `public/lib/report-views.mjs` names a section of `docs/features.md`; that
 * `docs/index.md` lists every page under `docs/` and resolves; and that every
 * page carries the frontmatter the standard requires (`type`, `title` and
 * `description`).
 *
 * The README is held to the same rule one step out: every relative link in it
 * has to name a file that exists and, where it carries a fragment, an anchor
 * that document defines. The README is the front door, so a link that goes
 * nowhere is the one failure a reader is certain to meet.
 *
 * What this cannot do is grade the prose. A section that exists may still be
 * wrong, thin or stale in its detail, and a green run says the section is
 * there, not that it is any good. Nor can it see a capability the code does not
 * enumerate: the checklist is the Options menu's own label rules and the
 * report's view list, so a surface stated only in prose, or only in
 * `public/app.js`, is invisible here - the rail's fold is one. A capability
 * added to one of those enumerations is caught; one added outside them is not,
 * and no check here will ever notice it.
 *
 * Matching is on a label naming a section's heading, so a new row with no
 * section turns the suite red. Where the interface and the document genuinely
 * use different words, ALIASES below declares the mapping, so every exception
 * is visible here rather than hidden inside a loosened rule.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  optionsItems,
  optionGroups,
  paletteControl,
  rangeControl,
  stepControl,
  helpItem,
  sprintsItem,
  holidaysItem,
  tagsItem,
  milestonesItem
} from "../public/lib/options.mjs";
import { REPORT_VIEWS } from "../public/lib/report-views.mjs";
import { helpAnchors } from "../public/lib/help.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const README = path.join(ROOT, "README.md");
const DOCS = path.join(ROOT, "docs");
const FEATURES = path.join(DOCS, "features.md");
const INDEX = path.join(DOCS, "index.md");

/*
 * The exceptions, by the interface's label: the document's own wording for the
 * section that carries the capability. Each is a real difference in words, not
 * a way to let a missing section pass - the aliased label still has to appear
 * in the section it names.
 */
const ALIASES = new Map([
  // The Holidays toggle draws the holiday band, and the section is named for
  // what the toggle draws rather than for the menu row that draws it.
  ["Holidays", "the holiday band"],
  // The Plan file panel and the plan's own file are one section, named for the
  // file and the panel together.
  ["Plan file...", "the plan and its file"],
  // The seven report views are documented together, in one section that lists
  // all seven, rather than one section each; the label still has to be listed
  // in that section's own text.
  ...REPORT_VIEWS.map((view) => [view.label, "the report's views"])
]);

// A label as the document would write it: the menu's trailing ellipsis says the
// row opens a panel, not that the capability's name ends in dots.
function words(label) {
  return label.replace(/\.\.\.$/, "").trim().toLowerCase();
}

// The menu's rows whose label comes from a rule in `public/lib/options.mjs`.
function menuCapabilities() {
  return [
    ...optionsItems(),
    paletteControl(),
    rangeControl(),
    stepControl(),
    helpItem(),
    sprintsItem(),
    holidaysItem(),
    tagsItem(),
    milestonesItem()
  ].map((item) => ({ key: item.key, label: item.label }));
}

// The two rows `public/app.js` writes inline, with no rule to read a label
// from: their names are stated here because there is nowhere else to read them.
const INLINE_ROWS = [
  { key: "plan-file", label: "Plan file..." },
  { key: "reset-view", label: "Reset view" }
];

// Everything that must be sectioned in the reference: the whole Options menu,
// row by row, and the report's seven views.
function capabilities() {
  return [
    ...menuCapabilities(),
    ...INLINE_ROWS,
    ...REPORT_VIEWS.map((view) => ({ key: view.key, label: view.label }))
  ];
}

/*
 * The reference as its sections: an `##` heading and the text under it, both
 * lowercased once. Sectioning at `##` is what makes a missing section fail even
 * when another section happens to mention the same word.
 */
function sections(markdown) {
  const found = [];
  let current = null;
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim().toLowerCase(), text: line.toLowerCase() };
      found.push(current);
    } else if (current) {
      current.text += "\n" + line.toLowerCase();
    }
  }
  return found;
}

const FEATURE_SECTIONS = sections(fs.readFileSync(FEATURES, "utf8"));

// A capability is documented when a section's heading names it - directly, or
// by its declared alias - and that section's text carries the label the
// interface actually wears.
function documented(capability) {
  const name = words(capability.label);
  const phrase = words(ALIASES.get(capability.label) ?? capability.label);
  return FEATURE_SECTIONS.some(function (section) {
    return section.heading.includes(phrase) && section.text.includes(name);
  });
}

function pagesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (entry) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pagesUnder(full);
    if (!entry.name.endsWith(".md")) return [];
    return [path.relative(DOCS, full).split(path.sep).join("/")];
  });
}

const DOC_PAGES = pagesUnder(DOCS).sort();

// The local paths `docs/index.md` links to, as written in it, without anchors.
function indexLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#"))
    .map((target) => target.split("#")[0])
    .filter(Boolean);
}

const INDEX_LINKS = indexLinks(fs.readFileSync(INDEX, "utf8"));

// A page as the index would refer to it, from the docs/ directory.
function asPage(link) {
  return path.relative(DOCS, path.resolve(DOCS, link)).split(path.sep).join("/");
}

const LINKED_PAGES = INDEX_LINKS.map(asPage);

// The frontmatter block's fields, or null when the page does not open with one.
function frontmatter(markdown) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(markdown);
  if (!block) return null;
  const fields = {};
  for (const line of block[1].split("\n")) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]] = field[2].trim();
  }
  return fields;
}

const REQUIRED_FIELDS = ["type", "title", "description"];

function pageText(page) {
  return fs.readFileSync(path.join(DOCS, page), "utf8");
}

test("every capability the code enumerates has a section in the feature reference", () => {
  const missing = capabilities()
    .filter((capability) => !documented(capability))
    .map((capability) => capability.label);
  assert.deepEqual(missing, [], "these are enumerated in the code and not sectioned in docs/features.md");
});

test("the checklist covers every row of the Options menu, and only those rows", () => {
  const menu = [...new Set(optionGroups(optionsItems()).flat())].sort();
  const checked = [...menuCapabilities(), ...INLINE_ROWS].map((row) => row.key);
  assert.deepEqual([...new Set(checked)].sort(), menu);
});

test("every alias names a capability, so an exception cannot outlive its row", () => {
  const labels = capabilities().map((capability) => capability.label);
  assert.deepEqual([...ALIASES.keys()].filter((label) => !labels.includes(label)), []);
});

test("the index lists every page under docs/", () => {
  assert.deepEqual(DOC_PAGES.filter((page) => !LINKED_PAGES.includes(page)), [],
    "these pages are not listed in docs/index.md");
});

test("every index entry points at a file that exists", () => {
  const missing = INDEX_LINKS.filter((link) => !fs.existsSync(path.resolve(DOCS, link)));
  assert.deepEqual(missing, [], "these docs/index.md entries point at nothing");
});

test("every page under docs/ carries type, title and description", () => {
  const missing = [];
  for (const page of DOC_PAGES) {
    const fields = frontmatter(pageText(page));
    if (!fields) {
      missing.push(page + " (no frontmatter)");
      continue;
    }
    const absent = REQUIRED_FIELDS.filter((key) => !fields[key]);
    if (absent.length) missing.push(page + " (" + absent.join(", ") + ")");
  }
  assert.deepEqual(missing, [], "these pages lack required frontmatter");
});

/* --- the README's own links, and the one section that is an offer ---------- */

// The local paths a document links to, as written in it, anchors included.
function localLinks(markdown) {
  return [...markdown.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)]
    .map((match) => match[1])
    .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("#"));
}

test("every relative link in README.md names a file, and an anchor, that exists", () => {
  const dead = [];
  for (const target of localLinks(fs.readFileSync(README, "utf8"))) {
    const [file, anchor] = target.split("#");
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      dead.push(target + " (no such file)");
    } else if (anchor && file.endsWith(".md") &&
      !helpAnchors(fs.readFileSync(full, "utf8")).includes(anchor)) {
      // The anchor rule is the app's own: a heading's slug, or a glossary
      // term's, which is what the documents already link to each other by.
      dead.push(target + " (no such heading or term)");
    }
  }
  assert.deepEqual(dead, [], "these README.md links are dead ends");
});

// A section of the README, by its heading, with its body as its own lines.
function readmeSection(title) {
  const part = fs.readFileSync(README, "utf8").split(/^## /m)
    .find((section) => section.startsWith(title + "\n"));
  return part ? part.slice(title.length + 1).replace(/\n+$/, "").split("\n") : null;
}

test("the README's What it does section is an offer, not a how-to", () => {
  const section = readmeSection("What it does");
  assert.ok(section, "README.md has no What it does section");
  const gestures = [...section.join("\n").matchAll(
    /\b(drag|drags|dragged|click|clicks|clicked|press|presses|pressed|chevron|paste|keystroke)\b/gi
  )].map((match) => match[0].toLowerCase());
  assert.deepEqual(gestures, [], "a gesture belongs in docs/features.md, not in what the plan offers");
  assert.equal(section.filter((line) => line.startsWith("- ")).length, 8);
  // The budget is generous on purpose: a capability a first-time reader cannot
  // follow is worse than a long one, and 25 lines forced the prose into clauses
  // that read as fragments. The gesture ban above is the rule that matters; this
  // only stops the section quietly turning into the manual it is meant to
  // summarise - a manual is far longer than this, and says how rather than what.
  assert.ok(section.length <= 50, "the section is " + section.length + " lines");
});
