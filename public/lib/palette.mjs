/*
 * PACT project colour palettes: the two ColorBrewer schemes, each an ordered
 * list of ten fills, and the two rules that turn a fill into legible ink and a
 * new Project into the least-used colour.
 *
 * A Project's colour is a slot - a whole number 0..9 into whichever palette is
 * active - never a hex and never a palette's own name. The two palettes map the
 * same slots to different fills, so switching palette recolours every Project
 * without changing which Project it is.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source. Every rule here is pure.
 */

// The two schemes, in their published order. Ten colours each; the slot is the
// index into these lists.
export const PALETTES = {
  paired: [
    "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99",
    "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a"
  ],
  set3: [
    "#8dd3c7", "#ffffb3", "#bebada", "#fb8072", "#80b1d3",
    "#fdb462", "#b3de69", "#fccde5", "#d9d9d9", "#bc80bd"
  ]
};

// The colours' original scheme names, the two choices the Options menu offers.
export const PALETTE_NAMES = ["paired", "set3"];
export const PALETTE_LABELS = { paired: "Paired", set3: "Set3" };
export const PALETTE_DEFAULT = "paired";
export const SLOT_COUNT = 10;

export function isPalette(name) {
  return PALETTE_NAMES.indexOf(name) !== -1;
}

/*
 * The six ink names the plan used before colour became a slot, each mapped onto
 * one distinct slot. The mapping is fixed so a stored name always migrates to
 * the same slot, and the six are spread across the palette rather than
 * clustered. `steel` and `teal` are blue, `moss` green, `iris` and `plum`
 * purple, `umber` orange-brown.
 */
export const LEGACY_SLOTS = {
  steel: 1,
  teal: 0,
  moss: 3,
  plum: 5,
  umber: 7,
  iris: 9
};

/*
 * A valid colour as a slot, or null. A stored slot 0..9 passes through; a
 * legacy ink name is migrated to its slot. Everything else is not a colour.
 */
export function slotForColour(value) {
  if (Number.isInteger(value) && value >= 0 && value < SLOT_COUNT) return value;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(LEGACY_SLOTS, value)) {
    return LEGACY_SLOTS[value];
  }
  return null;
}

/*
 * The slot a new Project should take: the least-used among the plan's Projects,
 * so a new one is least likely to sit beside a Project of the same colour. Ties
 * go to the lowest slot, so the answer is deterministic. A missing or malformed
 * colour counts for nothing rather than breaking the count.
 */
export function leastUsedSlot(projects) {
  const counts = new Array(SLOT_COUNT).fill(0);
  (Array.isArray(projects) ? projects : []).forEach((project) => {
    const slot = slotForColour(project && project.colour);
    if (slot !== null) counts[slot] += 1;
  });
  let best = 0;
  for (let i = 1; i < SLOT_COUNT; i++) {
    if (counts[i] < counts[best]) best = i;
  }
  return best;
}

/* --- contrast ------------------------------------------------------------ */

// The app's deep ink (--ink), the alternative to white on a project fill.
export const LABEL_WHITE = "#FFFFFF";
export const DEEP_INK = "#16323A";

function channels(hex) {
  const h = String(hex).replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16)
  ];
}

// Relative luminance per WCAG 2.x: sRGB channels linearised, then weighted.
function luminance(hex) {
  const parts = channels(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function contrast(a, b) {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/*
 * The ink that reads best on a fill: white when white has the higher contrast,
 * otherwise the app's deep ink. Both ColorBrewer schemes are light map fills,
 * so the pastels take the deep ink and only the darker members take white.
 */
export function labelInkFor(hex) {
  return contrast(hex, LABEL_WHITE) > contrast(hex, DEEP_INK) ? LABEL_WHITE : DEEP_INK;
}

// The better of the two inks' contrast against a fill, the most a label on it
// can ever meet.
export function bestLabelContrast(hex) {
  return Math.max(contrast(hex, LABEL_WHITE), contrast(hex, DEEP_INK));
}
