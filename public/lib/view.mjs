/*
 * PACT view state: the whole of what the interface draws the plan with rather
 * than what the plan holds - the Zoom and the row height, the weekend band and
 * the Grid dividers, the Minimap, the Colour palette, whether the Stack rail is
 * folded, and the two sort keys. It lives in `data/config.json` beside the
 * active plan file, so it survives a reload; the Filter and the Marker do not,
 * being a query and a cursor rather than settings.
 *
 * A plain ES module with no DOM and no server, so the browser (public/app.js),
 * the server (lib/config.mjs) and `node --test` all read exactly the same
 * source. Every rule here is pure.
 *
 * `normalizeView` is the whole contract on a stored value: a missing, malformed
 * or unreadable key falls back to that key's default alone, so a single bad
 * value can never break the view or a config the app refuses to start with.
 */
import {
  ZOOM_DEFAULT,
  isZoom,
  ROW_HEIGHT_DEFAULT,
  clampRowHeight
} from "./timeline.mjs";
import { PALETTE_DEFAULT, isPalette } from "./palette.mjs";
import { STACK_COLLAPSED_DEFAULT } from "./stack.mjs";
import { MINIMAP_DEFAULT } from "./minimap.mjs";
import {
  ASCENDING,
  DESCENDING,
  findSortKey,
  defaultDirection
} from "./sort.mjs";

/*
 * What the app ships with: exactly the values the interface opened on while
 * every one of these was session-only. These are the defaults a missing key
 * reads as, and the values Reset view restores.
 */
export const VIEW_DEFAULTS = Object.freeze({
  zoom: ZOOM_DEFAULT,
  rowHeight: ROW_HEIGHT_DEFAULT,
  weekends: false,
  dividers: true,
  minimap: MINIMAP_DEFAULT,
  palette: PALETTE_DEFAULT,
  stackCollapsed: STACK_COLLAPSED_DEFAULT,
  sort: Object.freeze({ projects: null, people: null })
});

// The keys the view owns, in one place so a writer knows what it may store.
export const VIEW_KEYS = Object.freeze([
  "zoom",
  "rowHeight",
  "weekends",
  "dividers",
  "minimap",
  "palette",
  "stackCollapsed",
  "sort"
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

/*
 * One list's sort as stored: `null` for the plan's own order, or a chosen key
 * with a direction. An unknown key is no order at all; an unknown direction
 * reads as that key's sensible one, so a half-written value still sorts.
 */
export function normalizeSort(kind, value) {
  if (!isPlainObject(value)) return null;
  const def = findSortKey(kind, value.key);
  if (!def) return null;
  const direction = value.direction === ASCENDING || value.direction === DESCENDING
    ? value.direction
    : defaultDirection(kind, def.key);
  return { key: def.key, direction: direction };
}

/*
 * A stored view read into the full shape, every key present. Anything that is
 * not a plain object reads as all defaults, and each key falls back on its own:
 * the others are kept.
 */
export function normalizeView(raw) {
  const source = isPlainObject(raw) ? raw : {};
  return {
    zoom: isZoom(source.zoom) ? source.zoom : VIEW_DEFAULTS.zoom,
    rowHeight: typeof source.rowHeight === "number" && Number.isFinite(source.rowHeight)
      ? clampRowHeight(source.rowHeight)
      : VIEW_DEFAULTS.rowHeight,
    weekends: booleanOr(source.weekends, VIEW_DEFAULTS.weekends),
    dividers: booleanOr(source.dividers, VIEW_DEFAULTS.dividers),
    minimap: booleanOr(source.minimap, VIEW_DEFAULTS.minimap),
    palette: isPalette(source.palette) ? source.palette : VIEW_DEFAULTS.palette,
    stackCollapsed: booleanOr(source.stackCollapsed, VIEW_DEFAULTS.stackCollapsed),
    sort: {
      projects: normalizeSort("projects", source.sort && source.sort.projects),
      people: normalizeSort("people", source.sort && source.sort.people)
    }
  };
}
