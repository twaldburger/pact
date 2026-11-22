/*
 * The command line page, and the table it carries.
 *
 * `docs/agent-tooling.md` is the one page that describes the tool, and the tool
 * prints its own command table for it: `node bin/pact.mjs --help table` emits
 * the table as a Markdown fragment, the page carries that fragment between two
 * markers, and this file compares the two byte for byte. A hand-written table
 * would drift from the commands it describes and assert things that are no
 * longer true, so the comparison is the whole point of the page: change the
 * tool's list without regenerating the page and this turns red, and change the
 * page's table by hand and it turns red the other way.
 *
 * What this cannot do is grade the prose. It checks the page's shape - the
 * boundary first, the sections named for a reader's question, the table last -
 * and that the page is reachable from the map, the index and the README. Whether
 * the prose is any good is the reviewer's job.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { scratch } from "../test-support/scratch.mjs";
import { helpSections } from "../public/lib/help.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const BIN = path.join(ROOT, "bin", "pact.mjs");
const PAGE = path.join(ROOT, "docs", "agent-tooling.md");
const PAGE_MARKDOWN = fs.readFileSync(PAGE, "utf8");
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
const MAP = fs.readFileSync(path.join(ROOT, "AGENTS.md"), "utf8");
const INDEX = fs.readFileSync(path.join(ROOT, "docs", "index.md"), "utf8");

// The markers the page and the tool share. They are HTML comments, so the help
// panel strips them rather than drawing them (see test/markdown.test.mjs).
const BEGIN = "<!-- command-table:begin";
const END = "<!-- command-table:end -->";

const scratchDir = scratch("agent-tooling");

function toolTable(options) {
  const opts = options || {};
  const result = spawnSync(process.execPath, [BIN, "--help", "table"], {
    cwd: opts.cwd || ROOT,
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return result.stdout;
}

function toolHelp() {
  const result = spawnSync(process.execPath, [BIN, "--help"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

// The fragment the page carries, markers included, or null when either marker
// is missing or they are out of order.
function pageTable() {
  const begin = PAGE_MARKDOWN.indexOf(BEGIN);
  const end = PAGE_MARKDOWN.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return null;
  return PAGE_MARKDOWN.slice(begin, end + END.length) + "\n";
}

function pageRows(fragment) {
  return fragment.split("\n").filter((line) => line.startsWith("|"));
}

/* --- the table is the tool's own ----------------------------------------- */

test("the page's command table is the tool's own output, byte for byte", () => {
  assert.equal(PAGE_MARKDOWN.split(BEGIN).length - 1, 1, "the page carries one table block");
  assert.equal(PAGE_MARKDOWN.split(END).length - 1, 1, "the page carries one table block");
  assert.equal(pageTable(), toolTable(), "the page's table and the tool's have diverged:\n" +
    "regenerate the page with node bin/pact.mjs --help table");
});

test("the table is one row per command, in a stated order", () => {
  const rows = pageRows(pageTable());
  assert.deepEqual(rows[0].split("|").map((cell) => cell.trim()).filter(Boolean),
    ["Command", "What it does", "Needs"]);
  const body = rows.slice(2);
  assert.equal(body.length, 26, "one row per command the tool has");
  assert.equal(new Set(body.map((row) => row.split("|")[1].trim())).size, body.length,
    "two rows name the same command");
  // The order is stated in the page and in the tool: the reads first, then the
  // writes that change a plan, then the two about how the app draws it.
  const needs = body.map((row) => row.split("|")[3].trim());
  const lastRead = needs.lastIndexOf("the plan file");
  const firstWrite = needs.indexOf("the app");
  assert.ok(lastRead < firstWrite, "a write comes before a read");
  assert.deepEqual(needs.slice(lastRead + 1).filter((need) => need !== "the app" && need !== "the app, reading only"), []);
  assert.equal(needs.slice(0, lastRead + 1).every((need) => need === "the plan file"), true);
  assert.equal(needs.slice(firstWrite).includes("the plan file"), false);
});

test("the table names only commands the tool takes, and the help describes them", () => {
  const plan = path.join(scratchDir(), "empty-plan.json");
  fs.writeFileSync(plan, fs.readFileSync(path.join(ROOT, "data", "default.pact.json"), "utf8"));
  const help = toolHelp();
  const heads = [...new Set(pageRows(pageTable()).slice(2).map((row) => {
    return row.split("|")[1].trim().replace(/^`|`$/g, "").split(" ")[0];
  }))];
  assert.ok(heads.length >= 10, "the table names too few commands: " + heads.join(", "));
  for (const head of heads) {
    // Every command word in the table is in the text `--help` prints...
    assert.ok(help.includes(head), "--help does not name " + head);
    // ...and the tool does not answer it with "unknown command".
    const result = spawnSync(process.execPath, [BIN, head, "--plan", plan], {
      cwd: ROOT, encoding: "utf8", timeout: 10000
    });
    assert.doesNotMatch(result.stderr, /unknown command/, head + " is not a command the tool takes");
  }
});

test("the table is deterministic: the same bytes from any directory, no path, no clock", () => {
  const first = toolTable({ cwd: ROOT });
  const second = toolTable({ cwd: scratchDir() });
  assert.equal(first, second, "the table changes with the directory it is printed from");
  // Nothing absolute and nothing that moves between runs: a path or a moment
  // would make the page's copy stale without either side changing.
  assert.doesNotMatch(first, /\/(home|Users|tmp|var)\//);
  assert.doesNotMatch(first, /[A-Za-z]:\\/);
  assert.doesNotMatch(first, new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((first.match(/^\d{4}-\d{2}-\d{2}T/gm) || []).length, 0, "a timestamp leaked into the table");
});

/* --- how the page is shaped ----------------------------------------------- */

// The page's `##` headings, top to bottom.
function headings() {
  return [...PAGE_MARKDOWN.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
}

test("the page opens with the boundary, then answers by task, not alphabetically", () => {
  const sections = headings();
  assert.equal(sections[0], "The tool never deletes anything",
    "the boundary is the first thing a reader meets");
  // Named for what a reader wants, not for the mechanism.
  for (const wanted of ["Answering a question about a plan", "Reading the figures",
    "Changing a plan", "Seeing what the app shows"]) {
    assert.ok(sections.includes(wanted), "the page has no section called " + wanted);
  }
  const alphabetical = sections.slice().sort((a, b) => a.localeCompare(b));
  assert.notDeepEqual(sections, alphabetical, "the page is ordered alphabetically");
});

test("the table is the last section, after the prose that explains it", () => {
  const sections = headings();
  assert.equal(sections[sections.length - 1], "The commands, in full");
  const at = PAGE_MARKDOWN.indexOf("## The commands, in full");
  assert.ok(at !== -1 && at < PAGE_MARKDOWN.indexOf(BEGIN), "the table comes before the prose");
  // The block sits inside that one section: no heading opens between the
  // markers, and nothing but prose follows the end marker.
  const between = PAGE_MARKDOWN.slice(PAGE_MARKDOWN.indexOf(BEGIN), PAGE_MARKDOWN.indexOf(END));
  assert.doesNotMatch(between, /^#{1,6}\s/m, "a heading splits the table");
});

test("every heading of the page is a search result in the help panel", () => {
  const searchable = helpSections(PAGE_MARKDOWN).map((section) => section.title);
  for (const heading of headings()) {
    assert.ok(searchable.includes(heading), heading + " is not a section the search can find");
  }
  assert.ok(searchable.includes("PACT's command line"), "the opening is not named by the page's title");
});

/* --- the page is reachable from the repository ----------------------------- */

test("the page is listed in the index, routed from the map, and pointed at from the README", () => {
  assert.match(INDEX, /\]\(agent-tooling\.md\)/, "docs/index.md does not list the page");
  assert.match(MAP, /\]\(docs\/agent-tooling\.md\)/, "AGENTS.md does not route to the page");
  assert.match(README, /\]\(docs\/agent-tooling\.md\)/, "README.md does not point at the page");
});

test("the README's agent section points at the page instead of describing commands", () => {
  const part = README.split(/^## /m).find((section) => section.startsWith("Working with an agent\n"));
  assert.ok(part, "README.md has no Working with an agent section");
  const section = part.slice("Working with an agent\n".length).replace(/\n+$/, "");
  assert.match(section, /\]\(docs\/agent-tooling\.md\)/, "the section does not link to the page");
  // The commands themselves are described once, on the page: a flag or a
  // subcommand in this section would be a second description, free to drift.
  const commands = section.match(/--[a-z-]+|\b\w+ (?:add|move|archive|restore|edit|set)\b/g) || [];
  assert.deepEqual(commands, [], "the README's agent section describes commands itself");
});
