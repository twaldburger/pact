/* PACT - the plan drawn from the server's JSON file, and the report on its own
 * page, both from this one script. Plain JavaScript as an ES module, no
 * framework, no build step. The page's <html data-view> says which view is
 * showing; the bar is mounted from ./lib/topbar.mjs, and the report draws its
 * own content where the grid would go. The plan lives in the active plan file
 * behind /api; the active file is chosen in the Plan file panel and remembered
 * in data/config.json. Every change the screen makes is sent to /api as it
 * happens, and the screen is redrawn from what the server returns. The panel
 * rules that are not about the DOM live in ./lib/panels.mjs, so `node --test`
 * can pin them. */
import {
  DEFAULT_STEP,
  STEP_MAX,
  clampAvailability,
  stepAvailability,
  suggestPersonTags,
  suggestProjectTags,
  suggestPersonLocations,
  suggestAssignmentTags,
  suggestMilestoneTags,
  withoutTag,
  archivedPersonRefusal,
  assignmentsHiddenRefusal,
  dropRefusal,
  rangeSettingRefusal,
  clampShare,
  stepShare,
  shareFromDrag,
  normalizeStep,
  stepSettingRefusal
} from "./lib/panels.mjs";
import { offeredTags, tickToggled, commitLabel, committedTags, enterTags } from "./lib/tag-picker.mjs";
import { planQuery } from "./lib/visibility.mjs";
import { optionsItems, optionDividerKeys, reportDisabledOptionKeys, dividerUnit, rangeControl, stepControl, paletteItems, paletteControl, blockLabelControl, blockLabelItems, sprintsItem, holidaysItem, tagsItem, milestonesItem, helpItem, adoItem } from "./lib/options.mjs";
import { mountTopbar, viewFromAttribute, VIEW_PLAN, VIEW_REPORT, isReportView, reportDisabledControlIds } from "./lib/topbar.mjs";
import { reportBucketLabel, FILTER_HANDOFF_KEY, serializeFilterHandoff, parseFilterHandoff } from "./lib/report.mjs";
import { reportContent, tagKeyGroups, tagKeyState, tagChoices, tagSelection, tagToggled } from "./lib/report-content.mjs";
import { REPORT_VIEWS, REPORT_VIEW_DEFAULT, normalizeReportView, reportViewLabel } from "./lib/report-views.mjs";
import {
  chartCeiling,
  chartGeometry,
  chartX,
  chartY,
  chartInPlot,
  chartNearestIndex,
  chartLinePath,
  chartBandPath,
  chartReadout,
  chartReadoutBox,
  chartReadoutAt,
  chartKeyIndex,
  chartMilestoneRules
} from "./lib/chart.mjs";
import { planFileItem, planFileView, withPlanSuffix } from "./lib/plan-file.mjs";
import { addressRefusals, adoRefusals, tokenNotice } from "./lib/ado.mjs";
import {
  HELP_DOCUMENTS,
  HELP_DOCUMENT_DEFAULT,
  HELP_RESULT_LIMIT,
  helpDocument,
  helpAnchors,
  searchHelp,
  renderHelpDocument
} from "./lib/help.mjs";
import {
  PALETTES,
  PALETTE_DEFAULT,
  SLOT_COUNT,
  isPalette,
  labelInkFor,
  leastUsedSlot,
  DEEP_INK
} from "./lib/palette.mjs";
import {
  TAG_LEVELS,
  TAG_LEVEL_LABELS,
  isTypedTag,
  tagKind,
  tagKeys,
  tagColourSlots,
  assignmentSlot,
  personSlot,
  blockIsHollow,
  planTypedTags,
  tagKindGroups,
  assignTagSlots,
  chooseTagSlot,
  cleanTagColours
} from "./lib/tags.mjs";
import {
  defaultScopes,
  filterPlan,
  filterIsEmpty,
  filterSuggestions,
  searchEverywhereSuggestion,
  personAssignedShare,
  scopeSummary,
  scopeLabel,
  searchedAreas,
  parseFilterTerm,
  fieldLabel,
  unknownFieldHint,
  SUGGESTION_LIMIT
} from "./lib/filter.mjs";
import { blockTitle, blockLabel, hoverText, isBlockLabel, labelText, rangeLabel } from "./lib/label.mjs";
import { copyName } from "./lib/copy.mjs";
import { deletionNotice } from "./lib/delete.mjs";
import {
  RAIL,
  GRID,
  PEOPLE,
  PROJECT,
  PERSON,
  projectCopy,
  personCopy,
  assignmentCopy,
  clipboardKind,
  pickUpIntent,
  pasteIntent,
  railRowTinted,
  rowHeaderTinted
} from "./lib/clipboard.mjs";
import {
  STACK_COLLAPSED_DEFAULT,
  stackToggleLabel,
  stackToggleExpanded,
  stackMatchCount,
  fteDaysFigure,
  fteDaysLabel
} from "./lib/stack.mjs";
import {
  MINIMAP_DEFAULT,
  minimapDensity,
  visibleDayWindow,
  centerScrollLeft,
  dragScrollLeft,
  trackDayAt
} from "./lib/minimap.mjs";
import {
  DROP_DAYS,
  dayRange,
  dropRange,
  moveRange,
  rowAtY,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_DEFAULT,
  ZOOM_DEFAULT,
  isZoom,
  stepRowHeight,
  rowGeometry,
  isRowHeaderTight,
  GRID_SPACING_MIN,
  GRID_SPACING_MAX,
  GRID_SPACING_DEFAULTS,
  stepGridSpacing
} from "./lib/timeline.mjs";
import {
  ASCENDING,
  DESCENDING,
  sortKeys,
  findSortKey,
  selectSortKey,
  toggleSortDirection,
  directionLabel,
  sortProjects,
  sortPeople,
  projectMeasures,
  markerReordersPeople,
  MARKER_RELEASE
} from "./lib/sort.mjs";
import { VIEW_DEFAULTS, normalizeView } from "./lib/view.mjs";
import { saveStatusWord, NOT_SAVED } from "./lib/save-status.mjs";
import {
  cadenceFrom,
  sprintsFor,
  SPRINT_LENGTH_DEFAULT,
  SPRINT_LENGTH_MIN,
  SPRINT_LENGTH_MAX,
  NAME_PREFIX_DEFAULT,
  NAME_NUMBER_DEFAULT
} from "./lib/sprints.mjs";
import { sprintDaysFigure } from "./lib/sprint-days.mjs";
import { milestoneMarks, milestoneAxisSlots, milestoneLabel, milestoneProjects } from "./lib/milestones.mjs";
import {
  milestoneProjectChoices,
  filterProjectChoices,
  projectPickerSummary
} from "./lib/milestone-projects.mjs";
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_DEFAULT,
  HOLIDAY_KIND_LABELS,
  holidayKindGroupName,
  holidayLocations,
  holidayCellsFor,
  isHolidayKind
} from "./lib/holidays.mjs";

var root = document.documentElement;
// Which view this page is: the grid, or the report on its own page. Read from
// the page's own attribute, so one script serves both and the two cannot drift.
var isReport = isReportView(root.getAttribute("data-view"));
// The bar is mounted before anything below reads it by id, so one source
// (public/lib/topbar.mjs) fills both pages with exactly the same bar.
mountTopbar(document.getElementById("topbar"), isReport ? VIEW_REPORT : VIEW_PLAN);
var tl = document.getElementById("tl");
var scroller = document.getElementById("scroller");
var stackList = document.getElementById("stack-list");
// The report's rail: the same panel, holding a list of the report's views
// rather than Projects. Absent on the plan, which has the list above instead.
var reportViewsList = document.getElementById("report-views");
var stackPanel = document.getElementById("stack");
var panelLayer = document.getElementById("panel-layer");
var contextEl = document.getElementById("context");
var saveStatusEl = document.getElementById("save-status");
var undoBtn = document.getElementById("undo-btn");
var redoBtn = document.getElementById("redo-btn");
var boardEl = document.getElementById("board");
var stackToggle = document.getElementById("rail-toggle");
var minimapEl = document.getElementById("minimap");
var stackChevron = document.querySelector(".rail-toggle__path");
var stackCount = document.getElementById("rail-toggle-count");

if (!tl || !scroller) throw new Error("PACT: the timeline is missing");

var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
var DAY_MS = 86400000;
// The active Colour palette: one of the view settings kept in the config and
// restored on load, Paired until one is chosen. It is never written to the
// plan. A Project's colour is a slot into whichever palette is active.
var activePalette = PALETTE_DEFAULT;
// What a block's label names: the Project, the Assignment's own name, or both.
// One of the view settings kept in the config and restored on load, like the
// palette; never written to the plan. It defaults to the Project's name alone,
// which is what every block said before an Assignment could have one.
var blockLabelSetting = VIEW_DEFAULTS.blockLabel;
// The plan's percentage step for the session, resolved from the loaded plan:
// the stored value, or the default of 10 when the plan carries none. The
// steppers, the panels and the vertical drag all move by it.
var planStep = DEFAULT_STEP;

var data = null;
var rangeStart = null;
var rangeEnd = null;
var DAYS = 1;
var startDow = 0;
var projectById = {};
var personById = {};
// The typed tags' colour-by-key choices and value colours, resolved from the
// loaded plan. Empty without a stored mapping, so nothing is coloured by a kind
// until one is chosen.
var tagKeyMap = {};
var tagSlotMap = {};
var assignments = [];
var markerIndex = 0;
var marker = null;
var markerDate = null;
// Whether the Marker is drawn, as restored from the config. Its index is kept
// either way: the Marker sets the date the per-person totals are read at, so
// hiding it hides the line, never the reading. Hiding it also takes the date
// chip out of the axis, so no invisible handle is left to catch a pointer.
var markerVisible = VIEW_DEFAULTS.marker;
// The sticky axis band the date chip is anchored to, so it stays in the
// header while the rows scroll under it.
var axisEl = null;
// The sprint chain, derived from the plan's cadence, adjustments and period in
// indexData: never stored, so it can never go stale. Empty without a cadence.
var sprintCadence = null;
var sprintList = [];
// The zoom buttons, kept so a cadence change can enable or disable the Sprint
// button and step the view away from a zoom it can no longer show.
var zoomButtons = [];
// The report's own zoom level, kept in the view like the grid's and restored
// on load. Separate, so moving the grid to Day never turns the report into
// 365 columns; the four levels are the report's time buckets.
var reportZoom = ZOOM_DEFAULT;
// Which of the report's seven views is showing, as the left panel's selection.
// One of the view settings kept in the config and restored on load; the report
// draws this view alone. Never written to the plan.
var reportView = REPORT_VIEW_DEFAULT;
// The row height and the geometry derived from it. One of the view settings
// kept in the config and restored on load; never written to the plan.
var rowHeight = ROW_HEIGHT_DEFAULT;
// The Grid spacing: the drawn width of one day, one value per zoom, so a zoom
// returns to its own width when it is re-entered. One of the view settings kept
// in the config and restored on load; never written to the plan.
var gridSpacing = Object.assign({}, GRID_SPACING_DEFAULTS);
var ftePx = 0;
var stepPx = 0;
var BASE_PX = 1;
var lastDragAt = 0;
var showArchived = false;
// The Minimap: an overview strip of the Timeline's whole period, off by
// default. One of the view settings kept in the config and restored on load;
// never written to the plan.
var minimapEnabled = MINIMAP_DEFAULT;
// The two grid-display choices: the weekend band and the full-height dividers.
// Kept in the config and restored on load, like Zoom and Row height - never
// written to the plan. Weekends start off and dividers on, so a first run
// opens on the quieter grid with its day boundaries ruled.
var highlightWeekends = false;
// The holiday band, off by default: when on, each Person's row shades the days
// off their own Location has configured. Kept in the config and restored on
// load, like the weekend band - never written to the plan.
var highlightHolidays = false;
// Whether the milestones are drawn: off by default, and a view change in the
// shape of the weekend band - kept in the config and restored on load, never
// written to the plan. When on, each visible date carries a rule down the rows
// and its milestone's name and date in the axis.
var milestoneRules = false;
// The dates those rules sit on, one mark per date, read from the plan's
// milestones once per draw by indexData and read by the rules, the axis band
// and the axis's own fit pass alike.
var milestoneMarkList = [];
// Whether each row draws its availability line: the dashed rule at the height
// the Person's Availability reaches, on by default so an untouched plan looks
// exactly as it did. A view setting kept in the config and restored on load,
// like the bands above - never written to the plan. Hiding it hides a mark of
// a measurement, never the measurement: the row height, the over-allocation
// band and every figure are drawn from the plan alone.
var availabilityLines = VIEW_DEFAULTS.availabilityLines;
// Whether each row draws its Assignment blocks, on by default so an untouched
// plan looks exactly as it did. A view setting kept in the config and restored
// on load, like the line above - never written to the plan. With it off no
// block is built at all rather than drawn and hidden, so the work is still
// there in every figure and only its drawing is gone.
var assignmentsVisible = VIEW_DEFAULTS.assignments;
var gridDividers = true;
// The Stack rail's folded state: one of the view settings kept in the config
// and restored on load, like Zoom and Row height; never written to the plan.
var stackCollapsed = STACK_COLLAPSED_DEFAULT;
// The sort: kept in the config and restored on load, like Zoom and Row height.
// null is the plan's own order; { key, direction } is a chosen key. The two
// lists sort independently.
var sortState = { projects: null, people: null };
// The Filter: session-only text and scope, never written to the plan. The
// whole plan stays in `assignments` for the row-header figures; `grid*` hold
// what the filter leaves to draw.
var filterQuery = "";
var filterScopes = defaultScopes();
var gridPeople = [];
var gridProjects = [];
var gridAssignments = [];

// The Session clipboard: what Ctrl+C holds, and what Ctrl+V makes of it. One
// slot serves all three kinds - a Project picked up from a rail row, an
// Assignment picked up from a block and a Person picked up from a row header -
// so it carries what it holds beside the thing itself, and a held copy can never
// be pasted as another kind. Held in memory only: the system clipboard is never
// read or written, so copying text elsewhere keeps working and the held copy
// dies with a page reload.
var clipboard = null;
// Where the pointer last was, so a keypress can act on the day and row under
// it without a click.
var clipboardPointer = null;
// What the pointer drives while the clipboard holds something: the tinted rail
// row for a held Project, the tinted row header for a held Person, the tinted
// target row and the ghost of the copy for a held Assignment.
var pastePreview = null;
var pasteDropRow = null;
// The row the pointer tints: one slot, because the clipboard holds one kind at
// a time and only one of them can be tinting a row.
var clipboardTint = null;

/* --- dates (UTC, so day arithmetic never crosses a DST edge) ------------- */

function udate(iso) {
  var p = iso.split("-");
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
}
function pad2(n) { return n < 10 ? "0" + n : String(n); }
function iso(d) {
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function addDays(d, n) { return new Date(d.getTime() + n * DAY_MS); }
function dayDiff(a, b) { return Math.round((b.getTime() - a.getTime()) / DAY_MS); }
function dow(d) { return d.getUTCDay(); }
function fmtDay(d) { return d.getUTCDate() + " " + MONTHS_SHORT[d.getUTCMonth()]; }
function fmtDayLong(d) {
  return d.getUTCDate() + " " + MONTHS_SHORT[d.getUTCMonth()] + " " + d.getUTCFullYear();
}
function fmtRange(a, b) {
  var s = fmtDay(a), e = fmtDay(b);
  if (a.getUTCFullYear() !== b.getUTCFullYear()) {
    s += " " + a.getUTCFullYear();
    e += " " + b.getUTCFullYear();
  }
  return s + " - " + e;
}
function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }
function r4(n) { return Math.round(n * 10000) / 10000; }

/* --- project colour ------------------------------------------------------ */

// The hex fill for a slot in the active palette. A malformed slot falls back to
// the palette's first fill rather than drawing nothing.
function activeColour(slot) {
  var palette = PALETTES[activePalette] || PALETTES[PALETTE_DEFAULT];
  return Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT ? palette[slot] : palette[0];
}

// The slot an Assignment's block draws in, from the typed tags resolved at
// index time, or its Project's own palette colour when no key colours it. The
// rule is public/lib/tags.mjs': its own tag under the assignments key, then its
// Project's under the projects key, then the Project colour.
function blockColourSlot(a) {
  var slot = assignmentSlot(a.raw && a.raw.tags, a.project && a.project.tags, tagKeyMap, tagSlotMap);
  return slot !== null ? slot : a.project.colour;
}

/* --- data index ---------------------------------------------------------- */

function indexData() {
  planStep = normalizeStep(data.step);
  rangeStart = udate(data.range.start);
  rangeEnd = udate(data.range.end);
  DAYS = dayDiff(rangeStart, rangeEnd) + 1;
  startDow = dow(rangeStart);

  // The sprint chain is derived here, from the cadence and adjustments the
  // plan holds and the period it draws, so nothing about it is stored.
  sprintCadence = cadenceFrom(data);
  sprintList = sprintCadence ? sprintsFor(sprintCadence, data.sprints, data.range) : [];

  projectById = {};
  data.projects.forEach(function (p) { projectById[p.id] = p; });
  personById = {};
  data.people.forEach(function (p) { personById[p.id] = p; });

  // The typed tags' colours, resolved from the plan so a draw reads two plain
  // maps rather than the stored shape.
  tagKeyMap = tagKeys(data.tagColours);
  tagSlotMap = tagColourSlots(data.tagColours);

  assignments = data.assignments.map(function (a) {
    var s = udate(a.start), e = udate(a.end);
    return {
      raw: a,
      id: a.id,
      project: projectById[a.projectId],
      person: personById[a.personId],
      start: s,
      end: e,
      startIdx: dayDiff(rangeStart, s),
      endIdx: dayDiff(rangeStart, e),
      share: a.share
    };
  }).filter(function (a) { return a.project && a.person; })
    // Work that falls outside the set period is not an error on load: it is
    // drawn only as far as the axis reaches, and work wholly outside it is not
    // drawn at all. Its real dates stay on the record.
    .filter(function (a) { return a.startIdx <= DAYS - 1 && a.endIdx >= 0; })
    .map(function (a) {
      a.startIdx = clamp(a.startIdx, 0, DAYS - 1);
      a.endIdx = clamp(a.endIdx, 0, DAYS - 1);
      return a;
    });

  // What the Filter leaves to draw. The mapped assignments keep their project
  // and person objects, so the filtered view is a subset of `assignments`
  // rather than a second mapping.
  var view = filterPlan(data, filterQuery, filterScopes);
  var markerISO = iso(addDays(rangeStart, clamp(markerIndex, 0, DAYS - 1)));
  // Ordering is display order only: the filtered view is put in the session's
  // sort order, never written back to the plan. With no key chosen each list
  // keeps the plan's own order.
  gridPeople = sortPeople(view.people, sortState.people, data, markerISO);
  gridProjects = sortProjects(view.projects, sortState.projects, data);
  var shown = {};
  view.assignments.forEach(function (a) { shown[a.id] = true; });
  gridAssignments = assignments.filter(function (a) { return shown[a.id]; });

  // The milestones the view leaves shown, one mark per date, read through the
  // model. A milestone term narrows this list, and the visibility rule still
  // decides what is drawn: one related to a project the Filter left out is not
  // marked, so the rules follow the visible projects rather than the whole
  // plan. The Milestones toggle is the last word - it is not read here,
  // because milestonesDrawn gates the drawing.
  milestoneMarkList = milestoneMarks(
    view.milestones,
    data.projects,
    gridProjects.map(function (project) { return project.id; }),
    data.range.start,
    DAYS
  );
}

/* --- tiny DOM helpers ---------------------------------------------------- */

function el(tag, cls) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}
function set(n, i, span) {
  n.style.setProperty("--i", i);
  n.style.setProperty("--n", span);
  return n;
}

// Pixel offset from the bottom of a row for a share of a full FTE. Rounding
// here keeps every drawn edge - the ceiling, a block, the hatch - on a whole
// pixel, so a fractional row height cannot blur a hairline. All shares are
// whole 10% steps, so stacked blocks share the same edge to the pixel.
function yPx(share) {
  return Math.round(BASE_PX + share * ftePx);
}

// How much larger than the interface's own 16px the root font is. The row
// height is in real pixels, so the row-header threshold has to be read in the
// same unit before the two can be compared.
function textScale() {
  var size = parseFloat(window.getComputedStyle(root).fontSize);
  return Number.isFinite(size) && size > 0 ? size / 16 : 1;
}

// Apply the current row height to the whole grid: the row-header column and
// the timeline together, and nothing else. Nothing here is persisted.
function applyRowHeight() {
  var g = rowGeometry(rowHeight);
  rowHeight = g.row;
  ftePx = g.fte;
  stepPx = g.step;
  root.style.setProperty("--row-h", rowHeight + "px");
  var down = document.getElementById("row-decrease");
  var up = document.getElementById("row-increase");
  if (down) down.disabled = rowHeight <= ROW_HEIGHT_MIN;
  if (up) up.disabled = rowHeight >= ROW_HEIGHT_MAX;
  root.classList.toggle("is-tight-rows", isRowHeaderTight(rowHeight, textScale()));
  // A report withdraws the pair regardless of where the row height sits, and
  // this runs again on every resize, so the sweep is repeated here.
  syncReportControls();
}

// Apply the active zoom's Grid spacing to the grid: one inline --day-w, which
// overrides the stylesheet's own per-zoom defaults, and the pair's disabled
// ends. Switching zoom applies that zoom's stored width rather than resetting
// it; nothing here is persisted.
function applyGridSpacing() {
  var zoom = root.getAttribute("data-zoom");
  if (!isZoom(zoom)) zoom = ZOOM_DEFAULT;
  var value = gridSpacing[zoom];
  root.style.setProperty("--day-w", value + "px");
  var down = document.getElementById("spacing-decrease");
  var up = document.getElementById("spacing-increase");
  if (down) down.disabled = value <= GRID_SPACING_MIN;
  if (up) up.disabled = value >= GRID_SPACING_MAX;
  // A wider or narrower day changes the room between two milestone dates, so
  // the band's labels are re-decided. Before the first draw there is no band
  // to decide, and the pass does nothing.
  fitMilestoneAxis();
  syncReportControls();
}

/* --- the shape of the calendar ------------------------------------------ */

function weekends() {
  var cells = [];
  var firstSat = (6 - startDow + 7) % 7;
  for (var i = firstSat; i < DAYS; i += 7) {
    cells.push({ i: i, n: Math.min(2, DAYS - i) });
  }
  return cells;
}

function months() {
  var cells = [];
  for (var i = 0; i < DAYS; i++) {
    var d = addDays(rangeStart, i);
    var key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    var last = cells[cells.length - 1];
    if (last && last.key === key) { last.n = i - last.i + 1; continue; }
    cells.push({ key: key, i: i, n: 1, date: d });
  }
  return cells;
}

function weeks() {
  var cells = [];
  for (var i = 0; i < DAYS;) {
    var w = (startDow + i) % 7;
    var span = ((7 - w) % 7) + 1;
    if (i + span > DAYS) span = DAYS - i;
    cells.push({ i: i, n: span, first: addDays(rangeStart, i).getUTCDate(), last: addDays(rangeStart, i + span - 1).getUTCDate() });
    i += span;
  }
  return cells;
}

// The Sprint zoom's cells: one per derived sprint in day-grid positions, plus
// a blank filler for the days before the cadence's start, which carry no
// sprint. The axis band and the Grid dividers both read this, so a rule is
// always drawn on the same edges as the sprint band it sits under.
function sprintCells() {
  var cells = [];
  if (!sprintList.length) return cells;
  var first = sprintList[0];
  if (first.startIndex > 0) {
    cells.push({ i: 0, n: Math.min(first.startIndex, DAYS), blank: true });
  }
  sprintList.forEach(function (sp) {
    var i = clamp(sp.startIndex, 0, DAYS - 1);
    var last = clamp(sp.endIndex, 0, DAYS - 1);
    cells.push({ i: i, n: Math.max(1, last - i + 1), name: sp.name });
  });
  return cells;
}

// The boundaries the Grid dividers are drawn on: the same cells the axis
// divides on at the active zoom. A rule sits at the right edge of each cell -
// the day-grid position of the axis separator that closes it - so the set of
// rules is exactly the set of axis separators at that zoom, and the leftmost
// edge, already the row-header column's own border, is drawn once.
function dividerCells() {
  var unit = dividerUnit(root.getAttribute("data-zoom"));
  if (unit === "sprint") return sprintCells();
  if (unit === "week") return weeks();
  if (unit === "month") return months();
  var days = [];
  for (var i = 0; i < DAYS; i++) days.push({ i: i, n: 1 });
  return days;
}

// The dividers overlay for the active zoom: one 1px rule at each boundary the
// axis divides on. It is built fresh for every draw and for every zoom change.
function buildRules() {
  var rules = el("div", "rules");
  dividerCells().forEach(function (c) {
    rules.appendChild(set(el("span", "rule"), c.i + c.n, 1));
  });
  return rules;
}

// A zoom change redraws the calendar's scale, not the rows, so the dividers
// are rebuilt in place: waiting for the next draw would leave last zoom's
// boundaries drawn down the rows.
function updateDividerRules() {
  var existing = tl.querySelector(".rules");
  if (existing) existing.remove();
  if (!gridDividers) return;
  var body = tl.querySelector(".tl__body");
  if (body) tl.insertBefore(buildRules(), body);
}

/* --- drawing: milestones ------------------------------------------------- */

// Whether the milestones are drawn at all: switched on, and something to name.
// The grid's rules, the axis band and the band's own height follow this one
// answer - and so does the report's chart, which rules the same marks - so a
// switched-on plan with nothing in the period draws no empty band.
function milestonesDrawn() {
  return milestoneRules && milestoneMarkList.length > 0;
}

// The milestone overlay: one full-height rule down the rows at each visible
// date, in the milestone's own palette colour. It is a sibling of the weekend
// band, the Grid dividers and the rows at the same stacking level, drawn last
// of them: a rule paints above the shading, the dividers and the blocks it
// crosses, while the Marker keeps its own higher layer.
function buildMilestoneRules() {
  var layer = el("div", "milestone-rules");
  milestoneMarkList.forEach(function (mark) {
    var rule = set(el("span", "milestone-rule"), mark.i, 1);
    rule.style.setProperty("--milestone", "var(--proj-" + mark.colour + ")");
    layer.appendChild(rule);
  });
  return layer;
}

// The axis band's slots: one per visible date, carrying the milestone's name
// and its date. Each slot is laid at its own date's column, the way a rule and
// the weekend band are, and its label runs on from there, so the fit is decided
// afterwards from the room the zoom leaves to the next date (fitMilestoneAxis)
// rather than from the number of slots.
function buildMilestoneBand() {
  var band = el("div", "axis__band axis__milestones");
  milestoneMarkList.forEach(function (mark) {
    var cell = el("div", "ax-milestone");
    cell.style.setProperty("--milestone", "var(--proj-" + mark.colour + ")");
    var label = el("span", "ax-milestone__label");
    label.textContent = milestoneLabel(mark);
    cell.appendChild(label);
    band.appendChild(set(cell, mark.i, 1));
  });
  return band;
}

// A label wider than the room to the next date is withdrawn and its slot keeps
// the bare tick. milestones.mjs owns that rule; this is the measuring around it,
// in the band's own font and its own inset, so a wider day, a longer name or a
// tighter inset moves the decision. Re-run wherever a label's room changes - a
// draw, the zoom, the spacing, the reader's text size, the bundled font
// arriving.
function fitMilestoneAxis() {
  var cells = tl.querySelectorAll(".ax-milestone");
  if (!cells.length) return;
  var label = cells[0].querySelector(".ax-milestone__label");
  if (!label) return;
  var style = window.getComputedStyle(label);
  var cellStyle = window.getComputedStyle(cells[0]);
  var measure = labelMeasurer(style.fontWeight + " " + style.fontSize + " " + style.fontFamily);
  var zoom = root.getAttribute("data-zoom");
  var slots = milestoneAxisSlots(milestoneMarkList, {
    dayWidth: gridSpacing[isZoom(zoom) ? zoom : ZOOM_DEFAULT],
    dayCount: DAYS,
    inset: parseFloat(cellStyle.paddingLeft) || 0,
    widthOf: measure
  });
  slots.forEach(function (slot, index) {
    if (cells[index]) cells[index].classList.toggle("is-tick", !slot.labelled);
  });
}

/* --- drawing: axis ------------------------------------------------------- */

function drawAxis() {
  var axis = el("div", "tl__axis");
  axis.setAttribute("aria-hidden", "true");
  // A click in the sticky header places the Marker on the day under the
  // pointer. Nothing follows while the button is held: the Marker's own
  // press-to-drag is the only surface that sweeps along the dates.
  axis.addEventListener("click", onAxisClick);
  axisEl = axis;

  var monthBand = el("div", "axis__band axis__months");
  months().forEach(function (m) {
    var c = el("div", "ax ax-month");
    var label = el("span", "ax-month__label");
    var text = MONTHS[m.date.getUTCMonth()];
    if (m.date.getUTCMonth() === 0 || m.i === 0) text += " " + m.date.getUTCFullYear();
    label.textContent = text;
    c.appendChild(label);
    monthBand.appendChild(set(c, m.i, m.n));
  });

  var dayBand = el("div", "axis__band axis__days");
  for (var i = 0; i < DAYS; i++) {
    var day = el("div", "ax ax-day");
    day.textContent = addDays(rangeStart, i).getUTCDate();
    dayBand.appendChild(set(day, i, 1));
  }

  var weekBand = el("div", "axis__band axis__weeks");
  weeks().forEach(function (wk) {
    var c = el("div", "ax ax-week");
    c.textContent = wk.first === wk.last ? String(wk.first) : wk.first + "-" + wk.last;
    weekBand.appendChild(set(c, wk.i, wk.n));
  });

  // The Sprint zoom's secondary band: one cell per derived sprint, starting at
  // the sprint's first day and left-aligned with its name. Days before the
  // cadence's start have no sprint, so a blank filler holds that stretch and
  // nothing is derived backwards. The band is drawn with the others and the
  // zoom's own CSS shows exactly one secondary band.
  var sprintBand = el("div", "axis__band axis__sprints");
  sprintCells().forEach(function (c) {
    var cell = el("div", c.blank ? "ax ax-sprint ax-sprint--blank" : "ax ax-sprint");
    if (!c.blank) {
      var label = el("span", "ax-sprint__label");
      label.textContent = c.name;
      cell.appendChild(label);
    }
    sprintBand.appendChild(set(cell, c.i, c.n));
  });

  axis.appendChild(monthBand);
  axis.appendChild(dayBand);
  axis.appendChild(weekBand);
  axis.appendChild(sprintBand);
  // The milestone band is drawn with the others and shown only while the rules
  // are switched on, so switching them on never rebuilds the axis by hand.
  if (milestonesDrawn()) axis.appendChild(buildMilestoneBand());
  return axis;
}

/* --- drawing: rows ------------------------------------------------------- */

// An Assignment under a Project marked as an absence: time off the Person
// rather than work, so it never adds load and is drawn hatched.
function aIsAbsence(a) {
  return !!(a.project && a.project.absence);
}

// Stack a person's assignments by start order, one rectangle per run of equal
// offset and over-allocation, so a block only ever sits where its share does.
// An absence takes no stacked space and no load: it is drawn at the bottom of
// the row, and never pushes work up or triggers the over-allocation band.
function layoutPerson(person, list) {
  var mine = (list || assignments).filter(function (a) { return a.person === person; })
    .sort(function (a, b) {
      if (a.startIdx !== b.startIdx) return a.startIdx - b.startIdx;
      if (a.endIdx !== b.endIdx) return a.endIdx - b.endIdx;
      return a.id < b.id ? -1 : 1;
    });

  var avail = person.availability / 100;
  var totalByDay = {};
  mine.forEach(function (a) {
    if (aIsAbsence(a)) return;
    for (var d = a.startIdx; d <= a.endIdx; d++) {
      totalByDay[d] = (totalByDay[d] || 0) + a.share / 100;
    }
  });

  return mine.map(function (a, ai) {
    var h = a.share / 100;
    var segs = [];
    if (aIsAbsence(a)) {
      segs.push({ key: "absence", offset: 0, hatch: 0, start: a.startIdx, end: a.endIdx });
      return { a: a, h: h, segs: segs };
    }
    var earlier = mine.slice(0, ai);
    var cur = null;
    for (var d = a.startIdx; d <= a.endIdx; d++) {
      var offset = 0;
      earlier.forEach(function (b) {
        if (aIsAbsence(b)) return;
        if (b.startIdx <= d && b.endIdx >= d) offset += b.share / 100;
      });
      var total = totalByDay[d] || 0;
      var hatch = total > avail + 1e-9
        ? Math.max(0, Math.min(offset + h, total) - Math.max(offset, avail))
        : 0;
      var key = r4(offset) + ":" + r4(hatch);
      if (!cur || cur.key !== key) {
        cur = { key: key, offset: offset, hatch: hatch, start: d, end: d };
        segs.push(cur);
      } else {
        cur.end = d;
      }
    }
    return { a: a, h: h, segs: segs };
  });
}

function drawRows() {
  var heads = el("div", "tl__heads");
  var body = el("div", "tl__body");

  gridPeople.forEach(function (person) {
    var wrap = el("div", "rowhead-wrap" + (person.archived ? " is-archived" : ""));
    wrap.setAttribute("data-person", person.id);

    var head = el("button", "rowhead");
    head.type = "button";
    head.setAttribute("data-person", person.id);
    var name = el("span", "rowhead__name");
    name.textContent = person.name;
    head.appendChild(name);
    // A Person's key colour as a mark beside their name, from their own tag
    // under the people key; a Person with no such tag keeps the row as it was,
    // since People have no palette colour of their own.
    var markSlot = personSlot(person.tags, tagKeyMap, tagSlotMap);
    if (markSlot !== null) {
      var mark = el("span", "rowhead__mark");
      mark.style.setProperty("--mark", "var(--proj-" + markSlot + ")");
      mark.setAttribute("aria-hidden", "true");
      name.appendChild(mark);
    }
    if (!person.archived) {
      var fig = el("span", "rowhead__fig");
      fig.setAttribute("data-fig", person.id);
      head.appendChild(fig);
    }
    head.addEventListener("click", function () {
      openPersonPanel(person, head);
    });
    wrap.appendChild(head);

    if (person.archived) {
      var badge = el("span", "rowhead__badge");
      badge.textContent = "Archived";
      wrap.appendChild(badge);
      var actions = el("div", "rowhead__actions");
      var restore = el("button", "rowhead__restore");
      restore.type = "button";
      restore.textContent = "Restore";
      restore.setAttribute("aria-label", "Restore " + person.name);
      restore.addEventListener("click", function () { restorePerson(person); });
      actions.appendChild(restore);
      var remove = el("button", "rowhead__delete");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete " + person.name);
      remove.addEventListener("click", function () { destroyPerson(person.id); });
      actions.appendChild(remove);
      wrap.appendChild(actions);
    }

    heads.appendChild(wrap);

    var row = el("div", "row" + (person.archived ? " is-archived" : ""));
    row.setAttribute("data-person", person.id);
    // With the setting off the line is not built at all, rather than drawn and
    // hidden: nothing invisible is left in the row to style or measure.
    if (availabilityLines) {
      var ceiling = el("span", "ceiling");
      ceiling.style.setProperty("--ceiling-px", yPx(person.availability / 100) + "px");
      row.appendChild(ceiling);
    }

    // The holiday band is per row: it shades only the days off the Person's own
    // Location has configured, so a row whose Location has none is untouched.
    if (highlightHolidays) {
      holidayCellsFor(data.holidays, person.location, data.range.start, DAYS).forEach(function (cell) {
        row.appendChild(set(el("span", "holiday" + (cell.kind === "half" ? " is-half" : "")), cell.i, cell.n));
      });
    }

    // With the setting off no block is built at all, rather than drawn and
    // hidden: the row holds no invisible element, and the over-allocation
    // hatch - a child of its block - goes with it, since with nothing drawn
    // above the ceiling there is nothing for it to mark. The ceiling line is
    // its own setting and is untouched by this one.
    if (assignmentsVisible) {
      layoutPerson(person, gridAssignments).forEach(function (group) {
        group.segs.forEach(function (s) {
          row.appendChild(blockFor(group, s));
        });
      });
    }

    body.appendChild(row);
  });

  // Empty row space is where a new Assignment is drawn; blocks and their edges
  // handle their own pointerdown first.
  body.addEventListener("pointerdown", onBodyPointerDown);

  return { heads: heads, body: body };
}

function blockFor(group, s) {
  var a = group.a;
  var archived = !!(a.raw && a.raw.archived);
  var absence = aIsAbsence(a);
  // Once a key that colours blocks is chosen, a block no chosen key colours
  // draws hollow instead of falling back to its Project's palette colour. With
  // no such key chosen it keeps that colour, so an untouched plan is unchanged.
  var hollow = blockIsHollow(a.raw && a.raw.tags, a.project && a.project.tags, tagKeyMap, tagSlotMap);
  // What the label names, by the Block label setting: the Project, the
  // Assignment's own name, or both. A nameless Assignment falls back to its
  // Project's name, so no block is left with a percentage alone.
  var title = blockTitle(blockLabelSetting, a.project.name, a.raw && a.raw.name);
  var b = el("div", "blk" + (archived ? " is-archived" : "") + (absence ? " is-absence" : "") + (hollow ? " is-hollow" : ""));
  b.setAttribute("role", "button");
  b.setAttribute("tabindex", "0");
  b.setAttribute("data-assignment", a.id);
  // The full label on hover, whatever the grid can show: a block too narrow or
  // too short for its own label still names what its label names and its share
  // under the pointer, with the Assignment's note on a second line when it has
  // one. Native chrome, so there is no tooltip to position or draw.
  b.title = hoverText(title, a.share, a.raw && a.raw.note);
  b.setAttribute("aria-label", title + " on " + a.person.name + ", " +
    a.share + "% from " + fmtRange(a.start, a.end) +
    (absence ? ", absence" : "") +
    (archived ? ", archived" : "") +
    ". Enter for details.");
  b.style.setProperty("--block-ink", "var(--proj-" + blockColourSlot(a) + ")");
  // The label ink is chosen per fill, so a pastel takes the deep ink and a dark
  // member takes white. It is a property of the drawn fill, not of the slot. A
  // hollow block has no fill, so its label sits on the canvas and takes the
  // deep ink the pastel fills already use.
  b.style.setProperty("--block-label", hollow ? DEEP_INK : labelInkFor(activeColour(blockColourSlot(a))));
  set(b, s.start, s.end - s.start + 1);
  b.style.setProperty("--blk-bottom", yPx(s.offset) + "px");
  b.style.setProperty("--blk-height", (yPx(s.offset + group.h) - yPx(s.offset)) + "px");
  b.dataset.offset = String(s.offset);
  if (s.hatch > 0) {
    // The over-allocation band runs from the block's top down to the ceiling;
    // its bottom border shares the ceiling's pixel so the two lines agree.
    var hatch = el("span", "blk__hatch");
    var hatchBottom = yPx(Math.max(s.offset, a.person.availability / 100));
    hatch.style.setProperty("--hatch-px",
      Math.max(0, yPx(s.offset + group.h) - hatchBottom) + "px");
    b.appendChild(hatch);
  }
  var tag = el("span", "blk__tag");
  tag.dataset.title = title;
  tag.dataset.share = String(a.share);
  tag.textContent = labelText(title, a.share);
  b.appendChild(tag);
  // A block too short to hold its own label carries the name on the paper just
  // above it instead. The text and its visibility are set by drawBlockLabels,
  // which is the only place that knows the room a block actually has.
  b.appendChild(el("span", "blk__outer"));
  if (archived) {
    // The same marked treatment the archived lists use, so an archived
    // Assignment reads as history rather than as live work.
    var badge = el("span", "blk__archived");
    badge.textContent = "Archived";
    b.appendChild(badge);
  }

  b.addEventListener("click", function () {
    if (Date.now() - lastDragAt < 300) return;
    select(b);
    openAssignmentPanel(a, b);
  });
  b.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(b);
      openAssignmentPanel(a, b);
    }
  });

  // An archived Assignment is history: it is drawn, but its edges carry no
  // change - restoring it comes first.
  if (archived) return b;

  // Dragging the body carries the whole Assignment along time and across
  // rows. The edges stop the event before it reaches here, so their own
  // drags are untouched.
  b.addEventListener("pointerdown", function (e) {
    beginBodyDrag(a, b, e);
  });

  [{ edge: "start", cls: "blk__edge--start" }, { edge: "end", cls: "blk__edge--end" }]
    .forEach(function (handle) {
      var node = el("span", "blk__edge " + handle.cls);
      node.setAttribute("aria-hidden", "true");
      node.addEventListener("pointerdown", function (e) {
        beginEdgeDrag(a, handle.edge, b, e);
      });
      b.appendChild(node);
    });

  return b;
}

/* --- drawing: block labels ----------------------------------------------- */

// Whether a block draws its title is decided from the room it actually has -
// its measured box against the label's measured width - never from the zoom
// or from how many days it spans. The rule lives in ./lib/label.mjs; this is
// the thin DOM reading around it: measure, decide, write.

var labelCanvas = null;

// A measure of the label's own font, from a canvas, so a pass is arithmetic
// rather than a reflow per candidate width.
function labelMeasurer(font) {
  if (!labelCanvas) labelCanvas = document.createElement("canvas");
  var ctx = labelCanvas.getContext("2d");
  ctx.font = font;
  return function (text) { return ctx.measureText(text).width; };
}

// The label's font, the inset that keeps it off the block's edges and the
// height one line of it needs - all read from a drawn tag, so the decision is
// made in the same pixels the label is drawn in. Every tag is styled alike, so
// one of them describes them all.
function readLabelMetrics(tag, block) {
  var style = window.getComputedStyle(tag);
  var box = block.getBoundingClientRect();
  var line = tag.getBoundingClientRect();
  return {
    font: style.fontWeight + " " + style.fontSize + " " + style.fontFamily,
    inset: Math.max(0, line.left - box.left),
    bottom: Math.max(0, box.bottom - line.bottom),
    textHeight: parseFloat(style.fontSize) || 0
  };
}

// The band one paper label needs above the block it names, in the label's own
// pixels.
var OUTER_LABEL_BAND = 11;

// Whether the paper label a block would draw is already occupied by another
// block in the same row. The band is the label's own footprint - a name drawn
// above a thin block is wider than the block - so a name that would run across
// a neighbour is skipped rather than drawn over it.
function outerBandOccupied(r, room) {
  var bandTop = r.top - OUTER_LABEL_BAND;
  var bandRight = r.left + r.textWidth;
  for (var i = 0; i < room.length; i++) {
    var o = room[i];
    if (o.row !== r.row) continue;
    if (o.top >= r.top || o.top + o.boxHeight <= bandTop) continue;
    if (o.left >= bandRight || o.left + o.boxWidth <= r.left) continue;
    return true;
  }
  return false;
}

// The paper label is anchored at the block's left edge and runs right, so the
// only edge the sticky Person column can swallow is that left one. A label
// that would start behind the column is not drawn at all: the sliver that
// shows is a nonsense tail of a name the reader cannot see in full. The grid's
// visible left edge is the column's right edge while the timeline is scrolled,
// and the grid's own edge when it is not.
function outerLabelClipped(r, gridLeft) {
  return r.viewportLeft < gridLeft;
}

function drawBlockLabels() {
  var blocks = tl.querySelectorAll(".blk");
  if (!blocks.length) return;
  var metrics = readLabelMetrics(blocks[0].querySelector(".blk__tag"), blocks[0]);
  var measure = labelMeasurer(metrics.font);
  var heads = tl.querySelector(".tl__heads");
  var gridLeft = heads ? heads.getBoundingClientRect().right : 0;

  // Read every block's box before writing any label, so the whole pass turns
  // on one layout rather than one per block.
  var room = [];
  for (var i = 0; i < blocks.length; i++) {
    var tag = blocks[i].querySelector(".blk__tag");
    if (!tag) continue;
    var title = tag.dataset.title || "";
    room.push({
      tag: tag,
      outer: blocks[i].querySelector(".blk__outer"),
      row: blocks[i].parentElement,
      title: title,
      share: tag.dataset.share,
      width: blocks[i].clientWidth - 2 * metrics.inset,
      height: blocks[i].clientHeight - metrics.bottom,
      top: blocks[i].offsetTop,
      left: blocks[i].offsetLeft,
      // The block's left edge in the viewport, the same space as the grid's
      // own left edge below. Captured here, with the other boxes, before any
      // label is written.
      viewportLeft: blocks[i].getBoundingClientRect().left,
      boxWidth: blocks[i].offsetWidth,
      boxHeight: blocks[i].offsetHeight,
      textWidth: measure(title)
    });
  }

  room.forEach(function (r) {
    var text = blockLabel({
      width: r.width,
      height: r.height,
      textHeight: metrics.textHeight,
      title: r.title,
      share: r.share,
      measure: measure
    });
    // A block with no room keeps its whole label in the DOM, hidden, so the
    // next pass can still measure the tag when the block grows again.
    r.tag.textContent = text || labelText(r.title, r.share);
    r.tag.style.visibility = text ? "" : "hidden";
    // Only a block with no room of its own can name itself on the paper above.
    if (text) {
      r.outer.textContent = "";
      r.outer.style.visibility = "hidden";
      return;
    }
    // The paper label carries the whole `Name · NN%` while the band above the
    // block has room for it, and the bare name while only that has. The widths
    // and the strings are the inside label's own, so the two agree; the cut the
    // inside label falls back to is not offered on the paper, where a fragment
    // would read as a different name. `minChars` at the title's own length is
    // what turns that fallback off.
    var full = labelText(r.title, r.share);
    var fullWidth = measure(full);
    r.textWidth = fullWidth;
    var outerWidth = 0;
    if (!outerBandOccupied(r, room)) {
      outerWidth = fullWidth;
    } else {
      r.textWidth = measure(r.title);
      if (!outerBandOccupied(r, room)) outerWidth = r.textWidth;
    }
    r.outer.textContent = blockLabel({
      width: outerWidth,
      height: OUTER_LABEL_BAND,
      textHeight: OUTER_LABEL_BAND,
      minChars: r.title.length,
      title: r.title,
      share: r.share,
      measure: measure
    });
    r.outer.style.visibility =
      outerWidth && !outerLabelClipped(r, gridLeft) ? "" : "hidden";
  });
}

// One pass a frame at most: a resize or a scale change arrives as a burst.
var labelsQueued = false;
function queueBlockLabels() {
  if (labelsQueued) return;
  labelsQueued = true;
  window.requestAnimationFrame(function () {
    labelsQueued = false;
    drawBlockLabels();
  });
}

/* --- drawing: marker ----------------------------------------------------- */

function drawMarker() {
  var layer = el("div", "marker-layer");
  marker = el("div", "marker");
  marker.setAttribute("role", "slider");
  marker.setAttribute("tabindex", "0");
  marker.setAttribute("aria-label", "Marker - the date the totals are read at");
  marker.setAttribute("aria-valuemin", "0");
  marker.setAttribute("aria-valuemax", String(DAYS - 1));
  marker.appendChild(el("span", "marker__hit"));
  marker.appendChild(el("span", "marker__grip"));
  // The chip belongs to the sticky header, not the scrolling marker, so it
  // stays in view; setMarker moves it to the Marker's x. It keeps the marker's
  // own press-to-drag behaviour, which is the only handle the header shows.
  markerDate = el("span", "marker__date");
  markerDate.addEventListener("pointerdown", onChipDown);
  if (axisEl) axisEl.appendChild(markerDate);

  marker.addEventListener("pointerdown", onMarkerDown);
  marker.addEventListener("pointermove", onMarkerMove);
  marker.addEventListener("pointerup", onMarkerUp);
  marker.addEventListener("pointercancel", onMarkerUp);
  marker.addEventListener("keydown", onMarkerKey);
  layer.appendChild(marker);
  return layer;
}

function indexFromClientX(x) {
  var tlRect = tl.getBoundingClientRect();
  var headW = headWidth();
  var dayW = dayWidth();
  return clamp(Math.floor((x - (tlRect.left + headW)) / dayW), 0, DAYS - 1);
}

// The drawn width of one day, read from the grid so it follows the zoom.
function dayWidth() {
  var tlRect = tl.getBoundingClientRect();
  var heads = tl.querySelector(".tl__heads");
  var headW = heads ? heads.getBoundingClientRect().width : 0;
  return (tlRect.width - headW) / DAYS;
}

function headWidth() {
  var heads = tl.querySelector(".tl__heads");
  return heads ? heads.getBoundingClientRect().width : 0;
}

var draggingMarker = false;

function onMarkerDown(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  draggingMarker = true;
  root.classList.add("is-dragging");
  try { marker.setPointerCapture(e.pointerId); } catch (err) { /* synthetic input */ }
  e.preventDefault();
  marker.focus();
}
// A click on the header band places the Marker on the day under the pointer.
// A click on the date chip is the chip's own: it is the header's drag handle,
// so it keeps the band underneath from placing the Marker under the chip's
// width rather than on the day the chip names.
// A hidden Marker is not placed this way either: with no line on screen, the
// click would move the date the totals are read at with nothing to show it.
function onAxisClick(e) {
  if (!markerVisible) return;
  if (e.target.closest(".marker__date")) return;
  setMarker(indexFromClientX(e.clientX));
}
// The chip is the header's own handle: it drags the Marker it names and keeps
// the press off the band underneath, which would move the Marker to the chip's
// centre rather than to the day it shows.
function onChipDown(e) {
  e.stopPropagation();
  onMarkerDown(e);
}
function onMarkerMove(e) {
  if (!draggingMarker) return;
  setMarker(indexFromClientX(e.clientX));
}
function onMarkerUp(e) {
  if (!draggingMarker) return;
  draggingMarker = false;
  root.classList.remove("is-dragging");
  try { if (marker.hasPointerCapture(e.pointerId)) marker.releasePointerCapture(e.pointerId); } catch (err) { /* ignored */ }
  // The Marker has been let go, so a load or free-capacity order is refreshed
  // now - not during the drag, which would move the rows under the pointer.
  if (markerReordersPeople(MARKER_RELEASE, sortState.people && sortState.people.key)) {
    reorderPeopleRows();
  }
}
function onMarkerKey(e) {
  var step = 0;
  if (e.key === "ArrowLeft") step = -1;
  else if (e.key === "ArrowRight") step = 1;
  else if (e.key === "Home") { setMarker(0); e.preventDefault(); return; }
  else if (e.key === "End") { setMarker(DAYS - 1); e.preventDefault(); return; }
  else return;
  setMarker(markerIndex + step);
  e.preventDefault();
}

function setMarker(i) {
  markerIndex = clamp(Math.round(i), 0, DAYS - 1);
  var date = addDays(rangeStart, markerIndex);
  // A hidden Marker has nothing drawn to move; its index has moved all the
  // same, so the figures below still read the day it stands on.
  if (marker) {
    marker.style.setProperty("--i", markerIndex);
    marker.setAttribute("aria-valuenow", String(markerIndex));
    marker.setAttribute("aria-valuetext", fmtDayLong(date));
  }
  if (markerDate) {
    markerDate.style.setProperty("--i", markerIndex);
    markerDate.textContent = fmtDay(date);
  }
  updateFigures();
  // A load or free-capacity order reads the Marker, but a drag must not
  // recompute it: the rows
  // stay put under the pointer and are refreshed on release (onMarkerUp). A
  // keyboard move is not a drag, so it refreshes here.
  if (!draggingMarker &&
      markerReordersPeople(MARKER_RELEASE, sortState.people && sortState.people.key)) {
    reorderPeopleRows();
  }
}

// Re-sort the People rows in place for the Marker's current date, moving the
// drawn nodes rather than rebuilding the grid, so a release does not flicker
// or lose the page's position. Only a load or free-capacity order ever reaches
// this.
function reorderPeopleRows() {
  if (!sortState.people) return;
  var ordered = sortPeople(gridPeople, sortState.people, data,
    iso(addDays(rangeStart, clamp(markerIndex, 0, DAYS - 1))));
  var same = ordered.length === gridPeople.length &&
    ordered.every(function (person, i) { return person.id === gridPeople[i].id; });
  if (same) return;
  gridPeople = ordered;
  var heads = tl.querySelector(".tl__heads");
  var body = tl.querySelector(".tl__body");
  if (!heads || !body) return;
  ordered.forEach(function (person) {
    var head = heads.querySelector('[data-person="' + person.id + '"]');
    var row = body.querySelector('[data-person="' + person.id + '"]');
    if (head) heads.appendChild(head);
    if (row) body.appendChild(row);
  });
  drawBlockLabels();
}

function totalAt(person, dayIdx) {
  // The figure is the Person's own load, read from the whole plan: a filter
  // must not narrow the number that answers "can this person take more?"
  return personAssignedShare(data, person.id, iso(addDays(rangeStart, dayIdx)));
}

function updateFigures() {
  data.people.forEach(function (person) {
    var fig = tl.querySelector('[data-fig="' + person.id + '"]');
    if (!fig) return;
    var total = totalAt(person, markerIndex);
    var assigned = Math.round(total * 100);
    var over = assigned > person.availability;
    fig.textContent = assigned + "/" + person.availability + "%";
    fig.classList.toggle("is-over", over);
    var head = fig.closest(".rowhead");
    if (head) {
      // One over-allocation decision colours the figure and marks the header.
      head.classList.toggle("is-over", over);
      head.setAttribute("aria-label", person.name + ", " + assigned + "% of " +
        person.availability + "% at the Marker");
    }
  });
}

/* --- drawing: stack rail ------------------------------------------------- */

function drawStack() {
  var measures = projectMeasures(data);
  gridProjects.forEach(function (project) {
    var row = el("li", "stack__row" + (project.archived ? " is-archived" : ""));

    var item = el("button", "stack__item");
    item.type = "button";
    item.setAttribute("data-project", project.id);
    var chip = el("span", "stack__chip");
    chip.style.setProperty("--chip", "var(--proj-" + project.colour + ")");
    var name = el("span", "stack__name");
    name.textContent = project.name;
    item.appendChild(chip);
    item.appendChild(name);
    // The figure is the Project's whole-plan FTE-days, never the filtered
    // view: the rail describes the plan, not the current filter.
    var fte = measures[project.id] ? measures[project.id].fteDays : 0;
    var days = el("span", "stack__fte");
    days.textContent = fteDaysFigure(fte);
    days.setAttribute("title", fteDaysLabel(fte));
    days.setAttribute("aria-label", fteDaysLabel(fte));
    item.appendChild(days);
    item.addEventListener("click", function () {
      if (Date.now() - lastDragAt < 300) return;
      openProjectPanel(project, item);
    });
    item.addEventListener("pointerdown", function (e) {
      beginStackDrag(e, project);
    });
    row.appendChild(item);

    if (project.archived) {
      var actions = el("div", "stack__actions");
      var badge = el("span", "stack__badge");
      badge.textContent = "Archived";
      var restore = el("button", "stack__restore");
      restore.type = "button";
      restore.textContent = "Restore";
      restore.setAttribute("aria-label", "Restore " + project.name);
      restore.addEventListener("click", function () { restoreProject(project); });
      actions.appendChild(badge);
      actions.appendChild(restore);
      var remove = el("button", "stack__delete");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.setAttribute("aria-label", "Delete " + project.name);
      remove.addEventListener("click", function () { destroyProject(project.id); });
      actions.appendChild(remove);
      row.appendChild(actions);
    }

    stackList.appendChild(row);
  });
}

/* --- interaction: drag a project from the Stack onto a row --------------- */

/*
 * Whether the grid may make a new Assignment at all, and the message when it
 * may not: an archived Person or Project is refused by name, and while the
 * assignment blocks are hidden every grid gesture is refused - a drag, a drop
 * or a paste would otherwise create work that lands in a row with nothing
 * drawn to show it. Returns the message, or null when the gesture may go on.
 */
function gridCreateRefusal(person, project) {
  if (!assignmentsVisible) return assignmentsHiddenRefusal();
  return dropRefusal(person, project);
}

// A ghost of the extent a drag would create or move: a block outline in the
// row it would land on, with a small label carrying its dates. `--i`/`--n`
// place it, `--blk-bottom`/`--blk-height` size it and `--block-ink` gives it
// the project colour.
function makeExtentPreview() {
  var node = el("div", "preview");
  var label = el("span", "preview__label");
  node.appendChild(label);
  return { node: node, label: label };
}

function placePreview(preview, row, range, colour, height, offset) {
  preview.node.style.setProperty("--i", range.start);
  preview.node.style.setProperty("--n", range.end - range.start + 1);
  preview.node.style.setProperty("--blk-bottom", yPx(offset) + "px");
  preview.node.style.setProperty("--blk-height", (yPx(offset + height) - yPx(offset)) + "px");
  preview.node.style.setProperty("--block-ink", "var(--proj-" + colour + ")");
  preview.label.textContent = fmtRange(addDays(rangeStart, range.start), addDays(rangeStart, range.end));
  if (preview.node.parentNode !== row) row.appendChild(preview.node);
}

function beginStackDrag(e, project) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  var startX = e.clientX, startY = e.clientY;
  var dragging = false;
  var ghost = null;
  var dropRow = null;
  var preview = null;

  function clearRow() {
    if (dropRow) dropRow.classList.remove("is-drop");
    dropRow = null;
  }
  function clearPreview() {
    if (preview) { preview.node.remove(); preview = null; }
  }

  // The row under the pointer is highlighted as the person signal; the ghost
  // only appears where a drop could actually create something.
  function showPreview(row, dayIndex) {
    var person = personById[row.personId];
    if (project.archived || (person && person.archived)) { clearPreview(); return; }
    if (!preview) preview = makeExtentPreview();
    placePreview(preview, row.el, dropRange(dayIndex, DAYS, DROP_DAYS), project.colour, 1, 0);
  }

  function onMove(ev) {
    if (!dragging) {
      if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
      dragging = true;
      ghost = el("div", "drag-ghost");
      var chip = el("span", "drag-ghost__chip");
      chip.style.setProperty("--chip", "var(--proj-" + project.colour + ")");
      var label = el("span", "drag-ghost__name");
      label.textContent = project.name;
      ghost.appendChild(chip);
      ghost.appendChild(label);
      document.body.appendChild(ghost);
      root.classList.add("is-dragging");
    }
    ghost.style.left = ev.clientX + "px";
    ghost.style.top = ev.clientY + "px";
    var row = rowInfoAt(ev.clientX, ev.clientY);
    if (row) {
      if (row.el !== dropRow) { clearRow(); dropRow = row.el; dropRow.classList.add("is-drop"); }
      showPreview(row, indexFromClientX(ev.clientX));
    } else {
      clearRow();
      clearPreview();
    }
  }

  function onUp(ev) {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (ghost) ghost.remove();
    root.classList.remove("is-dragging");
    clearRow();
    clearPreview();
    if (!dragging) return;
    lastDragAt = Date.now();
    var row = rowInfoAt(ev.clientX, ev.clientY);
    if (!row) return;
    // An archived Person or Project cannot take new work, and the grid makes
    // nothing at all while the blocks are hidden: the drop is refused with a
    // message rather than reviving it, drawing something invisible, or doing
    // nothing.
    var refusal = gridCreateRefusal(personById[row.personId], project);
    if (refusal) {
      showError(new Error(refusal));
      render();
      return;
    }
    createAssignment(project, row.personId, indexFromClientX(ev.clientX));
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

// Which row the pointer is over: the Person is decided by the pointer's height
// through the shared rule, then the pointer must be inside that row's grid or
// its header. The row-header column belongs to its Person's row.
function rowInfoAt(x, y) {
  var body = tl.querySelector(".tl__body");
  if (!body) return null;
  var rows = [];
  var rowEls = body.querySelectorAll(".row");
  for (var i = 0; i < rowEls.length; i++) {
    var r = rowEls[i].getBoundingClientRect();
    rows.push({
      id: rowEls[i].getAttribute("data-person"), el: rowEls[i],
      top: r.top, bottom: r.bottom, left: r.left, right: r.right
    });
  }
  var id = rowAtY(rows, y);
  if (!id) return null;
  var hit = null;
  rows.forEach(function (row) { if (row.id === id) hit = row; });
  if (!hit) return null;

  var inside = x >= hit.left && x <= hit.right;
  if (!inside) {
    var headEls = tl.querySelectorAll(".rowhead");
    for (var j = 0; j < headEls.length; j++) {
      if (headEls[j].getAttribute("data-person") !== id) continue;
      var hr = headEls[j].getBoundingClientRect();
      if (y >= hr.top && y <= hr.bottom && x >= hr.left && x <= hr.right) { inside = true; break; }
    }
  }
  if (!inside) return null;
  return { el: hit.el, personId: id };
}

/* --- interaction: copy and paste from the rail and the grid --------------- */

// Whether the keyboard is in a text field, where the browser's own copy and
// paste must be left alone. A button - an Assignment block or a row header -
// is not text, so the keys still work when focus is on one.
function isTextEditing() {
  var node = document.activeElement;
  if (!node) return false;
  var tag = node.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!node.isContentEditable;
}

// The rail's row under the pointer: its button, and the Project that row names.
// An archived Project has a row too, so copying one is offered as it is from its
// panel - copying creates rather than restores, so nothing is refused here.
function railRowAt(x, y) {
  var node = document.elementFromPoint(x, y);
  var item = node && node.closest ? node.closest(".stack__item[data-project]") : null;
  if (!item) return null;
  var id = item.getAttribute("data-project");
  var project = null;
  data.projects.forEach(function (p) { if (p.id === id) project = p; });
  return project ? { item: item, project: project } : null;
}

// The row header under the pointer: its button, and the Person it names. An
// archived Person has a header too, so copying one with the keyboard is offered
// as it is from their panel - copying creates rather than restores, so nothing
// is refused here.
function personRowAt(x, y) {
  var node = document.elementFromPoint(x, y);
  var head = node && node.closest ? node.closest(".rowhead[data-person]") : null;
  if (!head) return null;
  var person = personById[head.getAttribute("data-person")];
  return person ? { head: head, person: person } : null;
}

// Which surface the pointer is over, as the clipboard reads it: the Projects
// rail, the People column of row headers, the grid of Person rows, or none of
// them. The rail and the People column count whole, not only their rows, because
// a Project and a Person both need no target position. A report has no grid rows
// and lists views rather than Projects, so it is none of them.
function clipboardSurfaceAt(x, y) {
  if (isReport) return null;
  var node = document.elementFromPoint(x, y);
  if (!node) return null;
  if (stackPanel && stackPanel.contains(node)) return RAIL;
  if (node.closest && node.closest(".tl__heads")) return PEOPLE;
  if (rowInfoAt(x, y)) return GRID;
  return null;
}

// The record the pointer is over, from the lookup Ctrl+C and Delete share: the
// Project of the rail row it is on, or the Person of the row header. Anything
// else in either surface answers nothing, so neither key can reach a record the
// pointer is merely near - a stretch of the column below a header is no record.
function pickupAt(x, y) {
  var intent = pickUpIntent(clipboardSurfaceAt(x, y));
  if (intent === PROJECT) {
    var rail = railRowAt(x, y);
    return rail ? { kind: PROJECT, record: rail.project } : null;
  }
  if (intent === PERSON) {
    var head = personRowAt(x, y);
    return head ? { kind: PERSON, record: head.person } : null;
  }
  return null;
}

// Remember the Assignment the pointer is over: its Project, Share, name, tags,
// note and its length in whole days. An archived Assignment is history and
// cannot be copied, so it is left alone.
function copyAssignmentAt(x, y) {
  var node = document.elementFromPoint(x, y);
  var block = node && node.closest ? node.closest("[data-assignment]") : null;
  if (!block) return false;
  var id = block.getAttribute("data-assignment");
  var a = null;
  assignments.forEach(function (item) { if (item.id === id) a = item; });
  if (!a || (a.raw && a.raw.archived)) return false;
  clipboard = assignmentCopy({
    projectId: a.project.id,
    share: a.share,
    name: (a.raw && a.raw.name) || "",
    tags: a.raw && a.raw.tags ? a.raw.tags : [],
    note: (a.raw && a.raw.note) || "",
    days: a.endIdx - a.startIdx + 1
  });
  return true;
}

function clearPastePreview() {
  if (pasteDropRow) { pasteDropRow.classList.remove("is-drop"); pasteDropRow = null; }
  if (pastePreview) { pastePreview.node.remove(); pastePreview = null; }
}

function clearClipboardTint() {
  if (clipboardTint) { clipboardTint.classList.remove("is-drop"); clipboardTint = null; }
}

// Tint the row the pointer is over while the clipboard holds a kind that pastes
// at no position: the rail row for a held Project, the row header for a held
// Person, both with the drag's own is-drop tint. False when nothing is held
// there, so the caller can fall through to the ghost a held Assignment draws.
function tintRowUnderPointer() {
  if (!clipboardPointer) return false;
  var surface = clipboardSurfaceAt(clipboardPointer.x, clipboardPointer.y);
  var item = null;
  if (railRowTinted(clipboard) && surface === RAIL) {
    var rail = railRowAt(clipboardPointer.x, clipboardPointer.y);
    item = rail && rail.item;
  } else if (rowHeaderTinted(clipboard) && surface === PEOPLE) {
    var head = personRowAt(clipboardPointer.x, clipboardPointer.y);
    item = head && head.head;
  }
  if (!item) return false;
  clipboardTint = item;
  clipboardTint.classList.add("is-drop");
  return true;
}

// While the clipboard holds something, the pointer shows what a paste would do
// with it. A held Project and a held Person have no position to ghost, so the
// row under the pointer carries the tint instead. A held Assignment tints its
// target row and follows the pointer with a ghost of the copy, at the day the
// paste would land on; it stands down over an archived Person, whose paste is
// refused, and anywhere off the grid, where a paste would do nothing.
function updatePastePreview() {
  clearClipboardTint();
  if (tintRowUnderPointer()) { clearPastePreview(); return; }
  if (!clipboard || !clipboardPointer) { clearPastePreview(); return; }
  if (clipboardSurfaceAt(clipboardPointer.x, clipboardPointer.y) !== GRID) {
    clearPastePreview();
    return;
  }
  var row = rowInfoAt(clipboardPointer.x, clipboardPointer.y);
  if (!row) { clearPastePreview(); return; }
  if (row.el !== pasteDropRow) {
    if (pasteDropRow) pasteDropRow.classList.remove("is-drop");
    pasteDropRow = row.el;
    pasteDropRow.classList.add("is-drop");
  }
  var project = projectById[clipboard.projectId];
  if (!project || gridCreateRefusal(personById[row.personId], project)) {
    if (pastePreview) { pastePreview.node.remove(); pastePreview = null; }
    return;
  }
  if (!pastePreview) pastePreview = makeExtentPreview();
  placePreview(pastePreview, row.el,
    dropRange(indexFromClientX(clipboardPointer.x), DAYS, clipboard.days),
    project.colour, clipboard.share / 100, 0);
}

// A paste is an ordinary new Assignment: the same create path, carrying the
// copied Project, Share, name, tags and note, starting on the pointer's day
// with the copy's own length in the pointer's row.
function pasteAssignment(row, dayIdx) {
  var copy = clipboard;
  var project = projectById[copy.projectId];
  if (!project) return;
  var refusal = gridCreateRefusal(personById[row.personId], project);
  if (refusal) {
    showError(new Error(refusal));
    render();
    return;
  }
  var range = dropRange(dayIdx, DAYS, copy.days);
  // A paste uses the copy up: with the copied Assignment gone, a later pointer
  // move draws neither the ghost nor the row tint, and another paste needs a
  // fresh Ctrl+C. A refusal above returns first, so the copy stays retryable.
  clipboard = null;
  clearPastePreview();
  postAssignment({
    projectId: copy.projectId,
    personId: row.personId,
    start: iso(addDays(rangeStart, range.start)),
    end: iso(addDays(rangeStart, range.end)),
    share: copy.share,
    name: copy.name,
    tags: copy.tags.slice(),
    note: copy.note
  });
}

// A Project paste makes the copy at once, through the same function the Project
// panel's Copy button calls - one creation path, one name rule, one Undo step -
// with no target position to name. Like an Assignment paste it uses the copy up.
function pasteProject() {
  var source = projectById[clipboard.projectId];
  if (!source) return;
  clipboard = null;
  updatePastePreview();
  copyProject(source);
}

// A Person paste makes the copy at once, through the same function the Person
// panel's Copy button calls - one creation path, one name rule, one Undo step -
// with no target position to name, because a name sorts itself into the column.
// Like the other two it uses the copy up.
function pastePerson() {
  var source = personById[clipboard.personId];
  if (!source) return;
  clipboard = null;
  updatePastePreview();
  copyPerson(source);
}

function onClipboardPointerMove(ev) {
  clipboardPointer = { x: ev.clientX, y: ev.clientY };
  if (clipboard) updatePastePreview();
}

function onClipboardKey(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
  var key = e.key ? e.key.toLowerCase() : "";
  if (key !== "c" && key !== "v") return;
  if (isTextEditing() || !clipboardPointer) return;
  var x = clipboardPointer.x, y = clipboardPointer.y;

  if (key === "c") {
    // Only the rail's rows pick a Project up and only a row header picks a
    // Person up. A block in the grid carries nothing: it names a Project the
    // reader is hovering, and copying that Project from there would copy
    // something nobody pointed at.
    var pick = pickupAt(x, y);
    if (!pick) {
      if (copyAssignmentAt(x, y)) {
        e.preventDefault();
        updatePastePreview();
      }
      return;
    }
    e.preventDefault();
    if (pick.kind === PROJECT) {
      clipboard = projectCopy(pick.record.id);
      showToast("Copied " + pick.record.name);
    } else {
      clipboard = personCopy(pick.record.id);
      showToast("Copied \"" + pick.record.name + "\"");
    }
    updatePastePreview();
    return;
  }

  var intent = pasteIntent(clipboard, clipboardSurfaceAt(x, y));
  if (!intent) return;
  if (intent === PROJECT) {
    e.preventDefault();
    pasteProject();
    return;
  }
  if (intent === PERSON) {
    e.preventDefault();
    pastePerson();
    return;
  }
  var row = rowInfoAt(x, y);
  if (!row) return;
  e.preventDefault();
  clearPastePreview();
  pasteAssignment(row, indexFromClientX(x));
}

// The Delete key deletes the record under the pointer, with no dialog: the
// Assignment whose block it is on, else the Person of the row header or the
// Project of the rail row - the record Ctrl+C picks up, from the same lookup.
// Destroying a Person or a Project takes every Assignment of theirs in the same
// write, so the notice names the cascade the store itself counted, and Undo
// steps the whole removal back. A text field keeps the key for itself, so
// editing is untouched, and a pointer that is not on a record leaves it alone.
function onDeleteKey(e) {
  if (e.key !== "Delete" || isTextEditing() || !clipboardPointer) return;
  var x = clipboardPointer.x, y = clipboardPointer.y;
  var node = document.elementFromPoint(x, y);
  var block = node && node.closest ? node.closest("[data-assignment]") : null;
  if (block) {
    e.preventDefault();
    closePanel(false);
    destroyAssignment(block.getAttribute("data-assignment"));
    return;
  }
  var pick = pickupAt(x, y);
  if (!pick) return;
  e.preventDefault();
  closePanel(false);
  var name = pick.record.name;
  var destroy = pick.kind === PERSON ? destroyPerson : destroyProject;
  destroy(pick.record.id).then(function (result) {
    // A failed write is reported in place of this, and the store's answer is
    // the only count spoken: nothing is worked out on this side.
    if (!result) return;
    showToast(deletionNotice(pick.kind, name, result.assignments));
  });
}

/* --- interaction: drag an assignment's edges ----------------------------- */

function beginEdgeDrag(a, edge, block, e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  e.stopPropagation();
  select(block);

  var startX = e.clientX, startY = e.clientY;
  var mode = null;
  var origStart = a.startIdx, origEnd = a.endIdx, origShare = a.share;
  var curStart = origStart, curEnd = origEnd, curShare = origShare;
  var readout = null;

  function onMove(ev) {
    var dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!mode) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      mode = Math.abs(dx) >= Math.abs(dy) ? "date" : "share";
      root.classList.add("is-dragging");
      readout = el("span", "readout");
      document.body.appendChild(readout);
    }
    if (mode === "date") {
      var idx = indexFromClientX(ev.clientX);
      if (edge === "start") curStart = clamp(idx, 0, origEnd);
      else curEnd = clamp(idx, origStart, DAYS - 1);
      set(block, curStart, curEnd - curStart + 1);
      readout.textContent = fmtRange(addDays(rangeStart, curStart), addDays(rangeStart, curEnd));
    } else {
      // stepPx is the pixel height of a 10% step, so one plan step is that
      // much times step/10; a step of 10 reproduces the original arithmetic.
      var steps = Math.round(-dy / (stepPx * planStep / 10));
      curShare = shareFromDrag(origShare, steps, planStep);
      var offset = Number(block.dataset.offset) || 0;
      block.style.setProperty("--blk-height",
        (yPx(offset + curShare / 100) - yPx(offset)) + "px");
      readout.textContent = curShare + "%";
    }
    readout.style.left = (ev.clientX + 14) + "px";
    readout.style.top = (ev.clientY + 14) + "px";
  }

  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    root.classList.remove("is-dragging");
    if (readout) readout.remove();
    if (!mode) return;
    lastDragAt = Date.now();
    var patch = {};
    if (mode === "date") {
      if (edge === "start" && curStart !== origStart) patch.start = iso(addDays(rangeStart, curStart));
      if (edge === "end" && curEnd !== origEnd) patch.end = iso(addDays(rangeStart, curEnd));
    } else if (curShare !== origShare) {
      patch.share = curShare;
    }
    if (Object.keys(patch).length) updateAssignment(a.id, patch);
    else render();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

/* --- interaction: drag an assignment's body (move and reassign) ---------- */

function beginBodyDrag(a, block, e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (a.raw && a.raw.archived) return;
  var startX = e.clientX, startY = e.clientY;
  var fromIndex = indexFromClientX(startX);
  var origStart = a.startIdx, origEnd = a.endIdx, origPersonId = a.person.id;
  var started = false;
  var preview = null;
  var dropRow = null;
  var range = { start: origStart, end: origEnd };

  function clearRow() {
    if (dropRow) dropRow.classList.remove("is-drop");
    dropRow = null;
  }
  function endDrag() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    document.removeEventListener("keydown", onKey);
    root.classList.remove("is-dragging");
    block.classList.remove("is-moving");
    clearRow();
    if (preview) { preview.node.remove(); preview = null; }
  }

  function onMove(ev) {
    var dx = ev.clientX - startX, dy = ev.clientY - startY;
    if (!started) {
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      started = true;
      root.classList.add("is-dragging");
      block.classList.add("is-moving");
      select(block);
      preview = makeExtentPreview();
    }
    range = moveRange(origStart, origEnd, indexFromClientX(ev.clientX) - fromIndex, DAYS);
    var row = rowInfoAt(ev.clientX, ev.clientY);
    if (!row) { clearRow(); if (preview) preview.node.remove(); return; }
    if (row.el !== dropRow) { clearRow(); dropRow = row.el; dropRow.classList.add("is-drop"); }
    var person = personById[row.personId];
    if (person && person.archived) { if (preview) preview.node.remove(); return; }
    placePreview(preview, row.el, range, a.project.colour, r4(a.share / 100),
      Number(block.dataset.offset) || 0);
  }

  function onUp(ev) {
    endDrag();
    if (!started) return;
    lastDragAt = Date.now();
    var row = rowInfoAt(ev.clientX, ev.clientY);
    if (!row) { render(); return; }
    var person = personById[row.personId];
    if (person && person.archived) {
      showError(new Error(archivedPersonRefusal(person.name)));
      render();
      return;
    }
    var patch = {};
    if (row.personId !== origPersonId) patch.personId = row.personId;
    if (range.start !== origStart) patch.start = iso(addDays(rangeStart, range.start));
    if (range.end !== origEnd) patch.end = iso(addDays(rangeStart, range.end));
    if (Object.keys(patch).length) updateAssignment(a.id, patch);
    else render();
  }

  function onKey(ev) {
    if (ev.key !== "Escape") return;
    endDrag();
    render();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
  document.addEventListener("keydown", onKey);
}

/* --- interaction: draw a range in a Person's row -------------------------- */

function onBodyPointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  // A block starts its own drag; only empty row space draws a new range.
  if (e.target.closest && e.target.closest(".blk")) return;
  var row = e.target.closest ? e.target.closest(".row") : null;
  if (!row) return;
  var person = personById[row.getAttribute("data-person")];
  if (!person) return;
  // Dragging on a row is how an Assignment is made, so while the blocks are
  // hidden the draw is refused with a message that names the setting rather
  // than opening a panel over a row with nothing on it.
  var refusal = gridCreateRefusal(person, null);
  if (refusal) {
    showError(new Error(refusal));
    return;
  }
  beginRangeDraw(person, row, e);
}

function beginRangeDraw(person, row, e) {
  var startX = e.clientX, startY = e.clientY;
  var fromIndex = indexFromClientX(startX);
  var started = false;
  var range = { start: fromIndex, end: fromIndex };
  var band = el("div", "range-band");
  var label = el("span", "range-band__label");
  band.appendChild(label);

  function show(ev) {
    range = dayRange(fromIndex, indexFromClientX(ev.clientX), DAYS);
    band.style.setProperty("--i", range.start);
    band.style.setProperty("--n", range.end - range.start + 1);
    label.textContent = fmtRange(addDays(rangeStart, range.start), addDays(rangeStart, range.end));
  }

  function endDrag() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    document.removeEventListener("keydown", onKey);
    root.classList.remove("is-dragging");
    band.remove();
  }

  function onMove(ev) {
    if (!started) {
      if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
      started = true;
      root.classList.add("is-dragging");
      row.appendChild(band);
    }
    show(ev);
  }

  function onUp(ev) {
    endDrag();
    if (!started) return;
    lastDragAt = Date.now();
    openNewAssignmentPanel(person, range, { left: ev.clientX, top: ev.clientY, right: ev.clientX, bottom: ev.clientY }, row);
  }

  function onCancel() { endDrag(); }

  function onKey(ev) {
    if (ev.key !== "Escape") return;
    endDrag();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  document.addEventListener("keydown", onKey);
}

/* --- API ----------------------------------------------------------------- */

function api(method, url, body) {
  var options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  // Every non-GET is a write, and the status reports the writes in flight.
  var write = method !== "GET";
  if (write) beginWrite();
  return fetch(url, options).catch(function () {
    throw new Error("PACT could not reach its server - is it still running?");
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (payload) {
      if (!res.ok) throw new Error(payload && payload.error ? payload.error : "the server refused the change");
      return payload;
    });
  }).then(function (payload) {
    if (write) endWrite(false);
    return payload;
  }, function (err) {
    if (write) endWrite(true);
    throw err;
  });
}

var writesInFlight = 0;
var lastWriteFailed = false;

function beginWrite() {
  writesInFlight += 1;
  syncSaveStatus();
}

// The most recent write's fate replaces the last one's: a success clears a
// failure, and a failure keeps Not saved on screen until a write lands.
function endWrite(failed) {
  writesInFlight -= 1;
  lastWriteFailed = failed;
  syncSaveStatus();
}

function syncSaveStatus() {
  if (!saveStatusEl) return;
  var word = saveStatusWord(writesInFlight, lastWriteFailed);
  saveStatusEl.textContent = word;
  saveStatusEl.classList.toggle("is-failed", word === NOT_SAVED);
}

// The two history controls mirror what the server says is available: an empty
// stack greys its button out, exactly as the row-height stepper does at its
// ends. A page reload keeps the history, because the server keeps running.
function syncHistoryControls() {
  // A report makes no plan writes, so its history controls are always
  // disabled; on the grid they mirror what the server says is available.
  if (undoBtn) undoBtn.disabled = isReport || !(data && data.canUndo);
  if (redoBtn) redoBtn.disabled = isReport || !(data && data.canRedo);
}

function planUrl() {
  return planQuery(showArchived);
}

function refresh(opts) {
  return api("GET", planUrl()).then(function (plan) {
    var previousStart = rangeStart;
    data = plan;
    render(opts);
    // When the range has gained days to the left, hold the owner's view in
    // place rather than letting the restored scroll slip a whole month back.
    if (previousStart) {
      var shift = dayDiff(udate(plan.range.start), previousStart);
      if (shift > 0) scroller.scrollLeft += shift * dayWidth();
    }
  });
}

// One POST for a new Assignment - a Stack drop, a paste or a copy - then the
// usual refresh and focus, so the paths behave identically. The created
// Assignment is handed back, or null when the write failed and was reported, so
// a caller that has something to say about the new one can hold its tongue.
function postAssignment(payload) {
  var created = null;
  return api("POST", "/api/assignments", payload).then(function (assignment) {
    created = assignment;
    return refresh();
  }).then(function () {
    if (created) focusAssignment(created.id);
    return created;
  }).catch(function (err) {
    showError(err);
    render();
    return null;
  });
}

function createAssignment(project, personId, dayIdx) {
  // The extent the preview drew is the extent that lands, because both come
  // from the same rule in ./lib/timeline.mjs.
  var range = dropRange(dayIdx, DAYS, DROP_DAYS);
  postAssignment({
    projectId: project.id,
    personId: personId,
    start: iso(addDays(rangeStart, range.start)),
    end: iso(addDays(rangeStart, range.end)),
    share: 100,
    tags: [],
    note: ""
  });
}

/*
 * Duplicate an Assignment where it already is: the copy lands on the same
 * Person over the same start and end dates and carries the same Share, name,
 * tags and note, made through the one create path a drop and a paste use, so
 * the grid's refusals stand and the write is one Undo step back. The tags are
 * copied into their own list, so the copy can never share one with its source.
 * The source is untouched, and the copy draws as a second band above it,
 * because the row stacks a person's Assignments by cumulative share.
 *
 * One function, taking the Assignment, so the panel's button drives the same
 * road a later shortcut would.
 */
function copyAssignment(a) {
  var project = projectById[a.project.id];
  var person = personById[a.person.id];
  if (!project || !person) return;
  var refusal = gridCreateRefusal(person, project);
  if (refusal) {
    // The grid's own message, and nothing is created: a copy is the same
    // gesture as a drop or a paste and is refused for the same reasons.
    showError(new Error(refusal));
    return;
  }
  return postAssignment({
    projectId: project.id,
    personId: person.id,
    start: a.raw.start,
    end: a.raw.end,
    share: a.share,
    name: a.raw.name || "",
    tags: (a.raw.tags || []).slice(),
    note: a.raw.note || ""
  }).then(function (created) {
    if (!created) return;
    showToast("Copied the Assignment of \"" + project.name + "\" on \"" + person.name + "\"");
  });
}

function updateAssignment(id, patch) {
  api("PATCH", "/api/assignments/" + encodeURIComponent(id), patch).then(refresh).catch(function (err) {
    showError(err);
    render();
  });
}

function archiveAssignment(id) {
  api("DELETE", "/api/assignments/" + encodeURIComponent(id)).then(refresh).catch(function (err) {
    showError(err);
    render();
  });
}

function archivePerson(id) {
  api("DELETE", "/api/people/" + encodeURIComponent(id)).then(refresh).catch(showError);
}

// Refresh from what the server wrote, then hand the store's own answer on: the
// caller needs the count to say what went with the record.
function afterDestroy(result) {
  return refresh().then(function () { return result; });
}

function destroyPerson(id) {
  return api("DELETE", "/api/people/" + encodeURIComponent(id) + "/destroy")
    .then(afterDestroy).catch(showError);
}

function destroyProject(id) {
  return api("DELETE", "/api/projects/" + encodeURIComponent(id) + "/destroy")
    .then(afterDestroy).catch(showError);
}

function destroyAssignment(id) {
  api("DELETE", "/api/assignments/" + encodeURIComponent(id) + "/destroy").then(refresh).catch(function (err) {
    showError(err);
    render();
  });
}

function restorePerson(person) {
  api("PATCH", "/api/people/" + encodeURIComponent(person.id), { archived: false }).then(refresh).catch(showError);
}

function archiveProject(id) {
  api("DELETE", "/api/projects/" + encodeURIComponent(id)).then(refresh).catch(showError);
}

function restoreProject(project) {
  api("PATCH", "/api/projects/" + encodeURIComponent(project.id), { archived: false }).then(refresh).catch(showError);
}

function restoreAssignment(id) {
  api("PATCH", "/api/assignments/" + encodeURIComponent(id), { archived: false }).then(refresh).catch(showError);
}

// One step through the server's in-memory history. The server writes the
// restored plan and the screen refreshes from it, as it does after any change.
function undoPlan() {
  api("POST", "/api/undo").then(refresh).then(loadAdoState).catch(showError);
}

function redoPlan() {
  api("POST", "/api/redo").then(refresh).then(loadAdoState).catch(showError);
}

function focusAssignment(id) {
  var block = tl.querySelector('[data-assignment="' + id + '"]');
  if (block) block.focus();
}

var toastTimer = null;
// The app's one toast: a refusal after a failed save, or a word about what a
// click just did. It sits where it is and is taken away after a few seconds.
function showToast(message) {
  var toast = document.getElementById("pact-toast");
  if (!toast) {
    toast = el("div", "toast");
    toast.id = "pact-toast";
    toast.setAttribute("role", "alert");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove("is-on"); }, 6000);
}

function showError(err) {
  showToast(err && err.message ? err.message : "Could not save the change.");
}

/* --- panels -------------------------------------------------------------- */

var panel = null;
var panelTrigger = null;
var selectedBlock = null;

function select(block) {
  if (selectedBlock) selectedBlock.classList.remove("is-selected");
  selectedBlock = block;
  if (block) block.classList.add("is-selected");
}

function closePanel(restoreFocus) {
  if (!panel) return;
  panelLayer.hidden = true;
  panelLayer.innerHTML = "";
  panel = null;
  select(null);
  if (restoreFocus && panelTrigger && document.contains(panelTrigger)) {
    panelTrigger.focus();
  }
  panelTrigger = null;
}

// `rect` anchors the panel where a gesture happened (a released rubber band,
// say) while `trigger` is what focus returns to when the panel closes.
function openPanel(node, trigger, rect) {
  closePanel(false);
  panelTrigger = trigger || null;
  panelLayer.hidden = false;
  panelLayer.appendChild(node);
  panel = node;
  var close = node.querySelector(".panel__close");
  if (close) close.focus();

  var r = rect || (trigger ? trigger.getBoundingClientRect() : { right: 8, top: 8 });
  var pw = node.offsetWidth, ph = node.offsetHeight;
  var left = r.right + 8;
  var top = r.top;
  if (left + pw > window.innerWidth - 8) left = Math.max(8, r.left - pw - 8);
  if (top + ph > window.innerHeight - 8) top = Math.max(8, window.innerHeight - ph - 8);
  node.style.left = left + "px";
  node.style.top = top + "px";
}

function panelShell(title, sub) {
  var node = el("div", "panel");
  node.setAttribute("role", "dialog");
  node.setAttribute("aria-label", title);
  var close = el("button", "panel__close");
  close.type = "button";
  close.setAttribute("data-close", "");
  close.setAttribute("aria-label", "Close");
  close.textContent = "\u00d7";
  close.addEventListener("click", function () { closePanel(true); });
  node.appendChild(close);
  var h = el("h2", "panel__title");
  h.textContent = title;
  node.appendChild(h);
  if (sub) {
    var s = el("p", "panel__sub");
    s.textContent = sub;
    node.appendChild(s);
  }
  return node;
}

function field(term, valueNode) {
  var row = el("div", "field");
  var dt = el("dt");
  dt.textContent = term;
  var dd = el("dd");
  if (typeof valueNode === "string") dd.textContent = valueNode;
  else dd.appendChild(valueNode);
  row.appendChild(dt);
  row.appendChild(dd);
  return row;
}

function formRow(label, control) {
  var row = el("div", "form__row");
  var span = el("span");
  span.textContent = label;
  row.appendChild(span);
  row.appendChild(control);
  return row;
}

function input(value) {
  var i = document.createElement("input");
  i.type = "text";
  i.value = value || "";
  return i;
}

// A calendar-date field, used by the Sprints panel.
function dateField(value, label) {
  var i = document.createElement("input");
  i.type = "date";
  i.value = value || "";
  i.setAttribute("placeholder", "YYYY-MM-DD");
  if (label) i.setAttribute("aria-label", label);
  return i;
}

// A whole-number field bounded to the sprint length range.
function numberField(value, label) {
  var i = document.createElement("input");
  i.type = "number";
  i.min = String(SPRINT_LENGTH_MIN);
  i.max = String(SPRINT_LENGTH_MAX);
  i.step = "1";
  i.value = String(value);
  if (label) i.setAttribute("aria-label", label);
  return i;
}

function textarea(value) {
  var t = document.createElement("textarea");
  t.value = value || "";
  return t;
}

// A checkbox, used by the Project panel's Absence mark. The row's own label
// names it; the aria-label carries the same word to the control.
function checkbox(value, label) {
  var box = document.createElement("input");
  box.type = "checkbox";
  box.checked = !!value;
  if (label) box.setAttribute("aria-label", label);
  return { node: box, value: function () { return box.checked; } };
}

function button(cls, label, handler) {
  var b = el("button", cls);
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", handler);
  return b;
}

// A footer action whose visible word is short so a footer's group fits one row.
// The full wording travels in the accessible name and the tooltip, because the
// word alone loses which record the button acts on once the dialog's title is
// out of earshot.
function namedButton(cls, label, full, handler) {
  var b = button(cls, label, handler);
  b.setAttribute("aria-label", full);
  b.setAttribute("title", full);
  return b;
}

// The message a panel shows when a save is refused. It sits in the panel, so
// the panel keeps working and the value being saved is not lost.
function errorLine(node) {
  var p = el("p", "form__error");
  p.setAttribute("role", "alert");
  p.hidden = true;
  node.appendChild(p);
  return {
    set: function (message) { p.textContent = message; p.hidden = false; },
    clear: function () { p.textContent = ""; p.hidden = true; }
  };
}

function saveButton(label, onClick) {
  var b = button("btn-primary", label, onClick);
  b.setAttribute("data-save", "");
  return b;
}

// Send one panel's change. A refused save keeps the panel open with the
// message in it; a save that lands redraws the plan and closes the panel.
function submitPanel(node, error, request, done) {
  error.clear();
  var control = node.querySelector("[data-save]");
  if (control) control.disabled = true;
  return request().then(refresh).then(function (result) {
    closePanel(true);
    if (done) done(result);
  }).catch(function (err) {
    if (control) control.disabled = false;
    error.set(err && err.message ? err.message : "Could not save the change.");
  });
}

// A whole-10% value with minus and plus buttons and the arrow keys: one control
// serves a Person's Availability and an Assignment's Share, so the two read and
// behave alike, down to the disabled button at either end of the range.
function stepperControl(opts) {
  var wrap = el("span", "stepper");
  var current = opts.clamp(opts.value);

  var down = el("button", "stepper__btn");
  down.type = "button";
  down.textContent = "\u2212";
  down.setAttribute("aria-label", "One step less");

  var out = el("span", "stepper__value");
  out.setAttribute("role", "spinbutton");
  out.setAttribute("tabindex", "0");
  out.setAttribute("aria-label", opts.label);
  out.setAttribute("aria-valuemin", String(opts.min));
  out.setAttribute("aria-valuemax", String(opts.max));

  var up = el("button", "stepper__btn");
  up.type = "button";
  up.textContent = "+";
  up.setAttribute("aria-label", "One step more");

  function show() {
    out.textContent = current + "%";
    out.setAttribute("aria-valuenow", String(current));
    down.disabled = current <= opts.min;
    up.disabled = current >= opts.max;
  }
  function move(delta) { current = opts.step(current, delta); show(); }

  down.addEventListener("click", function () { move(-1); });
  up.addEventListener("click", function () { move(1); });
  out.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { move(1); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { move(-1); e.preventDefault(); }
    else if (e.key === "Home") { current = opts.min; show(); e.preventDefault(); }
    else if (e.key === "End") { current = opts.max; show(); e.preventDefault(); }
  });

  show();
  wrap.appendChild(down);
  wrap.appendChild(out);
  wrap.appendChild(up);
  return { node: wrap, value: function () { return current; } };
}

// A Person's Availability, stepped by the plan's own step. The floor is one
// step, so a 10% step floors at 10% exactly as before.
function availabilityControl(value) {
  return stepperControl({
    value: value,
    label: "Availability, in steps of " + planStep + " per cent",
    min: planStep,
    max: STEP_MAX,
    clamp: function (v) { return clampAvailability(v, planStep); },
    step: function (v, delta) { return stepAvailability(v, delta, planStep); }
  });
}

// An Assignment's Share, in the same step as Availability and set by the same
// control, so stepping and an edge drag can never disagree.
function shareControl(value) {
  return stepperControl({
    value: value,
    label: "Allocation, in steps of " + planStep + " per cent",
    min: planStep,
    max: STEP_MAX,
    clamp: function (v) { return clampShare(v, planStep); },
    step: function (v, delta) { return stepShare(v, delta, planStep); }
  });
}

var tagMenuSeq = 0;

// The tag field: chips, an input that takes a new tag, and the suggestion list
// it opens. The list is the Filter's own fixed dropdown - it narrows as you
// type with its first row already highlighted, the arrow keys move the
// highlight, Space ticks a row and Enter takes the highlighted row or, while
// rows are ticked, adds every ticked tag at once - so one narrowing serves
// several picks, and the plan's vocabulary can be taken more than a tag at a
// time.
// `onChange`, when given, is called with the new list after a chip is added or
// removed, so a list that saves itself needs no Save button of its own.
function tagEditor(initial, suggest, onChange) {
  var tags = (initial || []).slice();
  // The ticks belong to the open list rather than to the query, so narrowing
  // keeps them and one commit adds them all.
  var ticks = [];
  var shown = [];      // the tags the list is showing, in row order
  var rowIndex = -1;   // the highlighted row, -1 for none
  var watching = false;

  var wrap = el("div", "tags");
  var chips = el("span", "chips");
  var input = document.createElement("input");
  input.type = "text";
  input.className = "tags__input";
  input.placeholder = "Add a tag";
  input.setAttribute("aria-label", "Add a tag");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  var menu = el("div", "filter__suggest tags__menu");
  menu.id = "tag-menu-" + (++tagMenuSeq);
  menu.hidden = true;
  var list = el("div", "tags__list");
  list.id = menu.id + "-list";
  list.setAttribute("role", "listbox");
  menu.appendChild(list);
  // While a row is ticked the list ends with the one row a pointer commits
  // through, so ticking several is not a keyboard-only road.
  var commitRow = el("button", "filter__hit tags__commit");
  commitRow.type = "button";
  commitRow.hidden = true;
  menu.appendChild(commitRow);
  input.setAttribute("aria-controls", list.id);

  // The input sits in the chip row once and never moves again, so rebuilding
  // the chips around it cannot drop its focus.
  chips.appendChild(input);

  function render() {
    // The chips are rebuilt around the input, which never leaves the DOM:
    // re-appending a focused element drops its focus, so a run of tags can be
    // typed without the mouse, and removing a chip keeps the caret in place.
    Array.prototype.slice.call(chips.querySelectorAll(".chip")).forEach(function (chip) {
      chip.remove();
    });
    tags.forEach(function (tag) {
      var chip = el("span", "chip");
      var text = el("span", "chip__text");
      text.textContent = tag;
      var remove = el("button", "chip__remove");
      remove.type = "button";
      remove.textContent = "\u00d7";
      remove.setAttribute("aria-label", "Remove tag " + tag);
      remove.addEventListener("click", function () {
        tags = withoutTag(tags, tag);
        render();
        input.focus();
        if (onChange) onChange(tags.slice());
      });
      chip.appendChild(text);
      chip.appendChild(remove);
      chips.insertBefore(chip, input);
    });
  }

  // The list is fixed, so a panel that scrolls under it has to carry it along.
  function place() {
    // The tag field is a chip row's width, not the Filter's, so the list hangs
    // from the field's left edge rather than being centred on it.
    if (!menu.hidden) placePopover(menu, input, "left");
  }

  function watch(on) {
    if (on === watching) return;
    watching = on;
    if (on) document.addEventListener("scroll", place, true);
    else document.removeEventListener("scroll", place, true);
  }

  function highlight() {
    var rows = list.querySelectorAll("button");
    for (var i = 0; i < rows.length; i++) {
      rows[i].classList.toggle("is-sel", i === rowIndex);
    }
    var active = rows[rowIndex];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function close() {
    ticks = [];
    shown = [];
    rowIndex = -1;
    menu.hidden = true;
    list.innerHTML = "";
    commitRow.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    watch(false);
  }

  function updateCommitRow() {
    commitRow.hidden = ticks.length === 0;
    commitRow.textContent = commitLabel(ticks.length);
  }

  function draw() {
    shown = offeredTags(suggest(), tags, input.value);
    list.innerHTML = "";
    shown.forEach(function (tag, i) {
      var ticked = ticks.indexOf(tag) !== -1;
      var row = el("button", "filter__hit");
      row.type = "button";
      row.id = menu.id + "-row-" + i;
      row.setAttribute("role", "option");
      // The row's announced state is its tick, not the highlight: the
      // highlight is where the keyboard is, the tick is what will be added.
      row.setAttribute("aria-selected", ticked ? "true" : "false");
      if (ticked) row.classList.add("is-ticked");
      var mark = el("span", "tags__tick");
      mark.textContent = "\u2713";
      mark.setAttribute("aria-hidden", "true");
      var val = el("span", "filter__val");
      val.textContent = tag;
      row.appendChild(mark);
      row.appendChild(val);
      // Keep the input focused so the click lands and the list stays put.
      row.addEventListener("mousedown", function (e) { e.preventDefault(); });
      row.addEventListener("click", function () { tickRow(tag); });
      list.appendChild(row);
    });
    var open = shown.length > 0 || ticks.length > 0;
    menu.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) {
      rowIndex = -1;
      input.removeAttribute("aria-activedescendant");
      watch(false);
      return;
    }
    // The highlight lands on the first row of every redraw - an opened list and
    // a narrowing alike - so one Space ticks the obvious choice, and it stays
    // inside the rows on show: a narrowing that leaves nothing leaves no
    // highlight rather than a stale one.
    rowIndex = shown.length ? 0 : -1;
    updateCommitRow();
    watch(true);
    place();
    highlight();
  }

  function tickRow(tag) {
    ticks = tickToggled(ticks, tag);
    var ticked = ticks.indexOf(tag) !== -1;
    var rows = list.querySelectorAll("button");
    for (var i = 0; i < rows.length; i++) {
      if (shown[i] !== tag) continue;
      rows[i].classList.toggle("is-ticked", ticked);
      rows[i].setAttribute("aria-selected", ticked ? "true" : "false");
    }
    updateCommitRow();
  }

  // Adding the tags a key chose, whichever key chose them: the commits below
  // differ only in what they read and in whether the typed text is spent.
  function commitAdd(add) {
    tags = committedTags(tags, "", add);
    input.value = "";
    render();
    close();
    if (onChange) onChange(tags.slice());
  }

  function commitTicks() { commitAdd(ticks); }

  // The typed text is committed as it always was, so free text is never lost to
  // the list: a comma, or leaving the field, makes a new tag of it.
  function commitTyped() {
    if (input.value.trim() === "") { input.value = ""; close(); return; }
    commitAdd([input.value]);
  }

  commitRow.addEventListener("mousedown", function (e) { e.preventDefault(); });
  commitRow.addEventListener("click", commitTicks);

  input.addEventListener("input", draw);

  input.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (menu.hidden) {
        // The list opens where the field was left, with its first row in reach.
        draw();
      } else if (shown.length) {
        rowIndex = e.key === "ArrowDown"
          ? Math.min(rowIndex + 1, shown.length - 1)
          : Math.max(rowIndex - 1, 0);
        highlight();
      }
      return;
    }
    if (e.key === " ") {
      // A space ticks the highlighted row; with nothing highlighted it is a
      // space in the tag being typed, so multi-word free text still reads.
      if (!menu.hidden && rowIndex >= 0 && shown[rowIndex]) {
        e.preventDefault();
        tickRow(shown[rowIndex]);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      var add = enterTags(input.value, ticks, shown, rowIndex);
      if (add.length) commitAdd(add);
      else { input.value = ""; close(); }
      return;
    }
    if (e.key === ",") { e.preventDefault(); commitTyped(); return; }
    if (e.key === "Escape") {
      // The list closes and adds nothing; only then does Escape reach the panel.
      if (!menu.hidden) {
        e.preventDefault();
        e.stopPropagation();
        input.value = "";
        close();
      }
      return;
    }
    if (e.key === "Tab") { close(); return; }
    if (e.key === "Backspace" && input.value === "" && tags.length) {
      tags = tags.slice(0, -1);
      render();
    }
  });
  // A click on a row or on the commit row keeps the focus, so a blur is a click
  // away: the list closes and the typed text is committed, as it always was.
  input.addEventListener("blur", commitTyped);

  wrap.appendChild(chips);
  wrap.appendChild(menu);
  render();

  return {
    node: wrap,
    tags: function () { return tags.slice(); },
    // Re-read the suggestions, for when the Project a tag list is drawn from
    // changes underneath it.
    refresh: render,
    focus: function () { input.focus(); }
  };
}

var suggestListSeq = 0;

// A plain text input with a datalist of suggestions, for a single-valued free
// text field. One value reads and behaves like Name, unlike the tag editor.
function suggestedInput(value, suggest) {
  var i = input(value);
  var listId = "suggest-" + (++suggestListSeq);
  i.setAttribute("list", listId);
  var datalist = document.createElement("datalist");
  datalist.id = listId;
  suggest().forEach(function (text) {
    var option = document.createElement("option");
    option.value = text;
    datalist.appendChild(option);
  });
  var wrap = el("div", "suggest");
  wrap.appendChild(i);
  wrap.appendChild(datalist);
  return { node: wrap, input: i };
}

// The palette picker: the ten slots, exactly one pressed. One control serves
// the Project and Milestone forms, so both offer the same colours and the same
// way of choosing one.
function colourPicker(initial) {
  var slot = Number.isInteger(initial) ? initial : 0;
  var wrap = el("span", "swatches");
  var buttons = [];
  for (var i = 0; i < SLOT_COUNT; i++) {
    var sw = el("button", "swatch");
    sw.type = "button";
    sw.style.setProperty("--pick", "var(--proj-" + i + ")");
    sw.setAttribute("aria-label", "Colour " + (i + 1));
    sw.setAttribute("aria-pressed", i === slot ? "true" : "false");
    sw.dataset.slot = String(i);
    sw.addEventListener("click", function () {
      slot = Number(this.dataset.slot);
      buttons.forEach(function (b) {
        b.setAttribute("aria-pressed", Number(b.dataset.slot) === slot ? "true" : "false");
      });
    });
    wrap.appendChild(sw);
    buttons.push(sw);
  }
  return { node: wrap, value: function () { return slot; } };
}

function openPersonPanel(person, trigger) {
  var editing = !!person;
  var node = panelShell(editing ? "Person" : "Add person",
    editing ? null : "Availability is set in steps of " + planStep + "%.");
  var form = el("form", "form");

  var nameInput = input(editing ? person.name : "");
  form.appendChild(formRow("Name", nameInput));

  // A Person's Location is one free-text place, suggested from the Locations
  // already used on other People and the Locations the holidays configure.
  var location = suggestedInput(editing ? person.location : "", function () {
    return suggestPersonLocations(data.people, editing ? person.id : null, holidayLocations(data.holidays));
  });
  form.appendChild(formRow("Location", location.node));

  var availability = availabilityControl(editing ? person.availability : STEP_MAX);
  form.appendChild(formRow("Availability", availability.node));

  // Person tags are offered from other People; Assignment tags are a separate
  // vocabulary and are never suggested here.
  var tags = tagEditor(editing ? person.tags : [], function () {
    return suggestPersonTags(data.people, editing ? person.id : null);
  });
  form.appendChild(formRow("Tags", tags.node));

  var noteInput = input(editing ? person.note : "");
  form.appendChild(formRow("Note", noteInput));

  node.appendChild(form);
  var error = errorLine(node);

  var foot = el("div", "panel__foot");
  // The ordinary actions move as one group, so a footer too narrow for the
  // whole line wraps them clear of Save rather than splitting them around it.
  var actions = el("div", "panel__actions");
  if (editing) {
    // Copying destroys nothing, so it carries the ordinary style, not the two
    // danger buttons' - and it is offered on an archived Person too, where
    // copying one as a new Person is still a create rather than a restore.
    actions.appendChild(namedButton("btn-ghost", "Copy", "Copy person", function () {
      closePanel(false);
      copyPerson(person);
    }));
  }
  if (editing && !person.archived) {
    var archive = namedButton("btn-danger", "Archive", "Archive person", function () {
      closePanel(false);
      archivePerson(person.id);
    });
    actions.appendChild(archive);
    var remove = namedButton("btn-danger", "Delete", "Delete person", function () {
      closePanel(false);
      destroyPerson(person.id);
    });
    actions.appendChild(remove);
  }
  // A new Person has nothing to copy, archive or delete, so no empty group is
  // left in the footer: its one button is the whole of it.
  if (actions.childElementCount) foot.appendChild(actions);
  var spacer = el("span", "panel__spacer");
  foot.appendChild(spacer);
  var save = saveButton(editing ? "Save" : "Add person", function () {
    var name = nameInput.value.trim();
    if (!name) { error.set("A person needs a name."); nameInput.focus(); return; }
    var body = {
      name: name,
      location: location.input.value,
      availability: availability.value(),
      tags: tags.tags(),
      note: noteInput.value
    };
    submitPanel(node, error, function () {
      return editing
        ? api("PATCH", "/api/people/" + encodeURIComponent(person.id), body)
        : api("POST", "/api/people", body);
    });
  });
  foot.appendChild(save);
  node.appendChild(foot);

  form.addEventListener("submit", function (e) { e.preventDefault(); save.click(); });

  openPanel(node, trigger);
  if (!editing) nameInput.focus();
}

/*
 * Copy a Person at once, with no form in between: the new Person carries the
 * source's Location, Availability, Person tags and note, takes the name the rule
 * offers so it is never one a live Person already holds, and starts with no
 * Assignments of their own - their work is their own, so a copy is an empty row.
 * The write is the ordinary create, so it is one Undo step back like any other.
 *
 * One function, taking the Person, so a keyboard shortcut can drive the same
 * road the button does.
 */
function copyPerson(person) {
  var live = data.people.filter(function (p) { return !p.archived; })
    .map(function (p) { return p.name; });
  var name = copyName(person.name, live);
  return api("POST", "/api/people", {
    name: name,
    location: person.location,
    availability: person.availability,
    tags: person.tags,
    note: person.note
  }).then(refresh).then(function () {
    showToast("Copied \"" + person.name + "\" as \"" + name + "\"");
  }).catch(showError);
}

function openProjectPanel(project, trigger) {
  var editing = !!project;
  var node = panelShell(editing ? "Project" : "Add project",
    editing ? null : "A project exists on its own, before any person.");
  var form = el("form", "form");

  var nameInput = input(editing ? project.name : "");
  form.appendChild(formRow("Name", nameInput));

  var colour = colourPicker(editing ? project.colour : leastUsedSlot(data.projects));
  form.appendChild(formRow("Colour", colour.node));

  // Project tags are offered from other Projects only; Person tags and
  // Assignment tags are separate vocabularies and are never suggested here.
  var tags = tagEditor(editing ? project.tags : [], function () {
    return suggestProjectTags(data.projects, editing ? project.id : null);
  });
  form.appendChild(formRow("Tags", tags.node));

  var notes = textarea(editing ? project.notes : "");
  form.appendChild(formRow("Notes", notes));

  // An absence is a Project whose Assignments take time off the Person rather
  // than adding work: the mark changes how the figures and the bar are read,
  // never how the Project is stored.
  var absence = checkbox(editing ? !!project.absence : false, "Absence");
  form.appendChild(formRow("Absence", absence.node));

  node.appendChild(form);
  var error = errorLine(node);

  var foot = el("div", "panel__foot");
  // The ordinary actions move as one group, so a footer too narrow for the
  // whole line wraps them clear of Save rather than splitting them around it.
  var actions = el("div", "panel__actions");
  if (editing) {
    // Copying destroys nothing, so it carries the ordinary style, not the two
    // danger buttons' - and it is offered on an archived Project too, where
    // copying one as a new Project is the most useful case of all.
    actions.appendChild(namedButton("btn-ghost", "Copy", "Copy project", function () {
      closePanel(false);
      copyProject(project);
    }));
  }
  if (editing && !project.archived) {
    var archive = namedButton("btn-danger", "Archive", "Archive project", function () {
      closePanel(false);
      archiveProject(project.id);
    });
    actions.appendChild(archive);
    var remove = namedButton("btn-danger", "Delete", "Delete project", function () {
      closePanel(false);
      destroyProject(project.id);
    });
    actions.appendChild(remove);
  }
  // A new Project has nothing to copy, archive or delete, so no empty group is
  // left in the footer: its one button is the whole of it.
  if (actions.childElementCount) foot.appendChild(actions);
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton(editing ? "Save" : "Add project", function () {
    var name = nameInput.value.trim();
    if (!name) { error.set("A project needs a name."); nameInput.focus(); return; }
    var body = { name: name, colour: colour.value(), notes: notes.value, tags: tags.tags(), absence: absence.value() };
    submitPanel(node, error, function () {
      return editing
        ? api("PATCH", "/api/projects/" + encodeURIComponent(project.id), body)
        : api("POST", "/api/projects", body);
    });
  });
  foot.appendChild(save);
  node.appendChild(foot);

  form.addEventListener("submit", function (e) { e.preventDefault(); save.click(); });

  openPanel(node, trigger);
  if (!editing) nameInput.focus();
}

/*
 * Copy a Project at once, with no form in between: the new Project carries the
 * source's colour, tags, notes and absence mark, takes the name the rule offers
 * so it is never one a live Project already holds, and starts with no
 * Assignments of its own. The absence flag is carried rather than inherited
 * from the copy's name, because a copy of an absence is an absence. Milestone
 * relations are not copied either: they record what happened to one Project.
 * The write is the ordinary create, so it is one Undo step back like any other.
 *
 * One function, taking the Project, so a keyboard shortcut can drive the same
 * road the button does.
 */
function copyProject(project) {
  var live = data.projects.filter(function (p) { return !p.archived; })
    .map(function (p) { return p.name; });
  var name = copyName(project.name, live);
  return api("POST", "/api/projects", {
    name: name,
    colour: project.colour,
    tags: project.tags,
    notes: project.notes,
    absence: !!project.absence
  }).then(refresh).then(function () {
    showToast("Copied \"" + project.name + "\" as \"" + name + "\"");
  }).catch(showError);
}

function openAssignmentPanel(a, trigger) {
  var archived = !!(a.raw && a.raw.archived);
  var node = panelShell(a.project.name + " \u00b7 " + a.person.name,
    fmtRange(a.start, a.end));

  var form = el("form", "form");
  // The Assignment's own name, free text and optional: it says which work the
  // block is, where its Project says only which Project. It is never a second
  // Project - no colour, no tags of its own, no share.
  var nameInput = input(a.raw.name);
  form.appendChild(formRow("Name", nameInput));
  // The Share stepper and a vertical edge drag reach the same number; it opens
  // on the Assignment's current share, so the two cannot disagree.
  var share = shareControl(a.share);
  form.appendChild(formRow("Share", share.node));
  // Assignment tags are offered from that Project's other Assignments only.
  var tags = tagEditor(a.raw.tags, function () {
    return suggestAssignmentTags(data.assignments, a.project.id, a.id);
  });
  form.appendChild(formRow("Tags", tags.node));
  var noteInput = input(a.raw.note);
  form.appendChild(formRow("Note", noteInput));
  node.appendChild(form);
  var error = errorLine(node);

  var foot = el("div", "panel__foot");
  if (archived) {
    var badge = el("span", "panel__badge");
    badge.textContent = "Archived";
    foot.appendChild(badge);
    var restore = button("btn-primary", "Restore", function () {
      closePanel(false);
      restoreAssignment(a.id);
    });
    restore.setAttribute("aria-label", "Restore " + a.project.name + " on " + a.person.name);
    foot.appendChild(restore);
    var restoreRemove = button("btn-danger", "Delete", function () {
      closePanel(false);
      destroyAssignment(a.id);
    });
    restoreRemove.setAttribute("aria-label", "Delete " + a.project.name + " on " + a.person.name);
    foot.appendChild(restoreRemove);
  } else {
    // Copying destroys nothing, so it carries the ordinary style, not the two
    // danger buttons' - and it sits before them for the same reason. An archived
    // Assignment is history and offers no copy, as Ctrl+C over its block does
    // not: there is nothing to duplicate while it is out of the plan.
    var actions = el("div", "panel__actions");
    actions.appendChild(namedButton("btn-ghost", "Copy", "Copy assignment", function () {
      closePanel(false);
      copyAssignment(a);
    }));
    var archive = namedButton("btn-danger", "Archive", "Archive assignment", function () {
      closePanel(false);
      archiveAssignment(a.id);
    });
    actions.appendChild(archive);
    actions.appendChild(namedButton("btn-danger", "Delete", "Delete assignment", function () {
      closePanel(false);
      destroyAssignment(a.id);
    }));
    foot.appendChild(actions);
  }
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton("Save", function () {
    submitPanel(node, error, function () {
      return api("PATCH", "/api/assignments/" + encodeURIComponent(a.id), {
        name: nameInput.value,
        share: share.value(),
        tags: tags.tags(),
        note: noteInput.value
      });
    });
  });
  foot.appendChild(save);
  node.appendChild(foot);

  form.addEventListener("submit", function (e) { e.preventDefault(); save.click(); });

  openPanel(node, trigger);
}

// The panel a drawn range opens: the read-back of what was drawn, then the
// choices that make it an Assignment. The dates are read only - the range is
// set by drawing, never typed - the Share stepper opens on 100%, and the Project
// is required, because an Assignment cannot exist without one.
function openNewAssignmentPanel(person, range, rect, trigger) {
  var start = addDays(rangeStart, range.start);
  var end = addDays(rangeStart, range.end);
  var node = panelShell("New assignment", person.name);

  var fields = el("dl", "fields");
  fields.appendChild(field("Dates", fmtRange(start, end)));
  node.appendChild(fields);

  var form = el("form", "form");
  var nameInput = input("");
  form.appendChild(formRow("Name", nameInput));
  var projectSelect = document.createElement("select");
  projectSelect.setAttribute("aria-label", "Project");
  var choose = document.createElement("option");
  choose.value = "";
  choose.textContent = "Choose a project";
  projectSelect.appendChild(choose);
  // Only the live projects: creating one stays a Stack action.
  data.projects.filter(function (p) { return !p.archived; }).forEach(function (project) {
    var option = document.createElement("option");
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  });
  form.appendChild(formRow("Project", projectSelect));

  // Creating an Assignment starts at the whole range; the stepper walks to every
  // other share, exactly as an edge drag would set it.
  var share = shareControl(100);
  form.appendChild(formRow("Share", share.node));

  // Assignment tags are offered from the chosen Project's other Assignments,
  // so the list follows the Project choice.
  var tags = tagEditor([], function () {
    return suggestAssignmentTags(data.assignments, projectSelect.value, null);
  });
  form.appendChild(formRow("Tags", tags.node));
  var noteInput = input("");
  form.appendChild(formRow("Note", noteInput));
  node.appendChild(form);
  var error = errorLine(node);

  projectSelect.addEventListener("change", function () { tags.refresh(); });

  var foot = el("div", "panel__foot");
  foot.appendChild(button("btn-ghost", "Cancel", function () { closePanel(true); }));
  foot.appendChild(el("span", "panel__spacer"));
  var create = saveButton("Create", function () {
    if (!projectSelect.value) {
      error.set("Choose a project for this assignment.");
      projectSelect.focus();
      return;
    }
    submitPanel(node, error, function () {
      return api("POST", "/api/assignments", {
        projectId: projectSelect.value,
        personId: person.id,
        start: iso(start),
        end: iso(end),
        share: share.value(),
        name: nameInput.value,
        tags: tags.tags(),
        note: noteInput.value
      });
    }, function (created) {
      if (created && created.id) focusAssignment(created.id);
    });
  });
  foot.appendChild(create);
  node.appendChild(foot);

  form.addEventListener("submit", function (e) { e.preventDefault(); create.click(); });

  openPanel(node, trigger, rect);
  projectSelect.focus();
}

/* --- Sprints panel ------------------------------------------------------- */

// The cadence and its adjustment list, beside the Person and Project panels.
// Every write goes through PATCH /api/plan, like the period and the step: no
// new route and no new collection. The list is derived from what the server
// returns, so editing an end date re-flows every later sprint at once without
// the panel closing.
function openSprintsPanel(trigger) {
  var cadence = cadenceFrom(data);
  var node = panelShell("Sprints",
    "The chain is derived from the cadence and the plan period; nothing about it is stored.");
  // The derived list is four columns wide - name, start, end, and the row's
  // days figure - so this panel takes a little more room than the others
  // rather than squeezing the name.
  node.classList.add("panel--sprints");
  var periodStart = data.range ? data.range.start : "";

  var form = el("form", "form");
  var startInput = dateField(cadence ? cadence.start : periodStart, "First sprint starts");
  var lengthInput = numberField(cadence ? cadence.length : SPRINT_LENGTH_DEFAULT, "Sprint length in days");
  var prefixInput = input(cadence ? cadence.namePrefix : NAME_PREFIX_DEFAULT);
  prefixInput.setAttribute("aria-label", "Name prefix");
  var numberInput = input(cadence ? String(cadence.nameNumber) : String(NAME_NUMBER_DEFAULT));
  numberInput.setAttribute("aria-label", "First number");
  form.appendChild(formRow("First sprint starts", startInput));
  form.appendChild(formRow("Length, days", lengthInput));
  form.appendChild(formRow("Name prefix", prefixInput));
  form.appendChild(formRow("First number", numberInput));
  node.appendChild(form);

  var error = errorLine(node);

  var listWrap = el("div", "sprint-list");
  node.appendChild(listWrap);

  var notice = el("p", "panel__sub sprint-list__notice");
  notice.hidden = true;
  node.appendChild(notice);

  // Every write sends the whole cadence with the current adjustments, so the
  // store sets the pair in one atomic commit and one undo step.
  function currentAdjustments() {
    return (data.sprints || []).map(function (a) { return Object.assign({}, a); });
  }

  function withAdjustment(adjustments, index, patch) {
    var found = null;
    adjustments.forEach(function (a) { if (a.index === index) found = a; });
    if (!found) {
      found = { index: index };
      adjustments.push(found);
    }
    Object.keys(patch).forEach(function (k) { found[k] = patch[k]; });
    return adjustments;
  }

  function save(payload, after) {
    error.clear();
    return api("PATCH", "/api/plan", payload).then(function () {
      return refresh({ keepPanel: true });
    }).then(function () {
      updateSprintsItem();
      if (after) after();
    }).catch(function (err) {
      error.set(err && err.message ? err.message : "Could not save the sprints.");
    });
  }

  function renderList() {
    listWrap.innerHTML = "";
    var c = cadenceFrom(data);
    if (!c) {
      notice.hidden = true;
      clearBtn.hidden = true;
      saveCadence.textContent = "Define sprints";
      return;
    }
    saveCadence.textContent = "Save cadence";
    var list = sprintsFor(c, data.sprints || [], data.range);
    var before = list.length > 0 && list[0].startIndex > 0;
    notice.textContent = before
      ? "The period starts before the first sprint, " + c.start + "; those days carry no sprint."
      : "";
    notice.hidden = !before;

    var heading = el("p", "sprint-list__heading");
    heading.textContent = list.length + (list.length === 1 ? " sprint" : " sprints");
    listWrap.appendChild(heading);

    list.forEach(function (sp) {
      var row = el("div", "sprint-row");

      var name = input(sp.name);
      name.setAttribute("aria-label", "Sprint " + sp.index + " name");
      name.addEventListener("change", function () {
        if (name.value.trim() === "") { name.value = sp.name; return; }
        save({ cadence: c, sprints: withAdjustment(currentAdjustments(), sp.index, { name: name.value }) });
      });
      row.appendChild(name);

      // The start is derived and never edited: plain text in its own column, so
      // a long date can never wrap inside the row.
      var from = el("span", "sprint-row__from");
      from.textContent = sp.start;
      row.appendChild(from);

      var end = dateField(sp.end, "Sprint " + sp.index + " end");
      end.addEventListener("change", function () {
        var days = end.value ? dayDiff(udate(sp.start), udate(end.value)) + 1 : 0;
        if (days < SPRINT_LENGTH_MIN) {
          error.set("A sprint must end on or after it starts.");
          end.value = sp.end;
          return;
        }
        if (days > SPRINT_LENGTH_MAX) {
          error.set("A sprint can be at most " + SPRINT_LENGTH_MAX + " days.");
          end.value = sp.end;
          return;
        }
        save({ cadence: c, sprints: withAdjustment(currentAdjustments(), sp.index, { length: days }) }, renderList);
      });
      row.appendChild(end);

      // The row's figures beside the editable length: the calendar length the
      // end date states, then the working days the shared rule leaves over the
      // sprint's own dates. A per-sprint length adjustment moves both because
      // the count reads this row's start and end, not the cadence's default.
      var days = el("span", "sprint-row__days");
      days.textContent = sprintDaysFigure(sp, data.holidays);
      row.appendChild(days);
      listWrap.appendChild(row);
    });
    clearBtn.hidden = false;
  }

  var foot = el("div", "panel__foot");
  var clearBtn = button("btn-danger", "Clear cadence", function () {
    save({ cadence: null, sprints: [] }, function () {
      startInput.value = periodStart;
      lengthInput.value = String(SPRINT_LENGTH_DEFAULT);
      prefixInput.value = NAME_PREFIX_DEFAULT;
      numberInput.value = String(NAME_NUMBER_DEFAULT);
      renderList();
    });
  });
  clearBtn.hidden = !cadence;
  foot.appendChild(clearBtn);
  foot.appendChild(el("span", "panel__spacer"));

  var saveCadence = saveButton(cadence ? "Save cadence" : "Define sprints", function () {
    var start = startInput.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
      error.set("The first sprint needs a valid start date.");
      return;
    }
    var length = Number(lengthInput.value);
    if (!Number.isInteger(length) || length < SPRINT_LENGTH_MIN || length > SPRINT_LENGTH_MAX) {
      error.set("The sprint length must be a whole number from " + SPRINT_LENGTH_MIN + " to " + SPRINT_LENGTH_MAX + ".");
      return;
    }
    var number = numberInput.value.trim();
    if (!/^\d+$/.test(number)) {
      error.set("The first number must be a whole number.");
      return;
    }
    var next = { start: start, length: length, namePrefix: prefixInput.value, nameNumber: number };
    save({ cadence: next, sprints: currentAdjustments() }, renderList);
  });
  foot.appendChild(saveCadence);
  node.appendChild(foot);

  form.addEventListener("submit", function (e) { e.preventDefault(); saveCadence.click(); });

  renderList();
  openPanel(node, trigger);
}

/* --- Holidays panel ------------------------------------------------------ */

// The Locations and their dates off, beside the Sprints panel. Every write is
// one PATCH /api/plan with the whole list, so the store sets it in one atomic
// commit and one undo step, and the holidays travel with the plan. The panel
// stays open across the save so a run of dates can be entered in one sitting.
function openHolidaysPanel(trigger) {
  var node = panelShell("Holidays",
    "Each holiday is one date and a full or half day off, per Location. They travel with the plan.");
  node.classList.add("panel--holidays");

  var working = (data.holidays || []).map(function (group) {
    return {
      location: typeof group.location === "string" ? group.location : "",
      dates: (Array.isArray(group.dates) ? group.dates : []).map(function (entry) {
        return {
          date: typeof entry.date === "string" ? entry.date : "",
          kind: isHolidayKind(entry.kind) ? entry.kind : "full"
        };
      })
    };
  });

  var error = errorLine(node);
  var listWrap = el("div", "holiday-list");
  node.appendChild(listWrap);

  // The Locations already in use on People are offered while a holiday Location
  // is typed, so the two vocabularies stay in step.
  var listId = "holiday-locations";
  var datalist = document.createElement("datalist");
  datalist.id = listId;
  suggestPersonLocations(data.people, null, holidayLocations(data.holidays)).forEach(function (text) {
    var option = document.createElement("option");
    option.value = text;
    datalist.appendChild(option);
  });
  node.appendChild(datalist);

  function renderList() {
    listWrap.innerHTML = "";
    if (!working.length) {
      var empty = el("p", "holiday-list__empty");
      empty.textContent = "No holidays configured yet.";
      listWrap.appendChild(empty);
      return;
    }
    working.forEach(function (group, gi) {
      var card = el("div", "holiday-group");

      var head = el("div", "holiday-group__head");
      var location = input(group.location);
      location.className = "holiday-group__location";
      location.placeholder = "Location";
      location.setAttribute("list", listId);
      location.setAttribute("aria-label", "Holiday location");
      location.addEventListener("input", function () { group.location = location.value; });
      head.appendChild(location);
      head.appendChild(button("holiday__remove", "Remove location", function () {
        working.splice(gi, 1);
        renderList();
      }));
      card.appendChild(head);

      var dates = el("div", "holiday-dates");
      group.dates.forEach(function (entry, di) {
        var row = el("div", "holiday-row");
        var date = dateField(entry.date, "Holiday date");
        date.addEventListener("change", function () { entry.date = date.value; });
        row.appendChild(date);

        var kind = el("div", "holiday-row__kind");
        kind.setAttribute("role", "radiogroup");
        kind.setAttribute("aria-label", "Full or half day");
        var kindName = holidayKindGroupName(gi, di);
        var kindValue = isHolidayKind(entry.kind) ? entry.kind : HOLIDAY_KIND_DEFAULT;
        HOLIDAY_KINDS.forEach(function (name) {
          var option = el("label", "holiday-row__kind-option");
          var radio = document.createElement("input");
          radio.type = "radio";
          radio.name = kindName;
          radio.value = name;
          radio.checked = name === kindValue;
          radio.addEventListener("change", function () { entry.kind = name; });
          option.appendChild(radio);
          option.appendChild(document.createTextNode(HOLIDAY_KIND_LABELS[name]));
          kind.appendChild(option);
        });
        row.appendChild(kind);

        row.appendChild(button("holiday__remove", "\u00d7", function () {
          group.dates.splice(di, 1);
          renderList();
        }));
        dates.appendChild(row);
      });
      card.appendChild(dates);
      card.appendChild(button("btn-ghost holiday__add", "Add date", function () {
        group.dates.push({ date: "", kind: "full" });
        renderList();
      }));
      listWrap.appendChild(card);
    });
  }

  // The typed list as it should be stored: Locations trimmed, empty dates and
  // empty groups dropped, and each group's dates put in date order. Returns the
  // message to refuse with, or null when the list may be saved.
  function normalize() {
    var out = [];
    for (var i = 0; i < working.length; i += 1) {
      var group = working[i];
      var location = group.location.trim();
      if (location === "") return "Each holiday Location needs a name.";
      var dates = [];
      for (var d = 0; d < group.dates.length; d += 1) {
        var entry = group.dates[d];
        if (entry.date === "") return "Each holiday needs a date.";
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return "Each holiday date must be a real date.";
        dates.push({ date: entry.date, kind: isHolidayKind(entry.kind) ? entry.kind : "full" });
      }
      dates.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      if (dates.length) out.push({ location: location, dates: dates });
    }
    return out;
  }

  var foot = el("div", "panel__foot");
  foot.appendChild(button("btn-ghost", "Add location", function () {
    working.push({ location: "", dates: [{ date: "", kind: "full" }] });
    renderList();
  }));
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton("Save holidays", function () {
    var normalized = normalize();
    if (typeof normalized === "string") { error.set(normalized); return; }
    error.clear();
    save.disabled = true;
    api("PATCH", "/api/plan", { holidays: normalized.length ? normalized : null })
      .then(function () { return refresh({ keepPanel: true }); })
      .then(function () {
        updateHolidaysItem();
        working = (data.holidays || []).map(function (group) {
          return {
            location: group.location,
            dates: group.dates.map(function (entry) { return { date: entry.date, kind: entry.kind }; })
          };
        });
        renderList();
      })
      .catch(function (err) {
        error.set(err && err.message ? err.message : "Could not save the holidays.");
      })
      .then(function () { save.disabled = false; });
  });
  foot.appendChild(save);
  node.appendChild(foot);

  renderList();
  openPanel(node, trigger);
}

/* --- Tags panel ---------------------------------------------------------- */

// The colour-by-key choices and the value colours, beside the Sprints and
// Holidays panels. Every write is one PATCH /api/plan with the whole mapping,
// so the store sets it in one atomic commit and one undo step, and it travels
// with the plan. The panel stays open across the save so a run of values can be
// coloured in one sitting.
function openTagsPanel(trigger) {
  var node = panelShell("Tags",
    "Pick a key per level to colour by, and a palette slot for each typed value. The mapping travels with the plan.");
  node.classList.add("panel--tags");

  // The mapping as it is being edited, cloned from the plan so a cancelled
  // panel leaves it alone.
  var working = {
    keys: Object.assign({}, tagKeys(data.tagColours)),
    colours: Object.assign({}, tagColourSlots(data.tagColours))
  };

  var error = errorLine(node);

  // Every typed tag the plan carries, plus any the stored mapping still
  // colours, so a value whose tag was removed can still be cleared.
  function allTypedTags() {
    var tags = planTypedTags(data);
    Object.keys(working.colours).forEach(function (tag) {
      if (tags.indexOf(tag) === -1 && isTypedTag(tag)) tags.push(tag);
    });
    return tags;
  }

  function kindsInUse() {
    var kinds = {};
    allTypedTags().forEach(function (tag) { kinds[tagKind(tag)] = true; });
    TAG_LEVELS.forEach(function (level) {
      if (working.keys[level]) kinds[working.keys[level]] = true;
    });
    return Object.keys(kinds).filter(function (kind) { return kind !== ""; })
      .sort(function (a, b) {
        var x = a.toLowerCase(), y = b.toLowerCase();
        return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
      });
  }

  var keyRows = el("div", "tag-keys");
  node.appendChild(keyRows);

  var listWrap = el("div", "tag-list");
  node.appendChild(listWrap);

  function renderKeys() {
    keyRows.innerHTML = "";
    var kinds = kindsInUse();
    TAG_LEVELS.forEach(function (level) {
      var select = document.createElement("select");
      select.setAttribute("aria-label", "Colour " + TAG_LEVEL_LABELS[level] + " by key");
      var none = document.createElement("option");
      none.value = "";
      none.textContent = "No key";
      select.appendChild(none);
      kinds.forEach(function (kind) {
        var option = document.createElement("option");
        option.value = kind;
        option.textContent = kind;
        select.appendChild(option);
      });
      select.value = working.keys[level] || "";
      select.addEventListener("change", function () {
        if (select.value === "") delete working.keys[level];
        else working.keys[level] = select.value;
        // Choosing a key is the deliberate moment PACT colours by: every value
        // under a chosen key takes a slot, and one set by hand keeps its own.
        working.colours = assignTagSlots(working.keys, allTypedTags(), working.colours);
        renderList();
      });
      keyRows.appendChild(formRow(TAG_LEVEL_LABELS[level], select));
    });
  }

  function renderList() {
    listWrap.innerHTML = "";
    var groups = tagKindGroups(allTypedTags());
    if (!groups.length) {
      var empty = el("p", "tag-list__empty");
      empty.textContent = "No typed tags yet. A tag like api:Stellar reads as the kind api and the value Stellar.";
      listWrap.appendChild(empty);
      return;
    }
    groups.forEach(function (group) {
      var card = el("div", "tag-group");
      var heading = el("p", "tag-group__kind");
      heading.textContent = group.kind;
      card.appendChild(heading);
      group.values.forEach(function (entry) {
        var row = el("div", "tag-row");
        var name = el("span", "tag-row__value");
        name.textContent = entry.value;
        row.appendChild(name);

        var swatches = el("span", "swatches");
        var buttons = [];
        for (var i = 0; i < SLOT_COUNT; i += 1) {
          var sw = el("button", "swatch");
          sw.type = "button";
          sw.style.setProperty("--pick", "var(--proj-" + i + ")");
          sw.setAttribute("aria-label", entry.value + " colour " + (i + 1));
          sw.setAttribute("aria-pressed", working.colours[entry.tag] === i ? "true" : "false");
          sw.dataset.slot = String(i);
          sw.dataset.tag = entry.tag;
          sw.addEventListener("click", function () {
            var tag = this.dataset.tag;
            // The chosen slot is the clear control too: pressing it again
            // clears the value, pressing any other chooses that one.
            working.colours = chooseTagSlot(working.colours, tag, Number(this.dataset.slot));
            buttons.forEach(function (b) {
              b.setAttribute("aria-pressed", b.dataset.tag === tag &&
                working.colours[tag] === Number(b.dataset.slot) ? "true" : "false");
            });
          });
          swatches.appendChild(sw);
          buttons.push(sw);
        }
        row.appendChild(swatches);
        card.appendChild(row);
      });
      listWrap.appendChild(card);
    });
  }

  var foot = el("div", "panel__foot");
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton("Save tags", function () {
    var cleaned = cleanTagColours(working);
    error.clear();
    save.disabled = true;
    api("PATCH", "/api/plan", { tagColours: cleaned })
      .then(function () { return refresh({ keepPanel: true }); })
      .then(function () {
        updateTagsItem();
        working = {
          keys: Object.assign({}, tagKeys(data.tagColours)),
          colours: Object.assign({}, tagColourSlots(data.tagColours))
        };
        renderKeys();
        renderList();
      })
      .catch(function (err) {
        error.set(err && err.message ? err.message : "Could not save the tags.");
      })
      .then(function () { save.disabled = false; });
  });
  foot.appendChild(save);
  node.appendChild(foot);

  renderKeys();
  // A value that appeared since the key was chosen takes its slot when the
  // panel next shows it. With no key chosen this assigns nothing, so opening
  // an untouched plan writes nothing.
  working.colours = assignTagSlots(working.keys, allTypedTags(), working.colours);
  renderList();
  openPanel(node, trigger);
}

/* --- Milestones panel ---------------------------------------------------- */

// The Milestones panel: the plan's dated points, listed beside the Sprints,
// Holidays and Tags panels. A row opens the editor; Add opens an empty one.
// Every write goes through /api/milestones, the route the other collections
// already have, so creating, editing and deleting one is each an atomic save
// and its own undo step.
function openMilestonesPanel(trigger) {
  var node = panelShell("Milestones",
    "A milestone is one dated point in the plan - a delivery, a deployment, a deadline. They travel with the plan.");
  node.classList.add("panel--milestones");

  var listWrap = el("div", "milestone-list");
  node.appendChild(listWrap);

  var milestones = data.milestones || [];
  if (!milestones.length) {
    var empty = el("p", "milestone-list__empty");
    empty.textContent = "No milestones yet.";
    listWrap.appendChild(empty);
  }

  milestones.forEach(function (milestone) {
    var row = el("button", "milestone-row");
    row.type = "button";
    row.setAttribute("data-milestone", milestone.id);

    var swatch = el("span", "milestone-row__swatch");
    swatch.style.setProperty("--pick", "var(--proj-" + milestone.colour + ")");
    row.appendChild(swatch);

    var name = el("span", "milestone-row__name");
    name.textContent = milestone.name;
    row.appendChild(name);

    var date = el("span", "milestone-row__date");
    date.textContent = milestone.date;
    row.appendChild(date);

    // The Projects it relates to, by name. None that resolve reads as the
    // plan-wide milestone it is, whether it named none or named ones since
    // deleted (public/lib/milestones.mjs owns that rule).
    var links = milestoneProjects(milestone, data.projects);
    var related = el("span", "milestone-row__links");
    related.textContent = links.length
      ? links.map(function (project) { return project.name; }).join(", ")
      : "All projects";
    row.appendChild(related);

    if (Array.isArray(milestone.tags) && milestone.tags.length) {
      var tags = el("span", "milestone-row__tags");
      tags.textContent = milestone.tags.join(", ");
      row.appendChild(tags);
    }

    row.addEventListener("click", function () { openMilestonePanel(milestone, trigger); });
    listWrap.appendChild(row);
  });

  var foot = el("div", "panel__foot");
  foot.appendChild(el("span", "panel__spacer"));
  foot.appendChild(saveButton("Add milestone", function () { openMilestonePanel(null, trigger); }));
  node.appendChild(foot);

  openPanel(node, trigger);
}

/* The Related projects control: one summary row that opens a bounded,
 * scrollable list of checkboxes with its own search field, rather than a
 * checkbox per Project in the form - a plan with twenty-five Projects ran the
 * dialog past its footer. What is offered, how the row reads and how the
 * search narrows it are public/lib/milestone-projects.mjs' rules; this builds
 * the control, holds the choice and keeps the keyboard path whole.
 *
 * The popup is placed against its trigger like the bar's own popovers, so the
 * panel's scroll cannot clip it, and it closes when focus leaves it so Tab
 * never walks away from a list left floating.
 */
function milestoneProjectPicker(choices, chosen) {
  var wrap = el("div", "milestone-picker");

  var btn = el("button", "milestone-picker__btn");
  btn.type = "button";
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  var summary = el("span", "milestone-picker__summary");
  btn.appendChild(summary);
  // The Options menu's own disclosure marker, so the row reads as the same
  // kind of control as the ones in that menu.
  var chevron = el("span", "options__chevron");
  chevron.setAttribute("aria-hidden", "true");
  btn.appendChild(chevron);

  var popup = el("div", "milestone-picker__popup");
  popup.setAttribute("role", "group");
  popup.setAttribute("aria-label", "Related projects");
  popup.hidden = true;

  var search = document.createElement("input");
  search.type = "search";
  search.className = "milestone-picker__search";
  search.setAttribute("placeholder", "Search projects");
  search.setAttribute("aria-label", "Search projects");
  popup.appendChild(search);

  var list = el("div", "milestone-picker__list");
  popup.appendChild(list);

  var noMatch = el("p", "milestone-picker__none");
  noMatch.textContent = choices.length ? "No project matches that search." : "No projects yet.";
  noMatch.hidden = true;
  popup.appendChild(noMatch);

  wrap.appendChild(btn);
  wrap.appendChild(popup);

  var items = choices.map(function (choice) {
    var item = el("label", "milestone-picker__item");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.className = "milestone-picker__box";
    box.checked = !!chosen[choice.id];
    box.setAttribute("data-project", choice.id);
    box.addEventListener("change", function () {
      if (box.checked) chosen[choice.id] = true;
      else delete chosen[choice.id];
      renderSummary();
    });
    item.appendChild(box);
    item.appendChild(document.createTextNode(choice.label));
    list.appendChild(item);
    return { choice: choice, item: item, box: box };
  });

  function renderSummary() {
    var text = projectPickerSummary(choices, Object.keys(chosen));
    summary.textContent = text;
    btn.setAttribute("aria-label", "Related projects: " + text);
  }

  // The checkboxes the search left visible, in list order: the arrows walk
  // these and nothing that is hidden.
  function visibleBoxes() {
    return items.filter(function (entry) { return !entry.item.hidden; })
      .map(function (entry) { return entry.box; });
  }

  function applySearch() {
    var shown = filterProjectChoices(choices, search.value);
    var kept = {};
    shown.forEach(function (choice) { kept[choice.id] = true; });
    items.forEach(function (entry) { entry.item.hidden = !kept[entry.choice.id]; });
    noMatch.hidden = shown.length > 0;
  }

  function openPicker() {
    search.value = "";
    applySearch();
    popup.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    placePopover(popup, btn, "left");
    search.focus();
  }

  function closePicker(focusButton) {
    popup.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focusButton) btn.focus();
  }

  btn.addEventListener("click", function () {
    if (popup.hidden) openPicker();
    else closePicker(true);
  });
  btn.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { openPicker(); e.preventDefault(); }
  });

  popup.addEventListener("input", applySearch);

  popup.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      // The list is the closer level: the document's own Escape closes the
      // panel, so this stops here, closes the list and hands focus back with
      // the choice as it was.
      e.preventDefault();
      e.stopPropagation();
      closePicker(true);
      return;
    }
    if (e.key === "Enter" && e.target === search) {
      // Enter belongs to the form, which would save on it. In the search field
      // it moves into the list instead.
      var first = visibleBoxes()[0];
      e.preventDefault();
      if (first) first.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    var stops = [search].concat(visibleBoxes());
    var at = stops.indexOf(document.activeElement);
    if (at === -1) at = 0;
    var next = e.key === "ArrowDown" ? at + 1 : at - 1;
    if (next < 0 || next >= stops.length) return;
    e.preventDefault();
    stops[next].focus();
  });

  // Focus leaving the control - Tab, or a press on anything else in the form -
  // puts the list away rather than leaving it floating over the panel.
  wrap.addEventListener("focusout", function (e) {
    if (popup.hidden) return;
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
    closePicker(false);
  });

  renderSummary();
  return {
    node: wrap,
    close: function () { closePicker(false); }
  };
}

// One Milestone's editor, on top of the list. It returns to the list after a
// save or a delete, so a run of milestones can be written in one sitting.
function openMilestonePanel(milestone, trigger) {
  var editing = !!milestone;
  var node = panelShell(editing ? "Milestone" : "Add milestone",
    "One date, a colour, its own tags and the projects it relates to.");
  node.classList.add("panel--milestones");
  var form = el("form", "form");

  var nameInput = input(editing ? milestone.name : "");
  form.appendChild(formRow("Name", nameInput));

  var date = dateField(editing ? milestone.date : (data.today || ""), "Milestone date");
  form.appendChild(formRow("Date", date));

  var colour = colourPicker(editing ? milestone.colour : leastUsedSlot(data.milestones || []));
  form.appendChild(formRow("Colour", colour.node));

  // Related projects: none, one or many, so the control's own list holds each
  // Project as a checkbox behind a summary row and a search field. The
  // Milestone's stored ids are the starting state, and one the plan no longer
  // offers - an archived Project while Show archived is off, or one deleted
  // since - is listed by its id rather than dropped, so an unrelated edit never
  // silently unlinks a Milestone and a stale link can still be unticked
  // (public/lib/milestone-projects.mjs owns what is offered and the summary).
  var chosen = {};
  ((editing && milestone.projectIds) || []).forEach(function (id) { chosen[id] = true; });
  var picker = milestoneProjectPicker(milestoneProjectChoices(data, Object.keys(chosen)), chosen);
  form.appendChild(formRow("Related projects", picker.node));
  // The popup is fixed beside its trigger, so the panel scrolling under it
  // would leave it pointing at the wrong place: it closes instead.
  node.addEventListener("scroll", picker.close);

  // Milestone tags are their own vocabulary: offered from the other Milestones
  // only, never from People, Projects or Assignments.
  var tags = tagEditor(editing ? milestone.tags : [], function () {
    return suggestMilestoneTags(data.milestones, editing ? milestone.id : null);
  });
  form.appendChild(formRow("Tags", tags.node));

  var notes = textarea(editing ? milestone.notes : "");
  form.appendChild(formRow("Notes", notes));

  node.appendChild(form);
  var error = errorLine(node);

  var foot = el("div", "panel__foot");
  var actions = el("div", "panel__actions");
  if (editing) {
    actions.appendChild(button("btn-danger", "Delete milestone", function () {
      error.clear();
      api("DELETE", "/api/milestones/" + encodeURIComponent(milestone.id) + "/destroy")
        .then(refresh)
        .then(function () {
          updateMilestonesItem();
          openMilestonesPanel(trigger);
        })
        .catch(showError);
    }));
  }
  actions.appendChild(button("btn-ghost", "Cancel", function () { openMilestonesPanel(trigger); }));
  foot.appendChild(actions);
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton(editing ? "Save milestone" : "Add milestone", function () {
    var name = nameInput.value.trim();
    if (!name) { error.set("A milestone needs a name."); nameInput.focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.value)) {
      error.set("A milestone needs a valid date.");
      date.focus();
      return;
    }
    var body = {
      name: name,
      date: date.value,
      colour: colour.value(),
      // The stored order first, so an edit keeps the links as they were; a
      // newly ticked Project joins at the end.
      projectIds: Object.keys(chosen),
      tags: tags.tags(),
      notes: notes.value
    };
    submitPanel(node, error, function () {
      return editing
        ? api("PATCH", "/api/milestones/" + encodeURIComponent(milestone.id), body)
        : api("POST", "/api/milestones", body);
    }, function () {
      updateMilestonesItem();
      openMilestonesPanel(trigger);
    });
  });
  foot.appendChild(save);
  node.appendChild(foot);

  form.addEventListener("submit", function (e) { e.preventDefault(); save.click(); });

  openPanel(node, trigger);
  nameInput.focus();
}

/* --- zoom ---------------------------------------------------------------- */

// Bring today into the middle of the day area, leaving the sticky row-header
// column clear, and put the Marker back on today so the row headers read as of
// now again. Both effects happen in one press. When the set period excludes
// today there is nowhere honest to scroll, so the control is inert until the
// period includes today again.
function todayInRange() {
  if (!data || !rangeStart || !rangeEnd) return false;
  var today = data.today ? udate(data.today) : rangeStart;
  return today >= rangeStart && today <= rangeEnd;
}

function updateTodayControl() {
  var todayBtn = document.getElementById("today");
  if (!todayBtn) return;
  // In a report the Today slot has nothing to act on, and it is where a Report
  // reset will go once the report's own state is worth resetting. It is
  // disabled - visibly unavailable and not focusable - and keeps its position.
  if (isReport) {
    todayBtn.disabled = true;
    todayBtn.setAttribute("aria-disabled", "true");
    todayBtn.classList.add("is-disabled");
    todayBtn.title = "Today applies to the grid";
    return;
  }
  var available = todayInRange();
  // Kept focusable and labelled; only its action is withdrawn, so a reader
  // still reaches it and hears that it is unavailable.
  todayBtn.disabled = false;
  todayBtn.setAttribute("aria-disabled", available ? "false" : "true");
  todayBtn.classList.toggle("is-disabled", !available);
  todayBtn.title = available ? "" : "Today is outside the plan's period";
}

// Put a day in the middle of the grid's visible day area, leaving the sticky
// Person column clear. The one rule goToToday and a press on the Minimap
// share, held in lib/minimap.mjs.
function scrollToDayCenter(index) {
  var left = centerScrollLeft(index, dayWidth(), scroller.clientWidth, headWidth());
  scroller.scrollLeft = clamp(left, 0, maxScrollLeft());
}

function maxScrollLeft() {
  return Math.max(0, scroller.scrollWidth - scroller.clientWidth);
}

function goToToday() {
  if (!data || !todayInRange()) return;
  var today = data.today ? udate(data.today) : rangeStart;
  var index = clamp(dayDiff(rangeStart, today), 0, DAYS - 1);
  setMarker(index);
  scrollToDayCenter(index);
}

function applyZoom(zoom) {
  if (!isZoom(zoom)) zoom = ZOOM_DEFAULT;
  // The Sprint zoom is shown but disabled until a cadence exists; if the
  // cadence is cleared while the view is on Sprint, step back to Week rather
  // than leaving a zoom the plan can no longer name.
  if (zoom === "sprint" && !sprintCadence) zoom = "week";
  // The report has no grid to redraw: its level is still the same zoom
  // control, but it sets the report's own remembered level and touches
  // nothing about the grid's geometry.
  if (isReport) {
    reportZoom = zoom;
    syncZoomButtons(zoom);
    return;
  }
  // Hold the Marker where it sits on screen while the scale changes.
  var sRect = scroller.getBoundingClientRect();
  var before = marker ? marker.getBoundingClientRect().left - sRect.left : 0;
  root.setAttribute("data-zoom", zoom);
  applyGridSpacing();
  updateDividerRules();
  syncZoomButtons(zoom);
  var after = marker ? marker.getBoundingClientRect().left - sRect.left : 0;
  scroller.scrollLeft += after - before;
  queueBlockLabels();
  updateMinimapWindow();
}

// Which of the four buttons reads as pressed, in either view.
function syncZoomButtons(zoom) {
  zoomButtons.forEach(function (b) {
    b.setAttribute("aria-pressed", b.getAttribute("data-zoom") === zoom ? "true" : "false");
  });
}

// The Sprint button never appears and disappears: it is always in the group and
// disabled until a cadence exists, with a title saying where to define one.
function syncZoomControls() {
  var sprintBtn = document.querySelector('.zoom__btn[data-zoom="sprint"]');
  if (!sprintBtn) return;
  var available = !!sprintCadence;
  sprintBtn.disabled = !available;
  sprintBtn.setAttribute("aria-disabled", available ? "false" : "true");
  sprintBtn.title = available ? "" : "Define sprints in Options";
  // The active level is the grid's on the plan and the report's own on the
  // report, so clearing the cadence steps the right one back to Week.
  var active = isReport ? reportZoom : root.getAttribute("data-zoom");
  if (!available && active === "sprint") {
    applyZoom("week");
    persistView();
  }
}

function initZoom() {
  zoomButtons = Array.prototype.slice.call(document.querySelectorAll(".zoom__btn"));
  zoomButtons.forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.disabled) return;
      applyZoom(b.getAttribute("data-zoom"));
      persistView();
      // The grid redraws itself from the zoom geometry, but a report names its
      // own bucket in its content, so it redraws to show the new level.
      if (isReport) render();
    });
  });
  var initial = isReport ? reportZoom : root.getAttribute("data-zoom");
  applyZoom(isZoom(initial) ? initial : ZOOM_DEFAULT);
}

/* --- row height ---------------------------------------------------------- */

// The top-bar pair that changes the drawn height of every row, drawn with
// vertical arrows. Each press moves it by one 8px step across 32..120; it is
// applied to the grid and stored in the view.
function initRowHeight() {
  var down = document.getElementById("row-decrease");
  var up = document.getElementById("row-increase");
  if (down) {
    down.addEventListener("click", function () {
      rowHeight = stepRowHeight(rowHeight, -1);
      applyRowHeight();
      render();
      persistView();
    });
  }
  if (up) {
    up.addEventListener("click", function () {
      rowHeight = stepRowHeight(rowHeight, 1);
      applyRowHeight();
      render();
      persistView();
    });
  }
  applyRowHeight();
}

/* --- grid spacing -------------------------------------------------------- */

// The top-bar pair that changes the drawn width of one day for the active zoom.
// Each press moves that zoom's own width by 2px across 2..48; the change is
// applied to the grid and stored in the view, so it survives a reload and a
// trip through another zoom.
function bumpGridSpacing(delta) {
  var zoom = root.getAttribute("data-zoom");
  if (!isZoom(zoom)) zoom = ZOOM_DEFAULT;
  var next = stepGridSpacing(gridSpacing[zoom], delta);
  if (next === null) return;
  gridSpacing[zoom] = next;
  applyGridSpacing();
  // A wider or narrower day changes how much room a block label has, so the
  // labels and the Minimap's window are remeasured. Nothing about a row's own
  // height changes, so the rows are not redrawn.
  queueBlockLabels();
  updateMinimapWindow();
  persistView();
}

function initGridSpacing() {
  var down = document.getElementById("spacing-decrease");
  var up = document.getElementById("spacing-increase");
  if (down) {
    down.addEventListener("click", function () { bumpGridSpacing(-1); });
  }
  if (up) {
    up.addEventListener("click", function () { bumpGridSpacing(1); });
  }
  applyGridSpacing();
}

/* --- Stack rail collapse ------------------------------------------------- */

// The Stack rail's folded state is a view setting for the session only. This
// applies it: the board gains the collapsed track, the toggle announces the
// action and state it now has, the chevron turns to point the way the rail
// will move, and the match count appears only while folded and filtered. It
// writes nothing anywhere.
function syncStackToggle() {
  if (!boardEl || !stackToggle) return;
  var collapsed = stackCollapsed;
  boardEl.classList.toggle("is-collapsed", collapsed);
  // The toggle names the panel it folds, read from the panel's own label, so
  // the grid says Projects and a report says its views.
  var panel = stackPanel ? stackPanel.getAttribute("aria-label") : null;
  stackToggle.setAttribute("aria-expanded", stackToggleExpanded(collapsed) ? "true" : "false");
  stackToggle.setAttribute("aria-label", stackToggleLabel(collapsed, panel));
  stackToggle.setAttribute("title", stackToggleLabel(collapsed, panel));
  if (stackChevron) {
    stackChevron.setAttribute("d", collapsed ? "M6 3l5 5-5 5" : "M10 3 5 8l5 5");
  }
  if (stackCount) {
    var count = stackMatchCount(collapsed, filterQuery, gridProjects.length);
    stackCount.hidden = count === null;
    stackCount.textContent = count === null ? "" : String(count);
  }
}

function setStackCollapsed(collapsed) {
  stackCollapsed = collapsed === true;
  syncStackToggle();
  // The timeline's width changes with the rail, so the block labels have new
  // room to measure. Nothing else on the grid moves.
  queueBlockLabels();
  persistView();
}

// A real button, toggled by a click - which Enter and Space also fire - and by
// no global shortcut.
function initStackToggle() {
  if (!stackToggle) return;
  stackToggle.addEventListener("click", function () {
    setStackCollapsed(!stackCollapsed);
  });
  syncStackToggle();
}

/* --- the Minimap --------------------------------------------------------- */

// The overview strip is a view setting for the session only. It is drawn over
// the grid's bottom-right corner and is its own surface: a press on it - to
// drag the highlighted window or to move the view - never reaches the grid
// underneath, and the grid's own presses never reach it.
var minimapDrag = null;

// The area under the density curve: one point per day at that day's density,
// scaled so a fully allocated day reaches the top. A day past full is over the
// top and is clipped there, then marked by the over-allocation layer.
function minimapAreaPath(series, width, height) {
  var n = series.dayCount;
  if (!n) return "";
  var d = "M 0 " + height;
  for (var i = 0; i < n; i++) {
    var x = ((i + 0.5) / n) * width;
    var y = height - Math.min(series.slices[i].density, 1) * height;
    d += " L " + r4(x) + " " + r4(y);
  }
  return d + " L " + width + " " + height + " Z";
}

// The over-allocation runs: one full-height band per run of consecutive days
// whose used capacity is past their available capacity, so the crunch reads at
// the top of the scale and in the signal colour, distinct from merely busy.
function minimapOverPath(series, width, height) {
  var n = series.dayCount;
  if (!n) return "";
  var d = "";
  var i = 0;
  while (i < n) {
    if (!series.slices[i].over) { i++; continue; }
    var j = i;
    while (j + 1 < n && series.slices[j + 1].over) j++;
    var x0 = r4((i / n) * width);
    var x1 = r4(((j + 1) / n) * width);
    d += "M " + x0 + " " + height + " L " + x0 + " 0 L " + x1 + " 0 L " + x1 + " " + height + " Z ";
    i = j + 1;
  }
  return d.trim();
}

// Redraw the whole strip from the plan, the active Filter and the archive
// state: the same reading the grid draws from, so the two agree. The window is
// put back on top of the new area.
function renderMinimap() {
  if (!minimapEl || !data) return;
  var series = minimapDensity(data, filterQuery, filterScopes, showArchived);
  var fill = minimapEl.querySelector(".minimap__fill");
  var over = minimapEl.querySelector(".minimap__over");
  if (fill) fill.setAttribute("d", minimapAreaPath(series, 1000, 100));
  if (over) over.setAttribute("d", minimapOverPath(series, 1000, 100));
  // The highlight marks a stretch of a drawn axis. With the filter's empty
  // state there is no axis, so there is no window to draw.
  minimapEl.classList.toggle("is-empty", tl.classList.contains("is-empty"));
  updateMinimapWindow();
}

// The visible window follows a sideways scroll: its left edge and width are
// the same day arithmetic, read as a fraction of the plan's period.
function updateMinimapWindow() {
  if (!minimapEl || minimapEl.hidden || !data || !rangeStart || !DAYS) return;
  var node = minimapEl.querySelector(".minimap__window");
  if (!node) return;
  if (tl.classList.contains("is-empty")) {
    node.style.left = "0%";
    node.style.width = "0%";
    return;
  }
  var win = visibleDayWindow(scroller.scrollLeft, scroller.clientWidth,
    headWidth(), dayWidth(), DAYS);
  node.style.left = (win.start / DAYS) * 100 + "%";
  node.style.width = (win.width / DAYS) * 100 + "%";
}

// The strip is shown exactly while its toggle is on. Showing it draws it from
// the current reading; hiding it leaves the grid untouched.
function syncMinimap() {
  if (!minimapEl) return;
  minimapEl.hidden = !minimapEnabled;
  if (!minimapEnabled) return;
  renderMinimap();
}

function minimapTrackDay(clientX) {
  var rect = minimapEl.getBoundingClientRect();
  return trackDayAt(clientX, rect.left, rect.width, DAYS);
}

function centerMinimapAt(clientX) {
  var left = centerScrollLeft(minimapTrackDay(clientX), dayWidth(),
    scroller.clientWidth, headWidth());
  scroller.scrollLeft = clamp(left, 0, maxScrollLeft());
}

// A press on the highlighted window drags it: the pointer's travel across the
// strip's width is read as days across the whole range and turned into scroll
// by the same day width the grid draws with. A press anywhere else on the track
// moves the view to the day under the pointer, and dragging the track scrubs.
function onMinimapPointerDown(e) {
  if (e.button !== 0 && e.pointerType === "mouse") return;
  e.preventDefault();
  e.stopPropagation();
  var windowEl = minimapEl.querySelector(".minimap__window");
  if (windowEl && e.target !== minimapEl && windowEl.contains(e.target)) {
    minimapDrag = { mode: "window", startX: e.clientX, startScroll: scroller.scrollLeft };
  } else {
    minimapDrag = { mode: "track" };
    centerMinimapAt(e.clientX);
  }
  try { minimapEl.setPointerCapture(e.pointerId); } catch (err) { /* synthetic input */ }
}

function onMinimapPointerMove(e) {
  if (!minimapDrag) return;
  if (minimapDrag.mode === "track") { centerMinimapAt(e.clientX); return; }
  var rect = minimapEl.getBoundingClientRect();
  var left = dragScrollLeft(minimapDrag.startScroll, e.clientX - minimapDrag.startX,
    rect.width, DAYS, dayWidth());
  scroller.scrollLeft = clamp(left, 0, maxScrollLeft());
}

function onMinimapPointerUp(e) {
  minimapDrag = null;
  try {
    if (minimapEl.hasPointerCapture(e.pointerId)) minimapEl.releasePointerCapture(e.pointerId);
  } catch (err) { /* ignored */ }
}

function initMinimap() {
  if (!minimapEl) return;
  minimapEl.addEventListener("pointerdown", onMinimapPointerDown);
  minimapEl.addEventListener("pointermove", onMinimapPointerMove);
  minimapEl.addEventListener("pointerup", onMinimapPointerUp);
  minimapEl.addEventListener("pointercancel", onMinimapPointerUp);
  syncMinimap();
}

/* --- render -------------------------------------------------------------- */

// The empty result: it names what was typed, says what was searched and
// offers a way out. A typed term names its field; a term whose prefix named no
// field was searched as text, so it is named back with the hint that the
// prefix may have meant a field. The filter is still on, so the field stays as
// it is.
function buildEmptyState() {
  var term = parseFilterTerm(filterQuery);
  var box = el("div", "filter-empty");
  var line = el("div", "filter-empty__line");
  line.appendChild(document.createTextNode("Nothing matches "));
  var typed = el("b");
  var hint = el("p", "filter-empty__hint");
  if (term.kind === "field") {
    typed.textContent = term.value;
    line.appendChild(typed);
    line.appendChild(document.createTextNode(" in " + fieldLabel(term.fields) + "."));
    hint.textContent = "A typed term searches only the field it names; Look in is not used.";
  } else if (term.unknownPrefix) {
    typed.textContent = filterQuery.trim();
    line.appendChild(typed);
    line.appendChild(document.createTextNode(" in " + searchedAreas(filterScopes) + "."));
    hint.textContent = unknownFieldHint(term.unknownPrefix);
  } else {
    typed.textContent = filterQuery.trim();
    line.appendChild(typed);
    line.appendChild(document.createTextNode(" in " + searchedAreas(filterScopes) + "."));
    hint.textContent = "Check the spelling, or switch off a lookup area you do not need.";
  }
  box.appendChild(line);
  box.appendChild(hint);
  box.appendChild(button("btn-ghost", "Clear the filter", function () { clearFilter(); }));
  return box;
}

/* --- the report's own content ------------------------------------------- */

// A report figure, one decimal, with a middot for a value too small to read -
// the convention the mockup's tables drew.
function reportFigure(value) {
  if (!isFinite(value)) return "-";
  if (Math.abs(value) < 0.05) return "\u00b7";
  return (Math.round(value * 10) / 10).toFixed(1);
}

function reportPercent(fraction) {
  return Math.round((Number(fraction) || 0) * 100) + "%";
}

// A named thing's cell: the palette swatch its colour slot names, then the
// name. No slot means no swatch rather than a wrong one.
function reportNameCell(name, slot) {
  var span = el("span", "report-name");
  if (Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT) {
    var swatch = el("span", "report-name__swatch");
    swatch.style.background = activeColour(slot);
    span.appendChild(swatch);
  }
  span.appendChild(document.createTextNode(name));
  return span;
}

// One tag, drawn as a chip in the project's tag list. Its own colour slot is
// the colour-by-key feature's, and a tag without one is left plain - the swatch
// is what names a tag's colour. The TAGS column and the by-tag view's two rows
// draw this one chip: given a choice it is a toggle instead of a plain mark, and
// its state rides on the element as a whole - `data-state` for the drawing,
// `aria-pressed` for everything else - so selected and not selected are read
// off the chip rather than off its colour. A selected chip's fill is the same
// ink whatever colour the tag has; the swatch keeps carrying the colour.
function reportTagChip(tag, slot, choice) {
  var coloured = Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT;
  var chip = choice ? el("button", "report-tag report-tag--choice") : el("span", "report-tag");
  if (choice) {
    chip.type = "button";
    chip.setAttribute("data-state", choice.state);
    chip.setAttribute("aria-pressed", choice.state === "on" ? "true" : "false");
    if (choice.name) chip.setAttribute("aria-label", choice.name);
    chip.addEventListener("click", choice.onClick);
  }
  if (coloured) {
    var swatch = el("span", "report-tag__swatch");
    swatch.style.background = activeColour(slot);
    chip.appendChild(swatch);
  }
  chip.appendChild(document.createTextNode(tag));
  return chip;
}

function reportTagList(tags) {
  if (!tags || tags.length === 0) {
    var none = el("span", "report-tag report-tag--none");
    none.textContent = "none";
    return none;
  }
  var wrap = el("span", "report-tags");
  tags.forEach(function (tag) {
    var slot = Object.prototype.hasOwnProperty.call(tagSlotMap, tag) ? tagSlotMap[tag] : null;
    wrap.appendChild(reportTagChip(tag, slot));
  });
  return wrap;
}

function reportNumCell(value) {
  return { text: reportFigure(value), cls: "report-table__num" };
}

// The column carrying each row's total is marked the way the Total row is: the
// same weight, with no rule of its own. The header and the cells take the one
// class, which is the class the stylesheet marks.
var REPORT_TOTAL_COL = "report-table__num report-table__total";

function reportTotalCell(value) {
  return { text: reportFigure(value), cls: REPORT_TOTAL_COL };
}

// One share of an offer, as a cell: the whole percentage the app prints for a
// percentage everywhere else. Whether it is over-allocation is read off that
// same whole figure, exactly as the grid reads a row head's assigned figure
// against the person's availability, so the number and the colour can never
// disagree. A bucket the person offers nothing in has no share to state: it
// reads as the dash a figure with no value reads as, never as Infinity or a
// 0% that would claim they filled nothing.
function reportShareCell(value, totalColumn) {
  var cls = totalColumn ? REPORT_TOTAL_COL : "report-table__num";
  if (typeof value !== "number" || !isFinite(value)) return { text: "-", cls: cls };
  var shown = Math.round(value * 100);
  return { text: shown + "%", cls: shown > 100 ? cls + " is-over" : cls };
}

// One table. The first column is sticky so a wide matrix keeps its names, and
// every numeric column is right-aligned to its own figures.
function reportTable(headers, rows) {
  var wrap = el("div", "report-tablewrap");
  var table = el("table", "report-table");
  var thead = el("thead");
  var hrow = el("tr");
  headers.forEach(function (h) {
    var th = el("th", h.cls || "");
    th.textContent = h.text;
    if (h.title) th.title = h.title;
    hrow.appendChild(th);
  });
  thead.appendChild(hrow);
  table.appendChild(thead);
  var tbody = el("tbody");
  rows.forEach(function (row) {
    var tr = el("tr", row.cls || "");
    row.cells.forEach(function (cell) {
      var td = el("td", cell.cls || "");
      if (cell.node) td.appendChild(cell.node);
      else td.textContent = cell.text == null ? "" : cell.text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function reportSection(title, sub) {
  var sec = el("section", "report__section");
  var heading = el("h2", "report__heading");
  heading.textContent = title;
  sec.appendChild(heading);
  if (sub) {
    var note = el("p", "report__sub");
    note.textContent = sub;
    sec.appendChild(note);
  }
  return sec;
}

/* The one line under every view's content: the fact about the figures that
 * neither the heading nor the column heads say. Only one view shows at a time,
 * so it is on screen once. */
function reportAbsencesNote() {
  var note = el("p", "report__note");
  note.textContent = "Absences are left out.";
  return note;
}

/* --- the chart, hand-drawn SVG in the app's own tokens ------------------ */

function svgNode(tag, attrs, text) {
  var node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.keys(attrs || {}).forEach(function (key) {
    if (attrs[key] != null) node.setAttribute(key, attrs[key]);
  });
  if (text != null) node.textContent = text;
  return node;
}

// A whole-number ceiling a chart can divide cleanly is the module's own rule
// (public/lib/chart.mjs), beside the geometry, the paths and the ruler.

// The milestones on the chart: one quiet vertical rule at each date the view
// leaves a milestone on, in that milestone's own palette colour. The marks are
// the grid's own (milestoneMarkList, one per visible date and none off the
// plan period), and the one Milestones switch decides whether either
// surface draws them, so the chart and the rows cannot disagree about which
// milestones are shown. A date the plot does not hold draws nothing.
//
// A milestone is an annotation, so its rule takes the band's place in the paint
// order: over the grid and the capacity's quiet fill, under the data ink and
// under the ruler and the readout's paper. The paper is opaque, so a reading in
// the plot's corner stays legible over a rule beneath it and the rule is simply
// interrupted there rather than fighting the figure it annotates.
function reportChartMilestones(svg, buckets, geom) {
  chartMilestoneRules(milestoneMarkList, milestonesDrawn(), buckets, geom).forEach(function (rule) {
    var line = svgNode("line", {
      x1: rule.x, x2: rule.x, y1: geom.top, y2: geom.top + geom.plotH,
      class: "report-chart__milestone"
    });
    line.style.setProperty("--milestone", "var(--proj-" + rule.mark.colour + ")");
    // Named on hover and to a screen reader in the axis band's own words: the
    // milestone's name, its date, and how many others share the date.
    line.appendChild(svgNode("title", null, milestoneLabel(rule.mark)));
    svg.appendChild(line);
  });
}

function reportChartAxis(svg, width, height, geom) {
  [0, geom.max / 2, geom.max].forEach(function (v) {
    var y = chartY(v, geom);
    svg.appendChild(svgNode("line", {
      x1: geom.left, x2: geom.left + geom.plotW, y1: y, y2: y, class: "report-chart__grid"
    }));
    svg.appendChild(svgNode("text", {
      x: geom.left - 6, y: y + 3, "text-anchor": "end", class: "report-chart__tick"
    }, String(Math.round(v))));
  });
  svg.appendChild(svgNode("line", {
    x1: geom.left, x2: geom.left + geom.plotW,
    y1: geom.top + geom.plotH, y2: geom.top + geom.plotH, class: "report-chart__axis"
  }));
}

function reportChartLabels(svg, height, geom, labels) {
  var every = Math.max(1, Math.ceil(labels.length / 16));
  labels.forEach(function (label, i) {
    if (i % every !== 0 && i !== labels.length - 1) return;
    svg.appendChild(svgNode("text", {
      x: chartX(i, geom), y: height - 10, "text-anchor": "middle", class: "report-chart__tick"
    }, label));
  });
}

// The chart itself: one SVG in the app's own tokens. The capacity is a quiet
// band under a solid edge, painted below the grid so the horizontal guides
// still read through the roof; the allocation line and its dots ride over it,
// which is where the eye lands. The band's fill is the quiet neutral --off, so
// it is one fixed colour whatever palette scheme the plan is read in.
//
// Reading it is the ruler's job, over the pointer or the keyboard: it snaps to
// the nearest bucket's centre and a readout fixed in the plot's bottom-left
// corner states that bucket's label, its two figures and the share between
// them. Both are put away when the pointer leaves the plot or the chart loses
// focus, and the readout's words are announced through the caller's live
// region.
function buildLineChart(model, live) {
  var width = 780;
  var height = 240;
  var pad = { l: 46, r: 8, t: 12, b: 34 };
  var line = model.chart;
  var max = chartCeiling(line.reduce(function (m, b) { return Math.max(m, b.capacity); }, 0));
  var geom = chartGeometry(width, height, pad, line.length, max);
  var svg = svgNode("svg", {
    viewBox: "0 0 " + width + " " + height,
    class: "report-chart",
    role: "group",
    tabindex: "0",
    "aria-label": "Allocation against capacity over " + reportBucketLabel(reportZoom).toLowerCase()
  });

  svg.appendChild(svgNode("path", { d: chartBandPath(line, geom), class: "report-chart__band" }));
  reportChartAxis(svg, width, height, geom);
  reportChartMilestones(svg, model.buckets, geom);
  svg.appendChild(svgNode("path", {
    d: chartLinePath(line, geom, "capacity"), class: "report-chart__cap"
  }));
  svg.appendChild(svgNode("path", {
    d: chartLinePath(line, geom, "alloc"), class: "report-chart__alloc"
  }));
  // The allocation keeps its dots; the capacity's went with the dashes, since
  // the band's solid edge is the line now.
  line.forEach(function (b, i) {
    svg.appendChild(svgNode("circle", {
      cx: chartX(i, geom), cy: chartY(b.alloc, geom), r: 2.4, class: "report-chart__dot-alloc"
    }));
  });
  reportChartLabels(svg, height, geom, line.map(function (b) { return b.label; }));

  // The ruler and its readout: drawn once, shown by a class on the chart while
  // someone is reading. The readout is a group of its own, kept down in the
  // plot's left corner by the capacity's baseline - fixed there, so it never
  // covers the roof it describes and never flickers between two positions. Its
  // place is set on each showing, from the words' own measured box.
  var rule = svgNode("line", {
    class: "report-chart__rule", y1: geom.top, y2: geom.top + geom.plotH
  });
  var readout = svgNode("g", { class: "report-chart__readout" });
  var box = svgNode("rect", { class: "report-chart__readout-box" });
  var words = svgNode("text", { class: "report-chart__readout-text", x: 6, y: 13 });
  readout.appendChild(box);
  readout.appendChild(words);
  svg.appendChild(rule);
  svg.appendChild(readout);

  var index = null;
  function show(i) {
    if (i < 0 || i >= line.length) return hide();
    index = i;
    var x = chartX(i, geom);
    rule.setAttribute("x1", x);
    rule.setAttribute("x2", x);
    words.textContent = chartReadout(line[i]);
    // Shown before it is measured: an undisplayed group measures as nothing.
    svg.classList.add("is-reading");
    // The box takes the words' own measured size, and the group is placed from
    // that same box, so a taller or longer reading still sits inside the plot
    // and clear of the axis labels under its baseline.
    var paper = chartReadoutBox(words.getBBox());
    var at = chartReadoutAt(geom, paper);
    box.setAttribute("x", paper.x);
    box.setAttribute("y", paper.y);
    box.setAttribute("width", paper.width);
    box.setAttribute("height", paper.height);
    readout.setAttribute("transform", "translate(" + at.x + " " + at.y + ")");
    if (live) live.textContent = words.textContent;
  }
  function hide() {
    index = null;
    svg.classList.remove("is-reading");
    if (live) live.textContent = "";
  }

  // A pointer's position arrives in screen pixels and is converted to the
  // SVG's own units, which is where the geometry lives.
  svg.addEventListener("pointermove", function (ev) {
    var frame = svg.getBoundingClientRect();
    if (!frame.width || !frame.height) return;
    var x = (ev.clientX - frame.left) * (width / frame.width);
    var y = (ev.clientY - frame.top) * (height / frame.height);
    if (!chartInPlot(x, y, geom)) return hide();
    show(chartNearestIndex(x, geom));
  });
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("blur", hide);
  // Focus is an invitation: the keyboard lands on the first bucket's readout
  // without having to press an arrow to find out the chart can speak.
  svg.addEventListener("focus", function () { if (index === null && line.length) show(0); });
  svg.addEventListener("keydown", function (ev) {
    var i = chartKeyIndex(ev.key, index, line.length);
    if (i === null) return;
    // The arrows and the ends are the chart's while it holds focus; the page
    // must not scroll under them.
    ev.preventDefault();
    show(i);
  });
  return svg;
}

function reportLegend(items) {
  var legend = el("div", "report-legend");
  items.forEach(function (item) {
    var entry = el("span", "report-legend__item");
    entry.appendChild(el("span", "report-legend__swatch " + item.swatchClass));
    entry.appendChild(document.createTextNode(item.label));
    legend.appendChild(entry);
  });
  return legend;
}

/* --- the report page ----------------------------------------------------- */

/* The report's own content: one of its seven views at a time, from the plan the
 * Filter and the rail's sort leave. The figures come from
 * public/lib/report-content.mjs, which reads the app's own working-day rule, so
 * the report and the grid agree by construction. The one thing the report
 * writes is the by-tag view's own split, which is the owner's choice stored in
 * the plan like the holidays. The rail is drawn beside it and lists those seven
 * views - the plan's own panel, folded by the same control and remembering the
 * same collapsed state. */
function renderReport() {
  tl.classList.add("is-report");
  // The panel is drawn whatever the Filter leaves, so an empty result never
  // strands the owner in a view with no way to another.
  drawReportNav();

  // The grid maps its assignments to Dates and clamped indices; the report's
  // rule reads the raw ISO records, so it is handed the plan's own shape.
  var view = {
    projects: gridProjects,
    people: gridPeople,
    assignments: gridAssignments.map(function (a) { return a.raw; })
  };

  // The Filter reaches the report too: an empty result is the grid's own empty
  // state rather than an empty table.
  if (filterQuery.trim() !== "" && filterIsEmpty(view)) {
    tl.classList.add("is-empty");
    tl.appendChild(buildEmptyState());
    return;
  }
  tl.classList.remove("is-empty");

  var model = reportContent(view, data, {
    zoom: reportZoom,
    sprints: sprintList,
    tagSlots: tagSlotMap
  });

  var box = el("div", "report");

  // One view in the main area: the panel's selection decides, and nothing is
  // drawn beside it.
  box.appendChild(reportViewSection(model));

  tl.appendChild(box);
}

/* --- the report's rail ---------------------------------------------------- */

// The report's navigation panel: one row per view, in the list's own order, the
// row of the view showing marked current the way the Plan/Report switch marks a
// page - the app's one treatment for "this is the one showing". The panel is
// the plan's own; this only fills its list.
function drawReportNav() {
  if (!reportViewsList) return;
  reportViewsList.innerHTML = "";
  REPORT_VIEWS.forEach(function (entry) {
    var row = el("li", "stack__row");
    var item = el("button", "stack__item report-nav__item");
    item.type = "button";
    if (entry.key === reportView) item.setAttribute("aria-current", "true");
    var name = el("span", "stack__name");
    name.textContent = entry.label;
    item.appendChild(name);
    // A click's detail is 0 when the keyboard made the press and non-zero when
    // a pointer did, which is what decides whether focus is put back below.
    item.addEventListener("click", function (e) {
      selectReportView(entry.key, e.detail === 0);
    });
    row.appendChild(item);
    reportViewsList.appendChild(row);
  });
}

// A press on a row draws that view alone and remembers the choice as a view
// setting, like the Zoom, so a reload and a return from the plan resume here.
// Only a keyboard press has focus put back: the redraw takes the pressed row
// with it, so the keyboard would otherwise be dropped, but a pointer press is
// no instruction to move the focus a mouse user left on the row they pressed -
// and the refocused row would wear the keyboard's ring over the view it marks.
function selectReportView(key, pressedWithKeyboard) {
  var next = normalizeReportView(key);
  if (next === reportView) return;
  reportView = next;
  render();
  // The list is redrawn with the selection in its new place, so the pressed row
  // is gone: the keyboard is put back on the row that is now current.
  if (pressedWithKeyboard) {
    var current = reportViewsList.querySelector("[aria-current]");
    if (current) current.focus();
  }
  // A new view opens at its own top rather than at the old one's scroll.
  scroller.scrollTop = 0;
  persistView();
}

// The bucket the report draws, as the sentences below name it.
function reportBucketWord() {
  return reportBucketLabel(reportZoom).toLowerCase();
}

/* --- the seven views ----------------------------------------------------- */

// The view the selection names. Each builder draws one section under the panel
// entry's own label, so the panel and the content can never say different
// things.
function reportViewSection(model) {
  if (reportView === "by-person") return reportPersonSection(model);
  if (reportView === "by-tag") return reportTagSection(model);
  if (reportView === "allocation-by-project") return reportAllocationProjectSection(model);
  if (reportView === "allocation-by-person") return reportAllocationPersonSection(model);
  if (reportView === "allocation-by-tag") return reportAllocationTagSection(model);
  if (reportView === "allocation") return reportAllocationSection(model);
  return reportProjectSection(model);
}

// The bucket headings every matrix shares: one column per bucket, its dates in
// the tooltip.
function reportBucketHeaders(model) {
  return model.buckets.map(function (b) {
    return {
      text: b.label,
      cls: "report-table__num",
      title: b.start === b.end ? b.start : b.start + " to " + b.end
    };
  });
}

// FTE-days by project: one row per project, its FTE-days under each bucket.
function reportProjectSection(model) {
  var headers = [{ text: "Project", cls: "report-table__name" }]
    .concat(reportBucketHeaders(model))
    .concat([
      { text: "Total", cls: REPORT_TOTAL_COL },
      { text: "Of plan", cls: "report-table__num" },
      { text: "Tags", cls: "report-table__tags" }
    ]);
  var rows = model.byProject.rows.map(function (r) {
    var cells = [{ node: reportNameCell(r.name, r.colour), cls: "report-table__name" }];
    r.cells.forEach(function (v) { cells.push(reportNumCell(v)); });
    cells.push(reportTotalCell(r.total));
    cells.push({ text: reportPercent(r.share), cls: "report-table__num" });
    cells.push({ node: reportTagList(r.tags), cls: "report-table__tags" });
    return { cells: cells };
  });
  var totalCells = [{ text: "Total", cls: "report-table__name" }];
  model.byProject.total.cells.forEach(function (v) { totalCells.push(reportNumCell(v)); });
  totalCells.push(reportTotalCell(model.byProject.total.total));
  totalCells.push({ text: "100%", cls: "report-table__num" });
  totalCells.push({ text: "", cls: "report-table__tags" });
  rows.push({ cells: totalCells, cls: "report-row--total" });
  var section = reportSection(reportViewLabel("by-project"),
    "A project with two tags has its FTE-days split between them.");
  section.appendChild(reportTable(headers, rows));
  section.appendChild(reportAbsencesNote());
  return section;
}

// FTE-days by person: one row per person, their FTE-days against their offer.
function reportPersonSection(model) {
  var headers = [{ text: "Person", cls: "report-table__name" }]
    .concat(reportBucketHeaders(model))
    .concat([
      { text: "Total", cls: REPORT_TOTAL_COL },
      { text: "Of plan", cls: "report-table__num" },
      { text: "Of offer", cls: "report-table__num", title: "The person's FTE-days against the FTE-days they offer over the period" }
    ]);
  var rows = model.byPerson.rows.map(function (r) {
    // The mark is the grid's own: the Person's slot under the people key, and
    // no slot for a Person carrying no such tag, exactly as the row head draws
    // it. People have no palette colour of their own.
    var cells = [{ node: reportNameCell(r.name, personSlot(r.tags, tagKeyMap, tagSlotMap)), cls: "report-table__name" }];
    r.cells.forEach(function (v) { cells.push(reportNumCell(v)); });
    cells.push(reportTotalCell(r.total));
    cells.push({ text: reportPercent(r.share), cls: "report-table__num" });
    cells.push({ text: reportPercent(r.pct), cls: "report-table__num" });
    return { cells: cells };
  });
  var totalCells = [{ text: "Total", cls: "report-table__name" }];
  model.byPerson.total.cells.forEach(function (v) { totalCells.push(reportNumCell(v)); });
  totalCells.push(reportTotalCell(model.byPerson.total.total));
  totalCells.push({ text: "100%", cls: "report-table__num" });
  totalCells.push({ text: reportPercent(model.byPerson.total.pct), cls: "report-table__num" });
  rows.push({ cells: totalCells, cls: "report-row--total" });
  var section = reportSection(reportViewLabel("by-person"),
    "Of offer is against each person's own availability, so someone at 80% can reach 100%.");
  section.appendChild(reportTable(headers, rows));
  section.appendChild(reportAbsencesNote());
  return section;
}

// Allocation by project: each project's FTE-days as a share of the capacity the
// whole plan offers in the same bucket, and of everything it offers over the
// period in the Total column. The same table as Allocation by tag with a project
// in place of a tag: one denominator for every row, so the rows add up to the
// plan's own utilisation - the Total row they sit under - rather than to 100%,
// and no second percentage column sits beside it. Above 100% is a project
// occupying more than the whole team together, marked as the person view marks
// it; a project rarely reaches that, but the mark is the view's rule and not a
// figure's accident.
function reportAllocationProjectSection(model) {
  var headers = [{ text: "Project", cls: "report-table__name" }]
    .concat(reportBucketHeaders(model))
    .concat([{ text: "Total", cls: REPORT_TOTAL_COL }]);
  var rows = model.allocationByProject.rows.map(function (r) {
    // Marked with the project's own palette colour, as the by-project table
    // marks it, so the two readings of a project name it the same way.
    var cells = [{ node: reportNameCell(r.name, r.colour), cls: "report-table__name" }];
    r.cells.forEach(function (v) { cells.push(reportShareCell(v)); });
    cells.push(reportShareCell(r.total, true));
    return { cells: cells };
  });
  var totalCells = [{ text: "Total", cls: "report-table__name" }];
  model.allocationByProject.total.cells.forEach(function (v) { totalCells.push(reportShareCell(v)); });
  totalCells.push(reportShareCell(model.allocationByProject.total.total, true));
  rows.push({ cells: totalCells, cls: "report-row--total" });
  var section = reportSection(reportViewLabel("allocation-by-project"),
    "Each project's FTE-days as a share of the capacity the plan offers in the " +
    "same stretch of time; above 100% is over-allocation.");
  section.appendChild(reportTable(headers, rows));
  section.appendChild(reportAbsencesNote());
  return section;
}

// Allocation by person: each person's FTE-days as a share of what they offer in
// the same bucket, and over the period in the Total column. One denominator
// throughout, so no second percentage column sits beside it, and the Total
// column is a reading of the period rather than the sum of the cells.
function reportAllocationPersonSection(model) {
  var headers = [{ text: "Person", cls: "report-table__name" }]
    .concat(reportBucketHeaders(model))
    .concat([{ text: "Total", cls: REPORT_TOTAL_COL }]);
  var rows = model.allocationByPerson.rows.map(function (r) {
    // Marked with the Person's own colour slot, as the by-person table marks
    // them, so the two side-by-side readings name a person the same way.
    var cells = [{ node: reportNameCell(r.name, personSlot(r.tags, tagKeyMap, tagSlotMap)), cls: "report-table__name" }];
    r.cells.forEach(function (v) { cells.push(reportShareCell(v)); });
    cells.push(reportShareCell(r.total, true));
    return { cells: cells };
  });
  var totalCells = [{ text: "Total", cls: "report-table__name" }];
  model.allocationByPerson.total.cells.forEach(function (v) { totalCells.push(reportShareCell(v)); });
  totalCells.push(reportShareCell(model.allocationByPerson.total.total, true));
  rows.push({ cells: totalCells, cls: "report-row--total" });
  var section = reportSection(reportViewLabel("allocation-by-person"),
    "Each person's FTE-days as a share of what they offer in the same stretch of time; above 100% is over-allocation.");
  section.appendChild(reportTable(headers, rows));
  section.appendChild(reportAbsencesNote());
  return section;
}

/* The by-tag view's head: which tags its rows are, as two named rows of chips.
 * The first row is every key the plan's tags carry, the second every tag the
 * view can draw a row for, keyless ones included. Both are multi-select and
 * both start empty. A tag's own chip is the truth; a key's chip is derived from
 * its tags - selected when all of them are, not selected otherwise - so the two
 * rows cannot disagree. A press on a key selects its whole set and a press on a
 * selected one clears it, which is the one rule the tag chips already follow
 * over a list of one. Every press is the same write: the whole set of tags
 * replaces the plan's, so the choice travels with the plan and resumes after a
 * reload - one write to /api/plan, one undo step, exactly as the holidays and
 * the tag colours are set. Nothing is ticked until the owner ticks it: no
 * stored selection means no table, rather than a guess at a taxonomy. */
function reportTagSplit() {
  var selected = tagSelection(data);
  var head = el("div", "report-taghead");

  // The chips live in one bounded, scrolling list: a plan with many tags makes
  // the tag row tall, and the table below has to stay exactly where it is.
  var list = el("div", "report-taghead__list");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "The tags the rows are");
  head.appendChild(list);

  // Created last so a refusal reads under the chips it belongs to, the way a
  // panel's refusal reads under its form.
  var error = errorLine(head);

  function save(next) {
    // The next tick is read against what this one leaves, not against the plan
    // the screen was drawn from, so two ticks landing inside one save cannot
    // drop the first one's tag.
    selected = next;
    error.clear();
    api("PATCH", "/api/plan", { tagSplit: { tags: next } })
      .then(function () { return refresh({ keepPanel: true }); })
      .catch(function (err) {
        error.set(err && err.message ? err.message : "Could not save the tags.");
      });
  }

  // Both rows are the TAGS column's chip, given a state and a press. A key
  // carries no colour of its own - the colours belong to its tags - so it shows
  // no swatch at all.
  function choice(tag, slot, on, name, onPress) {
    return reportTagChip(tag, slot, {
      state: on,
      name: name,
      onClick: function () { save(onPress()); }
    });
  }

  // A row is its name and its chips on one line, so naming the rows costs the
  // chooser no height: the name cannot wrap onto a line of its own, and the
  // chips wrap inside the box it leaves.
  function row(name, cls) {
    var line = el("div", "report-taghead__row");
    var label = el("span", "report-taghead__label");
    label.textContent = name;
    line.appendChild(label);
    var chips = el("div", "report-tags " + cls);
    line.appendChild(chips);
    list.appendChild(line);
    return chips;
  }

  var keys = tagKeyGroups(data);
  if (keys.length > 0) {
    var keysRow = row("Keys", "report-tags--keys");
    keys.forEach(function (group) {
      var state = tagKeyState(group.tags, selected);
      keysRow.appendChild(choice(group.key, null, state.all ? "on" : "off",
        "Select or clear all " + group.key + " tags",
        function () { return tagToggled(selected, group.tags); }));
    });
  }

  var tags = tagChoices(data);
  if (tags.length > 0) {
    var tagsRow = row("Tags", "report-tags--tags");
    tags.forEach(function (tag) {
      var slot = Object.prototype.hasOwnProperty.call(tagSlotMap, tag) ? tagSlotMap[tag] : null;
      tagsRow.appendChild(choice(tag, slot, selected.indexOf(tag) !== -1 ? "on" : "off",
        null, function () { return tagToggled(selected, [tag]); }));
    });
  }

  return head;
}

// FTE-days by tag: the tags the owner ticked in the head, then one residual row
// for everything else, so the rows reconcile with the plan total.
function reportTagSection(model) {
  var headers = [{ text: "Tag", cls: "report-table__name" }]
    .concat(reportBucketHeaders(model))
    .concat([
      { text: "Total", cls: REPORT_TOTAL_COL },
      { text: "Of plan", cls: "report-table__num" }
    ]);
  var split = model.byTagSplit;
  var section = reportSection(reportViewLabel("by-tag"),
    "The rows are the tags you tick; ticking a key ticks all of its tags at once, " +
    "and the tags you leave out are gathered under Other tags.");
  section.appendChild(reportTagSplit());

  if (!split) {
    // Nothing is ticked: the view says so rather than guessing at a taxonomy.
    section.appendChild(reportNothingSelected());
  } else {
    function cellsFor(r) {
      var cells = [{ node: reportNameCell(r.label, r.slot), cls: "report-table__name" }];
      r.cells.forEach(function (v) { cells.push(reportNumCell(v)); });
      cells.push(reportTotalCell(r.total));
      cells.push({ text: reportPercent(r.share), cls: "report-table__num" });
      return cells;
    }

    var rows = split.rows.map(function (r) { return { cells: cellsFor(r) }; });
    if (split.other) rows.push({ cells: cellsFor(split.other) });
    var totalCells = [{ text: "Total", cls: "report-table__name" }];
    model.byTag.total.cells.forEach(function (v) { totalCells.push(reportNumCell(v)); });
    totalCells.push(reportTotalCell(model.byTag.total.total));
    totalCells.push({ text: "100%", cls: "report-table__num" });
    rows.push({ cells: totalCells, cls: "report-row--total" });
    section.appendChild(reportTable(headers, rows));
  }
  section.appendChild(reportAbsencesNote());
  return section;
}

// The one line both tag views carry where nothing is ticked: they say so rather
// than guessing at a taxonomy. One choice stored in the plan, one sentence.
function reportNothingSelected() {
  var note = el("p", "report__note");
  note.textContent = "Nothing is selected yet - tick the tags the rows should split by.";
  return note;
}

// Allocation by tag: the FTE-days view's own rows - the tags ticked in the head
// and the Other tags residual - as a share of the capacity the whole plan offers
// in the same bucket, and of everything it offers over the period in the Total
// column. One denominator for every row, so the rows reconcile with the total
// row they sit under rather than with 100%, and no second percentage column sits
// beside it. Above 100% is a tag whose projects occupy more than the whole team
// together: the same over-allocation mark, decided on the same whole figure.
function reportAllocationTagSection(model) {
  var headers = [{ text: "Tag", cls: "report-table__name" }]
    .concat(reportBucketHeaders(model))
    .concat([{ text: "Total", cls: REPORT_TOTAL_COL }]);
  var split = model.allocationByTag;
  var section = reportSection(reportViewLabel("allocation-by-tag"),
    "Each tag's FTE-days as a share of the capacity the plan offers in the same " +
    "stretch of time; above 100% is over-allocation.");
  // The same chooser the FTE-days view draws, from the same stored selection, so
  // a tag ticked in either view is ticked in both.
  section.appendChild(reportTagSplit());

  if (!split) {
    section.appendChild(reportNothingSelected());
  } else {
    function cellsFor(r) {
      var cells = [{ node: reportNameCell(r.label, r.slot), cls: "report-table__name" }];
      r.cells.forEach(function (v) { cells.push(reportShareCell(v)); });
      cells.push(reportShareCell(r.total, true));
      return cells;
    }

    var rows = split.rows.map(function (r) { return { cells: cellsFor(r) }; });
    if (split.other) rows.push({ cells: cellsFor(split.other) });
    var totalCells = [{ text: "Total", cls: "report-table__name" }];
    split.total.cells.forEach(function (v) { totalCells.push(reportShareCell(v)); });
    totalCells.push(reportShareCell(split.total.total, true));
    rows.push({ cells: totalCells, cls: "report-row--total" });
    section.appendChild(reportTable(headers, rows));
  }
  section.appendChild(reportAbsencesNote());
  return section;
}

// Allocation against capacity: the line, per bucket, in the view's one card.
function reportAllocationSection(model) {
  var section = reportSection(reportViewLabel("allocation"),
    "What the plan offers each " + reportBucketWord() + ", against what is allocated.");
  var card = el("div", "report-chartcard");
  // The readout is drawn in the plot's corner, out of the reading order, so the
  // same words are announced here whenever they change.
  var live = el("p", "report-chart__live");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  card.appendChild(buildLineChart(model, live));
  card.appendChild(live);
  card.appendChild(reportLegend([
    { label: "Allocation", swatchClass: "report-legend__swatch--ink" },
    { label: "Capacity", swatchClass: "report-legend__swatch--band" }
  ]));
  section.appendChild(card);
  section.appendChild(reportAbsencesNote());
  return section;
}

function render(opts) {
  if (!data) return;
  var scrollLeft = scroller.scrollLeft;
  // A panel stays open across a redraw only when it asked to: the Sprints
  // panel rebuilds its own list and must not be closed by the refresh that
  // follows each edit.
  if (!(opts && opts.keepPanel)) closePanel(false);
  tl.innerHTML = "";
  // The plan's rail holds Projects and is emptied before its list is redrawn.
  // A report's rail holds views rather than Projects, so it has nothing here.
  if (stackList) stackList.innerHTML = "";
  indexData();
  contextEl.textContent = rangeLabel(data.range.start, data.range.end);
  syncSaveStatus();
  syncHistoryControls();
  syncZoomControls();
  updateTodayControl();

  // The report shares everything above - the period line, the save status, the
  // disabled grid controls, the zoom - and then draws its own content instead
  // of the grid.
  if (isReport) { renderReport(); return; }

  if (filterQuery.trim() !== "" && filterIsEmpty({
    people: gridPeople,
    projects: gridProjects,
    assignments: gridAssignments
  })) {
    tl.classList.add("is-empty");
    // An empty grid draws no axis, so it takes no milestone band either.
    root.classList.remove("is-milestones");
    tl.appendChild(buildEmptyState());
    drawStack();
    marker = null;
    scroller.scrollLeft = 0;
    syncStackToggle();
    syncMinimap();
    return;
  }
  tl.classList.remove("is-empty");
  tl.style.setProperty("--days", DAYS);
  // The milestone band is part of the axis, so the axis's own height has to
  // know whether it is there before the rows are laid out under it.
  root.classList.toggle("is-milestones", milestonesDrawn());

  var overlay = null;
  if (highlightWeekends) {
    overlay = el("div", "weekends");
    weekends().forEach(function (w) {
      overlay.appendChild(set(el("span", "weekend"), w.i, w.n));
    });
  }

  var rules = gridDividers ? buildRules() : null;
  var milestoneOverlay = milestonesDrawn() ? buildMilestoneRules() : null;

  var corner = el("div", "tl__corner");
  var cornerLabel = el("span", "tl__corner-label");
  cornerLabel.textContent = "People";
  corner.appendChild(cornerLabel);
  // The add action sits in the column header it belongs to. Its visible label
  // is the plus, so the accessible name carries the meaning.
  var addPerson = el("button", "add");
  addPerson.type = "button";
  addPerson.setAttribute("aria-label", "Add person");
  addPerson.setAttribute("title", "Add person");
  addPerson.textContent = "+";
  addPerson.addEventListener("click", function (e) {
    openPersonPanel(null, e.currentTarget);
  });
  corner.appendChild(addPerson);
  // The People column's sort control sits beside its title, beside the add
  // control, and is re-attached here because the corner is rebuilt each draw.
  if (peopleSortButton) corner.appendChild(peopleSortButton);

  var rows = drawRows();

  if (overlay) tl.appendChild(overlay);
  // After the weekend band and before the rows, at the same stacking level:
  // that is what puts a divider above the shading and behind the blocks.
  if (rules) tl.appendChild(rules);
  tl.appendChild(corner);
  tl.appendChild(drawAxis());
  tl.appendChild(rows.heads);
  tl.appendChild(rows.body);
  // The milestone rules follow the rows, so a rule paints over the block it
  // crosses. They also follow the dividers at the same stacking level, so a
  // date's own rule still paints over a grid divider it happens to share.
  if (milestoneOverlay) tl.appendChild(milestoneOverlay);
  if (markerVisible) {
    tl.appendChild(drawMarker());
  } else {
    // No line and no chip, so nothing on screen to drag or to press. The index
    // stays where it is, which is what keeps the figures reading today.
    marker = null;
    markerDate = null;
  }

  drawStack();

  markerIndex = clamp(markerIndex, 0, DAYS - 1);
  setMarker(markerIndex);

  scroller.scrollLeft = scrollLeft;
  drawBlockLabels();
  fitMilestoneAxis();
  syncStackToggle();
  syncMinimap();
  // A held copy outlives the redraw, so the tint and the ghost are put back
  // over the freshly drawn rows.
  updatePastePreview();
}

/* --- wiring -------------------------------------------------------------- */

function bindChrome() {
  // The add control is the rail's own, so the report has none to bind.
  var addBtn = document.getElementById("add-project");
  if (addBtn) {
    addBtn.addEventListener("click", function (e) {
      openProjectPanel(null, e.currentTarget);
    });
  }
  // The Today control returns the owner to now: it brings today back into the
  // middle of the view and puts the Marker back on today. When the set period
  // excludes today it is inert, and updateTodayControl announces that.
  var todayBtn = document.getElementById("today");
  if (todayBtn) {
    todayBtn.addEventListener("click", function () { goToToday(); });
  }
  // Undo and Redo step the server's history. Buttons only: no keyboard
  // shortcut is bound for either.
  if (undoBtn) undoBtn.addEventListener("click", undoPlan);
  if (redoBtn) redoBtn.addEventListener("click", redoPlan);
  panelLayer.addEventListener("pointerdown", function (e) {
    if (e.target === panelLayer) closePanel(true);
  });
  // Escape clears the Session clipboard for all three kinds, so a copy picked up
  // by mistake is abandoned the same way whatever it holds - and with it the
  // row's tint and the paste's ghost. It stands down when something nearer
  // claims the key, which is why it is registered before the panel's own: a
  // panel, the Options menu, a list inside a panel, and a drag already in flight
  // all keep the Escape they have, and only a second press reaches the clipboard.
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (panel || (optionsMenu && !optionsMenu.hidden)) return;
    if (root.classList.contains("is-dragging")) return;
    if (!clipboardKind(clipboard)) return;
    clipboard = null;
    updatePastePreview();
    e.preventDefault();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel) closePanel(true);
  });
  // Copy and paste what the pointer is over: a Project from a rail row, a
  // Person from a row header, an Assignment from a block. They stand down inside
  // text fields, so the browser's own keys are untouched there.
  document.addEventListener("keydown", onClipboardKey);
  // Delete removes the Assignment under the pointer, beside them.
  document.addEventListener("keydown", onDeleteKey);
  window.addEventListener("pointermove", onClipboardPointerMove);
  // A sideways scroll moves the grid's visible left edge, and with it which
  // paper labels the sticky column would cover, so the labels are re-decided
  // as the timeline scrolls.
  scroller.addEventListener("scroll", function () {
    if (panel) closePanel(false);
    queueBlockLabels();
    updateMinimapWindow();
  });

  // Everything a label's room is decided from: the window, a scale change
  // (whose block widths animate, so the pass runs again when they settle)
  // and the bundled font, which may arrive after the first paint. None of
  // them reloads the page.
  window.addEventListener("resize", repositionPopovers);
  var topbar = document.querySelector(".topbar");
  if (topbar) topbar.addEventListener("scroll", repositionPopovers);
  window.addEventListener("resize", function () {
    // The reader's text size can change here, which moves the row height at
    // which the row header's two lines stop fitting, and the axis label's own
    // width with it.
    applyRowHeight();
    queueBlockLabels();
    fitMilestoneAxis();
    updateMinimapWindow();
  });
  tl.addEventListener("transitionend", function (e) {
    if (e.propertyName === "width") queueBlockLabels();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { drawBlockLabels(); fitMilestoneAxis(); });
  }
}

/* --- filter control ------------------------------------------------------ */

var filterEl = null;
var filterInput = null;
var filterClear = null;
var filterScopeBtn = null;
var filterScopesEl = null;
var filterSuggestEl = null;
var suggestionList = [];
var suggestionIndex = -1;

function scopeSwitches() {
  return filterScopesEl.querySelectorAll("[data-scope]");
}

// The rest of the control follows the session's filter: the scope summary, the
// clear affordance and each switch's announced state.
function updateFilterChrome() {
  if (!filterEl) return;
  var term = parseFilterTerm(filterInput.value);
  // A typed term aims at one field, so the plain-term scope is still
  // described but visibly set aside while one is in the field.
  var overridden = term.kind === "field";
  // The button names the count; the full selection, and the note that a typed
  // term sets the scope aside, ride on the accessible label.
  filterScopeBtn.textContent = scopeLabel(filterScopes);
  filterScopeBtn.setAttribute("aria-label", overridden
    ? "Look in - " + scopeSummary(filterScopes) + ", ignored because a typed term names its own field"
    : "Look in - " + scopeSummary(filterScopes));
  filterScopeBtn.classList.toggle("is-overridden", overridden);
  filterClear.hidden = filterInput.value === "";
  scopeSwitches().forEach(function (btn) {
    var on = !!filterScopes[btn.getAttribute("data-scope")];
    btn.setAttribute("aria-checked", on ? "true" : "false");
  });
}

function hideSuggestions() {
  suggestionList = [];
  suggestionIndex = -1;
  filterSuggestEl.hidden = true;
  filterSuggestEl.innerHTML = "";
  filterInput.setAttribute("aria-expanded", "false");
  filterInput.removeAttribute("aria-activedescendant");
}

function highlightSuggestion() {
  var rows = filterSuggestEl.querySelectorAll(".filter__hit");
  for (var i = 0; i < rows.length; i++) {
    rows[i].classList.toggle("is-sel", i === suggestionIndex);
    rows[i].setAttribute("aria-selected", i === suggestionIndex ? "true" : "false");
  }
  var active = rows[suggestionIndex];
  if (active) {
    filterInput.setAttribute("aria-activedescendant", active.id);
    active.scrollIntoView({ block: "nearest" });
  } else {
    filterInput.removeAttribute("aria-activedescendant");
  }
}

function updateSuggestions() {
  if (!filterEl) return;
  var q = filterInput.value.trim();
  if (q === "") { hideSuggestions(); return; }
  // An untyped query leads with the broad search it would run, so the row that
  // names it comes first and the vocabulary it found follows.
  var found = filterSuggestions(data, q, filterScopes);
  var everywhere = searchEverywhereSuggestion(data, q, filterScopes);
  suggestionList = (everywhere ? [everywhere].concat(found) : found).slice(0, SUGGESTION_LIMIT);
  if (suggestionList.length === 0) { hideSuggestions(); return; }
  suggestionIndex = 0;
  filterSuggestEl.innerHTML = "";
  suggestionList.forEach(function (item, i) {
    var row = el("button", "filter__hit");
    row.type = "button";
    row.id = "filter-hit-" + i;
    row.setAttribute("role", "option");
    var src = el("span", "filter__src");
    src.textContent = item.source;
    var val = el("span", "filter__val");
    val.textContent = item.value;
    var n = el("span", "filter__n");
    n.textContent = item.matchLabel;
    row.appendChild(src);
    row.appendChild(val);
    row.appendChild(n);
    // Keep the input focused so the click lands and the dropdown stays put.
    row.addEventListener("mousedown", function (e) { e.preventDefault(); });
    row.addEventListener("click", function () { applySuggestion(item); });
    filterSuggestEl.appendChild(row);
  });
  filterSuggestEl.hidden = false;
  placePopover(filterSuggestEl, filterInput, "center");
  filterInput.setAttribute("aria-expanded", "true");
  highlightSuggestion();
}

function applySuggestion(item) {
  // A prefix is only a start: keep the caret in the field and offer the
  // field's own vocabulary. A value completes the term.
  filterInput.value = item.insert || item.value;
  filterQuery = filterInput.value;
  updateFilterChrome();
  if (item.kind === "prefix") {
    render();
    filterInput.focus();
    updateSuggestions();
    return;
  }
  hideSuggestions();
  render();
}

function clearFilter() {
  filterInput.value = "";
  filterQuery = "";
  hideSuggestions();
  updateFilterChrome();
  render();
  filterInput.focus();
}

function setScope(key, on) {
  filterScopes[key] = on;
  updateFilterChrome();
  updateSuggestions();
  render();
}

function openScopes(open) {
  if (open && optionsMenu && !optionsMenu.hidden) openOptions(false);
  if (open) closeSortMenus();
  filterScopesEl.hidden = !open;
  filterScopeBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    hideSuggestions();
    placePopover(filterScopesEl, filterScopeBtn, "right");
  }
}

function initFilter() {
  filterEl = document.getElementById("filter");
  filterInput = document.getElementById("filter-input");
  filterClear = document.getElementById("filter-clear");
  filterScopeBtn = document.getElementById("filter-scope");
  filterScopesEl = document.getElementById("filter-scopes");
  filterSuggestEl = document.getElementById("filter-suggest");
  if (!filterEl || !filterInput) return;

  // The carried-in Filter, if any, is already in filterQuery; show it.
  filterInput.value = filterQuery;
  filterInput.addEventListener("input", function () {
    filterQuery = filterInput.value;
    updateFilterChrome();
    updateSuggestions();
    render();
  });
  filterInput.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" && suggestionList.length) {
      suggestionIndex = Math.min(suggestionIndex + 1, suggestionList.length - 1);
      highlightSuggestion();
      e.preventDefault();
    } else if (e.key === "ArrowUp" && suggestionList.length) {
      suggestionIndex = Math.max(suggestionIndex - 1, 0);
      highlightSuggestion();
      e.preventDefault();
    } else if (e.key === "Enter" && suggestionIndex >= 0 && suggestionList[suggestionIndex]) {
      applySuggestion(suggestionList[suggestionIndex]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      if (!filterSuggestEl.hidden) hideSuggestions();
      else if (!filterScopesEl.hidden) openScopes(false);
      else clearFilter();
      e.preventDefault();
    } else if (e.key === "Tab") {
      hideSuggestions();
    }
  });
  filterInput.addEventListener("blur", function () {
    window.setTimeout(function () {
      if (!filterEl.contains(document.activeElement)) hideSuggestions();
    }, 0);
  });

  filterClear.addEventListener("click", function () { clearFilter(); });
  filterScopeBtn.addEventListener("click", function () {
    openScopes(filterScopesEl.hidden);
  });
  scopeSwitches().forEach(function (btn) {
    btn.addEventListener("click", function () {
      var key = btn.getAttribute("data-scope");
      setScope(key, !filterScopes[key]);
    });
  });

  document.addEventListener("pointerdown", function (e) {
    if (filterEl.contains(e.target)) return;
    if (!filterScopesEl.hidden) openScopes(false);
    hideSuggestions();
  });

  updateFilterChrome();
}

/* --- sort controls ------------------------------------------------------- */

// The sort control in each column's own header: a quiet icon button in the
// same style and hit area as the add control, opening a small menu of that
// list's keys and an ascending/descending toggle. It is a real button with an
// accessible name and state, and the menu is keyboard-operable. The two lists
// sort independently and the state is session-only.

var peopleSortButton = null;
var sortControls = {};
var SORT_LABELS = { projects: "projects", people: "people" };

var SORT_ICON =
  '<svg class="sort__glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor" ' +
  'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M5 12.5v-9M5 3.5 2.5 6M5 3.5 7.5 6"/>' +
  '<path d="M11 3.5v9M11 12.5 8.5 10M11 12.5 13.5 10"/></svg>';

function sortMenuItems(menu) {
  return Array.prototype.slice.call(menu.querySelectorAll(".sort__item:not([disabled])"));
}

function closeSortMenus() {
  Object.keys(sortControls).forEach(function (kind) {
    var c = sortControls[kind];
    if (!c) return;
    c.menu.hidden = true;
    c.button.setAttribute("aria-expanded", "false");
  });
}

function placeSortMenu(kind) {
  var c = sortControls[kind];
  if (!c || c.menu.hidden) return;
  placePopover(c.menu, c.button, "left");
}

function openSortMenu(kind, open, focusFirst) {
  var c = sortControls[kind];
  if (!c) return;
  if (open) {
    closeSortMenus();
    if (optionsMenu && !optionsMenu.hidden) openOptions(false);
    if (filterScopesEl && !filterScopesEl.hidden) openScopes(false);
    updateSortControl(kind);
  }
  c.menu.hidden = !open;
  c.button.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    placeSortMenu(kind);
    if (focusFirst) {
      var first = sortMenuItems(c.menu)[0];
      if (first) first.focus();
    }
  }
}

// The menu's own state: which key is in force, and the direction toggle. The
// trigger's accessible name carries the same thing, so the control states what
// it is doing rather than only that it exists.
function updateSortControl(kind) {
  var c = sortControls[kind];
  if (!c) return;
  var state = sortState[kind];
  var label = SORT_LABELS[kind];
  var name = "Sort " + label;
  if (state && findSortKey(kind, state.key)) {
    name += ", by " + findSortKey(kind, state.key).label + " " +
      directionLabel(state.direction).toLowerCase();
  }
  c.button.setAttribute("aria-label", name);
  c.button.setAttribute("title", name);
  sortKeys(kind).forEach(function (def) {
    c.keyButtons[def.key].setAttribute("aria-checked",
      state && state.key === def.key ? "true" : "false");
  });
  var descending = !!state && state.direction === DESCENDING;
  c.dirBtn.setAttribute("aria-checked", descending ? "true" : "false");
  c.dirBtn.disabled = !state;
  c.dirBtn.setAttribute("aria-disabled", state ? "false" : "true");
  c.dirLabel.textContent = directionLabel(state ? state.direction : ASCENDING);
}

function applySort(kind, state) {
  sortState[kind] = state;
  updateSortControl(kind);
  closeSortMenus();
  render();
  persistView();
  var c = sortControls[kind];
  if (c) c.button.focus();
}

function buildSortControl(kind) {
  var label = SORT_LABELS[kind];
  var button = el("button", "add sort__btn");
  button.type = "button";
  button.setAttribute("aria-haspopup", "true");
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", "Sort " + label);
  button.setAttribute("title", "Sort " + label);
  button.innerHTML = SORT_ICON;
  button.addEventListener("click", function () {
    openSortMenu(kind, sortControls[kind].menu.hidden, false);
  });
  button.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { openSortMenu(kind, true, true); e.preventDefault(); }
  });

  var menu = el("div", "sort__menu");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Sort " + label);
  menu.hidden = true;

  var keyButtons = {};
  sortKeys(kind).forEach(function (def) {
    var item = el("button", "sort__item");
    item.type = "button";
    item.setAttribute("role", "menuitemradio");
    item.setAttribute("aria-checked", "false");
    var tick = el("span", "sort__tick");
    tick.setAttribute("aria-hidden", "true");
    item.appendChild(tick);
    item.appendChild(document.createTextNode(def.label));
    item.addEventListener("click", function () {
      applySort(kind, selectSortKey(kind, sortState[kind], def.key));
    });
    keyButtons[def.key] = item;
    menu.appendChild(item);
  });

  var sep = el("div", "sort__sep");
  sep.setAttribute("role", "separator");
  menu.appendChild(sep);

  var dirBtn = el("button", "sort__item sort__item--direction");
  dirBtn.type = "button";
  dirBtn.setAttribute("role", "menuitemcheckbox");
  dirBtn.setAttribute("aria-checked", "false");
  var dirGlyph = el("span", "sort__dir");
  dirGlyph.setAttribute("aria-hidden", "true");
  dirGlyph.textContent = "\u2195";
  var dirLabel = el("span", "sort__dir-label");
  dirBtn.appendChild(dirGlyph);
  dirBtn.appendChild(dirLabel);
  dirBtn.addEventListener("click", function () {
    if (!sortState[kind]) return;
    applySort(kind, toggleSortDirection(sortState[kind]));
  });
  menu.appendChild(dirBtn);

  // The menu is fixed to the viewport and placed against its trigger, so the
  // Stack rail's own scroller can never clip it. It lives on the body rather
  // than in the rebuilt corner, so a redraw does not lose it.
  document.body.appendChild(menu);
  sortControls[kind] = {
    button: button, menu: menu, keyButtons: keyButtons, dirBtn: dirBtn, dirLabel: dirLabel
  };

  menu.addEventListener("keydown", function (e) {
    var items = sortMenuItems(menu);
    if (!items.length) return;
    var i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { items[(i + 1) % items.length].focus(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { items[(i - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    else if (e.key === "Home") { items[0].focus(); e.preventDefault(); }
    else if (e.key === "End") { items[items.length - 1].focus(); e.preventDefault(); }
    else if (e.key === "Escape") { closeSortMenus(); button.focus(); e.preventDefault(); }
  });

  updateSortControl(kind);
  return button;
}

function initSortControls() {
  // The sort is the grid's: it orders the Rail's Projects and the People
  // column. A report's rail lists views, and its pivots read the sort the plan
  // stored, so a report mounts no sort control at all.
  if (isReport) return;
  var stackHead = document.querySelector(".stack__head");
  if (stackHead) stackHead.appendChild(buildSortControl("projects"));
  peopleSortButton = buildSortControl("people");
  var corner = tl.querySelector(".tl__corner");
  if (corner) corner.appendChild(peopleSortButton);
  document.addEventListener("pointerdown", function (e) {
    var inside = Object.keys(sortControls).some(function (kind) {
      var c = sortControls[kind];
      return c && (c.menu.contains(e.target) || c.button.contains(e.target));
    });
    if (!inside) closeSortMenus();
  });
}

/* --- view state ---------------------------------------------------------- */

// The view settings in the shape public/lib/view.mjs owns, read from the
// interface's own state, which every setter keeps in step.
function currentView() {
  return {
    zoom: root.getAttribute("data-zoom"),
    reportZoom: reportZoom,
    reportView: reportView,
    rowHeight: rowHeight,
    gridSpacing: {
      day: gridSpacing.day,
      week: gridSpacing.week,
      sprint: gridSpacing.sprint,
      month: gridSpacing.month
    },
    weekends: highlightWeekends,
    holidays: highlightHolidays,
    milestones: milestoneRules,
    availabilityLines: availabilityLines,
    assignments: assignmentsVisible,
    dividers: gridDividers,
    minimap: minimapEnabled,
    marker: markerVisible,
    palette: activePalette,
    blockLabel: blockLabelSetting,
    stackCollapsed: stackCollapsed,
    sort: { projects: sortState.projects, people: sortState.people }
  };
}

// Put a stored view into the interface's own state, normalising it first so a
// malformed key falls back on its own. Only the state the next draw reads is
// set here; the caller redraws. The Filter is deliberately not part of the
// view, and neither is the Marker's date - only whether it is drawn.
function adoptView(view) {
  var v = normalizeView(view);
  activePalette = v.palette;
  root.setAttribute("data-palette", v.palette);
  root.setAttribute("data-zoom", v.zoom);
  // The run's own zoom level, kept beside the grid's. A report page draws it
  // as its buckets; the grid page only stores it back unchanged.
  reportZoom = v.reportZoom;
  // The report's selected view, kept beside its zoom; the grid page only
  // stores it back unchanged.
  reportView = v.reportView;
  rowHeight = v.rowHeight;
  gridSpacing = Object.assign({}, v.gridSpacing);
  highlightWeekends = v.weekends;
  highlightHolidays = v.holidays;
  milestoneRules = v.milestones;
  availabilityLines = v.availabilityLines;
  assignmentsVisible = v.assignments;
  gridDividers = v.dividers;
  minimapEnabled = v.minimap;
  markerVisible = v.marker;
  blockLabelSetting = v.blockLabel;
  stackCollapsed = v.stackCollapsed;
  sortState = { projects: v.sort.projects, people: v.sort.people };
  // Apply the stored width now, before the caller's first draw, so a spacing
  // other than the stylesheet's default is what the first paint shows.
  applyGridSpacing();
  return v;
}

// Store the whole view whenever the owner changes a setting, so the config
// always holds one consistent snapshot. Writes are serialised in the order the
// changes were made: the view is sent whole, so two writes that overlap on the
// wire could otherwise land out of order and leave the config holding an
// earlier state - which a press-and-press-again stepper makes likely. A failed
// write is reported and the change simply does not survive a reload.
var viewWrite = Promise.resolve();
function persistView() {
  var view = currentView();
  viewWrite = viewWrite.then(function () {
    return api("POST", "/api/view", view).catch(showError);
  });
}

// Reset view: every view setting back to the default the app ships with, in
// one action. The plan path and the Filter are deliberately left alone, and so
// is the Marker's date - only its visibility is a view setting - which is why
// the owner named it Reset view rather than Reset config.
function resetView() {
  adoptView(VIEW_DEFAULTS);
  applyZoom(root.getAttribute("data-zoom"));
  applyRowHeight();
  updateOptionsMenu();
  updatePaletteMenu();
  updateBlockLabelMenu();
  updateSortControl("projects");
  updateSortControl("people");
  render();
  persistView();
  openOptions(false);
  if (optionsBtn) optionsBtn.focus();
}

/* --- options menu -------------------------------------------------------- */

var optionsEl = null;
var optionsBtn = null;
var optionsMenu = null;
var optionButtons = {};
var paletteButtons = {};
var blockLabelButtons = {};
var disclosureRows = {};
var openDisclosureKey = null;
var rangeStartInput = null;
var rangeEndInput = null;
var rangeError = null;
var stepInput = null;
var stepError = null;
var sprintsOptionDetail = null;
var holidaysOptionDetail = null;
var tagsOptionDetail = null;
var milestonesOptionDetail = null;
var planFileState = null;
var planFileOptionDetail = null;
var adoState = null;
var adoOptionDetail = null;

// The rows a divider sits above, set from options.mjs' grouping rule as the
// menu is built; every row builder asks it through optionRowClass, so no row
// is set off merely because it is an action.
var optionGroupDividers = [];

function optionRowClass(key) {
  return optionGroupDividers.indexOf(key) === -1 ? "options__item" : "options__item options__item--group";
}

// Every popover in the bar is fixed to the viewport and placed against its
// trigger. The bar can scroll on its own when the window is narrow, so this
// keeps a popover out of that scroller - it is never clipped by it and never
// adds to the page's own width.
function placePopover(node, trigger, align) {
  var r = trigger.getBoundingClientRect();
  var vw = document.documentElement.clientWidth;
  var vh = document.documentElement.clientHeight;
  var w = node.offsetWidth;
  var h = node.offsetHeight;
  var left = align === "center" ? r.left + r.width / 2 - w / 2
    : align === "left" ? r.left : r.right - w;
  left = Math.min(Math.max(8, left), Math.max(8, vw - w - 8));
  var top = r.bottom + 8;
  if (top + h > vh - 8) top = Math.max(8, r.top - h - 8);
  node.style.left = left + "px";
  node.style.top = top + "px";
}

function repositionPopovers() {
  if (optionsMenu && !optionsMenu.hidden) placePopover(optionsMenu, optionsBtn, "right");
  if (filterScopesEl && !filterScopesEl.hidden) placePopover(filterScopesEl, filterScopeBtn, "right");
  if (filterSuggestEl && !filterSuggestEl.hidden) placePopover(filterSuggestEl, filterInput, "center");
  Object.keys(sortControls).forEach(function (kind) { placeSortMenu(kind); });
}

// What each item does. The list and its checks come from optionsItems; adding
// a future infrequent control is one entry there and one handler here.
var OPTION_ACTIONS = {
  archived: function () { setShowArchived(!showArchived); },
  weekends: function () { setHighlightWeekends(!highlightWeekends); },
  holidays: function () { setHighlightHolidays(!highlightHolidays); },
  milestones: function () { setMilestoneRules(!milestoneRules); },
  availabilityLines: function () { setAvailabilityLines(!availabilityLines); },
  assignments: function () { setAssignmentsVisible(!assignmentsVisible); },
  dividers: function () { setGridDividers(!gridDividers); },
  minimap: function () { setMinimapEnabled(!minimapEnabled); },
  marker: function () { setMarkerVisible(!markerVisible); }
};

function setShowArchived(on) {
  showArchived = on;
  updateOptionsMenu();
  refresh().catch(showError);
}

// Turning the weekend band or the dividers on or off is a view change, not a
// plan change: it updates the menu, redraws, and stores the new view. The plan
// file is untouched.
function setHighlightWeekends(on) {
  highlightWeekends = on;
  updateOptionsMenu();
  render();
  persistView();
}

// The holiday band is a view change in the same shape: it updates the menu,
// redraws, and stores the new view. The plan file is untouched.
function setHighlightHolidays(on) {
  highlightHolidays = on;
  updateOptionsMenu();
  render();
  persistView();
}

// The milestone rules are a view change in the same shape: they update the
// menu, redraw, and store the new view. The plan file is untouched.
function setMilestoneRules(on) {
  milestoneRules = on;
  updateOptionsMenu();
  render();
  persistView();
}

// The availability lines are a view change in the same shape: they update the
// menu, redraw the rows, and store the new view. The plan file is untouched and
// no figure moves - a hidden line is a hidden mark, not a hidden measurement.
function setAvailabilityLines(on) {
  availabilityLines = on === true;
  updateOptionsMenu();
  render();
  persistView();
}

// The assignment blocks are a view change in the same shape: they update the
// menu, redraw the rows, and store the new view. The plan file is untouched and
// no figure moves - hidden blocks are hidden drawing, not hidden work, so the
// People column's figures and the Marker's totals are the same either way.
function setAssignmentsVisible(on) {
  assignmentsVisible = on === true;
  updateOptionsMenu();
  render();
  persistView();
}

function setGridDividers(on) {
  gridDividers = on;
  updateOptionsMenu();
  render();
  persistView();
}

// The Minimap toggle is a view change, not a plan change: it shows or hides
// the strip, redraws it from the current Filter, and stores the new view. The
// plan file is untouched.
function setMinimapEnabled(on) {
  minimapEnabled = on === true;
  updateOptionsMenu();
  syncMinimap();
  persistView();
}

// The Marker's visibility is a view change in the same shape: it draws or
// removes the line and its date chip, and stores the new view. The Marker's
// date is not a view setting, so the figures go on reading the day it sits on
// whether or not the line is drawn.
function setMarkerVisible(on) {
  markerVisible = on === true;
  updateOptionsMenu();
  render();
  persistView();
}

function updateOptionsMenu() {
  optionsItems(showArchived, highlightWeekends, gridDividers, minimapEnabled, highlightHolidays, milestoneRules, markerVisible, availabilityLines, assignmentsVisible).forEach(function (item) {
    var btn = optionButtons[item.key];
    if (btn) btn.setAttribute("aria-checked", item.checked ? "true" : "false");
  });
}

// The Colour palette is a single choice between two schemes. Both items are
// checkable; exactly one is checked, and the tick and aria-checked state it.
function updatePaletteMenu() {
  setDisclosureDetail("palette", paletteControl(activePalette).detail);
  paletteItems(activePalette).forEach(function (item) {
    var btn = paletteButtons[item.key];
    if (btn) btn.setAttribute("aria-checked", item.checked ? "true" : "false");
  });
}

// The Block label is a single choice between three settings. All three items
// are checkable; exactly one is checked, and the tick and aria-checked state
// it. The closed row states the setting in force beside its label.
function updateBlockLabelMenu() {
  setDisclosureDetail("blockLabel", blockLabelControl(blockLabelSetting).detail);
  blockLabelItems(blockLabelSetting).forEach(function (item) {
    var btn = blockLabelButtons[item.key];
    if (btn) btn.setAttribute("aria-checked", item.checked ? "true" : "false");
  });
}

// Switching what a block's label names is a view change, not a plan change: the
// blocks are rebuilt with the new label and the view is stored. The plan file is
// untouched. The menu's items and the agent tool both take an explicit setting.
function setBlockLabel(setting) {
  if (!isBlockLabel(setting) || setting === blockLabelSetting) return;
  blockLabelSetting = setting;
  updateBlockLabelMenu();
  render();
  persistView();
}

// Switching palette is a view change, not a plan change: it sets the root's
// data-palette (which swaps the --proj-* fills), redraws and stores the new
// view. The plan file is untouched.
function setPalette(name) {
  if (!isPalette(name) || name === activePalette) return;
  activePalette = name;
  root.setAttribute("data-palette", name);
  updatePaletteMenu();
  render();
  persistView();
}

// The palette is one of the stored view settings, adopted before the first
// draw; this only puts it on the root for the CSS to read.
function initPalette() {
  root.setAttribute("data-palette", activePalette);
}

function buildOptionsMenu() {
  optionsMenu.innerHTML = "";
  var items = optionsItems(showArchived, highlightWeekends, gridDividers, minimapEnabled, highlightHolidays, milestoneRules, markerVisible, availabilityLines, assignmentsVisible);
  optionGroupDividers = optionDividerKeys(items);
  // Help opens the menu, in the first group of its own; then the view group.
  optionsMenu.appendChild(buildHelpItem());
  // Show archived is drawn after the view group rather than in this pass: it
  // is a group of its own, because it decides which records are included
  // rather than how they are drawn. optionGroups states that shape.
  items.forEach(function (item) {
    if (item.key === "archived") return;
    optionsMenu.appendChild(buildOptionToggle(item));
  });
  buildDisclosureRow(paletteControl(activePalette), buildPaletteControl());
  buildDisclosureRow(blockLabelControl(blockLabelSetting), buildBlockLabelControl());
  optionsMenu.appendChild(buildResetViewItem());
  var archivedItem = items.filter(function (item) { return item.key === "archived"; })[0];
  optionsMenu.appendChild(buildOptionToggle(archivedItem));
  buildDisclosureRow(rangeControl(data && data.range), buildRangeControl());
  buildDisclosureRow(stepControl(data && data.step), buildStepControl());
  optionsMenu.appendChild(buildSprintsItem());
  optionsMenu.appendChild(buildHolidaysItem());
  optionsMenu.appendChild(buildTagsItem());
  optionsMenu.appendChild(buildMilestonesItem());
  optionsMenu.appendChild(buildPlanFileItem());
  optionsMenu.appendChild(buildAdoItem());
}

// One checkable row: a tick, a label and what it does. updateOptionsMenu reads
// the same items back to keep each row's aria-checked state in step.
function buildOptionToggle(item) {
  var btn = el("button", optionRowClass(item.key));
  btn.type = "button";
  btn.id = "option-" + item.key;
  btn.setAttribute("role", "menuitemcheckbox");
  btn.setAttribute("aria-checked", item.checked ? "true" : "false");
  var tick = el("span", "options__tick");
  tick.setAttribute("aria-hidden", "true");
  btn.appendChild(tick);
  btn.appendChild(document.createTextNode(item.label));
  btn.addEventListener("click", function () {
    var action = OPTION_ACTIONS[item.key];
    if (action) action();
  });
  optionButtons[item.key] = btn;
  return btn;
}

/* A disclosure row: a label and the value it currently holds, opening its own
 * control in place rather than in a popup. One row is open at a time, and the
 * value line stays visible on the open row so it keeps its meaning. */
function buildDisclosureRow(item, panel) {
  var btn = el("button", optionRowClass(item.key) + " options__item--disclosure");
  btn.type = "button";
  btn.id = "option-" + item.key;
  btn.setAttribute("role", "menuitem");
  btn.setAttribute("aria-expanded", "false");
  btn.appendChild(document.createTextNode(item.label));
  var detail = el("span", "options__item-detail");
  detail.textContent = item.detail;
  btn.appendChild(detail);
  var chevron = el("span", "options__chevron");
  chevron.setAttribute("aria-hidden", "true");
  btn.appendChild(chevron);
  btn.addEventListener("click", function () { toggleDisclosure(item.key); });
  panel.hidden = true;
  disclosureRows[item.key] = { btn: btn, detail: detail, panel: panel };
  optionsMenu.appendChild(btn);
  optionsMenu.appendChild(panel);
}

// One disclosure at a time: opening another closes the first, so the menu
// never grows long.
function toggleDisclosure(key) {
  var wasOpen = openDisclosureKey === key;
  closeDisclosure();
  var row = disclosureRows[key];
  if (wasOpen || !row) return;
  openDisclosureKey = key;
  row.btn.setAttribute("aria-expanded", "true");
  row.panel.hidden = false;
}

function closeDisclosure() {
  var row = disclosureRows[openDisclosureKey];
  if (row) {
    row.btn.setAttribute("aria-expanded", "false");
    row.panel.hidden = true;
  }
  openDisclosureKey = null;
}

function setDisclosureDetail(key, text) {
  var row = disclosureRows[key];
  if (row) row.detail.textContent = text;
}

/* The Reset view entry: an action, not a toggle. It returns every view
 * setting to its default in one press and leaves the plan path, the Filter and
 * the Marker's date alone. */
function buildResetViewItem() {
  var btn = el("button", optionRowClass("reset-view") + " options__item--action");
  btn.type = "button";
  btn.id = "option-reset-view";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode("Reset view"));
  btn.addEventListener("click", function () { resetView(); });
  return btn;
}

/* The Help entry: an action, not a toggle, and the menu's first row. It opens
 * the help panel over the board, as the four panel entries below it do. */
function buildHelpItem() {
  var item = helpItem();
  var btn = el("button", optionRowClass(item.key) + " options__item--action");
  btn.type = "button";
  btn.id = "option-help";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  btn.addEventListener("click", function () {
    openOptions(false);
    openHelpPanel(btn);
  });
  return btn;
}

/* The Sprints entry: an action, not a toggle. It opens the Sprints panel and
 * its detail counts the sprints that panel lists. */
function buildSprintsItem() {
  var item = sprintsItem(sprintCadence, data.sprints, data.range);
  var btn = el("button", optionRowClass(item.key) + " options__item--action");
  btn.type = "button";
  btn.id = "option-sprints";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  sprintsOptionDetail = el("span", "options__item-detail");
  sprintsOptionDetail.textContent = item.detail;
  btn.appendChild(sprintsOptionDetail);
  btn.addEventListener("click", function () {
    openOptions(false);
    openSprintsPanel(btn);
  });
  return btn;
}

function updateSprintsItem() {
  if (!sprintsOptionDetail) return;
  sprintsOptionDetail.textContent = sprintsItem(sprintCadence, data.sprints, data.range).detail;
}

/* The Holidays entry: an action, not a toggle. It opens the Holidays panel and
 * its detail counts the dates already configured. */
function buildHolidaysItem() {
  var item = holidaysItem(data && data.holidays);
  var btn = el("button", optionRowClass(item.key) + " options__item--action");
  btn.type = "button";
  btn.id = "option-holidays-panel";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  holidaysOptionDetail = el("span", "options__item-detail");
  holidaysOptionDetail.textContent = item.detail;
  btn.appendChild(holidaysOptionDetail);
  btn.addEventListener("click", function () {
    openOptions(false);
    openHolidaysPanel(btn);
  });
  return btn;
}

function updateHolidaysItem() {
  if (!holidaysOptionDetail) return;
  holidaysOptionDetail.textContent = holidaysItem(data && data.holidays).detail;
}

/* The Tags entry: an action, not a toggle. It opens the Tags panel, where the
 * colour-by-key choices and the value colours are set, and its detail states
 * what the panel holds. */
function buildTagsItem() {
  var item = tagsItem(data && data.tagColours);
  var btn = el("button", optionRowClass(item.key) + " options__item--action");
  btn.type = "button";
  btn.id = "option-tags";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  tagsOptionDetail = el("span", "options__item-detail");
  tagsOptionDetail.textContent = item.detail;
  btn.appendChild(tagsOptionDetail);
  btn.addEventListener("click", function () {
    openOptions(false);
    openTagsPanel(btn);
  });
  return btn;
}

function updateTagsItem() {
  if (!tagsOptionDetail) return;
  tagsOptionDetail.textContent = tagsItem(data && data.tagColours).detail;
}

/* The Milestones entry: an action, not a toggle. It opens the Milestones panel,
 * where the plan's dated points are listed and edited, and its detail counts
 * them so a plan carrying milestones is not silent about them. */
function buildMilestonesItem() {
  var item = milestonesItem(data && data.milestones);
  var btn = el("button", optionRowClass("milestones") + " options__item--action");
  btn.type = "button";
  btn.id = "option-milestones-panel";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  milestonesOptionDetail = el("span", "options__item-detail");
  milestonesOptionDetail.textContent = item.detail;
  btn.appendChild(milestonesOptionDetail);
  btn.addEventListener("click", function () {
    openOptions(false);
    openMilestonesPanel(btn);
  });
  return btn;
}

function updateMilestonesItem() {
  if (!milestonesOptionDetail) return;
  milestonesOptionDetail.textContent = milestonesItem(data && data.milestones).detail;
}

/* The Plan file entry: an action, not a toggle. It opens the Plan file panel
 * and its detail names the active file, or says PACT_DATA fixes it. */
function buildPlanFileItem() {
  var item = planFileItem(planFileState);
  var btn = el("button", optionRowClass(item.key) + " options__item--action");
  btn.type = "button";
  btn.id = "option-plan-file";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  planFileOptionDetail = el("span", "options__item-detail");
  planFileOptionDetail.textContent = item.detail;
  btn.appendChild(planFileOptionDetail);
  btn.addEventListener("click", function () {
    openOptions(false);
    openPlanFilePanel(btn);
  });
  return btn;
}

function updatePlanFileItem() {
  if (!planFileOptionDetail) return;
  planFileOptionDetail.textContent = planFileItem(planFileState).detail;
}

/* The ADO entry: an action, not a toggle. It opens the Azure DevOps panel, and
 * its detail says whether a mapping is configured and which ADO project it
 * names. It is always in the menu, because the connection is set up from its
 * panel rather than from a control that only appears once one exists. */
function buildAdoItem() {
  var item = adoItem(adoState && adoState.mapping);
  var btn = el("button", optionRowClass(item.key) + " options__item--action");
  btn.type = "button";
  btn.id = "option-ado";
  btn.setAttribute("role", "menuitem");
  btn.appendChild(document.createTextNode(item.label));
  adoOptionDetail = el("span", "options__item-detail");
  adoOptionDetail.textContent = item.detail;
  btn.appendChild(adoOptionDetail);
  btn.addEventListener("click", function () {
    openOptions(false);
    openAdoPanel(btn);
  });
  return btn;
}

function updateAdoItem() {
  if (!adoOptionDetail) return;
  adoOptionDetail.textContent = adoItem(adoState && adoState.mapping).detail;
}

// The connection's state is the server's to know: the menu and the panel read
// it back rather than keeping a copy that another tab or an Undo could stale.
function loadAdoState() {
  return api("GET", "/api/ado").then(function (state) {
    adoState = state;
    updateAdoItem();
    return state;
  }).catch(function () {
    return adoState;
  });
}

// The active file is the server's to know: the menu and the panel read it back
// rather than keeping a copy that a restart or another window could stale.
function loadPlanFileState() {
  return api("GET", "/api/plan-file").then(function (state) {
    planFileState = state;
    updatePlanFileItem();
    return state;
  }).catch(function () {
    return planFileState;
  });
}

/* The Plan file panel: the active file's resolved path, a field to type
 * another, Open, and New plan. Opening an existing file reloads it and reports
 * the exact resolved path; a refusal names the plain reason and leaves the
 * running plan alone. PACT_DATA is stated rather than looking broken. */
function openPlanFilePanel(trigger) {
  loadPlanFileState().then(function (loaded) {
    var view = planFileView(loaded);
    var node = panelShell("Plan file",
      "The one file PACT reads and writes. Every change is saved to it.");
    node.classList.add("panel--planfile");

    var form = el("form", "form");
    var current = el("code", "planfile__path");
    current.textContent = view.path;
    form.appendChild(formRow("Current", current));

    var pathInput = document.createElement("input");
    pathInput.type = "text";
    pathInput.className = "planfile__input";
    pathInput.id = "planfile-path";
    pathInput.value = view.path;
    pathInput.spellcheck = false;
    pathInput.setAttribute("aria-label", "Plan file path");
    form.appendChild(formRow("Path", pathInput));
    node.appendChild(form);

    var status = el("p", "planfile__status");
    status.setAttribute("role", "status");
    status.hidden = true;
    node.appendChild(status);

    var hint = el("p", "panel__sub planfile__hint");
    node.appendChild(hint);

    var error = errorLine(node);

    // The offer to create, shown only after a missing-file refusal so a plan is
    // never created silently.
    var offerBtn = button("btn-ghost", "Create it there", function () {
      offerBtn.hidden = true;
      doNew();
    });
    offerBtn.hidden = true;
    node.appendChild(offerBtn);

    var foot = el("div", "panel__foot");
    var openBtn = button("btn-primary", "Open", doOpen);
    var newBtn = button("btn-ghost", "New plan", doNew);
    foot.appendChild(openBtn);
    foot.appendChild(newBtn);
    foot.appendChild(el("span", "panel__spacer"));
    foot.appendChild(button("btn-ghost", "Close", function () { closePanel(true); }));
    node.appendChild(foot);

    function setStatus(message) {
      status.textContent = message || "";
      status.hidden = !message;
    }

    // A new plan is offered under .pact.json; an existing file opens as typed.
    function updateHint() {
      var raw = pathInput.value.trim();
      var suggested = raw ? withPlanSuffix(raw) : "";
      hint.textContent = raw && suggested !== raw
        ? "New plan is created empty at " + suggested + "."
        : "New plan is created empty - no people, no projects.";
    }

    function showPath(resolved) {
      current.textContent = resolved;
      pathInput.value = resolved;
      updateHint();
    }

    function succeeded(result) {
      error.clear();
      offerBtn.hidden = true;
      showPath(result.path);
      setStatus("Opened " + result.path);
      planFileState = result;
      updatePlanFileItem();
      return refresh({ keepPanel: true }).then(function () {
        // The mapping travels with the plan, so a switched file may have one
        // where the previous plan did not.
        return loadAdoState();
      });
    }

    function failed(err, missing) {
      setStatus("");
      offerBtn.hidden = !missing;
      error.set(err && err.message ? err.message : "Could not use that plan file.");
    }

    function doOpen() {
      error.clear();
      if (pathInput.value.trim() === "") { error.set("Enter the path to a plan file."); return; }
      openBtn.disabled = true;
      api("POST", "/api/plan-file/open", { path: pathInput.value.trim() })
        .then(succeeded)
        .catch(function (err) {
          var message = err && err.message ? err.message : "";
          failed(err, /^no plan file at /.test(message));
        })
        .then(function () { openBtn.disabled = false; });
    }

    function doNew() {
      error.clear();
      var raw = pathInput.value.trim();
      if (raw === "") { error.set("Enter a path for the new plan."); return; }
      newBtn.disabled = true;
      api("POST", "/api/plan-file/new", { path: withPlanSuffix(raw) })
        .then(succeeded)
        .catch(function (err) { failed(err, false); })
        .then(function () { newBtn.disabled = false; });
    }

    pathInput.addEventListener("input", updateHint);
    form.addEventListener("submit", function (e) { e.preventDefault(); doOpen(); });
    updateHint();
    if (view.notice) setStatus(view.notice);

    if (view.locked) {
      pathInput.disabled = true;
      openBtn.disabled = true;
      newBtn.disabled = true;
      setStatus(view.lockMessage);
    }

    openPanel(node, trigger);
    if (!view.locked) pathInput.focus();
  });
}

/* --- the Azure DevOps panel ---------------------------------------------- */

/*
 * The connection PACT uses for Azure DevOps. The organisation address and the
 * project are written into the plan, the three type slots are chosen from the
 * types the instance itself reports, and the token is typed here and written by
 * the server to this machine's config - it is never read back into the browser.
 *
 * Every call to ADO is caused by a press: opening this panel (which loads the
 * types once, because the slots are chosen from them), Test connection, and
 * Save mapping. There is no status light, no timer and no polling - closing the
 * panel is the end of it, even when ADO is unreachable.
 */
function openAdoPanel(trigger) {
  loadAdoState().then(function (state) {
    var mapping = state.mapping || {};
    var token = state.token || {};
    var instance = null;

    var node = panelShell("Azure DevOps",
      "The plan carries the mapping, this machine's config carries the token, and the browser never sees it.");
    node.classList.add("panel--ado");

    var form = el("form", "form");
    var orgInput = input(mapping.organizationUrl || "");
    orgInput.id = "ado-org";
    orgInput.spellcheck = false;
    orgInput.setAttribute("aria-label", "Organisation address");
    form.appendChild(formRow("Organisation", orgInput));
    var projectInput = input(mapping.project || "");
    projectInput.id = "ado-project";
    projectInput.spellcheck = false;
    projectInput.setAttribute("aria-label", "ADO project");
    form.appendChild(formRow("Project", projectInput));

    // The three slots. The Project and Assignment slots are backlog levels the
    // instance ranks, so they are offered from those; the Tag slot may be any
    // type the instance reports, or nothing at all.
    var projectLevel = typeSelect();
    projectLevel.id = "ado-project-level";
    fillTypeSelect(projectLevel, [], mapping.projectLevel);
    form.appendChild(formRow("Project type", projectLevel));
    var assignmentLevel = typeSelect();
    assignmentLevel.id = "ado-assignment-level";
    fillTypeSelect(assignmentLevel, [], mapping.assignmentLevel);
    form.appendChild(formRow("Assignment type", assignmentLevel));
    var tagLevel = typeSelect();
    tagLevel.id = "ado-tag-level";
    fillTypeSelect(tagLevel, [], mapping.tagLevel || "", { allowNone: true });
    form.appendChild(formRow("Tag type", tagLevel));

    // The token: typed, saved and replaced here, and never shown again. Clear
    // deletes the file, so a revoked token leaves nothing behind.
    var tokenInput = document.createElement("input");
    tokenInput.type = "password";
    tokenInput.id = "ado-token";
    tokenInput.autocomplete = "off";
    tokenInput.spellcheck = false;
    tokenInput.setAttribute("aria-label", "Personal access token");
    var tokenWrap = el("div", "ado__token");
    tokenWrap.appendChild(tokenInput);
    var tokenButton = button("btn-ghost", token.present ? "Replace token" : "Save token", onTokenButton);
    tokenButton.id = "ado-token-save";
    tokenWrap.appendChild(tokenButton);
    var clearButton = button("btn-ghost", "Clear token", clearToken);
    clearButton.id = "ado-token-clear";
    tokenWrap.appendChild(clearButton);
    form.appendChild(formRow("Token", tokenWrap));
    node.appendChild(form);

    var tokenStateLine = el("p", "panel__sub ado__tokenstate");
    tokenStateLine.textContent = tokenNotice(token);
    node.appendChild(tokenStateLine);

    // A token that is set is shown as set, not as a masked field that invites
    // an edit: the field appears only when Replace is pressed, and the server
    // never sends the stored value back to fill it.
    var replacing = false;

    function syncTokenControls() {
      tokenInput.hidden = token.present && !replacing;
      tokenButton.textContent = token.present && !replacing ? "Replace token" : "Save token";
      clearButton.hidden = !token.present;
    }

    function onTokenButton() {
      if (token.present && !replacing) {
        replacing = true;
        syncTokenControls();
        tokenInput.focus();
        return;
      }
      saveToken();
    }

    syncTokenControls();

    var status = el("p", "ado__status");
    status.setAttribute("role", "status");
    status.hidden = true;
    node.appendChild(status);

    var error = errorLine(node);

    var foot = el("div", "panel__foot");
    var testButton = button("btn-ghost", "Test connection", runTest);
    testButton.id = "ado-test";
    foot.appendChild(testButton);
    foot.appendChild(el("span", "panel__spacer"));
    var saveButtonEl = saveButton("Save mapping", saveMapping);
    saveButtonEl.id = "ado-save";
    saveButtonEl.disabled = true;
    foot.appendChild(saveButtonEl);
    node.appendChild(foot);

    function setStatus(message) {
      status.textContent = message || "";
      status.hidden = !message;
    }

    function errorText(err, fallback) {
      return err && err.message ? err.message : fallback;
    }

    // The server's answer to a token action is the whole connection state, so
    // the menu's detail and the token line move together.
    function applyState(next) {
      if (!next) return;
      adoState = next;
      updateAdoItem();
      token = next.token || {};
      tokenStateLine.textContent = tokenNotice(token);
      replacing = false;
      syncTokenControls();
    }

    function currentOr(select, fallback) {
      return select.value !== "" ? select.value : (fallback || "");
    }

    function applyInstance(result) {
      instance = result;
      var ranked = (result.types || []).map(function (type) { return type.name; });
      fillTypeSelect(projectLevel, ranked, currentOr(projectLevel, mapping.projectLevel));
      fillTypeSelect(assignmentLevel, ranked, currentOr(assignmentLevel, mapping.assignmentLevel));
      fillTypeSelect(tagLevel, result.reported || [], currentOr(tagLevel, mapping.tagLevel || ""), { allowNone: true });
      saveButtonEl.disabled = false;
    }

    function runTest() {
      var payload = {
        organizationUrl: orgInput.value.trim(),
        project: projectInput.value.trim()
      };
      var refusals = addressRefusals(payload);
      if (refusals.length) {
        error.set(refusals.join(" "));
        return;
      }
      error.clear();
      setStatus("Testing...");
      testButton.disabled = true;
      api("POST", "/api/ado/test", payload).then(function (result) {
        applyInstance(result);
        var ranks = (result.types || []).map(function (type) { return type.name + " " + type.rank; });
        setStatus("Connected to " + result.project.name + " (" + result.team + "): " + ranks.join(", ") + ".");
      }).catch(function (err) {
        instance = null;
        saveButtonEl.disabled = true;
        setStatus("");
        error.set(errorText(err, "Could not reach Azure DevOps."));
      }).then(function () { testButton.disabled = false; });
    }

    function saveMapping() {
      var payload = {
        organizationUrl: orgInput.value.trim(),
        project: projectInput.value.trim(),
        projectLevel: projectLevel.value,
        assignmentLevel: assignmentLevel.value
      };
      if (tagLevel.value !== "") payload.tagLevel = tagLevel.value;
      var refusals = adoRefusals(payload);
      if (refusals.length) {
        error.set(refusals.join(" "));
        return;
      }
      error.clear();
      saveButtonEl.disabled = true;
      api("POST", "/api/ado/mapping", payload).then(function (saved) {
        return refresh({ keepPanel: true }).then(function () {
          applyState(saved);
          var stored = saved.mapping || payload;
          setStatus("Mapping saved: " + stored.projectLevel + " for projects, " + stored.assignmentLevel +
            " for assignments" + (stored.tagLevel ? ", tags from " + stored.tagLevel : "") + ".");
        });
      }).catch(function (err) {
        error.set(errorText(err, "Could not save the mapping."));
      }).then(function () { saveButtonEl.disabled = !instance; });
    }

    function saveToken() {
      var value = tokenInput.value;
      if (value.trim() === "") {
        error.set("Type the personal access token first.");
        tokenInput.focus();
        return;
      }
      error.clear();
      tokenButton.disabled = true;
      api("POST", "/api/ado/token", { token: value }).then(function (next) {
        tokenInput.value = "";
        applyState(next);
        setStatus("Token saved to " + next.token.path + ".");
      }).catch(function (err) {
        error.set(errorText(err, "Could not save the token."));
      }).then(function () { tokenButton.disabled = false; });
    }

    function clearToken() {
      error.clear();
      api("DELETE", "/api/ado/token").then(function (next) {
        applyState(next);
        setStatus("Token cleared; the file was removed.");
      }).catch(function (err) {
        error.set(errorText(err, "Could not clear the token."));
      });
    }

    form.addEventListener("submit", function (e) { e.preventDefault(); saveMapping(); });

    openPanel(node, trigger);
    orgInput.focus();
    // Opening the panel is the press that loads the instance's own types: the
    // three slots are chosen from them, so the stored mapping's names can be
    // confirmed rather than assumed. With no token there is nothing to ask.
    if (token.present && (orgInput.value.trim() !== "" || projectInput.value.trim() !== "")) runTest();
  });
}

// A type slot's select, empty until the instance answers.
function typeSelect() {
  var select = document.createElement("select");
  select.className = "ado__select";
  return select;
}

/*
 * Fill a type select from the instance, keeping a stored name visible even when
 * the instance did not report it - a plan may arrive from another instance - so
 * the panel shows what the plan holds rather than silently dropping it. An
 * empty list means no test has answered yet.
 */
function fillTypeSelect(select, names, current, opts) {
  var settings = opts || {};
  var list = names.slice();
  select.innerHTML = "";
  // A stored name the instance did not report stays visible, so the panel shows
  // what the plan holds rather than silently dropping it.
  if (current && list.indexOf(current) === -1) list.unshift(current);
  if (list.length === 0) {
    var waiting = document.createElement("option");
    waiting.value = "";
    waiting.textContent = "Test connection first";
    select.appendChild(waiting);
    select.value = "";
    return;
  }
  if (settings.allowNone) {
    var none = document.createElement("option");
    none.value = "";
    none.textContent = "None";
    select.appendChild(none);
  }
  list.forEach(function (name) {
    var option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  select.value = current && list.indexOf(current) !== -1
    ? current
    : (settings.allowNone ? "" : list[0]);
}

/* --- the help panel ------------------------------------------------------ */

/*
 * The help: the feature reference, the glossary and the command line guide,
 * searched, opened from the first entry of the Options menu. It is opened and
 * never docked - the app's own panel shell over the board, so the grid does not
 * move and nothing about the plan is touched. Escape closes it and focus goes
 * back to the row that opened it, as every other panel's does.
 *
 * The documents are read from the server's allowlisted route every time the
 * panel opens, so it can never show a copy that has moved on, and nothing of
 * them outlives the panel: the documents, the anchors and the search index are
 * this function's own. The panel opens on the feature reference, and the last
 * document read is not remembered - reopening starts where a first visit does.
 *
 * The panel's subtitle row is the switch between them: one button per document,
 * named by the allowlist's own labels, the one showing marked the way the
 * Plan/Report switch marks the current page. A search is a search of the
 * document open, so a typed query survives a switch and is run again against
 * the document now showing.
 *
 * The search itself, and the rule that ranks a title match above a body match,
 * are public/lib/help.mjs'; this draws its results. A link between the
 * documents moves within the panel, and a link anywhere else is plain text.
 */
function openHelpPanel(trigger) {
  var node = panelShell("Help");
  node.classList.add("panel--help");

  // Where the subtitle was: the documents the help may draw, as a row of
  // buttons. The open one carries `aria-current`, which is the whole of the
  // marking - the stylesheet's fill follows the attribute.
  var switcher = el("div", "panel__sub help__switch");
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Help document");
  var switchButtons = {};
  HELP_DOCUMENTS.forEach(function (entry) {
    var button = el("button", "help__switch-btn");
    button.type = "button";
    button.textContent = entry.label;
    button.addEventListener("click", function () { switchDocument(entry.key); });
    switchButtons[entry.key] = button;
    switcher.appendChild(button);
  });

  var search = document.createElement("input");
  search.type = "search";
  search.className = "help__search";
  search.autocomplete = "off";
  search.setAttribute("aria-label", "Search the document showing");
  search.setAttribute("placeholder", "Search, or read the document");

  var count = el("p", "help__count");
  count.setAttribute("role", "status");
  count.hidden = true;
  var results = el("div", "help__results");
  results.hidden = true;
  var body = el("div", "help__body");

  node.appendChild(switcher);
  node.appendChild(search);
  node.appendChild(count);
  node.appendChild(results);
  node.appendChild(body);

  openPanel(node, trigger);
  search.focus();

  var documents = [];
  var anchors = {};
  // The panel's own ids carry this, so a glossary term named `Filter` or
  // `Minimap` cannot claim the grid's element id.
  var idPrefix = "help-";

  // The document the panel is showing, and the one whose text is drawn in the
  // body. They differ while a search lists results, because the text is left
  // as it was rather than redrawn under a list nobody is reading.
  var openKey = HELP_DOCUMENT_DEFAULT;
  var renderedKey = null;

  function markOpen() {
    HELP_DOCUMENTS.forEach(function (entry) {
      var button = switchButtons[entry.key];
      if (!button) return;
      if (entry.key === openKey) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  markOpen();

  // The document scrolls inside the panel, under a title, a close control and
  // a search field that stay put. A section is brought to the top of the text.
  function scrollToAnchor(anchorId) {
    if (!anchorId) { body.scrollTop = 0; return; }
    var target = body.querySelector('[id="' + idPrefix + anchorId + '"]');
    if (!target) return;
    body.scrollTop += target.getBoundingClientRect().top - body.getBoundingClientRect().top;
  }

  // The open document's own text in the body, scrolled to one of its sections.
  function renderBody(anchorId) {
    var doc = documents.find(function (entry) { return entry.key === openKey; });
    if (!doc) return;
    var known = helpDocument(doc.key);
    if (!known) return;
    renderedKey = doc.key;
    body.innerHTML = renderHelpDocument(known, doc.markdown, anchors, idPrefix);
    scrollToAnchor(anchorId);
  }

  // One document in the panel, scrolled to a section of it. This is what a
  // result and a link between the documents both do: the search that led to
  // either is spent, so the box is emptied.
  function showDocument(key, anchorId) {
    if (!helpDocument(key)) return;
    openKey = key;
    markOpen();
    search.value = "";
    results.textContent = "";
    results.hidden = true;
    count.hidden = true;
    body.hidden = false;
    renderBody(anchorId);
  }

  // A press on a switch: the document it names is the one showing from now on.
  // The box is left as it stands, because a query typed in one document is a
  // query about the other too - the panel runs it again rather than throwing
  // it away, and focus stays in the box to be typed in or cleared.
  function switchDocument(key) {
    if (!documents.length || !helpDocument(key)) return;
    openKey = key;
    markOpen();
    updateSearch();
    search.focus();
  }

  function resultButton(hit) {
    var row = el("button", "help__result");
    row.type = "button";
    var title = el("span", "help__result-title");
    title.textContent = hit.title;
    row.appendChild(title);
    if (hit.matched === "body") {
      var line = el("span", "help__result-line");
      line.textContent = hit.line;
      row.appendChild(line);
    }
    var where = el("span", "help__result-doc");
    where.textContent = hit.docLabel;
    row.appendChild(where);
    row.addEventListener("click", function () {
      showDocument(hit.doc, hit.anchor);
      search.focus();
    });
    return row;
  }

  // An empty field is the reading, a filled one is the search over the open
  // document: the panel shows one or the other, so a result list never pushes
  // the text being read away. A switch comes through here too, which is what
  // runs a typed query again against the document now showing.
  function updateSearch() {
    var query = search.value.trim();
    if (!query) {
      results.textContent = "";
      results.hidden = true;
      count.hidden = true;
      body.hidden = false;
      // A switch left another document's text in the body: draw this one's own.
      if (renderedKey !== openKey) renderBody(null);
      return;
    }
    body.hidden = true;
    results.textContent = "";
    results.hidden = false;
    count.hidden = false;
    var hits = searchHelp(documents.filter(function (doc) { return doc.key === openKey; }), query);
    var shown = hits.slice(0, HELP_RESULT_LIMIT);
    count.textContent = hits.length > shown.length
      ? "Showing the first " + shown.length + " of " + hits.length + " sections"
      : hits.length === 1 ? "1 section" : hits.length + " sections";
    if (!hits.length) {
      var none = el("p", "help__empty");
      none.textContent = "Nothing in this document matches that.";
      results.appendChild(none);
      return;
    }
    shown.forEach(function (hit) { results.appendChild(resultButton(hit)); });
  }

  search.addEventListener("input", updateSearch);
  search.addEventListener("keydown", function (e) {
    if (results.hidden) return;
    var first = results.querySelector(".help__result");
    if (!first) return;
    if (e.key === "Enter") { e.preventDefault(); first.click(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); first.focus(); }
  });

  // A link between the documents moves within the panel. Anything else was
  // drawn as plain text by the renderer, so it cannot arrive here.
  body.addEventListener("click", function (e) {
    var link = e.target.closest("a[data-help-doc]");
    if (!link) return;
    e.preventDefault();
    showDocument(link.getAttribute("data-help-doc"), link.getAttribute("data-help-anchor"));
    search.focus();
  });

  Promise.all(HELP_DOCUMENTS.map(function (entry) {
    return api("GET", "/api/help/" + entry.key);
  })).then(function (loaded) {
    // A panel closed before its documents arrived has nothing to fill.
    if (!node.isConnected) return;
    documents = loaded;
    loaded.forEach(function (doc) { anchors[doc.key] = helpAnchors(doc.markdown); });
    showDocument(HELP_DOCUMENT_DEFAULT);
  }).catch(function (err) {
    var message = el("p", "help__error");
    message.setAttribute("role", "alert");
    message.textContent = "The help could not be read: " +
      (err && err.message ? err.message : "the server did not answer");
    body.appendChild(message);
  });
}

/* The Colour palette disclosure: the two schemes, each a checkable item with
 * the menu's own tick. Choosing one recolours every chip and block at once. */
function buildPaletteControl() {
  var wrap = el("div", "options__disclosure");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Colour palette");
  paletteItems(activePalette).forEach(function (item) {
    var btn = el("button", "options__item");
    btn.type = "button";
    btn.id = "palette-" + item.key;
    btn.setAttribute("role", "menuitemradio");
    btn.setAttribute("aria-checked", item.checked ? "true" : "false");
    var tick = el("span", "options__tick");
    tick.setAttribute("aria-hidden", "true");
    btn.appendChild(tick);
    btn.appendChild(document.createTextNode(item.label));
    btn.addEventListener("click", function () { setPalette(item.key); });
    paletteButtons[item.key] = btn;
    wrap.appendChild(btn);
  });
  return wrap;
}

/* The Block label disclosure: the three settings, each a checkable item with
 * the menu's own tick, directly after the Colour palette so the two choices
 * about how a block is drawn stand together and neither is mistaken for an
 * overlay toggle. Choosing one relabels every block at once. */
function buildBlockLabelControl() {
  var wrap = el("div", "options__disclosure");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Block label");
  blockLabelItems(blockLabelSetting).forEach(function (item) {
    var btn = el("button", "options__item");
    btn.type = "button";
    btn.id = "block-label-" + item.key;
    btn.setAttribute("role", "menuitemradio");
    btn.setAttribute("aria-checked", item.checked ? "true" : "false");
    var tick = el("span", "options__tick");
    tick.setAttribute("aria-hidden", "true");
    btn.appendChild(tick);
    btn.appendChild(document.createTextNode(item.label));
    btn.addEventListener("click", function () { setBlockLabel(item.key); });
    blockLabelButtons[item.key] = btn;
    wrap.appendChild(btn);
  });
  return wrap;
}

/* The plan period disclosure: one explicit start date and one explicit end
 * date, set together. The fields follow the menu's own item language, and a
 * refused pair is named in the control rather than closing it. */
function buildRangeControl() {
  var wrap = el("div", "options__disclosure");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Plan period");

  function field(label, id) {
    var row = el("label", "options__field");
    row.setAttribute("for", id);
    var span = el("span", "options__field-label");
    span.textContent = label;
    var input = document.createElement("input");
    input.type = "date";
    input.className = "options__date";
    input.id = id;
    input.setAttribute("placeholder", "YYYY-MM-DD");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyRange(); }
    });
    row.appendChild(span);
    row.appendChild(input);
    return row;
  }

  var startRow = field("Start", "range-start");
  var endRow = field("End", "range-end");
  rangeStartInput = startRow.querySelector("input");
  rangeEndInput = endRow.querySelector("input");
  wrap.appendChild(startRow);
  wrap.appendChild(endRow);

  rangeError = el("p", "options__error");
  rangeError.setAttribute("role", "alert");
  rangeError.hidden = true;
  wrap.appendChild(rangeError);

  var apply = el("button", "options__apply");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.setAttribute("data-range-apply", "");
  apply.addEventListener("click", applyRange);
  wrap.appendChild(apply);

  return wrap;
}

function setRangeError(message) {
  if (!rangeError) return;
  rangeError.textContent = message;
  rangeError.hidden = !message;
}

function updateRangeControl() {
  if (!data) return;
  var item = rangeControl(data.range);
  setDisclosureDetail("range", item.detail);
  if (!rangeStartInput) return;
  rangeStartInput.value = item.start;
  rangeEndInput.value = item.end;
  setRangeError("");
}

function applyRange() {
  if (!rangeStartInput) return;
  var start = rangeStartInput.value;
  var end = rangeEndInput.value;
  var refusal = rangeSettingRefusal(start, end);
  if (refusal) { setRangeError(refusal); return; }
  var apply = optionsMenu.querySelector("[data-range-apply]");
  if (apply) apply.disabled = true;
  api("PATCH", "/api/plan", { start: start, end: end }).then(function () {
    return refresh();
  }).then(function () {
    setRangeError("");
    openOptions(false);
  }).catch(function (err) {
    setRangeError(err && err.message ? err.message : "Could not save the period.");
  }).then(function () {
    if (apply) apply.disabled = false;
  });
}

/* The percentage step disclosure, beside the period row: one whole-number
 * field from 1 to 100 and its own Apply, so a half-typed value never re-steps
 * the plan. Applying it updates the steppers, the panels and the drag, because
 * every one of them reads the plan's step. */
function buildStepControl() {
  var item = stepControl(null);
  var wrap = el("div", "options__disclosure");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", item.label);

  var row = el("label", "options__field");
  row.setAttribute("for", "step-input");
  var span = el("span", "options__field-label");
  span.textContent = "Step";
  var input = document.createElement("input");
  input.type = "number";
  input.className = "options__number";
  input.id = "step-input";
  input.min = String(item.min);
  input.max = String(item.max);
  input.step = "1";
  input.setAttribute("aria-label", "Percentage step, from 1 to 100");
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); applyStep(); }
  });
  row.appendChild(span);
  row.appendChild(input);
  stepInput = input;
  wrap.appendChild(row);

  stepError = el("p", "options__error");
  stepError.setAttribute("role", "alert");
  stepError.hidden = true;
  wrap.appendChild(stepError);

  var apply = el("button", "options__apply");
  apply.type = "button";
  apply.textContent = "Apply";
  apply.setAttribute("data-step-apply", "");
  apply.addEventListener("click", applyStep);
  wrap.appendChild(apply);

  return wrap;
}

function setStepError(message) {
  if (!stepError) return;
  stepError.textContent = message;
  stepError.hidden = !message;
}

function updateStepControl() {
  if (!data) return;
  var item = stepControl(data.step);
  setDisclosureDetail("step", item.detail);
  if (!stepInput) return;
  stepInput.value = String(item.value);
  setStepError("");
}

function applyStep() {
  if (!stepInput) return;
  var value = Number(stepInput.value);
  var refusal = stepSettingRefusal(value);
  if (refusal) { setStepError(refusal); return; }
  var apply = optionsMenu.querySelector("[data-step-apply]");
  if (apply) apply.disabled = true;
  api("PATCH", "/api/plan", { step: value }).then(function () {
    return refresh();
  }).then(function () {
    setStepError("");
    openOptions(false);
  }).catch(function (err) {
    setStepError(err && err.message ? err.message : "Could not save the step.");
  }).then(function () {
    if (apply) apply.disabled = false;
  });
}

// One popover at a time: opening the menu closes the filter's scope popover
// (and the suggestions), and opening the scope popover closes the menu.
function openOptions(open) {
  if (open) {
    hideSuggestions();
    closeSortMenus();
    if (filterScopesEl && !filterScopesEl.hidden) openScopes(false);
    updateOptionsMenu();
    updateBlockLabelMenu();
    updateRangeControl();
    updateStepControl();
    updateSprintsItem();
    updateHolidaysItem();
    updateTagsItem();
    updateMilestonesItem();
    loadPlanFileState();
  } else {
    closeDisclosure();
  }
  optionsMenu.hidden = !open;
  optionsBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) placePopover(optionsMenu, optionsBtn, "right");
}

function initOptions() {
  optionsEl = document.getElementById("options");
  optionsBtn = document.getElementById("options-btn");
  optionsMenu = document.getElementById("options-menu");
  if (!optionsEl || !optionsBtn || !optionsMenu) return;
  buildOptionsMenu();
  // In a report the grid-only entries cannot act, so they are disabled rather
  // than moved or hidden; the plan-facing entries stay live. Which rows those
  // are is public/lib/options.mjs' rule, not a second list here.
  if (isReport) {
    reportDisabledOptionKeys().forEach(function (key) {
      // The toggle rows are held by key; Reset view is its own button. The two
      // panel actions that share a toggle's key are held under their own ids,
      // so this resolves to the toggle, which is the row this rule names.
      var btn = optionButtons[key] || document.getElementById("option-" + key);
      if (btn) btn.disabled = true;
    });
  }
  optionsBtn.addEventListener("click", function () { openOptions(optionsMenu.hidden); });
  optionsBtn.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown") { openOptions(true); e.preventDefault(); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !optionsMenu.hidden) {
      openOptions(false);
      optionsBtn.focus();
      e.preventDefault();
    }
  });
  document.addEventListener("pointerdown", function (e) {
    if (optionsMenu.hidden) return;
    if (optionsEl.contains(e.target)) return;
    openOptions(false);
  });
}

/* --- the view switch, the report's controls and the carried Filter ------ */

// The controls a report withdraws keep their place but not their action. The
// two stepper pairs have no dynamic state, so they are set once; Today and
// Undo/Redo are updated on every draw beside their own rules.
function syncReportControls() {
  if (!isReport) return;
  reportDisabledControlIds().forEach(function (id) {
    var btn = document.getElementById(id);
    if (btn) btn.disabled = true;
  });
}

// The Filter stays session-only, but it must reach the report across the
// switch's navigation. On a switch the current text and Look in scope are left
// in the browser's session storage, and the page that loads consumes and
// removes them - so a plain reload still drops the Filter exactly as it does
// today, while moving between the two views carries it. The shape of that
// record is public/lib/report.mjs' rule.
function carryFilter() {
  try {
    sessionStorage.setItem(FILTER_HANDOFF_KEY,
      serializeFilterHandoff(filterQuery, filterScopes));
  } catch (err) { /* a browser refusing session storage just does not carry */ }
}

function takeFilterHandoff() {
  try {
    var raw = sessionStorage.getItem(FILTER_HANDOFF_KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(FILTER_HANDOFF_KEY);
    return parseFilterHandoff(raw);
  } catch (err) {
    return null;
  }
}

function initViewSwitch() {
  var links = Array.prototype.slice.call(document.querySelectorAll("[data-view-link]"));
  links.forEach(function (link) {
    link.addEventListener("click", function (e) {
      // A modified click opens a new tab or window; the Filter is that tab's
      // own session, so nothing is carried.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      carryFilter();
    });
  });
}

function boot() {
  // The stored view first, so the first draw opens on it; a failure to read it
  // is not fatal - the defaults are simply used.
  api("GET", "/api/view").catch(function () { return null; }).then(function (view) {
    adoptView(view);
    return api("GET", planUrl());
  }).then(function (plan) {
    data = plan;
    indexData();
    // The Filter the previous view sent over, applied before the first draw so
    // the report reflects it the moment it opens.
    var carried = takeFilterHandoff();
    if (carried) {
      filterQuery = carried.query;
      filterScopes = carried.scopes;
    }
    var today = data.today ? udate(data.today) : rangeStart;
    markerIndex = clamp(dayDiff(rangeStart, today), 0, DAYS - 1);
    initRowHeight();
    initGridSpacing();
    initStackToggle();
    initMinimap();
    initSortControls();
    initPalette();
    render();
    initZoom();
    bindChrome();
    initFilter();
    initOptions();
    initViewSwitch();
    syncReportControls();
    loadPlanFileState();
    loadAdoState();
    window.requestAnimationFrame(function () {
      var tlRect = tl.getBoundingClientRect();
      var heads = tl.querySelector(".tl__heads");
      var headW = heads ? heads.getBoundingClientRect().width : 0;
      var dayW = (tlRect.width - headW) / DAYS;
      scroller.scrollLeft = Math.max(0, markerIndex * dayW - scroller.clientWidth * 0.3);
    });
  }).catch(function (err) {
    document.body.innerHTML = "";
    var p = el("p", "noscript");
    p.textContent = "PACT could not load its plan: " + err.message +
      " - start the server with node server.mjs.";
    document.body.appendChild(p);
  });
}

boot();
