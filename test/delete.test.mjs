/*
 * PACT's Delete key: the record under the pointer goes, with no dialog, and the
 * notice says what went with it.
 *
 * The store is what destroys a Person or a Project and every Assignment that
 * referenced them, in one write, and it answers with the count. So the rules
 * that are not the DOM's - what the notice says, and that the count it speaks is
 * the store's own - live here and in `public/lib/delete.mjs`, where `node --test`
 * can pin them. What is left in `public/app.js` is checked by reading it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deletionNotice } from "../public/lib/delete.mjs";
import { PROJECT, PERSON } from "../public/lib/clipboard.mjs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const FEATURES = readFileSync(new URL("../docs/features.md", import.meta.url), "utf8");

/* --- what a deletion says ------------------------------------------------ */

test("a Project's cascade is named in the notice, with the store's own count", () => {
  assert.equal(deletionNotice(PROJECT, "Atlas", 3), 'Deleted "Atlas" and its 3 Assignments');
});

test("a Person's cascade is named in the notice, spoken of as a Person", () => {
  assert.equal(deletionNotice(PERSON, "Anna Meier", 2),
    'Deleted "Anna Meier" and their 2 Assignments');
});

test("one Assignment reads as one, never as a plural", () => {
  assert.equal(deletionNotice(PROJECT, "Atlas", 1), 'Deleted "Atlas" and its 1 Assignment');
  assert.equal(deletionNotice(PERSON, "Anna Meier", 1),
    'Deleted "Anna Meier" and their 1 Assignment');
});

test("a record with nothing hanging off it is named alone", () => {
  assert.equal(deletionNotice(PROJECT, "Atlas", 0), 'Deleted "Atlas"');
  assert.equal(deletionNotice(PERSON, "Anna Meier", 0), 'Deleted "Anna Meier"');
});

test("a count that is absent or nonsense speaks the record alone", () => {
  // Nothing is guessed in the notice's favour: a missing answer says the record
  // and no more, rather than inventing work that may not have gone.
  [undefined, null, "", "many", -1, NaN].forEach((count) => {
    assert.equal(deletionNotice(PROJECT, "Atlas", count), 'Deleted "Atlas"');
  });
});

test("a name is quoted as written, whatever it holds", () => {
  assert.equal(deletionNotice(PROJECT, null, 0), 'Deleted ""');
  assert.equal(deletionNotice(PROJECT, 'Atlas "A"', 0), 'Deleted "Atlas "A""');
});

/* --- the key, as the page binds it --------------------------------------- */

test("Delete stands down while typing and with no pointer to read", () => {
  // A note being edited keeps the key, or a stray press would remove a record
  // with the caret in a text field.
  const handler = APP.match(/function onDeleteKey\(e\) \{[\s\S]*?\n\}/);
  assert.ok(handler, "the Delete key's handler is bound");
  assert.match(handler[0], /if \(e\.key !== "Delete" \|\| isTextEditing\(\) \|\| !clipboardPointer\) return;/);
});

test("Delete over a block still deletes that Assignment and nothing else", () => {
  const handler = APP.match(/function onDeleteKey\(e\) \{[\s\S]*?\n\}/);
  assert.match(handler[0], /closest\("\[data-assignment\]"\)/);
  assert.match(handler[0], /destroyAssignment\(block\.getAttribute\("data-assignment"\)\)/);
  // The block is answered before any row is asked about, so a block's Project
  // is never mistaken for the rail's row of it.
  assert.ok(handler[0].indexOf('closest("[data-assignment]")') < handler[0].indexOf("pickupAt("),
    "the block is settled before the row lookup");
});

test("Delete over a row header or a rail row deletes through the same lookup as Copy", () => {
  const handler = APP.match(/function onDeleteKey\(e\) \{[\s\S]*?\n\}/);
  assert.match(handler[0], /pickupAt\(x, y\)/);
  assert.match(handler[0], /pick\.kind === PERSON \? destroyPerson : destroyProject/);
  // The record is whatever the shared lookup named: no second DOM read here.
  assert.equal(handler[0].includes("closest("), true);
  assert.equal(handler[0].includes("rowhead"), false);
  assert.equal(handler[0].includes("stack__item"), false);
});

test("Delete refuses nothing for an archived row: the row is the record either way", () => {
  const handler = APP.match(/function onDeleteKey\(e\) \{[\s\S]*?\n\}/);
  assert.equal(handler[0].includes("archived"), false,
    "the Delete key asks nothing about archiving");
});

test("no dialog stands between the key and the delete", () => {
  assert.equal(/window\.confirm|confirm\(/.test(APP), false, "the app asks for no confirmation");
  const handler = APP.match(/function onDeleteKey\(e\) \{[\s\S]*?\n\}/);
  assert.equal(handler[0].includes("confirm"), false);
  // It does close a panel that was showing the record it just removed, so the
  // screen never keeps a panel open on something gone.
  assert.match(handler[0], /closePanel\(false\)/);
});

test("the notice speaks the store's count, never one counted on this side", () => {
  const handler = APP.match(/function onDeleteKey\(e\) \{[\s\S]*?\n\}/);
  assert.match(handler[0], /showToast\(deletionNotice\(pick\.kind, name, result\.assignments\)\)/);
  assert.match(handler[0], /if \(!result\) return;/);
  // Nothing is counted by filtering the plan the page holds.
  ["filter(", "length"].forEach((word) => {
    assert.equal(handler[0].includes(word), false, "the notice must not count " + word);
  });
});

test("the two destroy paths hand the store's answer back once the screen refreshed", () => {
  ["destroyPerson", "destroyProject"].forEach((name) => {
    const destroy = APP.match(new RegExp("function " + name + "\\(id\\) \\{[\\s\\S]*?\\n\\}"));
    assert.ok(destroy, name + " is the one destroy path");
    assert.match(destroy[0], /return api\("DELETE"/);
    assert.match(destroy[0], /\.then\(afterDestroy\)/);
    assert.match(destroy[0], /\.catch\(showError\)/);
  });
  // The answer is the store's own, carried through the refresh so a caller can
  // name the cascade; a failed write answers nothing.
  const after = APP.match(/function afterDestroy\(result\) \{[\s\S]*?\n\}/);
  assert.ok(after, "afterDestroy carries the store's answer");
  assert.match(after[0], /return refresh\(\)\.then\(function \(\) \{ return result; \}\);/);
});

/* --- the feature reference ----------------------------------------------- */

test("the feature reference documents the Delete key on all three surfaces", () => {
  const prose = FEATURES.replace(/\s+/g, " ");
  assert.match(prose, /`Delete` over a row header is the panel's own Delete with no dialog/);
  assert.match(prose, /`Delete` over a rail row is the panel's own Delete with no dialog/);
  assert.match(prose, /`Deleted "Anna Meier" and their 3 Assignments`/);
  assert.match(prose, /`Deleted "Atlas" and its 3 Assignments`/);
  assert.match(prose, /The `Delete` key needs only the pointer over a block, a row header or a rail row/);
  // The archived row is fair game too, and Undo is the safety net for all of it.
  assert.match(prose, /The `Delete` key over an archived row deletes it as it deletes a live one/);
  assert.match(prose, /\[Undo\]\(\.\.\/GLOSSARY\.md#undo\) steps the whole removal back/);
  assert.match(prose, /\[Undo\]\(\.\.\/GLOSSARY\.md#undo\) is one step back for all of it/);
});
