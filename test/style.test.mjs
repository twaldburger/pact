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

/* --- the by-tag chips' one fill, in both palette schemes ------------------ */

// Every selected chip fills with the app's ink, so the label has one fill to
// read against and the swatch is the only thing carrying a tag's colour. Three
// of the paired colours sit under 3:1 against that ink, the darkest barely off
// it, so the dot wears a hairline of the paper instead of losing its colour.
// The values are lifted from the stylesheet so the test tracks the rules.
const CHIP_ON = STYLE.match(/\.report-tag--choice\[data-state="on"\]\s*\{([^}]*)\}/);
const CHIP_OFF = STYLE.match(/\.report-tag--choice\s*\{([^}]*)\}/);
const CHIP_SWATCH = STYLE.match(/\.report-tag--choice\[data-state="on"\] \.report-tag__swatch\s*\{([^}]*)\}/);

function tokenHex(name) {
  const value = STYLE.match(new RegExp(name + ":\\s*(#[0-9A-Fa-f]{6});"));
  assert.ok(value, name + " is not a hex token");
  return value[1];
}

test("a selected chip's label reads on the one fill, in both palette schemes", () => {
  assert.ok(CHIP_ON, "the selected chip has no rule");
  assert.ok(CHIP_OFF, "the resting chip has no rule");
  const ink = tokenHex("--ink");
  const paper = tokenHex("--canvas");
  // One fill for every chip, so the label reads at the same ratio whatever
  // colour the tag has, and holds well past the floor the blocks hold.
  const paints = CHIP_ON[1].replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(paints, /background: var\(--ink\);/);
  assert.match(paints, /border-color: var\(--ink\);/);
  assert.match(paints, /(?:^|[;\s])color: var\(--canvas\);/);
  assert.ok(contrast(ink, paper) >= 4.5,
    "a label on the chip's fill reads at " + contrast(ink, paper).toFixed(2));
  // Nothing sets a fill per tag any more, and no third state is styled: the
  // selection is the same mark on every chip.
  assert.equal(/--tag-fill|--tag-ink|--mix-half/.test(STYLE), false,
    "a per-tag fill or its half mix is still styled");
});

test("a selected chip's swatch keeps its colour, ringed where it would vanish", () => {
  assert.ok(CHIP_SWATCH, "the selected chip's swatch has no rule");
  const ink = tokenHex("--ink");
  const paints = CHIP_SWATCH[1].replace(/\/\*[\s\S]*?\*\//g, "");
  // The dot keeps naming the tag's colour: the rule neither repaints it nor
  // tints it, and only adds the hairline that separates it from the fill.
  assert.equal(/background|opacity|filter/.test(paints), false,
    "a selected chip still repaints or dims its swatch");
  assert.equal(declaration(paints, "box-shadow"), "0 0 0 var(--base) var(--canvas)");
  // Why it is there, measured: the paired scheme carries colours that no longer
  // separate from the ink, the Set3 scheme carries none.
  const vanishing = (hexes) => hexes.filter((hex) => contrast(hex, ink) < 3);
  assert.deepEqual(vanishing(PALETTES.paired), ["#1f78b4", "#e31a1c", "#6a3d9a"]);
  assert.deepEqual(vanishing(PALETTES.set3), []);
  // Every dot is ringed in the paper, so every one of them reads by shape even
  // where its colour is the fill's own darkness.
  assert.ok(contrast(tokenHex("--canvas"), ink) >= 4.5,
    "the ring reads at " + contrast(tokenHex("--canvas"), ink).toFixed(2));
});

/* --- the capacity band and the chart's ruler ------------------------------ */

// The chart's marks, the ruler's sweep and the readout's paper, lifted from the
// stylesheet so the tests track what the browser is handed.
const CHART_BAND = STYLE.match(/\.report-chart__band\s*\{([^}]*)\}/);
const CHART_CAP = STYLE.match(/(^|\n)\.report-chart__cap\s*\{([^}]*)\}/);
const CHART_ALLOC = STYLE.match(/(^|\n)\.report-chart__alloc\s*\{([^}]*)\}/);
const CHART_RULE = STYLE.match(/\.report-chart__rule\s*\{([^}]*)\}/);
const CHART_BOX = STYLE.match(/\.report-chart__readout-box\s*\{([^}]*)\}/);
const CHART_WORDS = STYLE.match(/\.report-chart__readout-text\s*\{([^}]*)\}/);
const CHART_HIDDEN = STYLE.match(/\.report-chart__rule,\s*\.report-chart__readout\s*\{([^}]*)\}/);
const CHART_SHOWN = STYLE.match(
  /\.report-chart\.is-reading \.report-chart__rule,\s*\.report-chart\.is-reading \.report-chart__readout\s*\{([^}]*)\}/
);
const CHART_FOCUS = STYLE.match(/\.report-chart:focus-visible\s*\{([^}]*)\}/);
const CHART_LIVE = STYLE.match(/\.report-chart__live\s*\{([^}]*)\}/);
const LEGEND_BAND = STYLE.match(/\.report-legend__swatch--band\s*\{([^}]*)\}/);

test("the capacity is a band under a solid edge, and no dash remains", () => {
  assert.ok(CHART_BAND, "the capacity band has no rule");
  assert.ok(CHART_CAP, "the capacity edge has no rule");
  assert.ok(CHART_ALLOC, "the allocation line has no rule");
  // The dashed mark the owner called an accident is gone from the chart: no
  // stroke anywhere is dashed, and the capacity carries no dot markers of its
  // own any more. (Other marks in the app keep their own dashes - a part day's
  // edge, a hollow drop target - so only the chart's rules are read here.)
  assert.equal(/stroke-dasharray/.test(STYLE), false, "a dashed stroke remains");
  [CHART_BAND[1], CHART_CAP[2], CHART_ALLOC[2]].forEach((rule) => {
    assert.doesNotMatch(rule, /dash/, "a chart mark is still dashed");
  });
  assert.equal(/report-chart__dot-cap/.test(STYLE), false, "the capacity still has dot markers");
  // The band is a fill and its edge a solid stroke of the capacity's own colour.
  assert.equal(declaration(CHART_BAND[1], "fill"), "var(--off)");
  assert.equal(declaration(CHART_CAP[2], "fill"), "none");
  assert.equal(declaration(CHART_CAP[2], "stroke"), "var(--signal)");
  assert.equal(declaration(CHART_CAP[2], "stroke-linejoin"), "round");
  // The allocation is a solid line over it, at the heavier weight: the roof is
  // there to be seen, the line is there to be read.
  assert.equal(declaration(CHART_ALLOC[2], "stroke"), "var(--ink)");
  const capWidth = Number(declaration(CHART_CAP[2], "stroke-width"));
  const allocWidth = Number(declaration(CHART_ALLOC[2], "stroke-width"));
  assert.ok(capWidth > 0 && capWidth < allocWidth,
    "the capacity edge is " + capWidth + " and the allocation line " + allocWidth);
});

test("the band's one fixed neutral is the same under both palette schemes", () => {
  // Palette independence is structural: the band reads only --off, and --off
  // lives on :root while the two palette blocks change nothing but --proj-*.
  assert.doesNotMatch(CHART_BAND[1], /--proj-/);
  assert.doesNotMatch(CHART_CAP[2], /--proj-/);
  const blocks = [...STYLE.matchAll(/\[data-palette="([a-z0-9]+)"\]\s*\{([^}]*)\}/g)];
  assert.deepEqual(blocks.map((m) => m[1]).sort(), Object.keys(PALETTES).sort(),
    "the stylesheet no longer styles both palette schemes");
  for (const block of blocks) {
    assert.doesNotMatch(block[2], /--off\s*:/, block[1] + " redefines the band's fill");
    assert.match(block[2], /--proj-0:/, block[1] + " no longer sets the project fills");
  }
});

test("the band is quiet on the paper and costs the ink nothing", () => {
  const ink = tokenHex("--ink");
  const canvas = tokenHex("--canvas");
  const off = tokenHex("--off");
  const signal = tokenHex("--signal");
  assert.equal(declaration(CHART_BAND[1], "fill"), "var(--off)");
  // The allocation's ink - the line and its dots - reads at the same strength
  // on the band as on the paper: nothing is lost to the fill.
  assert.ok(contrast(ink, off) >= 4.5,
    "the allocation's ink reads at " + contrast(ink, off).toFixed(2) + " on the band");
  assert.ok(contrast(ink, off) >= contrast(ink, canvas) * 0.9,
    "the band costs the ink more than a tenth of its contrast");
  // And the band is a step off the paper rather than a second figure: it reads
  // as background, so the eye lands on the line.
  const step = contrast(off, canvas);
  assert.ok(step >= 1.05 && step <= 1.25, "the band's step is " + step.toFixed(3));
  // Its own edge is legible over that fill.
  assert.ok(contrast(signal, off) >= 3,
    "the capacity's edge reads at " + contrast(signal, off).toFixed(2) + " on its band");
});

test("the ruler and its readout are put away until the chart is read", () => {
  assert.ok(CHART_HIDDEN, "the ruler has no resting rule");
  assert.ok(CHART_SHOWN, "the ruler has no reading rule");
  assert.equal(declaration(CHART_HIDDEN[1], "display"), "none");
  assert.equal(declaration(CHART_SHOWN[1], "display"), "block");
  // The words read over a paper box, so the bucket being read is never lost
  // under the lines it crosses; the ruler itself reads over the band.
  assert.ok(CHART_BOX, "the readout has no paper");
  assert.ok(CHART_WORDS, "the readout has no type");
  assert.ok(CHART_RULE, "the ruler has no rule");
  assert.equal(declaration(CHART_BOX[1], "fill"), "var(--canvas)");
  assert.equal(declaration(CHART_WORDS[1], "fill"), "var(--ink)");
  assert.equal(declaration(CHART_RULE[1], "stroke"), "var(--ink-soft)");
  assert.ok(contrast(tokenHex("--ink-soft"), tokenHex("--off")) >= 3,
    "the ruler reads at " + contrast(tokenHex("--ink-soft"), tokenHex("--off")).toFixed(2) + " on the band");
});

test("the chart's focus is drawn, and its readout is announced off screen", () => {
  assert.ok(CHART_FOCUS, "the chart has no focus rule");
  assert.equal(declaration(CHART_FOCUS[1], "outline"), "2px solid var(--ink)");
  assert.equal(declaration(CHART_FOCUS[1], "outline-offset"), "2px");
  // The live region takes no room and draws nothing, but stays in the
  // accessibility tree: announced, never seen.
  assert.ok(CHART_LIVE, "the readout has no live region rule");
  assert.equal(declaration(CHART_LIVE[1], "position"), "absolute");
  assert.equal(declaration(CHART_LIVE[1], "overflow"), "hidden");
  assert.equal(declaration(CHART_LIVE[1], "clip-path"), "inset(50%)");
});

test("the legend's capacity swatch draws the band, not a dash", () => {
  assert.ok(LEGEND_BAND, "the capacity swatch has no rule");
  assert.equal(declaration(LEGEND_BAND[1], "background"), "var(--off)");
  assert.equal(declaration(LEGEND_BAND[1], "border-top"), "1.5px solid var(--signal)");
  assert.doesNotMatch(LEGEND_BAND[1], /dash/);
});

/* --- the milestone rules and the grid's other overlays --------------------- */

// The milestone rules are drawn the way the weekend band and the Grid dividers
// are: a sibling layer inside the grid, at the same stacking level, each rule
// an absolutely positioned hairline on the date's own day boundary. These
// assertions pin that, and the axis band the dates are named in, so the rules
// cannot drift onto a layer or a geometry of their own.
const MILESTONE_RULES = STYLE.match(/\.milestone-rules\s*\{([^}]*)\}/);
const MILESTONE_RULE = STYLE.match(/\.milestone-rule\s*\{([^}]*)\}/);
const MILESTONE_TICK = STYLE.match(/\.ax-milestone::before\s*\{([^}]*)\}/);
const MILESTONE_BAND = STYLE.match(/\.axis__milestones\s*\{([^}]*)\}/);
const GRID_RULES = STYLE.match(/\.rules\s*\{([^}]*)\}/);
const DIVIDER_RULE = STYLE.match(/\.rule\s*\{([^}]*)\}/);

test("the milestone rules sit on the rows at the Grid dividers' own level", () => {
  assert.ok(MILESTONE_RULES, "the .milestone-rules rule is missing");
  assert.ok(GRID_RULES, "the .rules rule is missing");
  ["grid-column", "grid-row", "position", "z-index"].forEach((name) => {
    assert.equal(
      declaration(MILESTONE_RULES[1], name),
      declaration(GRID_RULES[1], name),
      "the milestone layer's " + name + " must match the Grid dividers'"
    );
  });
  assert.equal(declaration(MILESTONE_RULES[1], "pointer-events"), "none");
});

test("a milestone rule is a hairline on the date's own day boundary, in its colour", () => {
  assert.ok(MILESTONE_RULE, "the .milestone-rule rule is missing");
  assert.ok(DIVIDER_RULE, "the .rule rule is missing");
  // The same column a Grid divider sits on: the day's own left edge.
  assert.equal(declaration(MILESTONE_RULE[1], "left"), declaration(DIVIDER_RULE[1], "left"));
  assert.equal(declaration(MILESTONE_RULE[1], "width"), "1px");
  assert.equal(declaration(MILESTONE_RULE[1], "background"), "var(--milestone)");
});

test("the chart's milestone rule is a hairline in the milestone's own colour", () => {
  const rule = STYLE.match(/\n\.report-chart__milestone\s*\{([^}]*)\}/);
  assert.ok(rule, "the .report-chart__milestone rule is missing");
  // The palette slot arrives as the same token the grid's rules and axis band
  // wear, so a milestone is one colour on both surfaces.
  assert.equal(declaration(rule[1], "stroke"), "var(--milestone)");
  // A hairline, like the grid's own rule and the chart's grid: an annotation
  // beside the figures rather than one of them, and never dashed.
  assert.equal(Number(declaration(rule[1], "stroke-width")), 1);
  assert.doesNotMatch(rule[1], /dash/);
});

test("the milestone tick is drawn on the date's own column, in its colour", () => {
  assert.ok(MILESTONE_TICK, "the .ax-milestone::before rule is missing");
  // A slot is positioned at its own date, as a rule is, and carries the tick on
  // that same edge, where the rule through the rows sits.
  assert.equal(declaration(MILESTONE_TICK[1], "left"), "0");
  assert.equal(declaration(MILESTONE_TICK[1], "width"), "1px");
  assert.equal(declaration(MILESTONE_TICK[1], "background"), "var(--milestone)");
});

test("a milestone slot is laid at its date rather than packed beside the last one", () => {
  const slot = STYLE.match(/\.ax-milestone\s*\{([^}]*)\}/);
  assert.ok(slot, "the .ax-milestone rule is missing");
  assert.equal(declaration(slot[1], "position"), "absolute");
  assert.equal(declaration(slot[1], "left"), "calc(var(--i) * var(--day-w))");
  // The band keeps the axis' own width, so its rule runs the whole way whether
  // it holds one date or none.
  assert.equal(declaration(MILESTONE_BAND[1], "width"), "calc(var(--days) * var(--day-w))");
});

test("a crowded date keeps its tick and withdraws its name", () => {
  assert.match(STYLE, /\.ax-milestone\.is-tick\s+\.ax-milestone__label\s*\{[^}]*display:\s*none/);
});

test("the milestone band grows the axis rather than overhanging the rows", () => {
  assert.ok(MILESTONE_BAND, "the .axis__milestones rule is missing");
  assert.equal(declaration(MILESTONE_BAND[1], "height"), "var(--band-day-h)");
  // One extra band's height at every zoom, so the rows start below it.
  assert.match(STYLE, /--axis-h:\s*calc\(var\(--band-month-h\) \+ var\(--band-day-h\) \+ var\(--axis-extra\)\)/);
  assert.match(STYLE, /\[data-zoom="month"\][^{]*\{[^}]*--axis-h:\s*calc\(var\(--band-month-h\) \+ var\(--axis-extra\)\)/);
  assert.match(STYLE, /\.is-milestones\s*\{[^}]*--axis-extra:\s*var\(--band-day-h\)/);
});
