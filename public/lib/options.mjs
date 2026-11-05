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

export function optionsItems(showArchived) {
  return [
    { key: "archived", label: "Show archived", checked: !!showArchived }
  ];
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
