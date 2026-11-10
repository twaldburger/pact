import test from "node:test";
import assert from "node:assert/strict";
import {
  blockLabel,
  hoverText,
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

// The native title on hover: the label, then the Assignment's note on a second
// line whenever there is one. Only the hover text carries the note; the drawn
// labels above and inside the block are untouched.
test("a block's hover text is its label and its note on a second line", () => {
  assert.equal(hoverText(TITLE, SHARE, "Ships with Lumen"),
    FULL + "\nShips with Lumen");
});

test("a note is written as stored, so its own spacing survives", () => {
  assert.equal(hoverText(TITLE, SHARE, "  Ships\nwith Lumen  "),
    FULL + "\n  Ships\nwith Lumen  ");
});

test("a block with no note hovers as the label alone", () => {
  assert.equal(hoverText(TITLE, SHARE, ""), FULL);
  assert.equal(hoverText(TITLE, SHARE, undefined), FULL);
  assert.equal(hoverText(TITLE, SHARE, null), FULL);
});

test("a whitespace-only note adds no second line", () => {
  assert.equal(hoverText(TITLE, SHARE, "   "), FULL);
  assert.equal(hoverText(TITLE, SHARE, "\n\t"), FULL);
});

test("the hover text does not change what the block draws", () => {
  // The same label, whether or not a note rides beneath it on hover.
  assert.equal(hoverText(TITLE, SHARE, "Ships with Lumen").split("\n")[0],
    blockLabel(room));
});

// The word-boundary cut: a title of more than one word prefers the longest
// whole-word prefix that fits, and only cuts inside a word when no boundary
// does. The cut drops the whitespace the ellipsis replaces, so `Meridian
// Design...` has no space before the dots.
const LONG = "Meridian Design System"; // 22 chars
const longRoom = { ...room, title: LONG };

test("a long two-word name cuts at the word boundary, beside the ellipsis", () => {
  // Room for "Meridian Design…" (16 chars) but not the whole title (22).
  assert.equal(blockLabel({ ...longRoom, width: widthOf(17) }), "Meridian Design" + ELLIPSIS);
  assert.equal(blockLabel({ ...longRoom, width: widthOf(16) }), "Meridian Design" + ELLIPSIS);
  // The space the ellipsis replaces is dropped, not left before the dots.
  assert.ok(!blockLabel({ ...longRoom, width: widthOf(16) }).includes(" " + ELLIPSIS));
});

test("a narrower block drops to the next word boundary before cutting a word", () => {
  assert.equal(blockLabel({ ...longRoom, width: widthOf(15) }), "Meridian" + ELLIPSIS);
  assert.equal(blockLabel({ ...longRoom, width: widthOf(9) }), "Meridian" + ELLIPSIS);
});

test("a single unbreakable word falls back to the character-level cut", () => {
  // "Meridian" has no internal boundary; "Meridian…" is 9 chars and does not fit.
  assert.equal(blockLabel({ ...room, title: "Meridian", width: widthOf(7) }), "Meridi" + ELLIPSIS);
  assert.equal(blockLabel({ ...room, title: "Meridian", width: widthOf(6) }), "Merid" + ELLIPSIS);
});

test("the character-level cut is the fallback when not even the first word fits", () => {
  // Too narrow for "Meridian…" (9), so the longest fitting fragment is used.
  assert.equal(blockLabel({ ...longRoom, width: widthOf(8) }), "Meridia" + ELLIPSIS);
});

test("the three-character floor holds for a word-boundary title too", () => {
  // "Mer…" is the shortest cut there is, at four measured characters.
  assert.equal(blockLabel({ ...longRoom, width: widthOf(4) }), "Mer" + ELLIPSIS);
  assert.equal(blockLabel({ ...longRoom, width: widthOf(3) }), "");
});

test("the whole label and the bare name still win over any word-boundary cut", () => {
  const full = labelText(LONG, SHARE); // 29 chars
  assert.equal(blockLabel({ ...longRoom, width: widthOf(full.length) }), full);
  assert.equal(blockLabel({ ...longRoom, width: widthOf(LONG.length) }), LONG);
  assert.equal(blockLabel({ ...longRoom, width: widthOf(LONG.length + 1) }), LONG);
});

test("a paper label still never cuts a multi-word name", () => {
  // `minChars` at the title's own length turns every cut off, word boundary
  // included, so the paper reads the whole name or nothing.
  const paperLong = { ...paper, title: LONG, minChars: LONG.length };
  assert.equal(blockLabel({ ...paperLong, width: widthOf(LONG.length - 1) }), "");
  assert.ok(!blockLabel({ ...paperLong, width: widthOf(LONG.length - 1) }).includes(ELLIPSIS));
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
