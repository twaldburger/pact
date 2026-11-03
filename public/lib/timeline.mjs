/*
 * PACT timeline geometry: the parts of dragging that are arithmetic rather
 * than DOM - which days a drawn rubber band covers, which days a Stack drop
 * would create, where a moved Assignment lands, and which row the pointer is
 * over.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source. Indices are whole-day offsets
 * from the range start, clamped to the days the Timeline draws, so a preview
 * and the change it becomes can never disagree.
 */

export const DROP_DAYS = 5;

function clampIndex(index, dayCount) {
  const last = Math.max(0, dayCount - 1);
  const n = Number.isFinite(index) ? Math.round(index) : 0;
  return Math.min(last, Math.max(0, n));
}

/*
 * The days a pointer drag covers. It works in either direction - the earlier
 * end is the start - and the shortest selection is one whole day.
 */
export function dayRange(fromIndex, toIndex, dayCount) {
  const a = clampIndex(fromIndex, dayCount);
  const b = clampIndex(toIndex, dayCount);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/*
 * What dropping a Project from the Stack creates: a run of `dropDays` days at
 * the day under the pointer. The run is whole days and is kept inside the
 * Timeline, so the ghost and the Assignment it becomes are the same extent.
 */
export function dropRange(dayIndex, dayCount, dropDays) {
  const days = Math.max(1, Math.min(dropDays || DROP_DAYS, dayCount));
  const start = Math.min(Math.max(0, dayCount - days), clampIndex(dayIndex, dayCount));
  return { start: start, end: start + days - 1 };
}

/*
 * Where dragging an Assignment's body leaves it: the same length, moved by
 * `deltaDays` along the Timeline and kept inside it.
 */
export function moveRange(startIndex, endIndex, deltaDays, dayCount) {
  const span = Math.max(1, Math.round(endIndex) - Math.round(startIndex) + 1);
  const start = Math.min(
    Math.max(0, dayCount - span),
    Math.max(0, Math.round(startIndex) + Math.round(deltaDays || 0))
  );
  return { start: start, end: start + span - 1 };
}

/*
 * Which Person's row a pointer at `y` is over, from the rows the page has
 * measured. A pointer outside every row targets no row at all.
 */
export function rowAtY(rows, y) {
  const list = rows || [];
  for (const row of list) {
    if (y >= row.top && y <= row.bottom) return row.id;
  }
  return null;
}
