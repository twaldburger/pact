import test from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_VIEWS,
  REPORT_VIEW_DEFAULT,
  isReportViewKey,
  normalizeReportView,
  reportViewLabel
} from "../public/lib/report-views.mjs";

/* --- the five views ------------------------------------------------------- */

test("a report has five views, in the panel's order, with the names the owner chose", () => {
  assert.deepEqual(REPORT_VIEWS.map((entry) => entry.label), [
    "FTE-days by project",
    "FTE-days by person",
    "FTE-days by tag",
    "FTE-days by tag over time",
    "Allocation against capacity"
  ]);
  // Two tables of the same figure, one table of its split, then its two charts:
  // by project, by person, by tag, the stacked bar per bucket, the line.
  assert.deepEqual(REPORT_VIEWS.map((entry) => entry.key), [
    "by-project",
    "by-person",
    "by-tag",
    "by-tag-over-time",
    "allocation"
  ]);
});

test("every name says what the view shows, and no two say the same thing", () => {
  const labels = REPORT_VIEWS.map((entry) => entry.label);
  labels.forEach((label) => {
    assert.ok(label.trim().length > 0);
    // Each names its subject and its measure rather than a chart type.
    assert.doesNotMatch(label, /chart|table|graph|pivot|pie|bar|line/i, label);
  });
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(new Set(REPORT_VIEWS.map((entry) => entry.key)).size, REPORT_VIEWS.length);
});

test("the list and its entries are frozen, so a draw cannot reorder the panel", () => {
  assert.equal(Object.isFrozen(REPORT_VIEWS), true);
  REPORT_VIEWS.forEach((entry) => assert.equal(Object.isFrozen(entry), true));
});

/* --- the selection -------------------------------------------------------- */

test("a report opens on its first view", () => {
  assert.equal(REPORT_VIEW_DEFAULT, "by-project");
  assert.equal(REPORT_VIEW_DEFAULT, REPORT_VIEWS[0].key);
  assert.equal(normalizeReportView(undefined), REPORT_VIEW_DEFAULT);
  assert.equal(normalizeReportView(null), REPORT_VIEW_DEFAULT);
});

test("a stored selection that names no view falls back on the default", () => {
  [undefined, null, "", "by-chart", "BY-PROJECT", 0, 42, true, [], {}, "allocation "]
    .forEach((raw) => assert.equal(normalizeReportView(raw), REPORT_VIEW_DEFAULT, String(raw)));
});

test("every view survives a stored selection and is named by its own label", () => {
  REPORT_VIEWS.forEach((entry) => {
    assert.equal(isReportViewKey(entry.key), true);
    assert.equal(normalizeReportView(entry.key), entry.key);
    assert.equal(reportViewLabel(entry.key), entry.label);
  });
  // The heading and the panel entry read the same list, so a malformed value
  // still has a label to draw.
  assert.equal(reportViewLabel("nonsense"), REPORT_VIEWS[0].label);
  assert.equal(reportViewLabel(undefined), REPORT_VIEWS[0].label);
});
