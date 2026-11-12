/*
 * PACT holidays: the per-Location dates a plan records as time off, and the
 * cells the grid shades for a Person's own Location.
 *
 * A plain ES module with no imports, so the server's plan validator
 * (lib/plan.mjs), the browser (public/app.js) and `node --test` all read
 * exactly the same source. Every rule here is pure.
 *
 * A holiday is one date and a full-or-half mark. It travels with the plan: the
 * locations and their dates live in the plan file, validated beside the rest,
 * and are never read from a library, a network call or the Config.
 */

// The two marks a holiday may carry. A full day reads as a whole day off; a
// half day is half off, drawn so the two can be told apart.
export const HOLIDAY_KINDS = ["full", "half"];
export const HOLIDAY_KIND_DEFAULT = "full";
export const HOLIDAY_KIND_LABELS = Object.freeze({
  full: "Full day",
  half: "Half day"
});

export function isHolidayKind(value) {
  return value === "full" || value === "half";
}

/*
 * The radio-group name for one holiday date row. Each row's pair carries its
 * own name, so two rows on the same Location card cannot interfere with each
 * other's choice; the Location and date indices keep every row distinct.
 */
export function holidayKindGroupName(groupIndex, dateIndex) {
  return "holiday-kind-" + groupIndex + "-" + dateIndex;
}

// A Location is matched case-insensitively and trimmed, the same way the
// Person Location suggestions deduplicate, so "Switzerland" and "switzerland"
// name the same set of holidays.
export function locationKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
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

/*
 * The Location names a plan's holidays configure, deduplicated
 * case-insensitively with the first spelling winning. This is what the Person
 * Location field offers beside the Locations already in use on other People.
 */
export function holidayLocations(holidays) {
  const seen = new Map();
  (holidays || []).forEach(function (group) {
    if (!group || typeof group !== "object") return;
    const text = typeof group.location === "string" ? group.location.trim() : "";
    if (!text) return;
    const key = locationKey(text);
    if (!seen.has(key)) seen.set(key, text);
  });
  return Array.from(seen.values());
}

/*
 * The days off configured for one Location, each `{ date, kind }`, in date
 * order and with a malformed entry skipped rather than drawn as a full day. A
 * Location with no configured holidays returns nothing, so its row is shaded
 * nowhere.
 */
export function holidaysFor(holidays, location) {
  const key = locationKey(location);
  if (!key) return [];
  const dates = [];
  (holidays || []).forEach(function (group) {
    if (!group || typeof group !== "object" || locationKey(group.location) !== key) return;
    (Array.isArray(group.dates) ? group.dates : []).forEach(function (entry) {
      if (!entry || typeof entry !== "object" || !isISODate(entry.date)) return;
      dates.push({ date: entry.date, kind: isHolidayKind(entry.kind) ? entry.kind : HOLIDAY_KIND_DEFAULT });
    });
  });
  dates.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return dates;
}

/*
 * The holiday cells a Person's row shades, as `{ i, n, kind }` in day-grid
 * positions from the drawn period's start. Days outside the drawn period are
 * dropped, and adjacent days off of the same kind merge into one cell so a run
 * of holidays draws as one band rather than a stack of slivers.
 */
export function holidayCellsFor(holidays, location, rangeStartISO, dayCount) {
  if (!isISODate(rangeStartISO)) return [];
  const total = Number.isFinite(Number(dayCount)) ? Math.max(0, Math.round(Number(dayCount))) : 0;
  const cells = [];
  holidaysFor(holidays, location).forEach(function (day) {
    const i = dayOffset(rangeStartISO, day.date);
    if (i < 0 || i >= total) return;
    const last = cells[cells.length - 1];
    if (last && last.kind === day.kind && last.i + last.n === i) {
      last.n += 1;
      return;
    }
    cells.push({ i: i, n: 1, kind: day.kind });
  });
  return cells;
}
