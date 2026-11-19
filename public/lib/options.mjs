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
import { cadenceFrom, sprintsFor } from "./sprints.mjs";
import { tagKeys, tagColourSlots } from "./tags.mjs";

export function optionsItems(showArchived, highlightWeekends, gridDividers, minimap, highlightHolidays) {
  return [
    { key: "archived", label: "Show archived", checked: !!showArchived },
    { key: "weekends", label: "Highlight weekends", checked: !!highlightWeekends },
    { key: "holidays", label: "Highlight holidays", checked: !!highlightHolidays },
    { key: "dividers", label: "Grid dividers", checked: !!gridDividers },
    { key: "minimap", label: "Minimap", checked: !!minimap }
  ];
}

/*
 * The Options menu, group by group, top to bottom: the view, the plan and the
 * app. `items` is optionsItems' own list, so a future toggle joins the view
 * group without a second edit; the palette and Reset view follow them. The
 * plan group's "holidays" is the action that opens the Holidays panel, not the
 * highlight toggle of the same key above. This is the one place the menu's
 * shape is stated; public/app.js appends its rows in this order.
 */
export function optionGroups(items) {
  return [
    items.map(function (item) { return item.key; }).concat(["palette", "reset-view"]),
    ["range", "step", "sprints", "holidays", "tags", "milestones"],
    ["plan-file"]
  ];
}

/*
 * The rows a divider sits above: the first row of every group but the menu's
 * own first. A line therefore always means a boundary between groups, never
 * that a row happens to be an action. Derived from optionGroups so the two
 * cannot drift apart.
 */
export function optionDividerKeys(items) {
  return optionGroups(items).slice(1).map(function (group) { return group[0]; });
}

/*
 * The menu entries a report cannot act on, by key: the grid's own display
 * toggles (the weekend band, the holiday band, the Grid dividers and the
 * Minimap) and Reset view. A report draws no grid and makes no plan writes, so
 * these are disabled rather than moved or hidden; the plan-facing entries and
 * the Set of archived records stay live. Expressed here, beside the menu's own
 * items, so the menu and the report cannot disagree about which rows act.
 */
export function reportDisabledOptionKeys() {
  return ["weekends", "holidays", "dividers", "minimap", "reset-view"];
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
  // Sprint is denser than Week and draws its own boundaries: a sprint is a
  // run of its own length, so its dividers are the derived sprint cells.
  if (zoom === "sprint") return "sprint";
  return "month";
}

/*
 * The Colour palette group: the two schemes as checkable items, exactly one of
 * them checked. A view setting stored in the config, like Zoom and Row height
 * - the plan never learns which is active, so it takes no part in
 * optionsItems' saved-state list.
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
 * not a checked state: opening it opens the Sprints panel. The detail counts
 * the sprints that panel lists, by the panel's own rule (sprintsFor over the
 * cadence, the adjustments and the plan period), so the entry states the count
 * opening it will find rather than counting a second way. A plan with no
 * cadence has no chain to count and says so, rather than "0 sprints".
 */
export function sprintsItem(cadence, adjustments, period) {
  const count = sprintsFor(cadence, adjustments, period).length;
  return {
    key: "sprints",
    label: "Sprints...",
    detail: cadenceFrom({ cadence: cadence }) === null
      ? "Not defined yet"
      : count + (count === 1 ? " sprint" : " sprints")
  };
}

/*
 * The Holidays entry in the Options menu. Like the Sprints entry it is an
 * action, not a checked state: opening it opens the Holidays panel. The detail
 * counts the dates configured, so the menu says what opening it will find.
 */
export function holidaysItem(holidays) {
  const count = (holidays || []).reduce(function (total, group) {
    const dates = group && Array.isArray(group.dates) ? group.dates : [];
    return total + dates.length;
  }, 0);
  return {
    key: "holidays",
    label: "Holidays...",
    detail: count === 0 ? "None yet" : count + (count === 1 ? " date" : " dates")
  };
}

/*
 * The Tags entry in the Options menu. Like the Sprints and Holidays entries it
 * is an action, not a checked state: opening it opens the Tags panel. The
 * detail states what the panel holds - the colour-by-key choices and the values
 * given a colour - so the menu says what opening it will find.
 */
export function tagsItem(tagColours) {
  const keyCount = Object.keys(tagKeys(tagColours)).length;
  const colourCount = Object.keys(tagColourSlots(tagColours)).length;
  if (keyCount === 0 && colourCount === 0) {
    return { key: "tags", label: "Tags...", detail: "None yet" };
  }
  const parts = [];
  if (keyCount) parts.push(keyCount + (keyCount === 1 ? " key" : " keys"));
  if (colourCount) parts.push(colourCount + (colourCount === 1 ? " colour" : " colours"));
  return { key: "tags", label: "Tags...", detail: parts.join(", ") };
}

/*
 * The Milestones entry in the Options menu. Like the Sprints, Holidays and Tags
 * entries it is an action, not a checked state: opening it opens the Milestones
 * panel. The detail counts them, so a plan carrying Milestones is not silent
 * about them while their drawing is switched off.
 */
export function milestonesItem(milestones) {
  const count = Array.isArray(milestones) ? milestones.length : 0;
  return {
    key: "milestones",
    label: "Milestones...",
    detail: count === 0 ? "None yet" : count + (count === 1 ? " milestone" : " milestones")
  };
}

/*
 * The Colour palette row: a disclosure, not a group of items. Its detail names
 * the active scheme, and expanding it shows the two schemes paletteItems
 * lists. A view setting stored in the config, like Zoom and Row height.
 */
export function paletteControl(active) {
  const name = isPalette(active) ? active : PALETTE_DEFAULT;
  return {
    key: "palette",
    label: "Colour palette",
    detail: PALETTE_LABELS[name]
  };
}

// One stored range date as the menu states it: two-digit day, month and year,
// separated by dots, as in "01.01.26". Anything that is not a full ISO date
// reads empty rather than as a fragment.
function shortDate(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  return iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(2, 4);
}

/*
 * The plan period row: one explicit start date and one explicit end date, set
 * together, plus the read-back of what is stored. The detail names the stored
 * range so the collapsed row says what expanding it will find; a plan with a
 * missing or malformed pair says so rather than showing a fragment.
 */
export function rangeControl(range) {
  const start = range ? range.start : "";
  const end = range ? range.end : "";
  const from = shortDate(start);
  const to = shortDate(end);
  return {
    key: "range",
    label: "Plan period",
    detail: from && to ? from + " - " + to : "Not set",
    start: start,
    end: end
  };
}

/*
 * The percentage step row, beside the period row: one whole number from 1 to
 * 100, applied on its own so a half-typed value never re-steps the plan. Its
 * detail states the plan's current step, and an absent one reads as the
 * default of 10.
 */
export function stepControl(step) {
  const value = normalizeStep(step);
  return {
    key: "step",
    label: "Percentage step",
    detail: value + "%",
    value: value,
    min: STEP_MIN,
    max: STEP_MAX,
    defaultValue: DEFAULT_STEP
  };
}
