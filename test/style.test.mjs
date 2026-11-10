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
  // A press in the header places the Marker, and the chip is its own handle.
  assert.match(APP, /axis\.addEventListener\("pointerdown", onAxisDown\)/);
  assert.match(APP, /function onAxisDown\(e\) \{[^}]*setMarker\(indexFromClientX\(e\.clientX\)\)/);
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
