import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The Grid spacing control's markup and styling, read from the files rather
// than a browser: where the pair sits in the bar, that it is drawn with
// horizontal arrows while the row height keeps vertical ones, and that its
// buttons take the same disabled treatment the row height's do. The rendered
// width and the clamp itself are checked by the geometry and API tests.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const HTML = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");

const INSTRUMENTS = HTML.match(/<div class="topbar__instruments">([\s\S]*?)<main\b/);
const SPACING_GROUP = HTML.match(/<div class="spacing"[^>]*>([\s\S]*?)<\/div>/);
const ROWHEIGHT_GROUP = HTML.match(/<div class="rowheight"[^>]*>([\s\S]*?)<\/div>/);

test("the bar reads Filter, Today, Zoom, Row height, Grid spacing, Undo/Redo, Options", () => {
  assert.ok(INSTRUMENTS, "the topbar instruments are missing");
  const bar = INSTRUMENTS[1];
  const order = [
    /class="filter"/,
    /id="today"/,
    /class="zoom"/,
    /class="rowheight"/,
    /class="spacing"/,
    /class="history"/,
    /id="options"/
  ].map((re) => {
    const at = bar.search(re);
    assert.notEqual(at, -1, "the bar is missing " + re);
    return at;
  });
  const sorted = order.slice().sort((a, b) => a - b);
  assert.deepEqual(order, sorted, "the bar's controls are out of order");
});

test("Today sits between the Filter and the zoom group", () => {
  assert.ok(INSTRUMENTS, "the topbar instruments are missing");
  const bar = INSTRUMENTS[1];
  const filterAt = bar.search(/class="filter"/);
  const todayAt = bar.search(/id="today"/);
  const zoomAt = bar.search(/class="zoom"/);
  assert.ok(filterAt < todayAt && todayAt < zoomAt,
    "Today is not between the Filter and the zoom group");
});

test("the Grid spacing pair is a group of two labelled buttons", () => {
  assert.ok(SPACING_GROUP, "the .spacing group is missing");
  assert.match(SPACING_GROUP[0], /aria-label="Grid spacing - the width of one day"/);
  assert.match(SPACING_GROUP[1], /id="spacing-decrease"[^>]*aria-label="Narrower days"[^>]*title="Narrower days"/);
  assert.match(SPACING_GROUP[1], /id="spacing-increase"[^>]*aria-label="Wider days"[^>]*title="Wider days"/);
});

// The two pairs have to read as different axes: the row height's marks run
// vertically, the Grid spacing's horizontally. Each group's paths are read for
// the axis their drawing commands use - V/v against H/h - so a mark drawn the
// other way would fail.
function arrowPaths(group) {
  assert.ok(group, "the group is missing");
  const paths = [...group[1].matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paths.length >= 4, "the pair draws too few arrow paths");
  return paths;
}

test("the Grid spacing pair is drawn with horizontal arrows", () => {
  const paths = arrowPaths(SPACING_GROUP);
  assert.ok(paths.some((d) => /[Hh]/.test(d)), "no spacing path runs horizontally");
  paths.forEach((d) => {
    assert.doesNotMatch(d, /[Vv]/, "a spacing path runs vertically: " + d);
  });
});

test("the row-height pair keeps its vertical arrows", () => {
  const paths = arrowPaths(ROWHEIGHT_GROUP);
  assert.ok(paths.some((d) => /[Vv]/.test(d)), "no row-height path runs vertically");
  paths.forEach((d) => {
    assert.doesNotMatch(d, /[Hh]/, "a row-height path runs horizontally: " + d);
  });
});

test("a disabled spacing button takes the shared disabled treatment", () => {
  const rule = STYLE.match(/\.spacing__btn:disabled[^{}]*\{([^}]*)\}/);
  assert.ok(rule, "the .spacing__btn:disabled rule is missing");
  assert.match(rule[1], /opacity:\s*var\(--op-disabled\)/);
  assert.match(rule[1], /cursor:\s*default/);
});

test("the spacing hover does not fire on a disabled button", () => {
  assert.match(STYLE, /\.spacing__btn:hover:not\(:disabled\)/);
});
