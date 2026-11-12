/*
 * PACT sprint figures: one derived sprint's calendar length and the working
 * days it holds, as the text a Sprints-panel row shows.
 *
 * A plain ES module reading the one working-day rule (`workdays.mjs`), so the
 * browser (public/app.js) and `node --test` read exactly the same source. The
 * count is over the sprint's own dates - the row's own start and length, a
 * per-sprint adjustment included - and is never clamped to the plan period, so
 * a sprint running past the period's end counts every day it has. A fractional
 * count is kept as it is rather than rounded away.
 */
import { planWorkingDays } from "./workdays.mjs";

const DAY_MS = 86400000;

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

function udate(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

// The calendar length of one sprint: both ends inclusive, the raw span a row
// states. A malformed sprint has none.
export function sprintCalendarDays(sprint) {
  if (!sprint || !isISODate(sprint.start) || !isISODate(sprint.end)) return 0;
  const span = Math.round((udate(sprint.end).getTime() - udate(sprint.start).getTime()) / DAY_MS) + 1;
  return span > 0 ? span : 0;
}

/*
 * The working days one sprint holds: the shared plan-wide rule over the
 * sprint's own dates, so weekends, the holidays configured for any Location and
 * a half day all fall out of it. Returned as the rule counts it, fractional
 * where a half day leaves half.
 */
export function sprintWorkingDays(sprint, holidays) {
  if (!sprint) return 0;
  return planWorkingDays(sprint.start, sprint.end, holidays);
}

function dayText(value, unit) {
  return value + " " + unit + (value === 1 ? "" : "s");
}

/*
 * The row's figure, "14 days, 10 working days": the calendar length first, then
 * the working days the shared rule leaves. A fractional count reads as one, as
 * in "9.5 working days", rather than being rounded.
 */
export function sprintDaysFigure(sprint, holidays) {
  return dayText(sprintCalendarDays(sprint), "day") + ", " +
    dayText(sprintWorkingDays(sprint, holidays), "working day");
}
