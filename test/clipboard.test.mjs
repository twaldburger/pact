import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  RAIL,
  GRID,
  PROJECT,
  ASSIGNMENT,
  projectCopy,
  assignmentCopy,
  clipboardKind,
  pickUpIntent,
  pasteIntent,
  railRowTinted
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

test("an empty slot, a missing one or one of no known kind holds nothing", () => {
  assert.equal(clipboardKind(null), null);
  assert.equal(clipboardKind(undefined), null);
  assert.equal(clipboardKind({}), null);
  assert.equal(clipboardKind({ kind: "person", projectId: "p1" }), null);
  assert.equal(clipboardKind("project"), null);
});

/* --- what Ctrl+C picks up ------------------------------------------------ */

test("only a rail row picks a Project up: a grid block carries nothing", () => {
  assert.equal(pickUpIntent(RAIL), PROJECT);
  assert.equal(pickUpIntent(GRID), null);
  assert.equal(pickUpIntent(null), null);
  assert.equal(pickUpIntent("panel"), null);
});

/* --- what Ctrl+V means --------------------------------------------------- */

test("a held Project pastes over the rail and nowhere else", () => {
  const held = projectCopy("p1");
  assert.equal(pasteIntent(held, RAIL), PROJECT);
  // Over the grid a Project has nothing to land on: no position, no Paste.
  assert.equal(pasteIntent(held, GRID), null);
  assert.equal(pasteIntent(held, null), null);
});

test("a held Assignment pastes on the grid only, never in the rail", () => {
  const held = assignmentCopy({ projectId: "p1", share: 100, tags: [], note: "", days: 5 });
  assert.equal(pasteIntent(held, GRID), ASSIGNMENT);
  assert.equal(pasteIntent(held, RAIL), null);
  assert.equal(pasteIntent(held, null), null);
});

test("the kind, not the surface, decides: neither copy can paste as the other", () => {
  // The same surface means the two things a copy can be, so a paste can never
  // turn one into the other - the held kind is what Ctrl+V reads.
  assert.equal(pasteIntent(projectCopy("p1"), RAIL), PROJECT);
  assert.equal(pasteIntent(projectCopy("p1"), GRID), null);
  assert.equal(pasteIntent(assignmentCopy({ projectId: "p1" }), GRID), ASSIGNMENT);
  assert.equal(pasteIntent(assignmentCopy({ projectId: "p1" }), RAIL), null);
});

test("an empty slot pastes nothing on either surface", () => {
  assert.equal(pasteIntent(null, RAIL), null);
  assert.equal(pasteIntent(null, GRID), null);
  assert.equal(pasteIntent({}, RAIL), null);
  assert.equal(pasteIntent({ kind: "person" }, GRID), null);
});

test("a replaced copy is read by the kind it was replaced with", () => {
  // One slot serves both kinds, so a second Ctrl+C overwrites the first, and
  // from then on the surface rule follows the copy that is actually held.
  let held = projectCopy("p1");
  held = assignmentCopy({ projectId: "p1", share: 100, tags: [], note: "", days: 2 });
  assert.equal(pasteIntent(held, GRID), ASSIGNMENT);
  assert.equal(pasteIntent(held, RAIL), null);
  held = projectCopy("p2");
  assert.equal(pasteIntent(held, RAIL), PROJECT);
  assert.equal(pasteIntent(held, GRID), null);
});

/* --- the tint ------------------------------------------------------------ */

test("the rail row carries the tint while the clipboard holds a Project", () => {
  assert.equal(railRowTinted(projectCopy("p1")), true);
  assert.equal(railRowTinted(assignmentCopy({ projectId: "p1" })), false);
  assert.equal(railRowTinted(null), false);
  assert.equal(railRowTinted({}), false);
});

/* --- the wiring these rules are read by --------------------------------- */

test("Ctrl+V makes the copy through the one function the Copy button calls", () => {
  // One creation path, so the keyboard can never grow a second name rule: the
  // name rule (copyName) is called from copyProject and from nowhere else.
  assert.equal(APP.match(/copyName\(/g).length, 1);
  const pasteProject = APP.match(/function pasteProject\(\) \{[\s\S]*?\n\}/);
  assert.ok(pasteProject, "pasteProject is the keyboard's Project paste");
  assert.match(pasteProject[0], /copyProject\(source\)/);
});

test("the wiring asks the clipboard module what each key means", () => {
  assert.match(APP, /pickUpIntent\(clipboardSurfaceAt\(/);
  assert.match(APP, /pasteIntent\(clipboard, clipboardSurfaceAt\(/);
  assert.match(APP, /railRowTinted\(clipboard\)/);
  // A rail row is found by the rail's own button, so no grid block can be
  // mistaken for the Project it draws.
  assert.match(APP, /closest\("\.stack__item\[data-project\]"\)/);
});

test("Escape clears the clipboard for either kind, under whatever is nearer", () => {
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
