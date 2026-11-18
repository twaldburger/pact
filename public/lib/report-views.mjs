/*
 * PACT report views: the seven views a report shows one at a time, and the rule
 * for which one a stored selection names.
 *
 * The list is the report's navigation panel, in its order: the views grouped by
 * what they measure - the three FTE-days views, then the three Allocation views,
 * then Allocation against capacity last. Both groups name their subject in the
 * same order, project first, so the two can be read subject by subject. Each
 * label names what the view shows - its subject and its measure - rather than
 * the shape of the chart or table that draws it, which is what makes the panel
 * readable on its own. The report draws only the selected view, and the
 * selection is a view setting kept in the config, so returning to the report
 * resumes where the owner left off.
 *
 * A plain ES module with no imports, so the browser (public/app.js), the view
 * state (public/lib/view.mjs) and `node --test` read the same source.
 */

export const REPORT_VIEWS = Object.freeze([
  Object.freeze({ key: "by-project", label: "FTE-days by project" }),
  Object.freeze({ key: "by-person", label: "FTE-days by person" }),
  Object.freeze({ key: "by-tag", label: "FTE-days by tag" }),
  Object.freeze({ key: "allocation-by-project", label: "Allocation by project" }),
  Object.freeze({ key: "allocation-by-person", label: "Allocation by person" }),
  Object.freeze({ key: "allocation-by-tag", label: "Allocation by tag" }),
  Object.freeze({ key: "allocation", label: "Allocation against capacity" })
]);

// A report opens on its first view: the plan's FTE-days by project.
export const REPORT_VIEW_DEFAULT = REPORT_VIEWS[0].key;

// Whether a stored value names one of the views at all. Anything else - a
// missing key, a number, a view that was renamed - is not a selection.
export function isReportViewKey(value) {
  return REPORT_VIEWS.some(function (entry) { return entry.key === value; });
}

// A stored selection read as a view: an unknown or malformed one is the default
// rather than a blank panel.
export function normalizeReportView(value) {
  return isReportViewKey(value) ? value : REPORT_VIEW_DEFAULT;
}

// The label a view's own heading and its panel entry both wear, from the one
// list, so the two can never say different things.
export function reportViewLabel(value) {
  const key = normalizeReportView(value);
  const entry = REPORT_VIEWS.find(function (e) { return e.key === key; });
  return entry ? entry.label : REPORT_VIEWS[0].label;
}
