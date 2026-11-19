/*
 * PACT milestones: the dated points a plan marks - a delivery, a deployment, a
 * deadline - each with a name, one date, a palette slot, its own tags, notes
 * and the Projects it relates to; and the rules that decide which of them the
 * grid draws, where, and how much of a name the axis has room for.
 *
 * A plain ES module whose only imports are the app's other plain rules -
 * label.mjs for the axis's month names and its separator, palette.mjs for the
 * colour slots - so the browser (public/app.js) and `node --test` read exactly
 * the same source. Every rule here is pure.
 */
import { LABEL_SEPARATOR, MONTHS_SHORT } from "./label.mjs";
import { slotForColour } from "./palette.mjs";

/*
 * The Projects a Milestone relates to, as the plan's own objects, in the order
 * the Milestone names them and with repeats dropped.
 *
 * An id that no longer matches a Project resolves to nothing here rather than
 * refusing the plan: deleting a Project leaves its id behind, and a Milestone
 * is annotation, not a reference, so a stale link must never stop a plan from
 * loading. The id stays in the plan file, which is what lets undoing that
 * delete bring the link back with the Project; the panel shows it by its id so
 * it can be unticked rather than dropped by an unrelated edit. A Milestone
 * left with no resolvable link reads as one that relates to no Project.
 */
export function milestoneProjects(milestone, projects) {
  const byId = new Map();
  (Array.isArray(projects) ? projects : []).forEach(function (project) {
    if (project && typeof project.id === "string") byId.set(project.id, project);
  });
  const ids = milestone && Array.isArray(milestone.projectIds) ? milestone.projectIds : [];
  const seen = new Set();
  const out = [];
  ids.forEach(function (id) {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    out.push(byId.get(id));
  });
  return out;
}

/*
 * The palette slot a Milestone draws in, read through the model so the panel,
 * the grid and the report all colour it the same way. A malformed slot reads as
 * the palette's first fill rather than drawing nothing, as a Project's own
 * colour does.
 */
export function milestoneSlot(milestone) {
  const slot = milestone ? slotForColour(milestone.colour) : null;
  return slot === null ? 0 : slot;
}

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

function udate(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

function dayOffset(fromISO, toISO) {
  return Math.round((udate(toISO).getTime() - udate(fromISO).getTime()) / 86400000);
}

function idSet(ids) {
  if (ids instanceof Set) return ids;
  return new Set(Array.isArray(ids) ? ids : []);
}

/*
 * Whether the grid draws one Milestone at all.
 *
 * A Milestone related to no Project - because it names none, or because every
 * id it names has since been deleted - is plan-wide and always drawn. One
 * related to Projects is drawn only while at least one of them is visible: the
 * caller hands the Projects the view left (`visibleProjectIds`), so a link the
 * Filter hides, and a link the plan no longer holds, both count as gone.
 */
export function milestoneShown(milestone, projects, visibleProjectIds) {
  const links = milestoneProjects(milestone, projects);
  if (links.length === 0) return true;
  const visible = idSet(visibleProjectIds);
  return links.some(function (project) { return visible.has(project.id); });
}

/*
 * The marks the grid draws: one per date the view shows, in date order.
 *
 * Only the Milestones the view leaves shown are marked (milestoneShown), and
 * only at dates inside the drawn period - one outside it is not an error, it is
 * simply off the axis. Several on one date share one mark: the first in the
 * plan's own order names it, its palette slot colours it, and `count` carries
 * how many share the date, which is what the axis counts as `+2`.
 */
export function milestoneMarks(milestones, projects, visibleProjectIds, rangeStartISO, dayCount) {
  const total = Number.isFinite(Number(dayCount)) ? Math.max(0, Math.round(Number(dayCount))) : 0;
  if (!isISODate(rangeStartISO) || total === 0) return [];
  const byDate = new Map();
  (Array.isArray(milestones) ? milestones : []).forEach(function (milestone) {
    if (!milestone || typeof milestone !== "object" || !isISODate(milestone.date)) return;
    if (!milestoneShown(milestone, projects, visibleProjectIds)) return;
    const i = dayOffset(rangeStartISO, milestone.date);
    if (i < 0 || i >= total) return;
    const mark = byDate.get(milestone.date);
    if (mark) {
      mark.count += 1;
      return;
    }
    byDate.set(milestone.date, {
      date: milestone.date,
      i: i,
      colour: milestoneSlot(milestone),
      name: typeof milestone.name === "string" ? milestone.name : "",
      count: 1
    });
  });
  const marks = Array.from(byDate.values());
  marks.sort(function (a, b) { return a.i - b.i; });
  return marks;
}

// One date as the axis band names it: the day, then the month, as in "19 Nov".
// The month band above it already names the year.
export function milestoneDateLabel(iso) {
  if (!isISODate(iso)) return "";
  return (+iso.slice(8, 10)) + " " + MONTHS_SHORT[+iso.slice(5, 7) - 1];
}

/*
 * A mark's axis label: its name and its date, and the rest of its date counted
 * as `+2` when others share it. The name is the first one written, so a crowded
 * date reads as one name and a number rather than as a list.
 */
export function milestoneLabel(mark) {
  const rest = mark && mark.count > 1 ? " +" + (mark.count - 1) : "";
  return (mark && mark.name ? mark.name : "") + LABEL_SEPARATOR +
    milestoneDateLabel(mark && mark.date) + rest;
}

/*
 * The axis band's slots, one per mark: whether the name and the date fit in the
 * room the zoom leaves between that date and the next.
 *
 * The room is geometry, not text: a slot begins at its own date's column and
 * ends where the next date's begins, so two labels can never overlap however
 * long they are. `widthOf(text)` is the drawn width of a label in the band's
 * own pixels - the caller measures, this decides - and `inset` is how far right
 * of its date the label starts. A slot with no room for its label falls back to
 * a bare tick. The last mark's label may run to the end of the drawn period and
 * no further.
 */
export function milestoneAxisSlots(marks, options) {
  const list = Array.isArray(marks) ? marks : [];
  const dayWidth = Number(options && options.dayWidth);
  const total = Number(options && options.dayCount);
  const widthOf = options && options.widthOf;
  const inset = Math.max(0, Number(options && options.inset) || 0);
  const measured = Number.isFinite(dayWidth) && dayWidth > 0 && Number.isFinite(total) &&
    typeof widthOf === "function";
  return list.map(function (mark, index) {
    const next = list[index + 1];
    const end = next ? next.i : total;
    const room = measured ? Math.max(0, (end - mark.i) * dayWidth - inset) : 0;
    const label = milestoneLabel(mark);
    return {
      mark: mark,
      label: label,
      room: room,
      labelled: room > 0 && widthOf(label) <= room
    };
  });
}
