/*
 * PACT Stack rail collapse: the rules of folding the Stack away that are not
 * about the DOM - the toggle's accessible name and announced state, the count
 * of matching Projects it carries while collapsed, and the decision that the
 * rail takes no width. A plain ES module with no imports, so the browser
 * (public/app.js) and `node --test` load exactly the same source.
 *
 * The collapsed state is a view setting stored in the config, like Zoom and
 * Row height: it is never written to the plan. The plan file and the API own
 * their own shape; nothing here can add a field to them.
 */

export const STACK_COLLAPSED_DEFAULT = false;

// A stray value is not collapsed: only the boolean true folds the rail away,
// so a missing or malformed state opens it again rather than hiding it.
export function isStackCollapsed(value) {
  return value === true;
}

/*
 * Whether the Stack rail is drawn at all. Collapsed, the rail and its list are
 * gone and the timeline - with its Person column - takes the whole board. The
 * Person column is a column of the timeline and is not part of this decision.
 */
export function stackRailVisible(collapsed) {
  return !isStackCollapsed(collapsed);
}

// The toggle's accessible name states the action the press will take, never
// the state it is in.
export function stackToggleLabel(collapsed) {
  return isStackCollapsed(collapsed) ? "Expand Projects" : "Collapse Projects";
}

// aria-expanded is true exactly while the Stack is open.
export function stackToggleExpanded(collapsed) {
  return !isStackCollapsed(collapsed);
}

// Whether a filter query is present at all. Only non-blank text counts, so a
// field holding spaces behaves like an empty one.
export function hasFilterQuery(query) {
  return String(query == null ? "" : query).trim() !== "";
}

/*
 * The count the toggle carries: the number of Projects the filter leaves,
 * shown only while the Stack is collapsed and a query is present. Expanded, or
 * with no query, there is no count and the function returns null. The count is
 * the filter's own number, never recomputed here, and the layout stays
 * collapsed - the count never expands the rail.
 */
export function stackMatchCount(collapsed, query, matchingProjects) {
  if (!isStackCollapsed(collapsed)) return null;
  if (!hasFilterQuery(query)) return null;
  const n = Math.floor(Number(matchingProjects));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/*
 * The Stack row's trailing figure: a Project's total assigned FTE-days from
 * the whole plan (the measure sort.mjs computes), rounded to whole days. A
 * missing, malformed or negative total reads as no assigned work rather than
 * as a negative or NaN figure. The visible text is compact, the spelled-out
 * form names the unit for the tooltip and the accessible name.
 */
function wholeDays(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function fteDaysFigure(value) {
  return wholeDays(value) + " d";
}

export function fteDaysLabel(value) {
  return wholeDays(value) + " FTE-days";
}

/*
 * The session's view state, as one object beside the plan's own. It holds the
 * collapsed flag and nothing else, so toggling the Stack changes only this and
 * can never add a field to a saved plan.
 */
export function stackViewState(collapsed) {
  return { stackCollapsed: isStackCollapsed(collapsed) };
}
