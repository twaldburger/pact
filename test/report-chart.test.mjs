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
  chartReadoutBox,
  chartReadoutAt,
  chartKeyIndex,
  chartMilestoneRules
} from "../public/lib/chart.mjs";
import { milestoneMarks } from "../public/lib/milestones.mjs";

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
  assert.equal(chartReadout(BUCKETS[0]), "Sep: 148/372 FTE-days \u00b7 40%");
  assert.equal(chartReadout(BUCKETS[1]), "Oct: 210/372 FTE-days \u00b7 56%");
  // The share is rounded from the figures themselves, not from their rounding:
  // 148.4 of 372 is 39.9%.
  assert.equal(Math.round((BUCKETS[0].alloc / BUCKETS[0].capacity) * 100), 40);
  // The slash stands between the figures and the middle dot before the share:
  // neither the word "of" nor a bare space between the two counts.
  assert.doesNotMatch(chartReadout(BUCKETS[0]), / of |\d \d/);
  assert.equal(chartReadout(BUCKETS[0]).split(" \u00b7 ")[1], "40%");
  // Over-allocation reads as the share it is, above 100%.
  assert.equal(chartReadout({ label: "Dec", alloc: 500, capacity: 372 }),
    "Dec: 500/372 FTE-days \u00b7 134%");
  // A bucket the plan offers nothing in says so instead of dividing.
  assert.equal(chartReadout(BUCKETS[2]), "Nov: 12/0 FTE-days \u00b7 no capacity");
  assert.equal(chartReadout({ label: "Nov", alloc: 0, capacity: 0 }),
    "Nov: 0/0 FTE-days \u00b7 no capacity");
  assert.doesNotMatch(chartReadout(BUCKETS[2]), /%|Infinity|NaN/);
});

// What a browser's getBBox reports for the readout's words at 10px: the ink
// starts at the text's own x, rises a couple of units over its baseline and is
// one line of type tall. Used with the chart's real geometry, so the placement
// assertions below are measured in the SVG's own units.
const INK = { x: 6, y: 2, width: 132, height: 12 };

test("the readout's paper sits in the plot's bottom-left, above the baseline", () => {
  const geom = geometry();
  const base = geom.top + geom.plotH;
  const box = chartReadoutBox(INK);
  const at = chartReadoutAt(geom, box);
  // The paper in the SVG's own frame: the words plus their padding, carried by
  // the group's own place.
  const left = at.x + box.x;
  const top = at.y + box.y;
  const bottom = top + box.height;
  // The inset the readout took at the top corner, now taken from the left edge
  // and from the baseline under it.
  assert.equal(left, geom.left + 4);
  assert.equal(bottom, base - 4);
  // Inside the plot's lower half, so it no longer covers the roof it describes,
  // and above the baseline rather than on it.
  assert.ok(top > geom.top + geom.plotH / 2, "the readout is not in the bottom half");
  assert.ok(bottom < base, "the readout overlaps the baseline");
  // Clear of the axis labels, which are drawn under the baseline on a 10px
  // baseline of their own; and clear of the tick figures at the plot's left.
  const labelBaseline = HEIGHT - 10;
  assert.ok(bottom < labelBaseline - 10, "the readout reaches the axis labels");
  assert.ok(left > geom.left - 6, "the readout covers the tick figures");
  // The paper is the words' own measured size plus an even padding, so it
  // follows the text rather than a guessed height.
  assert.equal(box.width, INK.width + 12);
  assert.equal(box.height, INK.height + 8);
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

/* --- the milestones on the chart ------------------------------------------ */

// The report's buckets tile the plan period, as report-content.mjs makes them:
// four months of unequal length, each taken at the same width.
const MONTH_BUCKETS = [
  { key: "2026-09", label: "Sep", start: "2026-09-01", end: "2026-09-30" },
  { key: "2026-10", label: "Oct", start: "2026-10-01", end: "2026-10-31" },
  { key: "2026-11", label: "Nov", start: "2026-11-01", end: "2026-11-30" },
  { key: "2026-12", label: "Dec", start: "2026-12-01", end: "2026-12-31" }
];

function monthGeometry() {
  return chartGeometry(WIDTH, HEIGHT, PAD, MONTH_BUCKETS.length, 400);
}

// One mark as public/lib/milestones.mjs writes it: a date, the palette slot it
// is drawn in and, for the title, its name and how many share the date.
function markOn(date, colour) {
  return { date: date, i: 0, colour: colour === undefined ? 3 : colour, name: "Launch", count: 1 };
}

test("with the switch off the chart draws no milestone rule, whatever the plan holds", () => {
  const geom = monthGeometry();
  const marks = [markOn("2026-09-10"), markOn("2026-10-15"), markOn("2026-12-24")];
  assert.deepEqual(chartMilestoneRules(marks, false, MONTH_BUCKETS, geom), []);
  // Nothing else decides it: the same marks on the same plot, and the one
  // switch is the whole difference.
  assert.equal(chartMilestoneRules(marks, true, MONTH_BUCKETS, geom).length, 3);
  // And a chart with no mark is a chart with no rule, switch or not.
  assert.deepEqual(chartMilestoneRules([], true, MONTH_BUCKETS, geom), []);
  assert.deepEqual(chartMilestoneRules(undefined, true, MONTH_BUCKETS, geom), []);
});

test("with the switch on one rule stands at each milestone's own date", () => {
  const geom = monthGeometry();
  const rules = chartMilestoneRules(
    [markOn("2026-09-01", 1), markOn("2026-09-16", 2), markOn("2026-12-31", 5)],
    true, MONTH_BUCKETS, geom
  );
  assert.equal(rules.length, 3);
  // The palette slot travels with the rule, so the browser can colour it.
  assert.deepEqual(rules.map((r) => r.mark.colour), [1, 2, 5]);
  // A date is placed inside its own bucket, by how far through it falls: the
  // bucket's first day is its own left edge, its last one day short of the next.
  assert.equal(rules[0].x, geom.left);
  assert.equal(rules[1].x, geom.left + (15 / 30) * geom.bw);
  assert.equal(rules[2].x, geom.left + (3 + 30 / 31) * geom.bw);
  // A month's own first day opens that month's bucket.
  const october = chartMilestoneRules([markOn("2026-10-01")], true, MONTH_BUCKETS, geom);
  assert.equal(october[0].x, geom.left + geom.bw);
  // Later dates stand further right, and no rule leaves the plot.
  assert.ok(rules[1].x > rules[0].x && rules[2].x > rules[1].x, "the rules are not in date order");
  rules.forEach((r) => {
    assert.ok(r.x >= geom.left && r.x <= geom.left + geom.plotW, "a rule is off the plot");
  });
});

test("a Day report rules each day's own boundary, as the grid does", () => {
  const days = ["2026-09-01", "2026-09-02", "2026-09-03"].map((iso) => ({
    key: iso, label: iso, start: iso, end: iso
  }));
  const geom = chartGeometry(WIDTH, HEIGHT, PAD, days.length, 4);
  const rules = chartMilestoneRules([markOn("2026-09-02")], true, days, geom);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].x, geom.left + geom.bw);
});

test("a milestone outside the chart's period draws nothing", () => {
  const geom = monthGeometry();
  // Before the period and after it: the chart holds September to December.
  assert.deepEqual(chartMilestoneRules([markOn("2026-08-31")], true, MONTH_BUCKETS, geom), []);
  assert.deepEqual(chartMilestoneRules([markOn("2027-01-01")], true, MONTH_BUCKETS, geom), []);
  assert.deepEqual(chartMilestoneRules([markOn("2026-02-31")], true, MONTH_BUCKETS, geom), []);
  assert.deepEqual(chartMilestoneRules([markOn("")], true, MONTH_BUCKETS, geom), []);
  // A chart with no buckets holds no date at all - and a bucket without its
  // bounds is no evidence of one.
  assert.deepEqual(chartMilestoneRules([markOn("2026-09-10")], true, [], geom), []);
  assert.deepEqual(chartMilestoneRules([markOn("2026-09-10")], true, [{ key: "x" }], geom), []);
});

test("the rule follows the milestone visibility rule the grid uses", () => {
  const geom = monthGeometry();
  const projects = [{ id: "p1" }, { id: "p2" }];
  const milestones = [
    { id: "m1", name: "Launch", date: "2026-09-10", colour: 1, projectIds: ["p1"] },
    { id: "m2", name: "Audit", date: "2026-10-12", colour: 2, projectIds: ["p2"] },
    { id: "m3", name: "Review", date: "2026-11-03", colour: 4, projectIds: [] }
  ];
  // p2 is filtered out of the view: its milestone is not marked, so no rule is
  // drawn for it, while the visible project's and the plan-wide one are.
  const marks = milestoneMarks(milestones, projects, ["p1"], "2026-09-01", 122);
  const rules = chartMilestoneRules(marks, true, MONTH_BUCKETS, geom);
  assert.deepEqual(rules.map((r) => r.mark.name), ["Launch", "Review"]);
  // With both projects in view, all three dates rule the plot. The visibility
  // half of that answer is milestones.mjs': this side reads its marks.
  const both = milestoneMarks(milestones, projects, ["p1", "p2"], "2026-09-01", 122);
  assert.equal(chartMilestoneRules(both, true, MONTH_BUCKETS, geom).length, 3);
  // One rule per date however many milestones share it.
  const twin = milestones.concat([{ id: "m4", name: "Ship", date: "2026-09-10", colour: 7, projectIds: [] }]);
  const twinRules = chartMilestoneRules(milestoneMarks(twin, projects, ["p1"], "2026-09-01", 122),
    true, MONTH_BUCKETS, geom);
  assert.equal(twinRules.length, 2);
  assert.equal(twinRules[0].mark.count, 2);
});

test("a rule can stand under the readout's corner, and the paper is painted over it", () => {
  const geom = monthGeometry();
  // The readout's paper sits in the plot's bottom-left corner, drawn from its
  // own measured words; the first bucket's early days fall inside it.
  const ink = { x: 0, y: 0, width: 140, height: 14 };
  const at = chartReadoutAt(geom, chartReadoutBox(ink));
  const paper = chartReadoutBox(ink);
  const paperLeft = at.x + paper.x;
  const paperRight = paperLeft + paper.width;
  const inside = chartMilestoneRules([markOn("2026-09-03")], true, MONTH_BUCKETS, geom);
  assert.equal(inside.length, 1);
  assert.ok(inside[0].x > paperLeft && inside[0].x < paperRight,
    "the fixture no longer lands a rule under the readout");
  // The two are told apart by the paint order and by the paper: the rule is
  // drawn before the ruler and the readout, and the paper's fill is the opaque
  // canvas the chart is drawn on, so the reading survives over the rule.
  const chart = functionSource(APP, "buildLineChart");
  const rules = chart.indexOf("reportChartMilestones(svg, model.buckets, geom);");
  const ruler = chart.indexOf('class: "report-chart__rule"');
  const readout = chart.indexOf('class: "report-chart__readout"');
  assert.ok(rules > -1 && ruler > -1 && readout > -1, "a mark is missing");
  assert.ok(rules < ruler && ruler < readout, "the readout is not painted over the rules");
  const style = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
  const paperFill = style.match(/\.report-chart__readout-box\s*\{([^}]*)\}/);
  assert.ok(paperFill, "the readout has no paper");
  assert.match(paperFill[1], /fill:\s*var\(--canvas\)/, "the paper is not opaque");
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

test("the readout is placed from its own measured box each time it shows", () => {
  const chart = functionSource(APP, "buildLineChart");
  // Measured where the words are, and placed from that same measurement, so a
  // longer reading still sits inside the plot and above the axis labels.
  assert.match(chart, /var paper = chartReadoutBox\(words\.getBBox\(\)\);/);
  assert.match(chart, /var at = chartReadoutAt\(geom, paper\);/);
  assert.match(chart, /readout\.setAttribute\("transform", "translate\(" \+ at\.x \+ " " \+ at\.y \+ "\)"\);/);
  // The group carries no place of its own: a translate fixed at creation is
  // the top-corner placement this replaces.
  assert.match(chart, /var readout = svgNode\("g", \{ class: "report-chart__readout" \}\);/);
  // Shown before it is measured, since a display:none group measures as
  // nothing and getBBox would throw.
  assert.ok(chart.indexOf('svg.classList.add("is-reading")') <
    chart.indexOf("chartReadoutBox(words.getBBox())"),
    "the readout is measured while still hidden");
  // And the words come from the module's own rule, so the ruler and the tests
  // read the same wording.
  assert.match(chart, /words\.textContent = chartReadout\(line\[i\]\);/);
  // Both placement rules arrive through the chart module's own import list: a
  // rule the app calls without importing throws on the first hover.
  const imports = APP.slice(APP.lastIndexOf("import {", APP.indexOf('} from "./lib/chart.mjs";')));
  assert.match(imports, /chartReadoutBox/);
  assert.match(imports, /chartReadoutAt/);
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

test("the chart draws the grid's own marks, through the one Show milestones switch", () => {
  const helper = functionSource(APP, "reportChartMilestones");
  assert.ok(helper.length > 0, "reportChartMilestones is missing");
  // The marks are the grid's own list, read through the chart module's rule,
  // with the one milestonesDrawn() answer for the switch: no second reading of
  // the plan and no second copy of the visibility rule on this side.
  assert.match(helper,
    /chartMilestoneRules\(milestoneMarkList, milestonesDrawn\(\), buckets, geom\)\.forEach/);
  assert.doesNotMatch(helper, /data\.milestones/);
  assert.doesNotMatch(helper, /milestoneMarks\(|milestoneShown\(/);
  // A rule is the milestone's own palette slot, in the app's own token, and it
  // is named in the axis band's words for a hover or a screen reader.
  assert.match(helper, /class: "report-chart__milestone"/);
  assert.match(helper, /setProperty\("--milestone", "var\(--proj-" \+ rule\.mark\.colour \+ "\)"\)/);
  assert.match(helper, /svgNode\("title", null, milestoneLabel\(rule\.mark\)\)/);
  // Reached through the chart module's import list, not invented here.
  const imports = APP.slice(APP.lastIndexOf("import {", APP.indexOf('} from "./lib/chart.mjs";')));
  assert.match(imports, /chartMilestoneRules/);
});

test("the rules are painted over the grid and under the data ink and the readout", () => {
  const chart = functionSource(APP, "buildLineChart");
  const band = chart.indexOf('class: "report-chart__band"');
  const grid = chart.indexOf("reportChartAxis(svg, width, height, geom);");
  const rules = chart.indexOf("reportChartMilestones(svg, model.buckets, geom);");
  const cap = chart.indexOf('class: "report-chart__cap"');
  const alloc = chart.indexOf('class: "report-chart__alloc"');
  const ruler = chart.indexOf('class: "report-chart__rule"');
  const readout = chart.indexOf('class: "report-chart__readout"');
  [band, grid, rules, cap, alloc, ruler, readout].forEach((i, n) => {
    assert.ok(i > -1, "mark " + n + " is missing");
  });
  // Above the band's quiet fill and the grid's guides, so a rule reads.
  assert.ok(band < grid && grid < rules, "the rules are not over the grid");
  // Under the capacity's edge, the allocation line and its dots, so a rule
  // never covers the figures it annotates.
  assert.ok(rules < cap && cap < alloc, "the rules are not under the data ink");
  // And under the ruler and the readout's paper, so a reading survives.
  assert.ok(rules < ruler && ruler < readout, "the readout is not over the rules");
});
