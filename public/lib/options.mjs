/*
 * PACT options: the infrequent controls that live behind the Options menu
 * rather than in the bar itself. A pure rule listing the menu's items and what
 * each item's check reflects, so the browser (public/app.js) and `node --test`
 * read exactly the same source. Sharing the app's two-zone bar, this is the
 * only place a future infrequent control has to be added.
 */
import {
  PALETTE_DEFAULT,
  PALETTE_LABELS,
  PALETTE_NAMES,
  isPalette
} from "./palette.mjs";
import { DEFAULT_STEP, STEP_MIN, STEP_MAX, normalizeStep } from "./panels.mjs";

export function optionsItems(showArchived, highlightWeekends, gridDividers, minimap) {
  return [
    { key: "archived", label: "Show archived", checked: !!showArchived },
    { key: "weekends", label: "Highlight weekends", checked: !!highlightWeekends },
    { key: "dividers", label: "Grid dividers", checked: !!gridDividers },
    { key: "minimap", label: "Minimap", checked: !!minimap }
  ];
}

/*
 * The granularity of the Grid dividers: the finest time unit the active zoom
 * can show, as a name the drawing side turns into cells. It is one toggle, so
 * this is the whole rule. An unknown zoom falls back to the coarsest - month -
 * so a stray value draws the quietest grid rather than the busiest.
 */
export function dividerUnit(zoom) {
  if (zoom === "day") return "day";
  if (zoom === "week") return "week";
  // Sprint shares Week's density but not its boundaries: a sprint is a run of
  // its own length, so its dividers are the derived sprint cells, not weeks.
  if (zoom === "sprint") return "sprint";
  return "month";
}

/*
 * The Colour palette group: the two schemes as checkable items, exactly one of
 * them checked. Session-only, like Zoom and Row height - the plan never learns
 * which is active, so it takes no part in optionsItems' saved-state list.
 */
export function paletteItems(active) {
  const name = isPalette(active) ? active : PALETTE_DEFAULT;
  return PALETTE_NAMES.map((key) => ({
    key: key,
    label: PALETTE_LABELS[key],
    checked: key === name
  }));
}

/*
 * The Sprints entry in the Options menu. Unlike the toggles it is an action,
 * not a checked state: opening it opens the Sprints panel. The detail states
 * whether a cadence exists yet, so the menu says what opening it will find.
 */
export function sprintsItem(hasCadence) {
  return {
    key: "sprints",
    label: "Sprints...",
    detail: hasCadence ? "Cadence defined" : "Not defined yet"
  };
}

/*
 * The plan period control that sits with the menu's items: one explicit start
 * date and one explicit end date, set together, and the read-back of what is
 * stored. The two dates are specific days, not months or presets.
 */
export function rangeControl(range) {
  return {
    key: "range",
    label: "Plan period",
    start: range ? range.start : "",
    end: range ? range.end : ""
  };
}

/*
 * The percentage step control, beside the period control: one whole number
 * from 1 to 100, applied on its own so a half-typed value never re-steps the
 * plan. It reads back the plan's current step, and an absent one reads as the
 * default of 10.
 */
export function stepControl(step) {
  return {
    key: "step",
    label: "Percentage step",
    value: normalizeStep(step),
    min: STEP_MIN,
    max: STEP_MAX,
    defaultValue: DEFAULT_STEP
  };
}
