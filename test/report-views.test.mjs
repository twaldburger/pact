import test from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_VIEWS,
  REPORT_VIEW_DEFAULT,
  isReportViewKey,
  normalizeReportView,
  reportViewLabel
} from "../public/lib/report-views.mjs";

/* --- the seven views ----------------------------------------------------- */

test("a report has seven views, in the panel's order, with the names the owner chose", () => {
  assert.deepEqual(REPORT_VIEWS.map((entry) => entry.label), [
    "FTE-days by project",
    "FTE-days by person",
    "Allocation by person",
    "FTE-days by tag",
    "Allocation by tag",
    "FTE-days by tag over time",
    "Allocation against capacity"
  ]);
  // The absolute readings - by project, by person - then by person's own
  // percentage counterpart, the split and its counterpart, and the two charts:
  // the stacked bar per bucket, the line.
  assert.deepEqual(REPORT_VIEWS.map((entry) => entry.key), [
    "by-project",
    "by-person",
    "allocation-by-person",
    "by-tag",
    "allocation-by-tag",
    "by-tag-over-time",
    "allocation"
  ]);
});

test("each reading sits beside its own counterpart in the panel", () => {
  const index = (key) => REPORT_VIEWS.findIndex((entry) => entry.key === key);
  // The absolute reading and its percentage counterpart are neighbours, so a
  // Person's FTE-days and that same figure as a share of their offer read
  // together. The pair the owner asked for, in the order he asked for it.
  assert.equal(index("allocation-by-person"), index("by-person") + 1);
  // The tag pair follows the same rule, so a tag's FTE-days and that same
  // figure as a share of the plan's capacity read together.
  assert.equal(index("allocation-by-tag"), index("by-tag") + 1);
  // The share table is a seventh view, not a replacement for any of the six.
  assert.equal(REPORT_VIEWS.length, 7);
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
