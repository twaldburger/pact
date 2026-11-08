import test from "node:test";
import assert from "node:assert/strict";
import {
  blockLabel,
  labelText,
  rangeLabel,
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

// The paper label above a block is one line of the same type, and its room is
// the band above the block rather than the block's own box. The whole label is
// preferred, then the bare name, then nothing; the cut the inside label falls
// back to is not offered, which is what `minChars` at the title's own length
// turns off.
const paper = {
  height: 11,
  textHeight: 11,
  title: TITLE,
  share: SHARE,
  minChars: TITLE.length,
  measure: measure
};

test("a paper label whose band fits the whole label draws the name and the share", () => {
  assert.equal(blockLabel({ ...paper, width: widthOf(FULL.length) }), FULL);
});

test("a paper label whose band fits only the name draws the bare name", () => {
  assert.equal(blockLabel({ ...paper, width: widthOf(FULL.length) - 1 }), TITLE);
  assert.equal(blockLabel({ ...paper, width: widthOf(TITLE.length) }), TITLE);
});

test("a paper label whose band fits neither draws nothing, never a cut", () => {
  assert.equal(blockLabel({ ...paper, width: widthOf(TITLE.length) - 1 }), "");
  assert.equal(blockLabel({ ...paper, width: 0 }), "");
  assert.ok(!blockLabel({ ...paper, width: widthOf(TITLE.length) - 1 }).includes(ELLIPSIS));
});

test("the range label names both years when they differ", () => {
  assert.equal(rangeLabel("2026-09-01", "2027-10-31"), "Sep 2026 - Oct 2027");
});

test("the range label names the year once when the months share it", () => {
  assert.equal(rangeLabel("2026-09-01", "2026-10-31"), "Sep - Oct 2026");
});

test("the range label names a single month on its own", () => {
  assert.equal(rangeLabel("2026-09-01", "2026-09-30"), "Sep 2026");
});
