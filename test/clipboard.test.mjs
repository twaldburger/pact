import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RAIL,
  GRID,
  PEOPLE,
  PROJECT,
  ASSIGNMENT,
  PERSON,
  projectCopy,
  assignmentCopy,
  personCopy,
  clipboardKind,
  pickUpIntent,
  pasteIntent,
  railRowTinted,
  rowHeaderTinted
} from "../public/lib/clipboard.mjs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const DOCS = readFileSync(new URL("../docs/features.md", import.meta.url), "utf8");

/* --- what the slot holds ------------------------------------------------- */

test("a held Project carries its kind and the Project's id, and nothing else", () => {
  assert.deepEqual(projectCopy("p1"), { kind: PROJECT, projectId: "p1" });
  assert.equal(clipboardKind(projectCopy("p1")), PROJECT);
});

test("a held Assignment carries its kind and what a paste needs", () => {
  const held = assignmentCopy({ projectId: "p1", share: 60, tags: ["design"], note: "n", days: 3 });
  assert.deepEqual(held, {
    kind: ASSIGNMENT, projectId: "p1", share: 60, tags: ["design"], note: "n", days: 3
  });
  assert.equal(clipboardKind(held), ASSIGNMENT);
});

test("an Assignment copy takes its own list of tags, never the source's", () => {
  const tags = ["design"];
  const held = assignmentCopy({ projectId: "p1", share: 100, tags, note: "", days: 5 });
  tags.push("later");
  assert.deepEqual(held.tags, ["design"]);
  assert.deepEqual(assignmentCopy({ projectId: "p1" }), {
    kind: ASSIGNMENT, projectId: "p1", share: undefined, tags: [], note: "", days: undefined
  });
});

test("a held Person carries its kind and the Person's id, and nothing else", () => {
  assert.deepEqual(personCopy("e1"), { kind: PERSON, personId: "e1" });
  assert.equal(clipboardKind(personCopy("e1")), PERSON);
});

test("an empty slot, a missing one or one of no known kind holds nothing", () => {
  assert.equal(clipboardKind(null), null);
  assert.equal(clipboardKind(undefined), null);
  assert.equal(clipboardKind({}), null);
  assert.equal(clipboardKind({ kind: "milestone", projectId: "p1" }), null);
  assert.equal(clipboardKind("project"), null);
});

/* --- what Ctrl+C picks up ------------------------------------------------ */

test("only a rail row picks a Project up: a grid block carries nothing", () => {
  assert.equal(pickUpIntent(RAIL), PROJECT);
  assert.equal(pickUpIntent(GRID), null);
  assert.equal(pickUpIntent(null), null);
  assert.equal(pickUpIntent("panel"), null);
});

test("only the People column picks a Person up: the rail and the grid carry nothing", () => {
  assert.equal(pickUpIntent(PEOPLE), PERSON);
  assert.equal(pickUpIntent(RAIL), PROJECT);
  assert.equal(pickUpIntent(GRID), null);
  assert.equal(pickUpIntent(null), null);
});

/* --- what Ctrl+V means --------------------------------------------------- */

test("a held Project pastes over the rail and nowhere else", () => {
  const held = projectCopy("p1");
  assert.equal(pasteIntent(held, RAIL), PROJECT);
  // Over the grid a Project has nothing to land on: no position, no Paste. The
  // People column is no place for one either.
  assert.equal(pasteIntent(held, GRID), null);
  assert.equal(pasteIntent(held, PEOPLE), null);
  assert.equal(pasteIntent(held, null), null);
});

test("a held Assignment pastes on the grid only, never in the rail or the People column", () => {
  const held = assignmentCopy({ projectId: "p1", share: 100, tags: [], note: "", days: 5 });
  assert.equal(pasteIntent(held, GRID), ASSIGNMENT);
  assert.equal(pasteIntent(held, RAIL), null);
  assert.equal(pasteIntent(held, PEOPLE), null);
  assert.equal(pasteIntent(held, null), null);
});

test("a held Person pastes in the People column only, never on the grid or in the rail", () => {
  const held = personCopy("e1");
  assert.equal(pasteIntent(held, PEOPLE), PERSON);
  assert.equal(pasteIntent(held, GRID), null);
  assert.equal(pasteIntent(held, RAIL), null);
  assert.equal(pasteIntent(held, null), null);
});

test("the kind, not the surface, decides: no copy can paste as another kind", () => {
  // The same surface means the things a copy can be, so a paste can never turn
  // one into another - the held kind is what Ctrl+V reads.
  assert.equal(pasteIntent(projectCopy("p1"), RAIL), PROJECT);
  assert.equal(pasteIntent(projectCopy("p1"), GRID), null);
  assert.equal(pasteIntent(assignmentCopy({ projectId: "p1" }), GRID), ASSIGNMENT);
  assert.equal(pasteIntent(assignmentCopy({ projectId: "p1" }), PEOPLE), null);
  assert.equal(pasteIntent(personCopy("e1"), PEOPLE), PERSON);
  assert.equal(pasteIntent(personCopy("e1"), RAIL), null);
  assert.equal(pasteIntent(personCopy("e1"), GRID), null);
});

test("an empty slot pastes nothing on any surface", () => {
  assert.equal(pasteIntent(null, RAIL), null);
  assert.equal(pasteIntent(null, GRID), null);
  assert.equal(pasteIntent(null, PEOPLE), null);
  assert.equal(pasteIntent({}, RAIL), null);
  assert.equal(pasteIntent({ kind: "milestone" }, GRID), null);
});

test("a replaced copy is read by the kind it was replaced with", () => {
  // One slot serves all three kinds, so a second Ctrl+C overwrites the first,
  // and from then on the surface rule follows the copy that is actually held.
  let held = projectCopy("p1");
  held = assignmentCopy({ projectId: "p1", share: 100, tags: [], note: "", days: 2 });
  assert.equal(pasteIntent(held, GRID), ASSIGNMENT);
  assert.equal(pasteIntent(held, RAIL), null);
  held = personCopy("e1");
  assert.equal(pasteIntent(held, PEOPLE), PERSON);
  assert.equal(pasteIntent(held, GRID), null);
  held = projectCopy("p2");
  assert.equal(pasteIntent(held, RAIL), PROJECT);
  assert.equal(pasteIntent(held, PEOPLE), null);
  assert.equal(pasteIntent(held, GRID), null);
});

/* --- the tint ------------------------------------------------------------ */

test("the rail row carries the tint while the clipboard holds a Project", () => {
  assert.equal(railRowTinted(projectCopy("p1")), true);
  assert.equal(railRowTinted(assignmentCopy({ projectId: "p1" })), false);
  assert.equal(railRowTinted(personCopy("e1")), false);
  assert.equal(railRowTinted(null), false);
  assert.equal(railRowTinted({}), false);
});

test("the row header carries the tint while the clipboard holds a Person", () => {
  assert.equal(rowHeaderTinted(personCopy("e1")), true);
  assert.equal(rowHeaderTinted(projectCopy("p1")), false);
  assert.equal(rowHeaderTinted(assignmentCopy({ projectId: "p1" })), false);
  assert.equal(rowHeaderTinted(null), false);
  assert.equal(rowHeaderTinted({}), false);
});

/* --- the wiring these rules are read by --------------------------------- */

test("Ctrl+V makes the copy through the one function the Copy button calls", () => {
  // One creation path per kind, so the keyboard can never grow a second rule: the
  // name rule (copyName) is called from copyProject and copyPerson and nowhere
  // else, and each keyboard paste calls one of those two.
  assert.equal(APP.match(/copyName\(/g).length, 2);
  const pasteProject = APP.match(/function pasteProject\(\) \{[\s\S]*?\n\}/);
  assert.ok(pasteProject, "pasteProject is the keyboard's Project paste");
  assert.match(pasteProject[0], /copyProject\(source\)/);
  const pastePerson = APP.match(/function pastePerson\(\) \{[\s\S]*?\n\}/);
  assert.ok(pastePerson, "pastePerson is the keyboard's Person paste");
  assert.match(pastePerson[0], /copyPerson\(source\)/);
  // The Person panel's Copy button calls the same function the paste does.
  const copyButton = APP.match(/button\("btn-ghost", "Copy person", function \(\) \{[\s\S]*?\n {4}\}\)\)/);
  assert.ok(copyButton, "the Person panel has a Copy button");
  assert.match(copyButton[0], /copyPerson\(person\)/);
  // Copy is the ordinary style, and the two danger buttons keep theirs.
  assert.equal(APP.match(/button\("btn-danger", "Archive person"/g).length, 1);
  assert.equal(APP.match(/button\("btn-danger", "Delete person"/g).length, 1);
  // It is offered on an archived Person too: the button sits outside the guard
  // that hides Archive and Delete.
  assert.ok(APP.indexOf('"Copy person"') < APP.indexOf("if (editing && !person.archived) {"),
    "Copy person sits before the guard that hides Archive and Delete");
  // A copy creates a Person and never removes one.
  const copier = APP.match(/function copyPerson\(person\) \{[\s\S]*?\n\}/);
  assert.ok(copier, "copyPerson is the one Person copy path");
  assert.match(copier[0], /api\("POST", "\/api\/people"/);
  // It carries everything a Person is except their work, and deletes nothing:
  // no Assignment is written and no Person is taken away.
  ["location", "availability", "tags", "note"].forEach((field) => {
    assert.match(copier[0], new RegExp("\\n\\s+" + field + ":"), "the copy carries " + field);
  });
  ["destroyPerson(", "archivePerson(", "assignments", "DELETE"].forEach((word) => {
    assert.equal(copier[0].includes(word), false, "copyPerson must not carry " + word);
  });
});

test("the wiring asks the clipboard module what each key means", () => {
  assert.match(APP, /pickUpIntent\(clipboardSurfaceAt\(/);
  assert.match(APP, /pasteIntent\(clipboard, clipboardSurfaceAt\(/);
  assert.match(APP, /railRowTinted\(clipboard\)/);
  assert.match(APP, /rowHeaderTinted\(clipboard\)/);
  // A rail row is found by the rail's own button, so no grid block can be
  // mistaken for the Project it draws - and a Person by their own row header.
  assert.match(APP, /closest\("\.stack__item\[data-project\]"\)/);
  assert.match(APP, /closest\("\.rowhead\[data-person\]"\)/);
});

test("Escape clears the clipboard for any kind, under whatever is nearer", () => {
  const handler = APP.match(/document\.addEventListener\("keydown", function \(e\) \{\n {4}if \(e\.key !== "Escape" \|\| e\.defaultPrevented\) return;[\s\S]*?\n {2}\}\);/);
  assert.ok(handler, "the clipboard's Escape handler is bound");
  assert.match(handler[0], /if \(!clipboardKind\(clipboard\)\) return;/);
  assert.match(handler[0], /clipboard = null;/);
  // Nothing nearer loses its Escape: a panel, the Options menu and a drag in
  // flight all claim the key first.
  assert.match(handler[0], /panel/);
  assert.match(handler[0], /optionsMenu/);
  assert.match(handler[0], /is-dragging/);
});

test("the feature reference describes the Project copy and paste", () => {
  assert.match(DOCS, /`Ctrl\+C` holds that Project and says `Copied Atlas`/);
  assert.match(DOCS, /`Ctrl\+V` over\nthe rail makes the copy at once/);
  assert.match(DOCS, /`Escape` clears the slot whichever kind it holds/);
});

test("the feature reference describes the Person copy and paste", () => {
  // Prose, so a phrase may fall across the line the document wraps at.
  const prose = DOCS.replace(/\s+/g, " ");
  assert.match(prose, /Copy, Archive and Delete sit at the foot of the Person panel/);
  assert.match(prose, /`Ctrl\+C` over a row header holds that Person/);
  assert.match(prose, /`Ctrl\+V` over the People column makes the copy/);
  assert.match(prose, /a held Person tints the row header under the pointer/i);
});
