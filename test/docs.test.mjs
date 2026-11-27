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
 * that document defines. So is `docs/agent-tooling.md`, the one page whose
 * links are followed from inside the app as well as from the repository. The
 * README is the front door, so a link that goes nowhere is the one failure a
 * reader is certain to meet.
 *
 * What this cannot do is grade the prose. A section that exists may still be
 * told in the wrong words, and a green run says the section is there, not that
 * it is any good. What the guards at the end of this file do is hold the
 * prose's enumerable half back to the code: the Options menu's rows by label,
 * the help's own document list, the figures the constants own, every field a
 * panel holds, and every code-owned string the reference quotes. That is where
 * a document stops being merely present and starts being true.
 *
 * Nor can it see a capability the code does not
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
  blockLabelControl,
  rangeControl,
  stepControl,
  helpItem,
  sprintsItem,
  holidaysItem,
  tagsItem,
  milestonesItem,
  adoItem
} from "../public/lib/options.mjs";
import { REPORT_VIEWS } from "../public/lib/report-views.mjs";
import { HELP_DOCUMENTS, helpAnchors } from "../public/lib/help.mjs";
import {
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_STEP,
  ROW_HEIGHT_DEFAULT,
  GRID_SPACING_MIN,
  GRID_SPACING_MAX,
  GRID_SPACING_STEP,
  GRID_SPACING_DEFAULTS
} from "../public/lib/timeline.mjs";
import { DEFAULT_STEP, STEP_MIN, STEP_MAX } from "../public/lib/panels.mjs";
import { SPRINT_LENGTH_MIN, SPRINT_LENGTH_MAX } from "../public/lib/sprints.mjs";
import { HISTORY_LIMIT } from "../lib/plan.mjs";
import { IMPORTED_SHARE } from "../lib/ado.mjs";
import {
  ADO_CONNECT_FIRST,
  ADO_EGRESS_ACTIONS,
  connectionLine,
  existingProjectOffer,
  linkRow,
  tokenNotice
} from "../public/lib/ado.mjs";
import { deletionNotice } from "../public/lib/delete.mjs";
import { PERSON, PROJECT } from "../public/lib/clipboard.mjs";

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
    blockLabelControl(),
    rangeControl(),
    stepControl(),
    helpItem(),
    sprintsItem(),
    holidaysItem(),
    tagsItem(),
    milestonesItem(),
    adoItem()
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

const FEATURE_TEXT = fs.readFileSync(FEATURES, "utf8");
const FEATURE_SECTIONS = sections(FEATURE_TEXT);

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

// Every relative link in a document resolved from the directory it sits in:
// the file it names, and the heading or glossary term its fragment names, by
// the app's own anchor rule.
function deadLinks(markdown, directory) {
  const dead = [];
  for (const target of localLinks(markdown)) {
    const [file, anchor] = target.split("#");
    const full = path.join(directory, file);
    if (!fs.existsSync(full)) {
      dead.push(target + " (no such file)");
    } else if (anchor && file.endsWith(".md") &&
      !helpAnchors(fs.readFileSync(full, "utf8")).includes(anchor)) {
      dead.push(target + " (no such heading or term)");
    }
  }
  return dead;
}

test("every relative link in README.md names a file, and an anchor, that exists", () => {
  assert.deepEqual(deadLinks(fs.readFileSync(README, "utf8"), ROOT), [],
    "these README.md links are dead ends");
});

test("every relative link in docs/agent-tooling.md names a file, and an anchor, that exists", () => {
  assert.deepEqual(deadLinks(pageText("agent-tooling.md"), DOCS), [],
    "these docs/agent-tooling.md links are dead ends");
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

/* --- the detail the prose states, held to the code ------------------------
 *
 * The guards above ask whether a section exists. These ask whether what it
 * says is the code's own: the menu map lists the menu's rows, the help names
 * the documents the panel serves, the figures are the constants' values, a
 * panel's fields are all in its section, and a quoted string is quoted
 * verbatim. Each one names the finding it would have caught - the documentation
 * drift audit's six wrong statements, and the classes behind them.
 */

// One `##` section of the reference, its sub-headings included, as it is
// written. Whitespace-normalised by callers that match across a line wrap.
function featureSection(heading) {
  const lines = FEATURE_TEXT.split("\n");
  const start = lines.findIndex((line) => line.trim().toLowerCase() === "## " + heading.toLowerCase());
  assert.notEqual(start, -1, "docs/features.md has no ## " + heading + " section");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

// A section as one line, so a match is never defeated by where the prose wraps.
function oneLine(markdown) {
  return markdown.replace(/\s+/g, " ");
}

/* Guard 1: the Options menu map lists every row, by label, in menu order.

   Would have caught S1, the map missing the `Azure DevOps...` row, and catches
   any rename or reorder the capability test cannot see because it only asks a
   row for a section somewhere.

   The rows come from the same builders the checklist reads them from, in the
   order `optionGroups` puts them. A key the menu uses twice - the `Holidays`
   toggle and the `Holidays...` panel entry, likewise `Milestones` - takes the
   next unused label of its own, so neither instance has to be named here. */

function menuRowLabels() {
  const available = new Map();
  for (const row of [...menuCapabilities(), ...INLINE_ROWS]) {
    const queue = available.get(row.key) || [];
    queue.push(row.label);
    available.set(row.key, queue);
  }
  return optionGroups(optionsItems()).flat().map(function (key) {
    const queue = available.get(key);
    assert.ok(queue && queue.length, "the menu has a row " + key + " that no builder names");
    return queue.shift();
  });
}

// The map's own list: the bullet block that opens the section, before the prose
// that follows it. That is the part that claims to be a map.
function menuMapList() {
  const kept = [];
  let started = false;
  for (const line of featureSection("The Options menu").split("\n")) {
    if (line.startsWith("- ")) {
      started = true;
      kept.push(line);
    } else if (started && line.trim() !== "") {
      kept.push(line);
    } else if (started) {
      break;
    }
  }
  return oneLine(kept.join("\n"));
}

// Where a label is written as its own row, not as the start of a longer one:
// `Holidays` is not the `Holidays...` panel entry.
function labelPositions(text, label) {
  const found = [];
  let at = text.indexOf(label);
  while (at !== -1) {
    const after = text.charAt(at + label.length);
    if (label.endsWith("...") || after !== ".") found.push(at);
    at = text.indexOf(label, at + 1);
  }
  return found;
}

test("the Options menu map lists every row, by label, once, in the menu's order", () => {
  const list = menuMapList();
  const labels = menuRowLabels();
  const wrong = labels.filter((label) => labelPositions(list, label).length !== 1);
  assert.deepEqual(wrong, [],
    "these Options menu rows are missing from the map in docs/features.md, or listed twice");
  const positions = labels.map((label) => labelPositions(list, label)[0]);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b),
    "the map lists the rows out of the order the menu draws them in");
});

/* Guard 2: the help section names every document the panel serves.

   Would have caught W2, the section calling two documents where the panel, the
   server and the README all have three. A count word the list contradicts is
   the same finding in another dress, so it is caught too. */

test("the In-app help section names every document the panel serves, and no wrong count", () => {
  const section = featureSection("In-app help");
  const missing = HELP_DOCUMENTS.map((doc) => doc.label).filter((label) => !section.includes(label));
  assert.deepEqual(missing, [],
    "the help panel serves these documents and docs/features.md does not name them");
  const counts = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const stated = [...section.matchAll(/\b(one|two|three|four|five)\s+documents\b/gi)]
    .map((match) => counts[match[1].toLowerCase()]);
  assert.deepEqual(stated.filter((count) => count !== HELP_DOCUMENTS.length), [],
    "the section states a document count the panel's own list contradicts");
});

/* Guard 3: the prose's numbers come from the constants that own them.

   One entry per owning section, each phrase built from the constant rather
   than restated here. True today, so it catches nothing existing: it closes the
   class that rots next, when a default moves and its sentence does not. */

const PROSE_NUMBERS = [
  {
    section: "Row height",
    owner: "ROW_HEIGHT_* in public/lib/timeline.mjs",
    phrases: [
      ROW_HEIGHT_MIN + " to " + ROW_HEIGHT_MAX + " in " + ROW_HEIGHT_STEP + "px steps, defaulting to " + ROW_HEIGHT_DEFAULT
    ]
  },
  {
    section: "Grid spacing",
    owner: "GRID_SPACING_* in public/lib/timeline.mjs",
    phrases: [
      GRID_SPACING_MIN + " to " + GRID_SPACING_MAX + " in " + GRID_SPACING_STEP + "px steps",
      "Day " + GRID_SPACING_DEFAULTS.day + ", Week " + GRID_SPACING_DEFAULTS.week +
        ", Sprint " + GRID_SPACING_DEFAULTS.sprint + " and Month " + GRID_SPACING_DEFAULTS.month
    ]
  },
  {
    section: "Percentage step",
    owner: "STEP_MIN, STEP_MAX and DEFAULT_STEP in public/lib/panels.mjs",
    phrases: [STEP_MIN + " to " + STEP_MAX + ", defaulting to " + DEFAULT_STEP]
  },
  {
    section: "Sprints",
    owner: "SPRINT_LENGTH_MIN and SPRINT_LENGTH_MAX in public/lib/sprints.mjs",
    phrases: ["a default length of " + SPRINT_LENGTH_MIN + " to " + SPRINT_LENGTH_MAX + " days"]
  },
  {
    section: "Undo and redo",
    owner: "HISTORY_LIMIT in lib/plan.mjs",
    phrases: ["the last " + HISTORY_LIMIT + " changes"]
  },
  {
    section: "Importing a work item",
    owner: "IMPORTED_SHARE in lib/ado.mjs",
    phrases: [IMPORTED_SHARE + "% as its Share"]
  }
];

test("the reference's numbers are the constants that own them", () => {
  const wrong = [];
  for (const entry of PROSE_NUMBERS) {
    const section = oneLine(featureSection(entry.section));
    for (const phrase of entry.phrases) {
      if (!section.includes(phrase)) wrong.push(entry.section + ': "' + phrase + '" (' + entry.owner + ")");
    }
  }
  assert.deepEqual(wrong, [], "these figures in docs/features.md have drifted from their constants");
});

/* Guard 4: every field a panel holds is named in that panel's own section.

   The labels are read out of the panel builders in public/app.js, so the next
   field added to a panel turns this red rather than joining a list nobody
   remembers to update. Would have caught W4, the People section that called
   itself everything a Person is and omitted the Email field. */

const APP_JS = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");

// The `formRow("Label", ...)` labels inside one builder, up to the next
// top-level function.
function panelLabels(builder) {
  const start = APP_JS.indexOf("function " + builder + "(");
  assert.notEqual(start, -1, "public/app.js has no " + builder);
  let end = APP_JS.length;
  for (let i = start + 1; i < APP_JS.length; i++) {
    if (APP_JS.startsWith("\nfunction ", i)) {
      end = i;
      break;
    }
  }
  return [...APP_JS.slice(start, end).matchAll(/formRow\("([^"]+)"/g)].map((match) => match[1]);
}

const PANELS = [
  { builders: ["openPersonPanel"], section: "People" },
  { builders: ["openProjectPanel"], section: "Projects" },
  { builders: ["openAssignmentPanel", "openNewAssignmentPanel"], section: "Assignments" },
  { builders: ["openMilestonePanel"], section: "Milestones" }
];

test("every field a panel holds is named in that panel's section of the reference", () => {
  const missing = [];
  for (const panel of PANELS) {
    const section = oneLine(featureSection(panel.section)).toLowerCase();
    for (const builder of panel.builders) {
      const labels = panelLabels(builder);
      assert.ok(labels.length, builder + " draws no form rows, so this guard is looking in the wrong place");
      for (const label of labels) {
        if (!section.includes(label.toLowerCase())) {
          missing.push(label + " (" + builder + ", missing from ## " + panel.section + ")");
        }
      }
    }
  }
  assert.deepEqual(missing, [], "these panel fields are drawn by the app and absent from the reference");
});

/* Guard 5: the strings the reference quotes are the code's own, verbatim.

   Each is taken from the module that decides it - called, not retyped - so a
   rewording in code turns the test red instead of leaving a quotation behind.
   Would have caught R2, the refusal quoted with three full stops where the
   code ends in one ellipsis character. */

const QUOTED_STRINGS = [
  { what: "the withheld ADO button's reason", text: ADO_CONNECT_FIRST },
  { what: "the token's state line", text: tokenNotice({ present: true, path: "<path>" }) },
  {
    what: "the connection's line",
    text: connectionLine({
      ok: true,
      project: "PACT",
      team: "PACT Team",
      types: [
        { name: "Epic", rank: 4 },
        { name: "Feature", rank: 3 },
        { name: "User Story", rank: 2 },
        { name: "Bug", rank: 1 },
        { name: "Task", rank: 1 }
      ]
    }).text
  },
  { what: "a record with no work item", text: linkRow({}, undefined).text },
  { what: "the offer to use an existing Project", text: existingProjectOffer({ name: "<name>" }, "<name> (copy)").label },
  { what: "the offer to import as a copy", text: existingProjectOffer({ name: "<name>" }, "<name> (copy)").altLabel },
  { what: "the notice for a deleted Person", text: deletionNotice(PERSON, "Anna Meier", 3) },
  { what: "the notice for a deleted Project", text: deletionNotice(PROJECT, "Atlas", 3) }
];

test("the strings the reference quotes are the code's own, verbatim", () => {
  const prose = oneLine(FEATURE_TEXT);
  const wrong = QUOTED_STRINGS.filter((entry) => !prose.includes(entry.text))
    .map((entry) => entry.what + ': "' + entry.text + '"');
  assert.deepEqual(wrong, [], "these code-owned strings are not quoted verbatim in docs/features.md");
});

/* Guard 5's other half: the one list of presses that reach Azure DevOps.

   The list is `ADO_EGRESS_ACTIONS` in public/lib/ado.mjs, quoted by the README,
   the glossary and the reference rather than described three ways. Would have
   caught W5 and R1, which named a token action as egress when it makes no call
   and left out the settings panel, which makes one. */

const EGRESS_DOCUMENTS = [
  { name: "README.md", text: fs.readFileSync(README, "utf8") },
  { name: "GLOSSARY.md", text: fs.readFileSync(path.join(ROOT, "GLOSSARY.md"), "utf8") },
  { name: "docs/features.md", text: FEATURE_TEXT }
];

test("every document quotes the one list of presses that reach Azure DevOps", () => {
  const wrong = [];
  for (const doc of EGRESS_DOCUMENTS) {
    const prose = oneLine(doc.text);
    for (const action of ADO_EGRESS_ACTIONS) {
      if (!prose.includes(action)) wrong.push(doc.name + ': "' + action + '" is not quoted');
    }
    // A token write is a file on this machine. The phrase is what the wrong
    // listing used, so no document may use it again as though it reached ADO.
    if (/\btoken action\b/.test(prose)) wrong.push(doc.name + ": lists a token action among the presses that reach ADO");
  }
  assert.deepEqual(wrong, []);
});
