/*
 * PACT reports: the rules a report has of its own, kept here rather than in
 * the browser so `node --test` reads the same source the report does.
 *
 * Two of them. The report's time buckets are the four zoom levels, mapped
 * literally: Day, Week, Sprint and Month. The report remembers its own level
 * in the view state, so moving the grid to Day never turns the report into
 * 365 columns; this module only names the bucket the report's own level draws.
 *
 * And the Filter, which stays session-only but must reach the report across
 * the switch's navigation. It is handed over once, in the browser's session
 * storage, under `FILTER_HANDOFF_KEY`, and consumed on the next load - so a
 * plain reload still loses it exactly as it does today, while a move between
 * the two views carries it.
 */
import { ZOOM_DEFAULT } from "./timeline.mjs";

export const FILTER_HANDOFF_KEY = "pact.filter-handoff";

// The report's bucket for a zoom level, as the report's own line names it. An
// unknown level reads as the app's own default rather than an empty label.
export function reportBucketLabel(zoom) {
  if (zoom === "day") return "Day";
  if (zoom === "week") return "Week";
  if (zoom === "sprint") return "Sprint";
  if (zoom === "month") return "Month";
  return reportBucketLabel(ZOOM_DEFAULT);
}

// One carried filter as a string, or "" when there is nothing worth carrying.
// The shape is the two things the Filter holds: its session text and which
// areas it looks in.
export function serializeFilterHandoff(query, scopes) {
  const text = typeof query === "string" ? query : "";
  const areas = scopes && typeof scopes === "object" && !Array.isArray(scopes) ? scopes : {};
  return JSON.stringify({ query: text, scopes: areas });
}

// A carried filter read back, or null when the record is absent, unreadable or
// not the shape this module wrote. A null is not an error: it is simply no
// carried filter, and the report opens with an empty Filter as usual.
export function parseFilterHandoff(raw) {
  if (typeof raw !== "string") return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch (_) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const query = typeof value.query === "string" ? value.query : null;
  const scopes = value.scopes;
  if (query === null) return null;
  if (!scopes || typeof scopes !== "object" || Array.isArray(scopes)) return null;
  const clean = {};
  ["people", "projects", "assignments"].forEach(function (key) {
    clean[key] = scopes[key] === true;
  });
  return { query: query, scopes: clean };
}
