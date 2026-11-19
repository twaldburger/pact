import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  milestoneProjectChoices,
  filterProjectChoices,
  projectPickerSummary,
  NOT_IN_VIEW
} from "../public/lib/milestone-projects.mjs";

// The plan the form reads: Projects in plan order, one of them an absence -
// Annual Leave, which carries time off rather than delivery - and one archived,
// which the server leaves out of `projects` while Show archived is off.
const plan = {
  projects: [
    { id: "atlas", name: "Atlas" },
    { id: "borealis", name: "Borealis" },
    { id: "cascade", name: "Cascade" },
    { id: "annual-leave", name: "Annual Leave", absence: true }
  ]
};

const ids = (choices) => choices.map((choice) => choice.id);

test("the control offers each of the plan's Projects once, in plan order", () => {
  const choices = milestoneProjectChoices(plan, []);
  assert.deepEqual(ids(choices), ["atlas", "borealis", "cascade"]);
  assert.deepEqual(choices.map((choice) => choice.label), ["Atlas", "Borealis", "Cascade"]);
  // Nothing is chosen and nothing is stale, so there is nothing to add.
  assert.equal(choices.every((choice) => choice.offered), true);
  // A plan holding no Projects at all offers nothing rather than refusing.
  assert.deepEqual(milestoneProjectChoices({ projects: [] }, ["atlas"]), [
    { id: "atlas", name: "atlas", label: "atlas" + NOT_IN_VIEW, offered: false }
  ]);
  assert.deepEqual(milestoneProjectChoices(null, []), []);
});

test("an absence Project is not offered, by the rule the report already reads", () => {
  const choices = milestoneProjectChoices(plan, []);
  assert.equal(ids(choices).includes("annual-leave"), false);
  // The exclusion is workdays.mjs' `absenceProjectIds`, not a flag test here:
  // that rule counts only a Project marked `absence: true`, so a Project
  // carrying something else under the key is still a Project to relate to.
  const odd = { projects: [{ id: "atlas", name: "Atlas", absence: "yes" }] };
  assert.deepEqual(ids(milestoneProjectChoices(odd, [])), ["atlas"]);
});

test("a stored id the list does not offer stays listed, last, and reads as not in this view", () => {
  const choices = milestoneProjectChoices(plan, ["deleted-project", "atlas"]);
  assert.deepEqual(ids(choices), ["atlas", "borealis", "cascade", "deleted-project"]);
  const stale = choices[3];
  assert.equal(stale.label, "deleted-project" + NOT_IN_VIEW);
  assert.equal(stale.offered, false);
  // The stale id is searchable by the id it has: that is its name here.
  assert.deepEqual(ids(filterProjectChoices(choices, "deleted")), ["deleted-project"]);
});

test("a repeated stored id is one choice, and an absence Project already stored is listed to untick", () => {
  const choices = milestoneProjectChoices(plan, ["atlas", "atlas", "annual-leave"]);
  assert.deepEqual(ids(choices), ["atlas", "borealis", "cascade", "annual-leave"]);
  // It is not offered - the list is a delivery's Projects - but it is present,
  // so the link it holds is visible and can be removed.
  const leave = choices[3];
  assert.equal(choices[0].offered, true);
  assert.equal(leave.offered, false);
  assert.equal(choices.filter((choice) => choice.id === "annual-leave").length, 1);
  assert.equal(leave.name, "Annual Leave");
});

/* --- the summary line ----------------------------------------------------- */

test("the summary reads none, one and several in the order the Milestone stores them", () => {
  const choices = milestoneProjectChoices(plan, []);
  assert.equal(projectPickerSummary(choices, []), "No projects");
  assert.equal(projectPickerSummary(choices, ["borealis"]), "Borealis");
  // Several: the first stored name and a count of the rest, so it stays short
  // enough for the form's row however many Projects a plan holds.
  assert.equal(projectPickerSummary(choices, ["atlas", "borealis", "cascade"]), "Atlas, +2");
  // The stored order decides the name shown, not the plan's own order.
  assert.equal(projectPickerSummary(choices, ["cascade", "atlas"]), "Cascade, +1");
  // A repeated id is one link, as the plan stores it.
  assert.equal(projectPickerSummary(choices, ["atlas", "atlas"]), "Atlas");
});

test("the summary names a stale link by its id, so it is never silent", () => {
  const choices = milestoneProjectChoices(plan, ["deleted-project"]);
  assert.equal(projectPickerSummary(choices, ["deleted-project"]), "deleted-project");
  assert.equal(projectPickerSummary(choices, ["deleted-project", "atlas"]), "deleted-project, +1");
  // An id with no choice at all still reads as itself rather than as nothing.
  assert.equal(projectPickerSummary([], ["gone"]), "gone");
});

/* --- the search ----------------------------------------------------------- */

test("the search is a case-insensitive substring of the name, and empty keeps the whole list", () => {
  const choices = milestoneProjectChoices(plan, ["deleted-project"]);
  assert.deepEqual(ids(filterProjectChoices(choices, "")), ids(choices));
  assert.deepEqual(ids(filterProjectChoices(choices, "   ")), ids(choices));
  assert.deepEqual(ids(filterProjectChoices(choices, "A")), ["atlas", "borealis", "cascade"]);
  assert.deepEqual(ids(filterProjectChoices(choices, "ATL")), ["atlas"]);
  assert.deepEqual(ids(filterProjectChoices(choices, "e")), ["borealis", "cascade", "deleted-project"]);
  // A substring that matches nothing leaves nothing, and the whole list is a
  // copy: filtering never edits the list the control holds.
  assert.deepEqual(filterProjectChoices(choices, "zzz"), []);
  const kept = filterProjectChoices(choices, "");
  kept.pop();
  assert.equal(choices.length, 4);
});

/* --- what the form is built from ------------------------------------------ */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");

function declaration(rule, name) {
  const found = rule.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(name + ":\\s*([^;]+);"));
  assert.ok(found, name + " is missing from the rule");
  return found[1].replace(/\s+/g, " ").trim();
}

test("the form builds its related-Projects control from these rules", () => {
  // The presentation is the script's, but what is offered, how the row reads
  // and how a search narrows it are the module's, so the two surfaces cannot
  // disagree about them.
  assert.match(APP, /from "\.\/lib\/milestone-projects\.mjs"/);
  assert.match(APP, /milestoneProjectChoices\(data, Object\.keys\(chosen\)\)/);
  assert.match(APP, /filterProjectChoices\(choices, search\.value\)/);
  assert.match(APP, /projectPickerSummary\(choices, Object\.keys\(chosen\)\)/);
  // The stored shape is still the list of ids the plan already keeps.
  assert.match(APP, /projectIds: Object\.keys\(chosen\)/);
  // The checkbox-per-Project block the form used to draw in the row is gone.
  assert.doesNotMatch(APP, /el\("div", "milestone-projects"\)/);
  assert.doesNotMatch(APP, /milestone-projects__empty/);
});

test("the popup's list is bounded and scrolls its own content", () => {
  const list = STYLE.match(/\.milestone-picker__list\s*\{([^}]*)\}/);
  assert.ok(list, "the .milestone-picker__list rule is missing");
  // A bound with its own scroll: the list is what a long plan grows, so the
  // popup's height is the same for three Projects or thirty.
  assert.match(declaration(list[1], "max-height"), /^[0-9.]+rem$/);
  assert.equal(declaration(list[1], "overflow-y"), "auto");
  const popup = STYLE.match(/\.milestone-picker__popup\s*\{([^}]*)\}/);
  assert.ok(popup, "the .milestone-picker__popup rule is missing");
  // Fixed, beside its trigger, so the panel's own scroll cannot clip it.
  assert.equal(declaration(popup[1], "position"), "fixed");
  // A search field pinned above the scrolling list.
  const search = STYLE.match(/\.milestone-picker__search\s*\{([^}]*)\}/);
  assert.ok(search, "the .milestone-picker__search rule is missing");
  assert.equal(declaration(search[1], "width"), "100%");
  // The list's rows are flex, so the browser's own [hidden] would lose to that
  // display and a filtered-out row would stay on screen.
  assert.match(STYLE, /\.milestone-picker__item\[hidden\]\s*\{\s*display:\s*none/);
});

test("the keyboard path is held: Escape closes the list alone and focus returns to the control", () => {
  // The document's own Escape closes the panel; the list is the closer level,
  // so its handler stops there and hands focus back rather than letting the
  // dialog vanish under the choice.
  const popupKeydown = APP.match(/popup\.addEventListener\("keydown"[\s\S]*?\n  \}\);/);
  assert.ok(popupKeydown, "the popup's keydown handler is missing");
  assert.match(popupKeydown[0], /e\.key === "Escape"/);
  assert.match(popupKeydown[0], /e\.stopPropagation\(\)/);
  assert.match(popupKeydown[0], /closePicker\(true\)/);
  // The arrows walk the search field and the checkboxes the search left visible.
  assert.match(popupKeydown[0], /e\.key !== "ArrowDown" && e\.key !== "ArrowUp"/);
  assert.match(popupKeydown[0], /stops\[next\]\.focus\(\)/);
  // The trigger opens from the keyboard as the Options menu's does.
  assert.match(APP, /btn\.addEventListener\("keydown", function \(e\) \{\s*if \(e\.key === "ArrowDown"\) \{ openPicker\(\);/);
  // Escape closes the list without changing the choice: nothing on that path
  // ticks or unticks a box.
  assert.doesNotMatch(popupKeydown[0], /checked|chosen\[/);
});
