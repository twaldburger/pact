/*
 * The app's one tick list, and the two controls that are it.
 *
 * The tag field and the Azure DevOps mapping's two lists are the same
 * interaction - a field on the row, a list that opens under it, rows that tick,
 * Space to tick, Enter to take the ticks and close, Escape to close and take
 * nothing - over different vocabularies, so `tickPicker` in public/app.js is
 * built once and both call it. What is checked here is that this is still one
 * shell rather than two: one builder, the keys handled in it and nowhere else,
 * the ticks seeded where the list opens and dropped where it closes, and the
 * one difference the two controls are meant to have - whether a value may be
 * typed - carried as a flag rather than forked.
 *
 * The rules the list leans on are pure and held in tag-picker.test.mjs:
 * `offeredTags`, `tickToggled`, `enterTags`, and for a list that replaces its
 * choice, `choiceText`, `choiceRows` and `applyLabel`. What this file can see
 * is the wiring between those rules and the app. It cannot press a key: that is
 * checked against the running app.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mappingRefusal, typeRanks } from "../public/lib/ado.mjs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

// One span of the script, from its opening marker to the marker that follows.
function sourceFrom(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, startMarker + " is not in the script");
  const end = source.indexOf(endMarker, start);
  assert.ok(end > start, endMarker + " does not follow " + startMarker);
  return source.slice(start, end);
}

const BUILDER = sourceFrom(APP, "function tickPicker(", "\n// The tag field: chips");
const TAGS = sourceFrom(APP, "function tagEditor(", "\nvar suggestListSeq = 0;");
const LEVELS = sourceFrom(APP, "function levelPicker(", "\n// What a list with no types in it reads as");
const PANEL = sourceFrom(APP, "function openAdoSettingsPanel(", "\n/* --- the Azure DevOps operations panel");
const KEYS = sourceFrom(BUILDER, 'control.addEventListener("keydown"', 'control.addEventListener("blur"');
const CLOSE = sourceFrom(BUILDER, "function close()", "// The commit row's words");
const COMMIT = sourceFrom(BUILDER, "function commit(values)", "function commitTicks()");

/* --- one shell, two controls --------------------------------------------- */

test("the tick list is built once, and both controls are that build", () => {
  assert.equal((APP.match(/function tickPicker\(/g) || []).length, 1,
    "the tick list is built more than once");
  assert.match(TAGS, /var picker = tickPicker\(\{/, "the tag field does not use the shared list");
  assert.match(LEVELS, /var picker = tickPicker\(\{/, "the mapping list does not use the shared list");
  // Neither control keeps a list, a row or a key of its own.
  [["the tag field", TAGS], ["the mapping list", LEVELS]].forEach(([what, source]) => {
    assert.doesNotMatch(source, /addEventListener\("keydown"/, what + " handles its own keys");
    assert.doesNotMatch(source, /el\("button", "filter__hit"\)/, what + " draws its own rows");
    assert.doesNotMatch(source, /placePopover|aria-activedescendant/, what + " places or announces its own list");
  });
});

test("typed is the one difference, and it is a flag", () => {
  assert.match(TAGS, /typed: true,/);
  assert.match(LEVELS, /typed: false,/);
  // A typed field takes text and may commit it; an untyped one has nothing to
  // type into, so the mapping list's field is a button and no input.
  assert.match(BUILDER, /typed \? control\.value : ""/);
  assert.doesNotMatch(LEVELS, /control\.value|createElement\("input"\)/);
  assert.match(LEVELS, /var button = el\("button", "choose__value"\);/);
});

/* --- the manners the tag picker already had ------------------------------ */

test("Space ticks the highlighted row", () => {
  assert.match(KEYS, /e\.key === " "/);
  assert.match(KEYS, /tickRow\(shown\[rowIndex\]\)/);
  // Space in a typed field with nothing highlighted is a space in the tag.
  assert.match(KEYS, /if \(menu\.hidden && !typed\)/);
});

test("Enter takes the ticks and closes, in one step", () => {
  // The mapping list takes its ticks whole; from closed, Enter opens first.
  assert.match(KEYS, /if \(!typed\) \{[\s\S]*?if \(menu\.hidden\) \{ draw\(\); return; \}[\s\S]*?commitTicks\(\);/);
  // The tag field keeps `enterTags`' ranking and commits what it answers.
  assert.match(KEYS, /var add = enterTags\(control\.value, ticks, shown, rowIndex\);/);
  assert.match(KEYS, /if \(add\.length\) commit\(add\);/);
  // One commit: the field's half decides what the values mean, the field is
  // repainted from what it holds, and the list closes on the same step.
  assert.match(COMMIT, /spec\.apply\(\(values \|\| \[\]\)\.slice\(\)\);/);
  assert.match(COMMIT, /spec\.field\.paint\(\);/);
  assert.match(COMMIT, /close\(\);/);
});

test("Escape closes and takes nothing", () => {
  const escape = sourceFrom(KEYS, 'e.key === "Escape"', 'e.key === "Tab"');
  assert.match(escape, /close\(\);/);
  // Nothing is applied on the way out: the field keeps what it held before the
  // list was opened, so a mis-click on a list of ten costs nothing.
  assert.doesNotMatch(escape, /commit|apply/);
  // A typed field clears the text it was narrowing with; an untyped one has
  // none to clear.
  assert.match(escape, /if \(typed\) control\.value = "";/);
});

test("the ticks are seeded where the list opens and dropped where it closes", () => {
  assert.match(BUILDER, /if \(menu\.hidden\) ticks = \(spec\.seeded \? spec\.seeded\(\) : \[\]\)\.slice\(\);/);
  // A list that replaces its choice opens with the choice ticked; a field that
  // adds opens with nothing ticked.
  assert.match(LEVELS, /seeded: function \(\) \{ return levels; \}/);
  assert.match(TAGS, /seeded: function \(\) \{ return \[\]; \}/);
  // Closing empties them without applying anything.
  assert.match(CLOSE, /ticks = \[\];/);
  assert.doesNotMatch(CLOSE, /spec\.apply/);
});

test("a click away closes and takes nothing, and a typed field still commits its text", () => {
  assert.match(BUILDER, /control\.addEventListener\("blur", function \(\) \{\s*if \(typed\) commitTyped\(\);\s*else close\(\);/);
});

/* --- the mapping list's own half ---------------------------------------- */

test("the rows are the instance's types, and a stored name it no longer reports", () => {
  // The rule is the shared module's, so the panel cannot word a second one.
  assert.match(LEVELS, /suggest: function \(\) \{ return choiceRows\(vocabulary, levels\); \}/);
  assert.match(LEVELS, /commitText: applyLabel,/);
  // The field has one node, so it sits in the row like the URL field above it.
  assert.match(BUILDER, /wrap\.appendChild\(spec\.field\.node\);/);
});

test("a list with nothing to offer says what it is waiting for", () => {
  assert.match(LEVELS, /empty: function \(\) \{ return LEVELS_WAITING; \}/);
  assert.match(BUILDER, /var note = shown\.length === 0 && spec\.empty \? spec\.empty\(\) : "";/);
  assert.match(BUILDER, /el\("p", "choose__empty"\)/);
});

/* --- the rule still judges ---------------------------------------------- */

const RANKS = typeRanks({
  value: [
    { rank: 4, workItemTypes: [{ name: "Epic" }] },
    { rank: 3, workItemTypes: [{ name: "Feature" }] },
    { rank: 2, workItemTypes: [{ name: "User Story" }] }
  ]
});

test("the control chooses and the rank rule refuses a bad pair on save", () => {
  // Every save goes through the shared rule before it is sent.
  assert.match(PANEL, /var refusals = adoRefusals\(payload\);/);
  assert.match(PANEL, /if \(refusals\.length\) \{\s*error\.set\(refusals\.join\(" "\)\);\s*return;/);
  // And a pair the control can hold - an assignment type above a project type -
  // is still refused, naming both ranks.
  const refusal = mappingRefusal({ projectLevels: ["Feature"], assignmentLevels: ["Epic"] }, { ranks: RANKS });
  assert.match(refusal, /'Feature' \(rank 3\)/);
  assert.match(refusal, /'Epic' \(rank 4\)/);
  assert.match(refusal, /must be a higher level/);
});
