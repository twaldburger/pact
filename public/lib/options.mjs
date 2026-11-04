/*
 * PACT options: the infrequent controls that live behind the Options menu
 * rather than in the bar itself. A pure rule listing the menu's items and what
 * each item's check reflects, so the browser (public/app.js) and `node --test`
 * read exactly the same source. Sharing the app's two-zone bar, this is the
 * only place a future infrequent control has to be added.
 */

export function optionsItems(showArchived) {
  return [
    { key: "archived", label: "Show archived", checked: !!showArchived }
  ];
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
