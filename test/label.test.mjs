import test from "node:test";
import assert from "node:assert/strict";
import {
  blockLabel,
  labelText,
  ELLIPSIS,
  LABEL_MIN_CHARS
} from "../public/lib/label.mjs";

// A stand-in for the label's own font: every character is 7px wide, so a
// string's measured width is its length, and an expected label can be read
// straight off the string it is cut from.
const CHAR = 7;
const measure = (text) => text.length * CHAR;
const widthOf = (chars) => chars * CHAR;

const TITLE = "Design"; // 42px
const SHARE = 60;
const FULL = labelText(TITLE, SHARE); // "Design \u00b7 60%" - 84px

// A block with room for the whole label, unless a test says otherwise.
const room = {
  width: widthOf(FULL.length),
  height: 20,
  textHeight: 11,
  title: TITLE,
  share: SHARE,
  measure: measure
};

test("a block wide enough for the whole label draws the name and its share", () => {
  assert.equal(blockLabel(room), FULL);
  // Any room to spare draws it too.
  assert.equal(blockLabel({ ...room, width: widthOf(FULL.length) + 30 }), FULL);
});

test("the boundary between the whole label and less than it is exact", () => {
  assert.equal(blockLabel({ ...room, width: widthOf(FULL.length) }), FULL);
  const short = blockLabel({ ...room, width: widthOf(FULL.length) - 1 });
  assert.notEqual(short, FULL);
  assert.equal(short, TITLE);
});

test("a block that cannot hold the share draws the whole title, without an ellipsis", () => {
  assert.equal(blockLabel({ ...room, width: widthOf(TITLE.length) }), TITLE);
  assert.ok(!blockLabel({ ...room, width: widthOf(TITLE.length) }).includes(ELLIPSIS));
});

test("a narrower block draws the title cut, ending in an ellipsis", () => {
  assert.equal(blockLabel({ ...room, width: widthOf(TITLE.length) - 1 }), "Desi" + ELLIPSIS);
  assert.equal(blockLabel({ ...room, width: widthOf(TITLE.length - 1) }), "Desi" + ELLIPSIS);
  assert.equal(blockLabel({ ...room, width: widthOf(TITLE.length - 2) }), "Des" + ELLIPSIS);
});

test("a block too narrow for a meaningful cut draws nothing", () => {
  // Exactly enough for the shortest cut there is, then one pixel less.
  const shortest = widthOf(LABEL_MIN_CHARS + 1); // the cut title and its ellipsis
  assert.equal(blockLabel({ ...room, width: shortest }), TITLE.slice(0, LABEL_MIN_CHARS) + ELLIPSIS);
  assert.equal(blockLabel({ ...room, width: shortest - 1 }), "");
  assert.equal(blockLabel({ ...room, width: 0 }), "");
  assert.equal(blockLabel({ ...room, width: -5 }), "");
});

test("the share is never drawn alone", () => {
  // Wide enough for "60%", far too narrow for three letters of the name.
  const label = blockLabel({ ...room, width: widthOf(3) });
  assert.equal(label, "");
  assert.ok(!label.includes(SHARE + "%"));
});

test("a block without the height for one line of text draws nothing", () => {
  assert.equal(blockLabel({ ...room, height: 11 }), FULL);
  assert.equal(blockLabel({ ...room, height: 10.9 }), "");
  assert.equal(blockLabel({ ...room, height: 0 }), "");
});

test("the width and the height are both needed, at any zoom", () => {
  // A two-month block at month zoom: 5px a day is 300px, ample for the label,
  // whatever height the row it sits in is drawn at.
  assert.equal(blockLabel({ ...room, width: 300, height: 30 }), FULL);
  // The same block with no room for a line draws nothing.
  assert.equal(blockLabel({ ...room, width: 300, height: 4 }), "");
});
