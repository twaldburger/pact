import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PALETTES, labelInkFor } from "../public/lib/palette.mjs";

// The interface's one stylesheet and the script that feeds it the per-block
// tokens. Both are read here so a colour token that is referenced but no longer
// defined is caught by `node --test` instead of shipping as a transparent fill.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(full);
    return /\.(js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

// Every `var(--x)` with no fallback: those are the references that need the
// property to exist. A reference with a fallback reads either way.
function referencedTokens(css) {
  const names = [];
  for (const m of css.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,[^)]*)?\)/g)) {
    if (!m[2]) names.push(m[1]);
  }
  return names;
}

// Custom properties style.css defines, plus the ones app.js sets on elements
// (`setProperty("--x", ...)`) - the block fill and label, the geometry and the
// palette chips all arrive that way.
function definedTokens(css, files) {
  const names = new Set();
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) names.add(m[1]);
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/setProperty\(\s*["'](--[a-z0-9-]+)["']/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

test("every custom property style.css reads is defined in the CSS or set by the script", () => {
  const defined = definedTokens(STYLE, filesUnder(PUBLIC));
  const missing = [...new Set(referencedTokens(STYLE))].filter((name) => !defined.has(name));
  assert.deepEqual(missing, []);
});

/* --- the Assignment hover ------------------------------------------------ */

// The hover rule, and the mix it draws, lifted from the stylesheet so the test
// tracks the real value rather than a copy of it.
const HOVER = STYLE.match(/\.blk:hover,\s*\.blk:focus-visible\s*\{([^}]*)\}/);

function hoverMix() {
  assert.ok(HOVER, "the .blk:hover, .blk:focus-visible rule is missing");
  const mix = HOVER[1].match(
    /color-mix\(\s*in srgb,\s*var\((--[a-z0-9-]+)\)\s*([0-9.]+)%\s*,\s*var\((--[a-z0-9-]+)\)\s*\)/
  );
  assert.ok(mix, "the hover background is not an opaque sRGB color-mix");
  return { ink: mix[1], percent: Number(mix[2]), base: mix[3] };
}

function channels(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// CSS `color-mix(in srgb, ...)` interpolates the gamma-encoded channels.
function mix(a, b, percent) {
  const p = percent / 100;
  const out = channels(a).map((v, i) => Math.round(v * (1 - p) + channels(b)[i] * p));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}

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
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test("the hover mixes --block-label into --block-ink at a visible step", () => {
  const { ink, base, percent } = hoverMix();
  const defined = definedTokens(STYLE, filesUnder(PUBLIC));
  assert.ok(defined.has(ink), ink + " is not defined");
  assert.ok(defined.has(base), base + " is not defined");
  // The label ink is the per-block ink that reads on the fill, so the mix is a
  // quiet step in one direction or the other for every project colour.
  assert.equal(ink, "--block-label");
  assert.equal(base, "--block-ink");
  assert.ok(percent > 0 && percent < 50, "a hover mix of " + percent + "%");
});

test("on hover every fill changes and its label ink stays legible", () => {
  const { percent } = hoverMix();
  const fills = PALETTES.paired.concat(PALETTES.set3);
  for (const fill of fills) {
    const labelInk = labelInkFor(fill);
    const hovered = mix(fill, labelInk, percent);
    // The fill is replaced by an opaque colour, not left transparent.
    assert.match(hovered, /^#[0-9a-f]{6}$/);
    // One quiet step, but a step: the hovered fill reads as a different colour.
    assert.notEqual(hovered, fill);
    assert.ok(
      contrast(fill, hovered) >= 1.05,
      "hover on " + fill + " is too faint (" + contrast(fill, hovered).toFixed(3) + ")"
    );
    // The label ink chosen for the base fill still clears the WCAG floor for
    // large text and interface graphics once the fill is hovered.
    assert.ok(
      contrast(hovered, labelInk) >= 3,
      "label on hovered " + fill + " falls to " + contrast(hovered, labelInk).toFixed(2)
    );
  }
});

/* --- the Marker's date in the header ------------------------------------- */

// The date chip was drawn at the top of the marker element, which is the top
// of the scrolling content, so it scrolled out of view once the grid scrolled.
// It is now anchored to the sticky axis at the Marker's x; these two assertions
// pin both halves of that so neither half can drift back on its own.
const MARKER_DATE = STYLE.match(/\.marker__date\s*\{([^}]*)\}/);

test("the Marker's date is anchored to the sticky axis at the marker's x", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.ok(MARKER_DATE, "the .marker__date rule is missing");
  const left = MARKER_DATE[1].match(/left:\s*([^;]+);/);
  assert.ok(left, "the .marker__date rule has no left");
  assert.equal(
    left[1].replace(/\s+/g, " ").trim(),
    "calc((var(--i) + 0.5) * var(--day-w) + var(--sp-3))"
  );
  // The chip hangs off the axis, not the marker, and carries the Marker's index.
  assert.match(APP, /axisEl\.appendChild\(markerDate\)/);
  assert.match(APP, /markerDate\.style\.setProperty\("--i", markerIndex\)/);
  // A click in the header places the Marker - not a press, which would sweep -
  // and the chip is its own drag handle rather than a spot on the band.
  assert.match(APP, /axis\.addEventListener\("click", onAxisClick\)/);
  assert.match(APP, /function onAxisClick\(e\) \{[^}]*setMarker\(indexFromClientX\(e\.clientX\)\)/);
  assert.match(APP, /e\.target\.closest\("\.marker__date"\)/);
  assert.match(APP, /markerDate\.addEventListener\("pointerdown", onChipDown\)/);
});

/* --- the Grid dividers and the axis separators share the boundary --------- */

// The full-height Grid dividers sit on the true day boundary
// B = (i + n) * var(--day-w), the position the blocks and the weekend band use.
// The axis separator is an absolutely positioned 1px ink laid against the
// cell's padding edge. A right border on the cell - opaque or transparent -
// moves that edge one pixel left of B, because absolute positioning resolves
// against the padding edge rather than the border box, so the ink lands on
// B - 1 and reads a pixel off the divider. With no right border the padding
// edge is B and right: -1px hangs the ink onto B; the cell also keeps its full
// content width, so a centred day number keeps the cell's true centre.
const AX = STYLE.match(/\.ax\s*\{([^}]*)\}/);
const AX_AFTER = STYLE.match(/\.ax::after\s*\{([^}]*)\}/);

test("the axis separator ink lands on the Grid divider's boundary", () => {
  assert.ok(AX, "the .ax rule is missing");
  assert.ok(AX_AFTER, "the .ax::after rule is missing");
  // No right border on the cell or on .ax-day / .ax-week / .ax-month: any
  // such border would pull the ink a pixel left of the boundary.
  assert.equal(
    /\.ax(?![a-z])[^{}]*\{[^}]*border-right\s*:/.test(STYLE),
    false,
    "an axis cell still carries a right border"
  );
  const right = AX_AFTER[1].match(/right:\s*(-?[\d.]+)px\s*;/);
  const width = AX_AFTER[1].match(/width:\s*([\d.]+)px\s*;/);
  assert.ok(right, "the .ax::after rule has no right offset");
  assert.ok(width, "the .ax::after rule has no width");
  // The ink's left edge is B - right - width, so it sits on B when
  // -right - width is zero.
  assert.equal(-Number(right[1]) - Number(width[1]), 0);
});

/* --- the zoom day widths ------------------------------------------------- */

// The drawn width of one day per zoom, so a zoom cannot silently drift from
// the density the interface promises. Sprint is half the Week zoom's, so a
// 14-day sprint cell and a Week zoom's 7-day cell span the same width.
const ROOT_REM_PX = 16;

function dayWidthPx(zoom) {
  const rule = STYLE.match(new RegExp('\\[data-zoom="' + zoom + '"\\]\\s*\\{([^}]*)\\}'));
  assert.ok(rule, "no [data-zoom=\"" + zoom + "\"] rule");
  const value = rule[1].match(/--day-w:\s*([\d.]+)rem\s*;/);
  assert.ok(value, "[data-zoom=\"" + zoom + "\"] sets no rem --day-w");
  return Number(value[1]) * ROOT_REM_PX;
}

function sprintCellPx(days) {
  return dayWidthPx("sprint") * days;
}

test("the Sprint zoom's day is half the Week zoom's", () => {
  assert.equal(dayWidthPx("week"), 16);
  assert.equal(dayWidthPx("sprint"), 8);
});

test("a 14-day sprint cell equals a Week zoom's 7-day cell", () => {
  assert.equal(sprintCellPx(14), dayWidthPx("week") * 7);
});

/* --- the Filter control's fixed footprint -------------------------------- */

// The Look in button's summary text changes length with the scope, so its
// width is one constant and its text ellipsises rather than resizing the
// control. The whole rule is read from the stylesheet so the assertion tracks
// the real declaration.
const SCOPE = STYLE.match(/\.filter__scope\s*\{([^}]*)\}/);

test("the Look in button reserves one width and ellipsises a long summary", () => {
  assert.ok(SCOPE, "the .filter__scope rule is missing");
  const width = SCOPE[1].match(/width:\s*([^;]+);/);
  assert.ok(width, "the .filter__scope rule has no width");
  assert.equal(width[1].trim(), "var(--scope-w)");
  // A fixed width only holds if the button cannot grow or shrink as a flex
  // item, and ellipsis only reaches text that overflows a block container.
  assert.match(SCOPE[1], /flex:\s*0 0 auto/);
  assert.match(SCOPE[1], /display:\s*block/);
  assert.match(SCOPE[1], /overflow:\s*hidden/);
  assert.match(SCOPE[1], /text-overflow:\s*ellipsis/);
  assert.match(SCOPE[1], /white-space:\s*nowrap/);
  // The width is a token, so the scope selection has no way to change it.
  assert.match(STYLE, /--scope-w:\s*[^;]+;/);
});

/* --- the Panels' bound to the viewport ----------------------------------- */

// A panel is fixed and used to grow with its body, so the Sprints panel's
// derived chain ran past the bottom of the window and its footer - where
// "Save cadence" and "Clear cadence" live - could not be reached at all. The
// bound lives on the shared .panel rule so it covers every panel, and the
// footer sticks to the panel's bottom while the body scrolls under it.
const PANEL = STYLE.match(/\.panel\s*\{([^}]*)\}/);
const PANEL_FOOT = STYLE.match(/\.panel__foot\s*\{([^}]*)\}/);

function declaration(rule, name) {
  // Comments inside the rule carry prose with colons and semicolons of their
  // own, so strip them before reading a declaration.
  const found = rule.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(name + ":\\s*([^;]+);"));
  assert.ok(found, name + " is missing from the rule");
  return found[1].replace(/\s+/g, " ").trim();
}

test("a panel is bounded to the viewport and scrolls its own content", () => {
  assert.ok(PANEL, "the .panel rule is missing");
  const maxHeight = declaration(PANEL[1], "max-height");
  assert.match(
    maxHeight,
    /^calc\(\s*100(?:dvh|vh)\s*-/,
    "the bound must be the viewport less the anchor margin, not " + maxHeight
  );
  // A viewport bound only holds the panel in place if its own content can
  // scroll rather than pushing the box taller.
  assert.equal(declaration(PANEL[1], "overflow-y"), "auto");
});

test("a panel's footer sticks to its bottom so its actions stay reachable", () => {
  assert.ok(PANEL_FOOT, "the .panel__foot rule is missing");
  assert.equal(declaration(PANEL_FOOT[1], "position"), "sticky");
  assert.equal(declaration(PANEL_FOOT[1], "bottom"), "0");
  // The footer paints its own bottom padding because the panel carries none,
  // so the scrolling body cannot show in a band below the actions.
  assert.equal(declaration(PANEL_FOOT[1], "padding-bottom"), "var(--sp-5)");
  assert.equal(declaration(PANEL[1], "padding"), "var(--sp-5) var(--sp-5) 0");
});

/* --- the absence bar's hatch ---------------------------------------------- */

// An absence is drawn hatched all over, distinctly from the over-allocation
// band's top strip, so the two treatments cannot be confused on the grid.
const ABSENCE_HATCH = STYLE.match(/\.blk\.is-absence::before\s*\{([^}]*)\}/);
const OVER_HATCH = STYLE.match(/\.blk__hatch\s*\{([^}]*)\}/);

test("an absence block is hatched all over, not with the over-allocation band", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.ok(ABSENCE_HATCH, "the .blk.is-absence::before rule is missing");
  assert.ok(OVER_HATCH, "the .blk__hatch rule is missing");
  // The absence hatch covers the whole block and follows a repeating gradient.
  assert.match(ABSENCE_HATCH[1], /inset:\s*0/);
  assert.match(ABSENCE_HATCH[1], /repeating-linear-gradient/);
  assert.doesNotMatch(ABSENCE_HATCH[1], /height:\s*var\(--hatch-px\)/);
  // The over-allocation band is only the top strip, in --signal.
  assert.match(OVER_HATCH[1], /height:\s*var\(--hatch-px\)/);
  assert.match(OVER_HATCH[1], /var\(--signal\)/);
  // The class comes from the Project's own absence mark, and the block's label
  // is still read from the fill, so the hatch and the label agree.
  assert.match(APP, /a\.project\.absence/);
  assert.match(APP, /is-absence/);
});

/* --- the hollow untagged block ------------------------------------------- */

// The hollow treatment: once a block key is chosen, a block with no colour
// from it draws as an unfilled cell. The border is a 1px inset shadow on the
// block itself, so it is drawn inside the box and the block's width (the
// zoom's day width) and height (the row height) are untouched - an ordinary
// border would add to both. The shadow's ink is the mid --ink-soft, darker
// than the pale --rule of the grid dividers, so the two cannot be mistaken.
const HOLLOW = STYLE.match(/\.blk\.is-hollow\s*\{([^}]*)\}/);
const HOLLOW_HOVER = STYLE.match(/\.blk\.is-hollow:hover,\s*\.blk\.is-hollow:focus-visible\s*\{([^}]*)\}/);

test("a hollow block is unfilled and bordered inside its own box", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.ok(HOLLOW, "the .blk.is-hollow rule is missing");
  const rule = HOLLOW[1].replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(declaration(HOLLOW[1], "background"), "transparent");
  // The only edge is an inset shadow: drawn inside the box, and named as such.
  const shadow = declaration(HOLLOW[1], "box-shadow");
  assert.match(shadow, /inset/);
  assert.match(shadow, /0 0 0 1px/);
  // Nothing here adds to the block's size: no border, width or height.
  assert.doesNotMatch(rule, /(^|[;\s])border\s*:/);
  assert.doesNotMatch(rule, /(^|[;\s])border-width\s*:/);
  assert.doesNotMatch(rule, /(^|[;\s])width\s*:/);
  assert.doesNotMatch(rule, /(^|[;\s])height\s*:/);
  // The edge reads apart from the grid's own dividers.
  assert.doesNotMatch(shadow, /var\(--rule\)/);
  assert.doesNotMatch(shadow, /var\(--rule-strong\)/);
  assert.match(shadow, /var\(--ink-soft\)/);
  assert.match(STYLE, /--ink-soft:\s*#[0-9a-fA-F]{6};/);
  // The hover, which fills a coloured block, cannot fill a hollow one; it
  // lifts with a faint tint that leaves the border standing.
  assert.ok(HOLLOW_HOVER, "the hollow hover rule is missing");
  assert.match(declaration(HOLLOW_HOVER[1], "background"), /transparent/);
  // The state comes from the shared rule and the label takes the deep ink.
  assert.match(APP, /blockIsHollow\(/);
  assert.match(APP, /hollow \? " is-hollow" : ""/);
  assert.match(APP, /hollow \? DEEP_INK : labelInkFor\(/);
});

// An untagged absence must read as both: the hatch paints over the hollow
// block and takes the same --block-label, so neither replaces the other.
test("a hollow absence keeps its hatch", () => {
  const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");
  assert.ok(ABSENCE_HATCH, "the .blk.is-absence::before rule is missing");
  assert.match(ABSENCE_HATCH[1], /var\(--block-label\)/);
  // Both classes land on the one block, so the two treatments compose.
  assert.match(APP, /is-absence" : ""\) \+ \(hollow \? " is-hollow"/);
});

/* --- the absence and holiday check marks --------------------------------- */

// The Absence checkbox and the holiday radios were on the browser's own blue
// accent and the dark-red signal respectively. Both now read the same quiet
// ink as the bar's controls, and the checkbox sits at the left of its row's
// control column rather than stretching across it like a text field.
const ABSENCE_CHECK = STYLE.match(/\.form input\[type="checkbox"\]\s*\{([^}]*)\}/);
const HOLIDAY_RADIO = STYLE.match(
  /\.holiday-group \.holiday-row__kind input\[type="radio"\]\s*\{([^}]*)\}/
);

test("the absence and holiday marks read the app's ink, not the signal", () => {
  assert.ok(ABSENCE_CHECK, 'the .form input[type="checkbox"] rule is missing');
  assert.ok(HOLIDAY_RADIO, "the holiday radio rule is missing");
  assert.equal(declaration(ABSENCE_CHECK[1], "accent-color"), "var(--ink)");
  assert.equal(declaration(HOLIDAY_RADIO[1], "accent-color"), "var(--ink)");
  // A stretched grid item centres the native mark in the row; the checkbox
  // keeps its own size and starts at the control column's left edge.
  assert.equal(declaration(ABSENCE_CHECK[1], "width"), "auto");
  assert.equal(declaration(ABSENCE_CHECK[1], "justify-self"), "start");
});

/* --- the report's two totals --------------------------------------------- */

// The Total row is marked with the title weight and a stronger rule above it.
// The Total column carries the weight alone: the owner reads a leading rule as
// a hard edge he does not want, so the rule is gone and the weight is the mark.
// Lifted from the stylesheet so the test tracks the rules rather than a copy of
// them.
const TOTAL_ROW = STYLE.match(/\.report-row--total td\s*\{([^}]*)\}/);
const TOTAL_COLUMN = STYLE.match(/\.report-table \.report-table__total\s*\{([^}]*)\}/);

test("the Total column keeps the Total row's weight and draws no rule of its own", () => {
  assert.ok(TOTAL_ROW, "the .report-row--total rule is missing");
  assert.ok(TOTAL_COLUMN, "the .report-table__total rule is missing");
  // The same weight, from the same token as the row.
  assert.equal(declaration(TOTAL_ROW[1], "font-weight"), "var(--fw-title)");
  assert.equal(declaration(TOTAL_COLUMN[1], "font-weight"), declaration(TOTAL_ROW[1], "font-weight"));
  // The row keeps its own stronger rule above it; the column takes no rule at
  // all, vertical or otherwise, so nothing draws a divider before its cells.
  assert.equal(declaration(TOTAL_ROW[1], "border-top"), "var(--base) solid var(--rule-strong)");
  assert.doesNotMatch(TOTAL_COLUMN[1], /border(-(top|right|bottom|left))?\s*:/,
    "the Total column still draws a rule");
  // The weight is the column's whole mark.
  const marks = TOTAL_COLUMN[1].replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";").map((d) => d.trim()).filter(Boolean);
  assert.deepEqual(marks, ["font-weight: var(--fw-title)"]);
});

// A collapsed border between two cells is resolved in favour of the topmost
// cell's, so the pale rule under the row above outbid the Total row's own strong
// top rule of the same width and the stronger ink never reached the screen. The
// row above yields that edge and the Total row's rule is the one drawn.
const YIELDING_ROW = STYLE.match(
  /\.report-table tbody tr:has\(\+ \.report-row--total\) td\s*\{([^}]*)\}/
);

test("the row above the Total row yields its rule so the strong one paints", () => {
  assert.ok(YIELDING_ROW, "the rule above the Total row is not yielded");
  assert.equal(declaration(YIELDING_ROW[1], "border-bottom"), "none");
  // The edge still exists: it is the Total row's own stronger rule.
  assert.equal(declaration(TOTAL_ROW[1], "border-top"), "var(--base) solid var(--rule-strong)");
});

// The table's own cell rule sets text-align: left, and a bare
// `.report-table__num` cannot outrank `.report-table td`: the figures stayed
// left-aligned and ragged while the cells stretched. Naming the table in the
// selector is what holds their right edge.
const NUM_CELL = STYLE.match(/\.report-table \.report-table__num\s*\{([^}]*)\}/);

test("the figures hold their right edge against the table's left alignment", () => {
  assert.ok(NUM_CELL, "the numeric cell rule no longer names .report-table");
  assert.equal(declaration(NUM_CELL[1], "text-align"), "right");
  // The left alignment it must outrank is still the table's default.
  const CELLS = STYLE.match(/\.report-table th,\n\.report-table td \{([^}]*)\}/);
  assert.ok(CELLS, "the shared cell rule is missing");
  assert.equal(declaration(CELLS[1], "text-align"), "left");
});

/* --- the by-tag chips' contrast, in both palette schemes ----------------- */

// A chip's three states are told apart by more than their colour, but its
// label still has to read on whichever fill it carries. The two fills are the
// tag's own palette colour (a selected tag or key) and the app's ink (a tag
// with no colour set), and the half state mixes the fill into the paper. The
// values are lifted from the stylesheet so the test tracks the rules.
const CHIP_ON = STYLE.match(/\.report-tag--choice\[data-state="on"\]\s*\{([^}]*)\}/);
const CHIP_SOME = STYLE.match(/\.report-tag--choice\[data-state="some"\]\s*\{([^}]*)\}/);
const CHIP_OFF = STYLE.match(/\.report-tag--choice\s*\{([^}]*)\}/);

function tokenHex(name) {
  const value = STYLE.match(new RegExp(name + ":\\s*(#[0-9A-Fa-f]{6});"));
  assert.ok(value, name + " is not a hex token");
  return value[1];
}

test("a chip's label reads on its fill, in either palette and in its half state", () => {
  assert.ok(CHIP_ON, "the selected chip has no rule");
  assert.ok(CHIP_SOME, "the half chip has no rule");
  assert.ok(CHIP_OFF, "the resting chip has no rule");
  // A selected chip's label ink is the fill's own, exactly as a block's is, so
  // it holds the floor the blocks hold: the two mid-tone fills that no ink the
  // app owns can lift past 4.5:1 are the same two short here, and no others.
  assert.match(CHIP_ON[1], /color: var\(--tag-ink\);/);
  const fills = PALETTES.paired.concat(PALETTES.set3);
  const short = fills.filter((hex) => contrast(hex, labelInkFor(hex)) < 4.5);
  assert.deepEqual(short, ["#33a02c", "#bc80bd"]);
  fills.forEach((hex) => {
    assert.ok(contrast(hex, labelInkFor(hex)) >= 3,
      "a label on " + hex + " reads at " + contrast(hex, labelInkFor(hex)).toFixed(2));
  });
  // A tag with no colour fills with the app's ink and takes the paper as its
  // label: a selection never depends on a colour having been set.
  const ink = tokenHex("--ink");
  assert.match(CHIP_OFF[1], /--tag-fill: var\(--ink\);/);
  assert.match(CHIP_OFF[1], /--tag-ink: var\(--canvas\);/);
  assert.ok(contrast(ink, tokenHex("--canvas")) >= 4.5,
    "the label on a colourless chip reads at " + contrast(ink, tokenHex("--canvas")).toFixed(2));
  // A half-filled key keeps the app's ink as its label, so the mixed fill has
  // to hold that ink for every tag colour there is.
  const half = STYLE.match(/--mix-half:\s*([0-9.]+)%;/);
  assert.ok(half, "the half fill's mix is not a percentage token");
  const percent = Number(half[1]);
  assert.match(CHIP_SOME[1], /color: var\(--ink\);/);
  assert.match(CHIP_SOME[1], /color-mix\(in srgb, var\(--tag-fill\) var\(--mix-half\), var\(--panel\)\)/);
  const panel = tokenHex("--panel");
  for (const fill of fills.concat([ink])) {
    const mixed = mix(panel, fill, percent);
    assert.ok(contrast(mixed, tokenHex("--ink")) >= 4.5,
      "a half chip on " + fill + " reads at " + contrast(mixed, ink).toFixed(2));
  }
});
