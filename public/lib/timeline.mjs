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

/*
 * The row-height control: the drawn height of one Person's row, in whole
 * pixels, in steps of eight. It is a view setting only - it is never written
 * to the plan and returns to its default when the interface reloads.
 */
export const ROW_HEIGHT_MIN = 32;
export const ROW_HEIGHT_MAX = 120;
export const ROW_HEIGHT_STEP = 8;
export const ROW_HEIGHT_DEFAULT = 56;

// Below this the two lines of a row header cannot both fit, so the header
// collapses to its name and figure on one line.
export const ROW_HEADER_TIGHT = 48;

// Snap any value to the nearest whole step and keep it inside the range, so a
// control press can never leave the row at a height the interface does not
// draw.
export function clampRowHeight(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return ROW_HEIGHT_DEFAULT;
  const snapped = Math.round(n / ROW_HEIGHT_STEP) * ROW_HEIGHT_STEP;
  return Math.min(ROW_HEIGHT_MAX, Math.max(ROW_HEIGHT_MIN, snapped));
}

export function stepRowHeight(value, delta) {
  const direction = delta < 0 ? -1 : 1;
  return clampRowHeight(clampRowHeight(value) + direction * ROW_HEIGHT_STEP);
}

/*
 * The drawable height and the per-step size for a given row height. At the
 * original 44px row the drawable height was 40px and a 10% step 4px, so the
 * row is one step taller than the height an Assignment fills and a step is a
 * tenth of that drawable height: row = drawable + step, step = drawable / 10.
 * Given the row alone, step = row / 11 and drawable = 10 * step.
 */
export function rowGeometry(rowHeight) {
  const row = Number.isFinite(Number(rowHeight)) ? Number(rowHeight) : ROW_HEIGHT_DEFAULT;
  const step = row / 11;
  return { row: row, fte: 10 * step, step: step };
}

export function isRowHeaderTight(rowHeight) {
  const row = Number.isFinite(Number(rowHeight)) ? Number(rowHeight) : ROW_HEIGHT_DEFAULT;
  return row < ROW_HEADER_TIGHT;
}

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
