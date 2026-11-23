/*
 * The panels' footers: four short actions in one row, one alignment rule.
 *
 * The suite has no DOM to lay a footer out with, so what is checked here is the
 * structure the two files hand the browser: the one gap and the one edge the
 * stylesheet sets, the action group that wraps as a unit, the primary action
 * kept outside it, and the words each shortened button carries behind its one
 * visible word. Whether the four buttons really land on one row, share a top
 * edge and a height, and wrap deliberately below the dialog's width is a
 * measurement, not something these assertions can make - it is checked against
 * the running app.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const STYLE = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");

const FOOT = STYLE.match(/\.panel__foot\s*\{([^}]*)\}/);
const ACTIONS = STYLE.match(/\.panel__actions\s*\{([^}]*)\}/);

function declaration(rule, name) {
  // Comments inside a rule carry prose with colons and semicolons of their own,
  // so strip them before reading a declaration.
  const found = rule.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(name + ":\\s*([^;]+);"));
  assert.ok(found, name + " is missing from the rule");
  return found[1].replace(/\s+/g, " ").trim();
}

// One panel's source, from its opening function up to the end marker.
function sourceFrom(startMarker, endMarker) {
  const start = APP.indexOf(startMarker);
  assert.ok(start >= 0, startMarker + " is not in the script");
  const end = APP.indexOf(endMarker, start);
  assert.ok(end > start, endMarker + " does not follow " + startMarker);
  return APP.slice(start, end);
}

const PERSON = sourceFrom("function openPersonPanel(", "\nfunction copyPerson(");
const PROJECT = sourceFrom("function openProjectPanel(", "\nfunction copyProject(");
const ASSIGNMENT = sourceFrom("function openAssignmentPanel(", "\nfunction openNewAssignmentPanel(");
// The Milestones editor shares the footer but keeps its own labels; it is read
// from its footer alone, since the panel's name is not a reliable end marker.
const MILESTONE_FOOT = (() => {
  const at = APP.indexOf('button("btn-danger", "Delete milestone"');
  assert.ok(at > 0, "the Milestones editor's Delete button is not in the script");
  const start = APP.lastIndexOf('var foot = el("div", "panel__foot");', at);
  const end = APP.indexOf("node.appendChild(foot);", at);
  return APP.slice(start, end);
})();

/* --- the one rule for every footer --------------------------------------- */

test("the footer wraps at the primary action, on one gap and one edge", () => {
  assert.ok(FOOT, "the .panel__foot rule is missing");
  assert.ok(ACTIONS, "the .panel__actions rule is missing");
  // One gap for both axes: a single length, not a row gap and a column gap, so
  // a wrapped line is as far from the one above it as two buttons are apart.
  const gap = declaration(FOOT[1], "gap");
  assert.doesNotMatch(gap, /\s/, "the footer sets a row gap and a column gap: " + gap);
  assert.equal(gap, "var(--sp-3)");
  // The group is its own wrapping row on that same gap, aligned to the footer's
  // own edge, so its lines and the primary share one alignment.
  assert.equal(declaration(ACTIONS[1], "display"), "flex");
  assert.equal(declaration(ACTIONS[1], "flex-wrap"), "wrap");
  assert.equal(declaration(ACTIONS[1], "gap"), gap);
  assert.equal(declaration(ACTIONS[1], "justify-content"), declaration(FOOT[1], "justify-content"));
  // Every item takes the line's height, so no button class in a footer can
  // draw shorter than another beside it.
  assert.equal(declaration(FOOT[1], "align-items"), "stretch");
  assert.equal(declaration(ACTIONS[1], "align-items"), "stretch");
});

test("the footer still sticks to the panel's bottom and keeps its padding", () => {
  assert.equal(declaration(FOOT[1], "position"), "sticky");
  assert.equal(declaration(FOOT[1], "bottom"), "0");
  assert.equal(declaration(FOOT[1], "flex-wrap"), "wrap");
  assert.equal(declaration(FOOT[1], "padding-bottom"), "var(--sp-5)");
});

// Every footer that groups its ordinary actions appends that group before the
// spacer and the primary action after it, so the group is what wraps and the
// primary is never inside it beside Delete.
test("every action group is appended before the spacer and the primary after it", () => {
  const groups = [...APP.matchAll(/var actions = el\("div", "panel__actions"\);/g)];
  assert.equal(groups.length, 4, "the three dialogs and the Milestones editor carry a group");
  for (const match of groups) {
    const body = APP.slice(match.index, APP.indexOf("node.appendChild(foot);", match.index));
    const firstAfter = (needles) => needles
      .map((needle) => body.indexOf(needle))
      .filter((at) => at >= 0)
      .sort((a, b) => a - b)[0];
    const groupAt = body.indexOf("foot.appendChild(actions);");
    const spacerAt = firstAfter([
      "foot.appendChild(spacer);",
      'foot.appendChild(el("span", "panel__spacer"));'
    ]);
    const saveAt = firstAfter([
      "foot.appendChild(save);",
      "foot.appendChild(saveCadence);",
      "foot.appendChild(create);"
    ]);
    assert.ok(groupAt >= 0, "the group is never appended to its footer");
    assert.ok(spacerAt >= 0, "the footer has no spacer after its actions");
    assert.ok(saveAt >= 0, "the footer's primary action is not appended by name");
    assert.ok(groupAt < spacerAt, "the group must be appended before the spacer");
    assert.ok(spacerAt < saveAt, "the primary action must sit outside the group, after the spacer");
  }
});

/* --- the shortened words, and the wording they carry --------------------- */

// The visible word and the full wording for every renamed action, in the order
// the footer draws them.
const ACTIONS_BY_KIND = {
  Person: [["btn-ghost", "Copy", "Copy person"], ["btn-danger", "Archive", "Archive person"], ["btn-danger", "Delete", "Delete person"]],
  Project: [["btn-ghost", "Copy", "Copy project"], ["btn-danger", "Archive", "Archive project"], ["btn-danger", "Delete", "Delete project"]],
  Assignment: [["btn-ghost", "Copy", "Copy assignment"], ["btn-danger", "Archive", "Archive assignment"], ["btn-danger", "Delete", "Delete assignment"]]
};

test("a short footer word keeps its full wording in the accessible name and title", () => {
  const helper = APP.match(/function namedButton\(cls, label, full, handler\) \{[\s\S]*?\n\}/);
  assert.ok(helper, "namedButton is the one place a short footer label is made");
  // The visible word is the button's text; the full one is announced and shown
  // on hover, since the word alone loses which record the button acts on.
  assert.match(helper[0], /button\(cls, label, handler\)/);
  assert.match(helper[0], /setAttribute\("aria-label", full\)/);
  assert.match(helper[0], /setAttribute\("title", full\)/);
});

for (const [kind, actions] of Object.entries(ACTIONS_BY_KIND)) {
  test("the " + kind + " dialog offers Copy, Archive and Delete with their full wording", () => {
    const source = { Person: PERSON, Project: PROJECT, Assignment: ASSIGNMENT }[kind];
    const group = source.match(/var actions = el\("div", "panel__actions"\);[\s\S]*?foot\.appendChild\(actions\);/);
    assert.ok(group, "the " + kind + " dialog's footer has an action group");
    let at = 0;
    for (const [cls, word, full] of actions) {
      const call = 'namedButton("' + cls + '", "' + word + '", "' + full + '"';
      const found = group[0].indexOf(call);
      assert.ok(found > at, word + " must be drawn after the action before it");
      at = found;
    }
    // Three short words, and no longer ones left behind.
    assert.equal(group[0].match(/namedButton\(/g).length, 3);
  });
}

test("the primary action still says Save, outside the group", () => {
  assert.match(PERSON, /saveButton\(editing \? "Save" : "Add person"/);
  assert.match(PROJECT, /saveButton\(editing \? "Save" : "Add project"/);
  assert.match(ASSIGNMENT, /saveButton\("Save"/);
  // The group is a group of ordinary actions only: no primary button is made
  // inside one, so Save can never end up between Copy and Delete.
  for (const source of [PERSON, PROJECT, ASSIGNMENT, MILESTONE_FOOT]) {
    const group = source.match(/var actions = el\("div", "panel__actions"\);[\s\S]*?foot\.appendChild\(actions\);/);
    assert.ok(group, "an action group is missing from a footer");
    assert.doesNotMatch(group[0], /saveButton\(/);
  }
});

test("the add form keeps its one verb, and an archived Assignment keeps its two", () => {
  // A new Person or Project has nothing to copy, archive or delete, so the
  // footer holds that one button and it says what the form does.
  assert.match(PERSON, /saveButton\(editing \? "Save" : "Add person"/);
  assert.match(PROJECT, /saveButton\(editing \? "Save" : "Add project"/);
  // An archived Assignment is history: Restore and Delete, both already short,
  // and no group of ordinary actions around them.
  const archived = ASSIGNMENT.slice(
    ASSIGNMENT.indexOf("if (archived) {"),
    ASSIGNMENT.indexOf("} else {")
  );
  assert.match(archived, /button\("btn-primary", "Restore"/);
  assert.match(archived, /button\("btn-danger", "Delete"/);
  assert.doesNotMatch(archived, /panel__actions/);
});

test("the other panels' own labels are untouched", () => {
  assert.match(MILESTONE_FOOT, /button\("btn-danger", "Delete milestone"/);
  assert.match(APP, /saveButton\(editing \? "Save milestone" : "Add milestone"/);
  assert.match(APP, /saveButton\(cadence \? "Save cadence" : "Define sprints"/);
  assert.match(APP, /saveButton\("Save holidays"/);
  assert.match(APP, /saveButton\("Save tags"/);
});

test("the footers with at most one ordinary action keep it outside a group", () => {
  // Clear cadence, Add location and the tags panel's lone Save were never a
  // group: with at most one ordinary action there is nothing a wrap could
  // interleave, so their markup is left as it was.
  for (const marker of ['"Clear cadence"', '"Add location"', '"Save tags"']) {
    const at = APP.indexOf(marker);
    assert.ok(at > 0, marker + " is not in the script");
    const footAt = APP.lastIndexOf('var foot = el("div", "panel__foot");', at);
    assert.ok(footAt >= 0 && footAt < at, marker + " has no footer before it");
    const foot = APP.slice(footAt, APP.indexOf("node.appendChild(foot);", at));
    assert.doesNotMatch(foot, /panel__actions/, marker + " was put in an action group");
  }
});
