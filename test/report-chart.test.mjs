import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  chartCeiling,
  chartGeometry,
  chartX,
  chartY,
  chartInPlot,
  chartNearestIndex,
  chartLinePath,
  chartBandPath,
  chartReadout,
  chartKeyIndex
} from "../public/lib/chart.mjs";

// The report's chart is drawn in the browser but its rules are pure, in
// public/lib/chart.mjs. Everything here reads those rules directly: where a
// bucket's centre is, whether a pointer is over the plot, where the ruler
// snaps, what the readout can say and where a key press moves it. The last
// block reads the composition and the wiring, which only the script can show.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");

const WIDTH = 780;
const HEIGHT = 240;
const PAD = { l: 46, r: 8, t: 12, b: 34 };

// One month per bucket, the shape report-content.mjs hands the chart: a label
// as the axis writes it, the allocated FTE-days and the capacity the plan
// offers. The third bucket offers nothing, which is the case the readout must
// state rather than divide.
const BUCKETS = [
  { key: "2026-09", label: "Sep", alloc: 148.4, capacity: 372 },
  { key: "2026-10", label: "Oct", alloc: 210, capacity: 372 },
  { key: "2026-11", label: "Nov", alloc: 12, capacity: 0 },
  { key: "2026-12", label: "Dec", alloc: 300, capacity: 372 }
];

function geometry() {
  const max = chartCeiling(BUCKETS.reduce(function (m, b) { return Math.max(m, b.capacity); }, 0));
  return chartGeometry(WIDTH, HEIGHT, PAD, BUCKETS.length, max);
}

test("the ceiling is a whole number above the largest value, never zero", () => {
  assert.equal(chartCeiling(372), 400);
  assert.equal(chartCeiling(400), 400);
  assert.equal(chartCeiling(41), 50);
  assert.equal(chartCeiling(0), 1);
  assert.equal(chartCeiling(-5), 1);
  assert.equal(chartCeiling(NaN), 1);
});

test("the plot divides its width over the buckets and stands values from a floor to a top", () => {
  const geom = geometry();
  assert.equal(geom.left, PAD.l);
  assert.equal(geom.top, PAD.t);
  assert.equal(geom.plotW, WIDTH - PAD.l - PAD.r);
  assert.equal(geom.plotH, HEIGHT - PAD.t - PAD.b);
  assert.equal(geom.count, BUCKETS.length);
  assert.equal(geom.max, 400);
  assert.equal(geom.bw, geom.plotW / BUCKETS.length);
  // Zero is the plot's floor and the ceiling its top, at both ends and in the
  // middle.
  assert.equal(chartY(0, geom), geom.top + geom.plotH);
  assert.equal(chartY(geom.max, geom), geom.top);
  assert.equal(chartY(geom.max / 2, geom), geom.top + geom.plotH / 2);
  // The first centre is half a bucket in from the plot's left edge, and the
  // last half a bucket back from its right.
  assert.equal(chartX(0, geom), geom.left + geom.bw / 2);
  assert.equal(chartX(BUCKETS.length - 1, geom), geom.left + geom.plotW - geom.bw / 2);
});

test("the ruler snaps to the nearest bucket's centre, never between two", () => {
  const geom = geometry();
  BUCKETS.forEach(function (_, i) {
    assert.equal(chartNearestIndex(chartX(i, geom), geom), i, "the centre of bucket " + i);
  });
  // Just either side of a centre: the nearer one wins, so the rule never stands
  // off a data point.
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const centre = chartX(i, geom);
    assert.equal(chartNearestIndex(centre + geom.bw * 0.49, geom), i);
    assert.equal(chartNearestIndex(centre + geom.bw * 0.51, geom), i + 1);
  }
  // A pointer past either end lands on the end bucket rather than nowhere.
  assert.equal(chartNearestIndex(geom.left, geom), 0);
  assert.equal(chartNearestIndex(geom.left + geom.plotW, geom), BUCKETS.length - 1);
  // An empty chart has no bucket to snap to.
  assert.equal(chartNearestIndex(100, chartGeometry(WIDTH, HEIGHT, PAD, 0, 1)), -1);
});

test("the ruler only answers inside the plot, not over its labels or margin", () => {
  const geom = geometry();
  assert.equal(chartInPlot(geom.left, geom.top, geom), true);
  assert.equal(chartInPlot(geom.left + geom.plotW, geom.top + geom.plotH, geom), true);
  assert.equal(chartInPlot(geom.left + geom.plotW / 2, geom.top + geom.plotH / 2, geom), true);
  assert.equal(chartInPlot(geom.left - 1, geom.top + 10, geom), false, "over the axis labels");
  assert.equal(chartInPlot(geom.left + 10, geom.top - 1, geom), false, "above the plot");
  assert.equal(chartInPlot(geom.left + 10, geom.top + geom.plotH + 1, geom), false,
    "below the baseline, over the bucket labels");
  assert.equal(chartInPlot(geom.left + geom.plotW + 1, geom.top + 10, geom), false,
    "past the plot's right edge");
});

test("the band is the capacity's own top edge closed down to the baseline", () => {
  const geom = geometry();
  const base = geom.top + geom.plotH;
  const capacity = BUCKETS.map(function (b, i) {
    return (i === 0 ? "M" : "L") + chartX(i, geom) + " " + chartY(b.capacity, geom);
  }).join(" ");
  const first = chartX(0, geom);
  const last = chartX(BUCKETS.length - 1, geom);
  // The capacity is one solid polyline through the bucket centres, and the band
  // is that same line with the bottom edge closed back to the first centre.
  assert.equal(chartLinePath(BUCKETS, geom, "capacity"), capacity);
  assert.equal(chartBandPath(BUCKETS, geom), capacity + " L" + last + " " + base + " L" + first + " " + base + " Z");
  // A bucket the plan offers nothing in sits on the baseline, so the band has
  // no height there rather than dipping below the plot.
  assert.equal(chartY(0, geom), base);
  assert.equal(chartY(BUCKETS[2].capacity, geom), base);
});

test("the readout names the bucket, both figures and the share between them", () => {
  assert.equal(chartReadout(BUCKETS[0]), "Sep: 148 of 372 FTE-days \u00b7 40%");
  assert.equal(chartReadout(BUCKETS[1]), "Oct: 210 of 372 FTE-days \u00b7 56%");
  // The share is rounded from the figures themselves, not from their rounding:
  // 148.4 of 372 is 39.9%.
  assert.equal(Math.round((BUCKETS[0].alloc / BUCKETS[0].capacity) * 100), 40);
  // Over-allocation reads as the share it is, above 100%.
  assert.equal(chartReadout({ label: "Dec", alloc: 500, capacity: 372 }),
    "Dec: 500 of 372 FTE-days \u00b7 134%");
  // A bucket the plan offers nothing in says so instead of dividing.
  assert.equal(chartReadout(BUCKETS[2]), "Nov: 12 of 0 FTE-days \u00b7 no capacity");
  assert.equal(chartReadout({ label: "Nov", alloc: 0, capacity: 0 }),
    "Nov: 0 of 0 FTE-days \u00b7 no capacity");
  assert.doesNotMatch(chartReadout(BUCKETS[2]), /%|Infinity|NaN/);
});

test("the keyboard walks one bucket at a time and jumps to the ends", () => {
  const count = BUCKETS.length;
  assert.equal(chartKeyIndex("ArrowRight", 0, count), 1);
  assert.equal(chartKeyIndex("ArrowRight", 2, count), 3);
  assert.equal(chartKeyIndex("ArrowLeft", 2, count), 1);
  assert.equal(chartKeyIndex("ArrowLeft", 1, count), 0);
  // The ends are the ends: neither key walks off the chart.
  assert.equal(chartKeyIndex("ArrowRight", count - 1, count), count - 1);
  assert.equal(chartKeyIndex("ArrowLeft", 0, count), 0);
  // Home and End jump there from anywhere.
  assert.equal(chartKeyIndex("Home", 3, count), 0);
  assert.equal(chartKeyIndex("End", 0, count), count - 1);
  // A chart nobody has read yet starts at its first bucket.
  assert.equal(chartKeyIndex("ArrowRight", null, count), 0);
  assert.equal(chartKeyIndex("ArrowLeft", null, count), 0);
  // Anything else is left to the page.
  assert.equal(chartKeyIndex("Enter", 1, count), null);
  assert.equal(chartKeyIndex("a", 1, count), null);
  assert.equal(chartKeyIndex("ArrowRight", 0, 0), null);
});

/* --- the composition and the wiring --------------------------------------- */

// One function's source, from its own line to the next closing brace at column
// zero, so an assertion can be made of that builder alone.
function functionSource(source, name) {
  const start = source.indexOf("function " + name + "(");
  const end = start < 0 ? -1 : source.indexOf("\n}\n", start);
  return end > start ? source.slice(start, end + 3) : "";
}

test("the band is painted beneath the allocation line, and the capacity keeps no dots", () => {
  const chart = functionSource(APP, "buildLineChart");
  assert.ok(chart.length > 0, "buildLineChart is missing");
  // Painted in the order that puts the roof behind the line: the band, then the
  // grid, then the capacity's solid edge and the allocation over both.
  const band = chart.indexOf('class: "report-chart__band"');
  const cap = chart.indexOf('class: "report-chart__cap"');
  const alloc = chart.indexOf('class: "report-chart__alloc"');
  assert.ok(band > -1 && cap > -1 && alloc > -1, "a mark is missing");
  assert.ok(band < cap && cap < alloc, "the band is not beneath the line");
  // The capacity's markers went with the dashes: the band's edge is the line
  // now. The allocation keeps its own.
  assert.equal(APP.includes("report-chart__dot-cap"), false, "the capacity still carries dots");
  assert.match(chart, /class: "report-chart__dot-alloc"/);
});

test("the chart answers the pointer and the keyboard, and keeps its name", () => {
  const chart = functionSource(APP, "buildLineChart");
  // The chart is its own tab stop, named as it was and no longer an image: it
  // is something to read with.
  assert.match(chart, /role: "group"/);
  assert.match(chart, /tabindex: "0"/);
  assert.match(chart, /"aria-label": "Allocation against capacity over " \+ reportBucketLabel\(reportZoom\)\.toLowerCase\(\)/);
  // A pointer's x snaps through the module's own nearest-bucket rule; the keys
  // walk through its own step rule.
  assert.match(chart, /show\(chartNearestIndex\(x, geom\)\)/);
  assert.match(chart, /if \(!chartInPlot\(x, y, geom\)\) return hide\(\);/);
  assert.match(chart, /var i = chartKeyIndex\(ev\.key, index, line\.length\);/);
  // Both are put away when the pointer leaves the plot or focus leaves the
  // chart.
  assert.match(chart, /addEventListener\("pointerleave", hide\)/);
  assert.match(chart, /addEventListener\("blur", hide\)/);
});

test("the readout's words are announced, not only drawn", () => {
  const section = functionSource(APP, "reportAllocationSection");
  assert.ok(section.length > 0, "reportAllocationSection is missing");
  assert.match(section, /var live = el\("p", "report-chart__live"\);/);
  assert.match(section, /live\.setAttribute\("role", "status"\);/);
  assert.match(section, /live\.setAttribute\("aria-live", "polite"\);/);
  assert.match(section, /card\.appendChild\(buildLineChart\(model, live\)\);/);
  // The legend names what is drawn: a band, not a dashed line.
  assert.match(section, /swatchClass: "report-legend__swatch--band"/);
  assert.equal(APP.includes("report-legend__swatch--dashed"), false,
    "the legend still names a dashed capacity");
});
