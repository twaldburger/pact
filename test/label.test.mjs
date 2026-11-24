import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOCK_LABEL_DEFAULT,
  BLOCK_LABEL_SETTINGS,
  blockLabel,
  blockTitle,
  hoverText,
  isBlockLabel,
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

test("the range label names both years when they differ", () => {
  assert.equal(rangeLabel("2026-09-01", "2027-10-31"), "Sep 2026 - Oct 2027");
});

test("the range label names the year once when the months share it", () => {
  assert.equal(rangeLabel("2026-09-01", "2026-10-31"), "Sep - Oct 2026");
});

test("the range label names a single month on its own", () => {
  assert.equal(rangeLabel("2026-09-01", "2026-09-30"), "Sep 2026");
});

/* --- what a block's label names ------------------------------------------- */

test("the Block label setting chooses the first part and the Share stays last", () => {
  // The three settings, each composed exactly as labelText draws it.
  assert.equal(labelText(blockTitle("project", "Atlas Platform Rebuild", "PDF export"), SHARE),
    "Atlas Platform Rebuild \u00b7 60%");
  assert.equal(labelText(blockTitle("assignment", "Atlas Platform Rebuild", "PDF export"), SHARE),
    "PDF export \u00b7 60%");
  assert.equal(labelText(blockTitle("both", "Atlas Platform Rebuild", "PDF export"), SHARE),
    "PDF export \u00b7 Atlas Platform Rebuild \u00b7 60%");
});

test("a nameless Assignment falls back to its Project's name, never a bare percentage", () => {
  // A rule, not a preference: under either setting that asks for the name, a
  // block with no name of its own still says which Project it belongs to.
  assert.equal(blockTitle("assignment", "Atlas", ""), "Atlas");
  assert.equal(blockTitle("both", "Atlas", ""), "Atlas");
  // The same for a name that is only whitespace, and for one stored as absent.
  assert.equal(blockTitle("assignment", "Atlas", "   "), "Atlas");
  assert.equal(blockTitle("assignment", "Atlas", undefined), "Atlas");
  assert.equal(blockTitle("assignment", "Atlas", null), "Atlas");
  // Under `both` the block shows the one name that exists.
  assert.equal(labelText(blockTitle("both", "Atlas", ""), SHARE), "Atlas \u00b7 60%");
  // The Project's own name is the setting that never looks at the Assignment.
  assert.equal(blockTitle("project", "Atlas", "PDF export"), "Atlas");
});

test("an unknown or absent setting reads as the Project's name alone", () => {
  [undefined, null, "", "title", "Both", 2].forEach((setting) => {
    assert.equal(blockTitle(setting, "Atlas", "PDF export"), "Atlas", String(setting));
  });
});

test("the hover text carries the label the setting chose, name and note together", () => {
  const both = labelText(blockTitle("both", "Atlas", "PDF export"), SHARE);
  assert.equal(hoverText(blockTitle("both", "Atlas", "PDF export"), SHARE, "Ships with Lumen"),
    both + "\nShips with Lumen");
  // A named block with room for the whole label draws that same label.
  const named = blockLabel(Object.assign({}, room, {
    title: blockTitle("both", "Atlas", "PDF export"),
    width: widthOf(labelText("PDF export \u00b7 Atlas", SHARE).length)
  }));
  assert.equal(named, "PDF export \u00b7 Atlas \u00b7 60%");
});

test("the three settings are the whole vocabulary, and the default is the Project's name", () => {
  assert.deepEqual(BLOCK_LABEL_SETTINGS, ["project", "assignment", "both"]);
  assert.equal(BLOCK_LABEL_DEFAULT, "project");
  BLOCK_LABEL_SETTINGS.forEach((name) => assert.equal(isBlockLabel(name), true));
  [undefined, null, "", "title", "Both", 1].forEach((value) => assert.equal(isBlockLabel(value), false));
});
