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
