import test from "node:test";
import assert from "node:assert/strict";
import {
  PALETTES,
  PALETTE_DEFAULT,
  PALETTE_NAMES,
  SLOT_COUNT,
  LEGACY_SLOTS,
  isPalette,
  slotForColour,
  leastUsedSlot,
  labelInkFor,
  bestLabelContrast,
  LABEL_WHITE,
  DEEP_INK
} from "../public/lib/palette.mjs";

test("both palettes are the ColorBrewer schemes, ten exact fills each", () => {
  assert.deepEqual(PALETTES.paired, [
    "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99",
    "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a"
  ]);
  assert.deepEqual(PALETTES.set3, [
    "#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3",
    "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd"
  ]);
  PALETTE_NAMES.forEach((name) => assert.equal(PALETTES[name].length, SLOT_COUNT));
});

test("Paired is the default and only the two names are palettes", () => {
  assert.equal(PALETTE_DEFAULT, "paired");
  assert.deepEqual(PALETTE_NAMES, ["paired", "set3"]);
  assert.equal(isPalette("paired"), true);
  assert.equal(isPalette("set3"), true);
  assert.equal(isPalette("vibrant"), false);
  assert.equal(isPalette(undefined), false);
});

test("the label ink is whichever of white and deep ink contrasts more", () => {
  // A dark fill takes white; Set3's pastels and Paired's mid-tones take ink.
  assert.equal(labelInkFor("#1f78b4"), LABEL_WHITE);
  assert.equal(labelInkFor("#e31a1c"), LABEL_WHITE);
  assert.equal(labelInkFor("#ffffb3"), DEEP_INK);
  assert.equal(labelInkFor("#a6cee3"), DEEP_INK);
  // Pure white is the extreme light case.
  assert.equal(labelInkFor("#ffffff"), DEEP_INK);
});

test("every fill's chosen ink is the best one, and only two fall short of 4.5:1", () => {
  const fills = PALETTES.paired.concat(PALETTES.set3);
  // The chosen ink is the better of the two, by construction.
  fills.forEach((hex) => {
    assert.ok(labelInkFor(hex) === LABEL_WHITE || labelInkFor(hex) === DEEP_INK);
    assert.ok(bestLabelContrast(hex) >= 1);
  });
  // Neither ink reaches 4.5:1 on exactly these two mid-tone fills; every other
  // fill meets it with the adaptive ink.
  assert.deepEqual(
    fills.filter((hex) => bestLabelContrast(hex) < 4.5),
    ["#33a02c", "#bc80bd"]
  );
});

test("the six legacy ink names migrate onto six distinct slots", () => {
  const names = ["steel", "moss", "teal", "iris", "plum", "umber"];
  const slots = names.map((name) => slotForColour(name));
  assert.deepEqual(slots, [1, 3, 0, 9, 5, 7]);
  assert.equal(new Set(slots).size, names.length);
  slots.forEach((slot) => assert.ok(slot >= 0 && slot < SLOT_COUNT));
  // The mapping is the names' own, exposed for the store.
  assert.deepEqual(Object.keys(LEGACY_SLOTS).sort(), names.slice().sort());
});

test("a colour is a slot 0..9; a legacy name migrates and anything else is null", () => {
  assert.equal(slotForColour(0), 0);
  assert.equal(slotForColour(9), 9);
  assert.equal(slotForColour("plum"), 5);
  assert.equal(slotForColour(10), null);
  assert.equal(slotForColour(-1), null);
  assert.equal(slotForColour(1.5), null);
  assert.equal(slotForColour("nope"), null);
  assert.equal(slotForColour(undefined), null);
});

test("a new Project's slot is the least used, ties to the lowest", () => {
  assert.equal(leastUsedSlot([]), 0);
  // Two on slot 0 and one on slot 1: slot 2 is first with the fewest.
  assert.equal(leastUsedSlot([{ colour: 0 }, { colour: 0 }, { colour: 1 }]), 2);
  // Everything on one slot: the first unused slot wins.
  assert.equal(leastUsedSlot([{ colour: 5 }, { colour: 5 }, { colour: 5 }]), 0);
  // A missing or malformed colour counts for nothing.
  assert.equal(leastUsedSlot([{ colour: null }, { colour: "nope" }, {}]), 0);
  // A legacy name still counts as its slot when the plan is being read.
  assert.equal(leastUsedSlot([{ colour: "steel" }, { colour: "moss" }]), 0);
});
