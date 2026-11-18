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
    "FTE-days by tag",
    "Allocation by project",
    "Allocation by person",
    "Allocation by tag",
    "Allocation against capacity"
  ]);
  assert.deepEqual(REPORT_VIEWS.map((entry) => entry.key), [
    "by-project",
    "by-person",
    "by-tag",
    "allocation-by-project",
    "allocation-by-person",
    "allocation-by-tag",
    "allocation"
  ]);
});

test("the views are grouped by measure, each group naming project, person, tag", () => {
  const index = (key) => REPORT_VIEWS.findIndex((entry) => entry.key === key);
  // The three FTE-days views first, in project, person, tag order...
  assert.deepEqual(REPORT_VIEWS.slice(0, 3).map((entry) => entry.key),
    ["by-project", "by-person", "by-tag"]);
  // ...then the three Allocation views, opening on the same subject...
  assert.deepEqual(REPORT_VIEWS.slice(3, 6).map((entry) => entry.key),
    ["allocation-by-project", "allocation-by-person", "allocation-by-tag"]);
  // ...and Allocation against capacity last.
  assert.equal(REPORT_VIEWS[REPORT_VIEWS.length - 1].key, "allocation");
  // Every FTE-days view precedes every Allocation view, and each group's order
  // is the other's, so the two readings of one subject sit at the same distance
  // apart in both.
  ["project", "person", "tag"].forEach((subject) => {
    assert.ok(index("by-" + subject) < index("allocation-by-" + subject), subject);
  });
  assert.ok(index("by-tag") < index("allocation-by-project"));
  assert.ok(index("allocation-by-tag") < index("allocation"));
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

test("a stored selection naming the removed view falls back on the default", () => {
  // Issue #171 removed FTE-days by tag over time. A config written before that
  // still names it, and must open the report on its first view rather than a
  // blank panel.
  assert.equal(isReportViewKey("by-tag-over-time"), false);
  assert.equal(normalizeReportView("by-tag-over-time"), REPORT_VIEW_DEFAULT);
  assert.equal(reportViewLabel("by-tag-over-time"), REPORT_VIEWS[0].label);
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
