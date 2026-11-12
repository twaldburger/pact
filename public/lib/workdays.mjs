/*
 * PACT working days: which calendar days count as worked, and how much of a
 * part-worked one does.
 *
 * A working day is a calendar day that is not a Saturday or Sunday, not a
 * holiday configured for the Person's Location, and not an absence for that
 * Person. The glossary's rule, and the unit every figure that measures time is
 * counted in. `holidays.mjs` owns the per-Location lookup; this module adds the
 * weekend and the marks that take time out of a day, and nothing else.
 *
 * A half holiday leaves half a working day rather than none, and an absence at
 * 50% takes half of the day, so the count is fractional where it has to be. An
 * absence (#115) is a range of days off for one Person: the Assignments under a
 * Project marked as an absence, each taking its own share out of the day. It is
 * another subtraction in the same count, never a second rule. A plain ES module
 * importing only `holidays.mjs`, which itself imports nothing, so the server,
 * the browser (public/app.js) and `node --test` read exactly the same source.
 * Every rule here is pure.
 */
import { holidaysFor, holidayLocations } from "./holidays.mjs";

const DAY_MS = 86400000;

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

function udate(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

function toISO(d) {
  return d.toISOString().slice(0, 10);
}

/*
 * The holiday time off each date for one Location, as `date -> fraction off`.
 * Two marks on one date add up, and the total is held at a whole day so a
 * doubled entry cannot take more than the day away.
 */
function holidayOff(holidays, location) {
  const off = new Map();
  holidaysFor(holidays, location).forEach(function (day) {
    const taken = day.kind === "half" ? 0.5 : 1;
    off.set(day.date, Math.min(1, (off.get(day.date) || 0) + taken));
  });
  return off;
}

/*
 * The holiday time off each date for the whole plan, as `date -> fraction
 * off`, with every Location's marks merged: a date any Location takes off is
 * off here. A sprint belongs to the plan rather than to one Person, so its
 * count cannot read one Location's holidays and takes all of them; with none
 * configured it is empty and weekends are the only subtraction.
 */
function holidayOffEverywhere(holidays) {
  const off = new Map();
  holidayLocations(holidays).forEach(function (location) {
    holidaysFor(holidays, location).forEach(function (day) {
      const taken = day.kind === "half" ? 0.5 : 1;
      off.set(day.date, Math.min(1, (off.get(day.date) || 0) + taken));
    });
  });
  return off;
}

/*
 * The ids of the Plan's absence Projects. An absence is a Project marked with
 * `absence: true`, and every Assignment under it is an absence for its Person.
 * A Plan without the flag has none, so the working-day rule is unchanged.
 */
export function absenceProjectIds(plan) {
  const ids = new Set();
  ((plan && plan.projects) || []).forEach(function (project) {
    if (project && project.absence === true) ids.add(project.id);
  });
  return ids;
}

/*
 * One Person's absences, as the `{start, end, share}` the count reads: the
 * Assignments under the Plan's absence Projects. An absence at 100% takes a
 * whole day off the Person, one at 50% half.
 */
export function absencesFor(plan, personId) {
  const ids = absenceProjectIds(plan);
  if (ids.size === 0) return [];
  return ((plan && plan.assignments) || []).filter(function (assignment) {
    return assignment && assignment.personId === personId && ids.has(assignment.projectId);
  });
}

// The absence time off one date for one Person, as a fraction of the day. Two
// absences on one date add up, and the total is held at a whole day.
function absenceOff(absences, dateISO) {
  let taken = 0;
  (absences || []).forEach(function (absence) {
    if (absence.start <= dateISO && absence.end >= dateISO) {
      taken += (Number(absence.share) || 0) / 100;
    }
  });
  return Math.min(1, taken);
}

// Holidays and absences together, as a fraction of the day held off, so the
// two kinds of time off share one cap rather than each taking the day again.
function offOn(dateISO, holidays, location, absences) {
  return Math.min(1, (holidayOff(holidays, location).get(dateISO) || 0) + absenceOff(absences, dateISO));
}

// Saturday or Sunday, read in UTC so an ISO date names the same day wherever
// the caller runs.
export function isWeekend(dateISO) {
  if (!isISODate(dateISO)) return false;
  const dow = udate(dateISO).getUTCDay();
  return dow === 0 || dow === 6;
}

/*
 * The fraction of one date that counts as worked for a Location and a Person's
 * absences: 1 on an ordinary working day, 0.5 on a half holiday or a 50%
 * absence, and 0 on a weekend, a full holiday, a 100% absence or any mix that
 * takes the whole day. A malformed date has no working time. A Person with no
 * Location and no absences is affected by weekends alone.
 */
export function workingFraction(dateISO, location, holidays, absences) {
  if (!isISODate(dateISO) || isWeekend(dateISO)) return 0;
  return Math.max(0, 1 - offOn(dateISO, holidays, location, absences));
}

// Whether a date is a working day at all - the fraction above is greater than
// zero. A half holiday or a 50% absence is still a working day, half of one.
export function isWorkingDay(dateISO, location, holidays, absences) {
  return workingFraction(dateISO, location, holidays, absences) > 0;
}

/*
 * The shared span arithmetic: walk `[startISO, endISO]` a day at a time,
 * skipping weekends and subtracting each date's time off from `off`, plus any
 * of the Person's absences. A malformed or reversed pair has no working days
 * rather than a negative count.
 */
function countWorkingDays(startISO, endISO, off, absences) {
  if (!isISODate(startISO) || !isISODate(endISO)) return 0;
  const start = udate(startISO);
  const end = udate(endISO);
  const span = Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
  if (span <= 0) return 0;
  let total = 0;
  for (let i = 0; i < span; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const dateISO = toISO(d);
    const taken = Math.min(1, (off.get(dateISO) || 0) + absenceOff(absences, dateISO));
    total += Math.max(0, 1 - taken);
  }
  return total;
}

/*
 * The working days in `[startISO, endISO]`, both ends inclusive, for one
 * Location and a Person's absences: each date contributes its working fraction,
 * so a span over a weekend, a holiday, an absence and a half day counts only
 * the time actually worked. A malformed or reversed pair has no working days
 * rather than a negative count.
 */
export function workingDays(startISO, endISO, location, holidays, absences) {
  return countWorkingDays(startISO, endISO, holidayOff(holidays, location), absences);
}

/*
 * The same count for the whole plan rather than one Person: a date counts
 * unless it is a weekend or any configured Location marks it off. A sprint
 * spans every Person, so its figure is the count the plan as a whole works -
 * with no holidays configured it is the weekends alone, exactly the same rule
 * as `workingDays`. It carries no Person's absences, which are theirs alone.
 */
export function planWorkingDays(startISO, endISO, holidays) {
  return countWorkingDays(startISO, endISO, holidayOffEverywhere(holidays));
}
