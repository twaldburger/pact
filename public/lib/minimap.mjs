/*
 * PACT Minimap: the shape of the plan's load across its whole period - the
 * per-slice density the overview strip draws, and the scroll arithmetic that
 * turns a press on it into a movement of the grid. A plain ES module, so the
 * browser (public/app.js) and `node --test` load exactly the same source.
 *
 * The density is used capacity over available capacity for the rows and work
 * the active Filter and Show archived leave, so the strip shows a proportion
 * rather than an absolute share: a slice is full when every shown Person is
 * fully allocated, and a slice past full is over-allocation, the top of the
 * scale. The reading is passed through visiblePlan and filterPlan, the same
 * two rules the grid uses, so the strip and the grid can never disagree.
 *
 * The strip is a view setting for the session only: it is never sent to the
 * server and never written to the plan.
 */
import { defaultScopes, filterPlan } from "./filter.mjs";
import { visiblePlan } from "./visibility.mjs";

export const MINIMAP_DEFAULT = false;

export function isMinimapEnabled(value) {
  return value === true;
}

const DAY_MS = 86400000;

function parseISO(iso) {
  const p = String(iso).split("-");
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function clamp(value, lo, hi) {
  return value < lo ? lo : value > hi ? hi : value;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

// A series for a plan with no period, or one whose range holds no days: it has
// no slices, no capacity and no peak.
function emptySeries() {
  return {
    start: null,
    end: null,
    dayCount: 0,
    slices: [],
    maxDensity: 0,
    capacity: false
  };
}

/*
 * The density series across the plan's period: one slice per day, each with
 * the used and available capacity summed over the rows and Assignments the
 * filter and archive state leave, and their ratio - 0 when no row is shown.
 * A slice is over-allocated when its used capacity is strictly greater than
 * its available capacity. Work outside the period is read only as far as the
 * period reaches, exactly as the grid draws it.
 */
export function minimapDensity(plan, query, scopes, showArchived) {
  const range = (plan && plan.range) || null;
  if (!range || typeof range.start !== "string" || typeof range.end !== "string") {
    return emptySeries();
  }
  const start = parseISO(range.start);
  const end = parseISO(range.end);
  const dayCount = dayDiff(start, end) + 1;
  if (!(dayCount > 0)) return emptySeries();

  const visible = visiblePlan({
    people: (plan.people) || [],
    projects: (plan.projects) || [],
    assignments: (plan.assignments) || []
  }, showArchived === true);
  const view = filterPlan(visible, query, scopes || defaultScopes());

  const available = new Array(dayCount).fill(0);
  const used = new Array(dayCount).fill(0);

  (view.people || []).forEach(function (person) {
    const share = Number(person.availability) / 100;
    if (!(share > 0)) return;
    for (let i = 0; i < dayCount; i++) available[i] += share;
  });

  (view.assignments || []).forEach(function (assignment) {
    const share = Number(assignment.share) / 100;
    if (!(share > 0)) return;
    const from = dayDiff(start, parseISO(assignment.start));
    const to = dayDiff(start, parseISO(assignment.end));
    if (to < 0 || from > dayCount - 1) return;
    for (let i = Math.max(0, from); i <= Math.min(dayCount - 1, to); i++) used[i] += share;
  });

  const slices = [];
  let maxDensity = 0;
  let capacity = false;
  for (let i = 0; i < dayCount; i++) {
    const have = round4(available[i]);
    const want = round4(used[i]);
    if (have > 0) capacity = true;
    const density = have > 0 ? round4(want / have) : 0;
    if (density > maxDensity) maxDensity = density;
    slices.push({
      index: i,
      used: want,
      available: have,
      density: density,
      over: have > 0 && want > have + 1e-9
    });
  }

  return {
    start: range.start,
    end: range.end,
    dayCount: dayCount,
    slices: slices,
    maxDensity: round4(maxDensity),
    capacity: capacity
  };
}

/*
 * The window of days the grid currently shows, in day coordinates. The sticky
 * Person column covers the left of the viewport, so the visible day area runs
 * from the scroller's own scrollLeft - the day whose left edge sits at the
 * column's right edge - across the viewport minus that column. The result is
 * held inside the plan's range, so a range shorter than the viewport reads as
 * one whole window rather than running past its end.
 */
export function visibleDayWindow(scrollLeft, viewportWidth, headWidth, dayWidth, dayCount) {
  const total = Math.max(0, dayCount);
  if (!(dayWidth > 0) || total === 0) return { start: 0, width: total };
  const start = clamp(scrollLeft / dayWidth, 0, total);
  const width = clamp((viewportWidth - headWidth) / dayWidth, 0, total - start);
  return { start: start, width: width };
}

/*
 * The scroll that puts a day in the middle of the grid's visible day area.
 * It is the one rule goToToday and a press on the strip share: the day's
 * centre, less half the visible day area's width.
 */
export function centerScrollLeft(dayIndex, dayWidth, viewportWidth, headWidth) {
  return (dayIndex + 0.5) * dayWidth - (viewportWidth - headWidth) / 2;
}

/*
 * Where dragging the highlighted window leaves the grid: the scroll it started
 * from, moved by the pointer's travel in strip pixels, read as days across the
 * whole range. The caller clamps the answer to the scroller's own range.
 */
export function dragScrollLeft(startScrollLeft, deltaPixels, trackWidth, dayCount, dayWidth) {
  if (!(trackWidth > 0)) return startScrollLeft;
  const deltaDays = (deltaPixels / trackWidth) * dayCount;
  return startScrollLeft + deltaDays * dayWidth;
}

// The day under a press on the track, as a fraction of the whole range. The
// strip maps its whole width to the plan's whole period.
export function trackDayAt(clientX, trackLeft, trackWidth, dayCount) {
  const total = Math.max(0, dayCount);
  if (!(trackWidth > 0) || total === 0) return 0;
  return clamp((clientX - trackLeft) / trackWidth, 0, 1) * total;
}
