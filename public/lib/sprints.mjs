/*
 * PACT sprint cadence: the pure derivation of the sprint chain from the
 * cadence, the per-sprint adjustments and the plan period.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source. Nothing here is stored: the
 * chain is recomputed from the cadence, the adjustments and the period, so a
 * change to any of the three can never leave a stored list stale.
 */

// The name rule a new cadence is offered with. The prefix is taken exactly as
// typed, trailing space included, because that space is what separates the
// prefix from the number: "Sprint " and 24 give Sprint 24, 25, 26.
export const NAME_PREFIX_DEFAULT = "Sprint ";
export const NAME_NUMBER_DEFAULT = 1;
export const SPRINT_LENGTH_DEFAULT = 14;
export const SPRINT_LENGTH_MIN = 1;
export const SPRINT_LENGTH_MAX = 365;

const DAY_MS = 86400000;

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

function udate(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

function toISO(d) {
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

function addDays(d, n) {
  return new Date(d.getTime() + n * DAY_MS);
}

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// A whole length inside the sane range, or the fallback. A malformed stored
// value reads as the default rather than drawing nothing.
function normalizeLength(value, fallback) {
  return Number.isInteger(value) && value >= SPRINT_LENGTH_MIN && value <= SPRINT_LENGTH_MAX
    ? value
    : fallback;
}

// The first number, as the spelling that sets the padding width. An integer
// stores its own digits; a typed leading zero ("01") is kept, because it is
// exactly what makes the width two.
function nameNumberSpelling(value, fallback) {
  if (Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  return String(fallback);
}

// The stored cadence, normalised, or null when the plan carries none. Only the
// start is required to derive a chain; the rest fall back to the defaults a
// new cadence is offered with.
export function cadenceFrom(plan) {
  const raw = plan && plan.cadence;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (!isISODate(raw.start)) return null;
  return {
    start: raw.start,
    length: normalizeLength(raw.length, SPRINT_LENGTH_DEFAULT),
    namePrefix: typeof raw.namePrefix === "string" ? raw.namePrefix : NAME_PREFIX_DEFAULT,
    nameNumber: nameNumberSpelling(raw.nameNumber, NAME_NUMBER_DEFAULT)
  };
}

// The name of the sprint at `index` (1 for the first): the prefix exactly as
// typed, then the first number counted up from, padded to the width the first
// number's spelling sets. "Sprint" and 24 give Sprint 24, 25, 26; "26-" and
// "01" give 26-01, 26-02.
export function sprintName(cadence, index) {
  const prefix = cadence && typeof cadence.namePrefix === "string"
    ? cadence.namePrefix
    : NAME_PREFIX_DEFAULT;
  const first = nameNumberSpelling(cadence && cadence.nameNumber, NAME_NUMBER_DEFAULT);
  const n = Math.max(1, Math.round(Number(index) || 1));
  const value = Number(first) + (n - 1);
  return prefix + String(value).padStart(first.length, "0");
}

function adjustmentAt(adjustments, index) {
  if (!Array.isArray(adjustments)) return null;
  return adjustments.find(function (a) {
    return a && a.index === index;
  }) || null;
}

/*
 * The sprint chain: one entry per sprint that overlaps the plan period, from
 * the cadence's first start, each starting the day after the previous ends.
 * The chain is contiguous, and it runs until a sprint starts past the period's
 * end, so the last sprint is kept whole rather than cut at the period's edge.
 * Days before the cadence's start simply carry no sprint: nothing is derived
 * backwards.
 *
 * Each entry is { index, name, start, end, startIndex, endIndex }, the two
 * indices being whole-day offsets from the period's start. A sprint that began
 * before the period starts is clamped to index 0; the last sprint's endIndex
 * is its true offset, which the drawing side clamps to the grid. An adjustment
 * outside the chain - a stale ordinal - is ignored.
 */
export function sprintsFor(cadence, adjustments, period) {
  const c = cadenceFrom({ cadence: cadence });
  if (!c || !period || !isISODate(period.start) || !isISODate(period.end)) return [];
  const periodStart = udate(period.start);
  const periodEnd = udate(period.end);
  if (periodEnd < periodStart) return [];

  const sprints = [];
  let start = udate(c.start);
  let index = 1;
  // A walk from a cadence that began long before the period with very short
  // sprints is bounded, so a stored oddity cannot hang the draw.
  while (start <= periodEnd && index <= 100000) {
    const adjustment = adjustmentAt(adjustments, index);
    const length = adjustment ? normalizeLength(adjustment.length, c.length) : c.length;
    const end = addDays(start, length - 1);
    if (end >= periodStart) {
      const renamed = adjustment && typeof adjustment.name === "string" && adjustment.name.trim() !== ""
        ? adjustment.name
        : null;
      sprints.push({
        index: index,
        name: renamed === null ? sprintName(c, index) : renamed,
        start: toISO(start),
        end: toISO(end),
        startIndex: Math.max(0, dayDiff(periodStart, start)),
        endIndex: dayDiff(periodStart, end)
      });
    }
    start = addDays(end, 1);
    index += 1;
  }
  return sprints;
}
