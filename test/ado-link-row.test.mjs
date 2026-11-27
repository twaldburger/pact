/*
 * The ADO row both panels draw: the work item's id as a link to it, or the
 * words `not linked`.
 *
 * What the row reads, where it points and what it explains on hover is one rule
 * in public/lib/ado.mjs, and ado-import.test.mjs holds its two states. What is
 * checked here is the drawing around it, read out of the script the browser is
 * handed: that an Assignment's panel carries the row and so does an existing
 * Project's - always, linked or not - that a new Project and a new Assignment
 * carry none, that the anchor is given the new-tab attributes and no other
 * window's opener, and that the row's words are the rule's rather than a second
 * copy in the markup. The stylesheet is read for the one thing a picture would
 * have to say: the link wears the app's ink, not the browser's default.
 *
 * What this cannot do is draw it. Whether the row appears where the script says
 * and the link resolves is checked in the running app, which is where an
 * outcome like that has to be measured.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const STYLE = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

// One span of the script, from its opening marker to the marker that follows.
function sourceFrom(startMarker, endMarker) {
  const start = APP.indexOf(startMarker);
  assert.ok(start >= 0, startMarker + " is not in the script");
  const end = APP.indexOf(endMarker, start);
  assert.ok(end > start, endMarker + " does not follow " + startMarker);
  return APP.slice(start, end);
}

const BUILDER = sourceFrom("function adoLinkRow(", "function openProjectPanel(");
const PROJECT = sourceFrom("function openProjectPanel(", "function copyProject(");
const ASSIGNMENT = sourceFrom("function openAssignmentPanel(", "function openNewAssignmentPanel(");
const NEW_ASSIGNMENT = sourceFrom("function openNewAssignmentPanel(", "\n/* --- Sprints panel");

const calls = (source) => source.match(/adoLinkRow\(/g) || [];

/* --- where the row is drawn ---------------------------------------------- */

test("an Assignment's panel carries the ADO row, linked or not", () => {
  assert.equal(calls(ASSIGNMENT).length, 1, "the Assignment panel draws the row once");
  assert.match(ASSIGNMENT, /adoLinkRow\(a\.raw\.link, "assignment-ado-link"\)/);
  // Not behind a link: an Assignment typed onto the grid says `not linked`,
  // which is what makes the row worth reading on every one of them.
  assert.doesNotMatch(ASSIGNMENT, /if \(a\.raw\.link\)/);
});

test("an existing Project's panel carries it too, and a new Project's does not", () => {
  assert.equal(calls(PROJECT).length, 1, "the Project panel draws the row once");
  assert.match(PROJECT, /adoLinkRow\(project\.link, "project-ado-link"\)/);
  // A Project read and saved in the panel is the one that may have a link; a
  // new Project has nothing to link yet.
  assert.match(PROJECT, /if \(editing\) form\.appendChild\(adoLinkRow\(project\.link, "project-ado-link"\)\);/);
});

test("a new Assignment carries no ADO row: nothing imported it", () => {
  assert.equal(calls(NEW_ASSIGNMENT).length, 0);
});

test("both panels name the row the same way, and the rule supplies its words", () => {
  assert.equal((BUILDER.match(/formRow\("ADO"/g) || []).length, 1);
  // The type, the id, `not linked` and the facts the row explains are the
  // rule's: the script draws what it is handed rather than keeping a second copy
  // that could drift from the one the tests hold.
  assert.doesNotMatch(APP, /"not linked"/);
  assert.doesNotMatch(APP, /its dates are assumed/);
  assert.match(BUILDER, /var row = linkRow\(link, adoState && adoState\.mapping\);/);
  assert.match(BUILDER, /if \(row\.type\) node\.appendChild\(document\.createTextNode\(row\.type \+ " "\)\);/);
  assert.match(BUILDER, /anchor\.textContent = row\.text;/);
  assert.match(BUILDER, /node\.setAttribute\("title", row\.title\);/);
  // The row's own element is the span, so an unlinked record's words have it too.
  assert.match(BUILDER, /var node = el\("span", "ado__link"\);/);
});

/* --- the link itself ------------------------------------------------------ */

test("the id opens the work item in a new tab, while the type stays plain text", () => {
  // Only the id is an anchor, so the word before it never looks like the thing
  // to press.
  assert.match(BUILDER, /var anchor = el\("a", "ado__link__item"\);/);
  assert.match(BUILDER, /anchor\.href = row\.href;/);
  assert.match(BUILDER, /anchor\.target = "_blank";/);
  assert.match(BUILDER, /anchor\.rel = "noopener noreferrer";/);
  // The row is a span in both states, so `not linked` is not a link to nothing
  // and takes no tab stop.
  assert.match(BUILDER, /if \(row\.linked\) \{/);
  assert.match(BUILDER, /node\.classList\.add\("ado__link--none"\);/);
});

/* --- how it is drawn ----------------------------------------------------- */

test("the id wears the app's ink rather than the browser's default", () => {
  const item = /\.ado__link__item \{([^}]*)\}/.exec(STYLE);
  assert.ok(item, "the link has no style of its own");
  assert.match(item[1], /color: var\(--ink\)/);
  assert.match(item[1], /text-decoration: underline/);
  // The words for a record with no link are quiet, not a warning: an absent
  // work item is a fact about the record rather than an error in it, and there
  // is nothing underlined because there is nowhere to go.
  const none = /\.ado__link--none \{([^}]*)\}/.exec(STYLE);
  assert.ok(none, "`not linked` has no style of its own");
  assert.match(none[1], /color: var\(--ink-soft\)/);
  assert.doesNotMatch(none[1], /text-decoration: underline/);
});
