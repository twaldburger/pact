/* PACT - the plan, drawn from the server's JSON file.
 * Plain JavaScript as an ES module, no framework, no build step. The plan
 * lives in data/pact.json behind /api; every change the screen makes is sent
 * there as it happens, and the screen is redrawn from what the server returns.
 * The panel rules that are not about the DOM live in ./lib/panels.mjs, so
 * `node --test` can pin them. */
import {
  AVAILABILITY_MIN,
  AVAILABILITY_MAX,
  clampAvailability,
  stepAvailability,
  suggestPersonTags,
  suggestAssignmentTags,
  withTag,
  withoutTag,
  archivedPersonRefusal,
  dropRefusal,
  clampShare,
  shareValues,
  shareFromDrag
} from "./lib/panels.mjs";
import { planQuery } from "./lib/visibility.mjs";
import { blockLabel, labelText, rangeLabel } from "./lib/label.mjs";
import {
  DROP_DAYS,
  dayRange,
  dropRange,
  moveRange,
  rowAtY,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_DEFAULT,
  stepRowHeight,
  rowGeometry,
  isRowHeaderTight
} from "./lib/timeline.mjs";

var root = document.documentElement;
var tl = document.getElementById("tl");
var scroller = document.getElementById("scroller");
var stackList = document.getElementById("stack-list");
var panelLayer = document.getElementById("panel-layer");
var contextEl = document.getElementById("context");
var archivedToggle = document.getElementById("show-archived");

if (!tl || !scroller) throw new Error("PACT: the timeline is missing");

var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];
var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
var DAY_MS = 86400000;
var INKS = ["steel", "moss", "teal", "iris", "plum", "umber"];

var data = null;
var rangeStart = null;
var rangeEnd = null;
var DAYS = 1;
var startDow = 0;
var projectById = {};
var personById = {};
var assignments = [];
var markerIndex = 0;
var marker = null;
var markerDate = null;
// The row height and the geometry derived from it. A view setting for the
// session only: it is never written to the plan and resets on reload.
var rowHeight = ROW_HEIGHT_DEFAULT;
var ftePx = 0;
var stepPx = 0;
var BASE_PX = 1;
var lastDragAt = 0;
var showArchived = false;

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

/* --- data index ---------------------------------------------------------- */

function indexData() {
  rangeStart = udate(data.range.start);
  rangeEnd = udate(data.range.end);
  DAYS = dayDiff(rangeStart, rangeEnd) + 1;
  startDow = dow(rangeStart);

  projectById = {};
  data.projects.forEach(function (p) { projectById[p.id] = p; });
  personById = {};
  data.people.forEach(function (p) { personById[p.id] = p; });

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
  }).filter(function (a) { return a.project && a.person; });
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

/* --- drawing: axis ------------------------------------------------------- */

function drawAxis() {
  var axis = el("div", "tl__axis");
  axis.setAttribute("aria-hidden", "true");

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

  axis.appendChild(monthBand);
  axis.appendChild(dayBand);
  axis.appendChild(weekBand);
  return axis;
}

/* --- drawing: rows ------------------------------------------------------- */

// Stack a person's assignments by start order, one rectangle per run of equal
// offset and over-allocation, so a block only ever sits where its share does.
function layoutPerson(person) {
  var mine = assignments.filter(function (a) { return a.person === person; })
    .sort(function (a, b) {
      if (a.startIdx !== b.startIdx) return a.startIdx - b.startIdx;
      if (a.endIdx !== b.endIdx) return a.endIdx - b.endIdx;
      return a.id < b.id ? -1 : 1;
    });

  var avail = person.availability / 100;
  var totalByDay = {};
  mine.forEach(function (a) {
    for (var d = a.startIdx; d <= a.endIdx; d++) {
      totalByDay[d] = (totalByDay[d] || 0) + a.share / 100;
    }
  });

  return mine.map(function (a, ai) {
    var earlier = mine.slice(0, ai);
    var h = a.share / 100;
    var segs = [];
    var cur = null;
    for (var d = a.startIdx; d <= a.endIdx; d++) {
      var offset = 0;
      earlier.forEach(function (b) {
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

  data.people.forEach(function (person) {
    var wrap = el("div", "rowhead-wrap" + (person.archived ? " is-archived" : ""));
    wrap.setAttribute("data-person", person.id);

    var head = el("button", "rowhead");
    head.type = "button";
    head.setAttribute("data-person", person.id);
    var name = el("span", "rowhead__name");
    name.textContent = person.name;
    head.appendChild(name);
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
      var restore = el("button", "rowhead__restore");
      restore.type = "button";
      restore.textContent = "Restore";
      restore.setAttribute("aria-label", "Restore " + person.name);
      restore.addEventListener("click", function () { restorePerson(person); });
      wrap.appendChild(restore);
    }

    heads.appendChild(wrap);

    var row = el("div", "row" + (person.archived ? " is-archived" : ""));
    row.setAttribute("data-person", person.id);
    var ceiling = el("span", "ceiling");
    ceiling.style.setProperty("--ceiling-px", yPx(person.availability / 100) + "px");
    row.appendChild(ceiling);

    layoutPerson(person).forEach(function (group) {
      group.segs.forEach(function (s) {
        row.appendChild(blockFor(group, s));
      });
    });

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
  var b = el("div", "blk" + (archived ? " is-archived" : ""));
  b.setAttribute("role", "button");
  b.setAttribute("tabindex", "0");
  b.setAttribute("data-assignment", a.id);
  b.setAttribute("aria-label", a.project.name + " on " + a.person.name + ", " +
    a.share + "% from " + fmtRange(a.start, a.end) +
    (archived ? ", archived" : "") +
    ". Enter for details" + (archived ? "." : ", drag an edge to change it."));
  b.style.setProperty("--block-ink", "var(--proj-" + a.project.colour + ")");
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
  tag.dataset.title = a.project.name;
  tag.dataset.share = String(a.share);
  tag.textContent = labelText(a.project.name, a.share);
  b.appendChild(tag);
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

function drawBlockLabels() {
  var blocks = tl.querySelectorAll(".blk");
  if (!blocks.length) return;
  var metrics = readLabelMetrics(blocks[0].querySelector(".blk__tag"), blocks[0]);
  var measure = labelMeasurer(metrics.font);

  // Read every block's box before writing any label, so the whole pass turns
  // on one layout rather than one per block.
  var room = [];
  for (var i = 0; i < blocks.length; i++) {
    var tag = blocks[i].querySelector(".blk__tag");
    if (!tag) continue;
    room.push({
      tag: tag,
      title: tag.dataset.title || "",
      share: tag.dataset.share,
      width: blocks[i].clientWidth - 2 * metrics.inset,
      height: blocks[i].clientHeight - metrics.bottom
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
  markerDate = el("span", "marker__date");
  marker.appendChild(markerDate);

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
function onMarkerMove(e) {
  if (!draggingMarker) return;
  setMarker(indexFromClientX(e.clientX));
}
function onMarkerUp(e) {
  if (!draggingMarker) return;
  draggingMarker = false;
  root.classList.remove("is-dragging");
  try { if (marker.hasPointerCapture(e.pointerId)) marker.releasePointerCapture(e.pointerId); } catch (err) { /* ignored */ }
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
  marker.style.setProperty("--i", markerIndex);
  markerDate.textContent = fmtDay(date);
  marker.setAttribute("aria-valuenow", String(markerIndex));
  marker.setAttribute("aria-valuetext", fmtDayLong(date));
  updateFigures();
}

function totalAt(person, dayIdx) {
  var total = 0;
  assignments.forEach(function (a) {
    if (a.person === person && a.startIdx <= dayIdx && a.endIdx >= dayIdx) {
      total += a.share / 100;
    }
  });
  return total;
}

function updateFigures() {
  data.people.forEach(function (person) {
    var fig = tl.querySelector('[data-fig="' + person.id + '"]');
    if (!fig) return;
    var total = totalAt(person, markerIndex);
    var assigned = Math.round(total * 100);
    fig.textContent = assigned + "/" + person.availability + "%";
    fig.classList.toggle("is-over", assigned > person.availability);
    var head = fig.closest(".rowhead");
    if (head) {
      head.setAttribute("aria-label", person.name + ", " + assigned + "% of " +
        person.availability + "% at the Marker");
    }
  });
}

/* --- drawing: stack rail ------------------------------------------------- */

var NOTE_ICON =
  '<svg class="stack__note" viewBox="0 0 16 16" aria-hidden="true">' +
  '<path d="M3.5 2.5h6l3 3v8h-9z" fill="none" stroke="currentColor" ' +
  'stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M5.5 8h5M5.5 10.5h5" stroke="currentColor" stroke-width="1.2" ' +
  'stroke-linecap="round"/></svg>';

function drawStack() {
  data.projects.forEach(function (project) {
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
    if (project.notes) {
      var mark = el("span", "stack__notemark");
      mark.setAttribute("title", "Has a note");
      mark.innerHTML = NOTE_ICON;
      item.appendChild(mark);
    }
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
      row.appendChild(actions);
    }

    stackList.appendChild(row);
  });
}

/* --- interaction: drag a project from the Stack onto a row --------------- */

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
    // An archived Person or Project cannot take new work: the drop is refused
    // with a message rather than reviving it or doing nothing.
    var refusal = dropRefusal(personById[row.personId], project);
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
      var steps = Math.round(-dy / stepPx);
      curShare = shareFromDrag(origShare, steps);
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
  if (person.archived) {
    showError(new Error(archivedPersonRefusal(person.name)));
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
  return fetch(url, options).catch(function () {
    throw new Error("PACT could not reach its server - is it still running?");
  }).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (payload) {
      if (!res.ok) throw new Error(payload && payload.error ? payload.error : "the server refused the change");
      return payload;
    });
  });
}

function planUrl() {
  return planQuery(showArchived);
}

function refresh() {
  return api("GET", planUrl()).then(function (plan) {
    var previousStart = rangeStart;
    data = plan;
    render();
    // When the range has gained days to the left, hold the owner's view in
    // place rather than letting the restored scroll slip a whole month back.
    if (previousStart) {
      var shift = dayDiff(udate(plan.range.start), previousStart);
      if (shift > 0) scroller.scrollLeft += shift * dayWidth();
    }
  });
}

function createAssignment(project, personId, dayIdx) {
  // The extent the preview drew is the extent that lands, because both come
  // from the same rule in ./lib/timeline.mjs.
  var range = dropRange(dayIdx, DAYS, DROP_DAYS);
  var start = addDays(rangeStart, range.start);
  var end = addDays(rangeStart, range.end);
  var created = null;
  api("POST", "/api/assignments", {
    projectId: project.id,
    personId: personId,
    start: iso(start),
    end: iso(end),
    share: 100,
    tags: [],
    note: ""
  }).then(function (assignment) {
    created = assignment;
    return refresh();
  }).then(function () {
    if (created) focusAssignment(created.id);
  }).catch(function (err) {
    showError(err);
    render();
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

function focusAssignment(id) {
  var block = tl.querySelector('[data-assignment="' + id + '"]');
  if (block) block.focus();
}

var toastTimer = null;
function showError(err) {
  var toast = document.getElementById("pact-toast");
  if (!toast) {
    toast = el("div", "toast");
    toast.id = "pact-toast";
    toast.setAttribute("role", "alert");
    document.body.appendChild(toast);
  }
  toast.textContent = err && err.message ? err.message : "Could not save the change.";
  toast.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toast.classList.remove("is-on"); }, 6000);
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

function textarea(value) {
  var t = document.createElement("textarea");
  t.value = value || "";
  return t;
}

function button(cls, label, handler) {
  var b = el("button", cls);
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", handler);
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

function confirmArchive(node, question, reopen, onConfirm) {
  var foot = node.querySelector(".panel__foot");
  foot.innerHTML = "";
  var ask = el("span", "panel__ask");
  ask.textContent = question;
  var keep = button("btn-ghost", "Keep", reopen);
  var yes = button("btn-danger", "Archive", onConfirm);
  foot.appendChild(ask);
  foot.appendChild(keep);
  foot.appendChild(yes);
  yes.focus();
}

// A Person's Availability in whole 10% steps, with buttons and arrow keys.
function availabilityControl(value) {
  var wrap = el("span", "avail");
  var current = clampAvailability(value);

  var down = el("button", "avail__btn");
  down.type = "button";
  down.textContent = "\u2212";
  down.setAttribute("aria-label", "One step less");

  var out = el("span", "avail__value");
  out.setAttribute("role", "spinbutton");
  out.setAttribute("tabindex", "0");
  out.setAttribute("aria-label", "Availability, in steps of 10 per cent");
  out.setAttribute("aria-valuemin", String(AVAILABILITY_MIN));
  out.setAttribute("aria-valuemax", String(AVAILABILITY_MAX));

  var up = el("button", "avail__btn");
  up.type = "button";
  up.textContent = "+";
  up.setAttribute("aria-label", "One step more");

  function show() {
    out.textContent = current + "%";
    out.setAttribute("aria-valuenow", String(current));
  }
  function move(delta) { current = stepAvailability(current, delta); show(); }

  down.addEventListener("click", function () { move(-1); });
  up.addEventListener("click", function () { move(1); });
  out.addEventListener("keydown", function (e) {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { move(1); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { move(-1); e.preventDefault(); }
    else if (e.key === "Home") { current = AVAILABILITY_MIN; show(); e.preventDefault(); }
    else if (e.key === "End") { current = AVAILABILITY_MAX; show(); e.preventDefault(); }
  });

  show();
  wrap.appendChild(down);
  wrap.appendChild(out);
  wrap.appendChild(up);
  return { node: wrap, value: function () { return current; } };
}

var tagListSeq = 0;

// A menu of the ten possible shares, 10% through 100%. Choosing a value is the
// same change a vertical edge drag makes - it lands on exactly the same number
// - so there is nothing to type and nothing to round by hand.
function shareSelect(current) {
  var select = document.createElement("select");
  select.setAttribute("aria-label", "Allocation, in steps of 10 per cent");
  shareValues().forEach(function (value) {
    var option = document.createElement("option");
    option.value = String(value);
    option.textContent = value + "%";
    select.appendChild(option);
  });
  select.value = String(clampShare(current));
  return select;
}

// Tag chips plus an input that takes a new tag or one from `suggest`.
function tagEditor(initial, suggest) {
  var tags = (initial || []).slice();
  var wrap = el("div", "tags");
  var chips = el("span", "chips");
  var input = document.createElement("input");
  input.type = "text";
  input.className = "tags__input";
  input.placeholder = "Add a tag";
  input.setAttribute("aria-label", "Add a tag");
  var listId = "tag-suggest-" + (++tagListSeq);
  input.setAttribute("list", listId);
  var datalist = document.createElement("datalist");
  datalist.id = listId;

  function render() {
    chips.innerHTML = "";
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
      });
      chip.appendChild(text);
      chip.appendChild(remove);
      chips.appendChild(chip);
    });
    chips.appendChild(input);
    datalist.innerHTML = "";
    suggest().forEach(function (tag) {
      var option = document.createElement("option");
      option.value = tag;
      datalist.appendChild(option);
    });
  }

  function commit() {
    if (input.value.trim() === "") { input.value = ""; return; }
    tags = withTag(tags, input.value);
    input.value = "";
    render();
  }

  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commit(); }
    else if (e.key === "Backspace" && input.value === "" && tags.length) {
      tags = tags.slice(0, -1);
      render();
    }
  });
  input.addEventListener("blur", commit);

  wrap.appendChild(chips);
  wrap.appendChild(datalist);
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

function openPersonPanel(person, trigger) {
  var editing = !!person;
  var node = panelShell(editing ? "Person" : "Add person",
    editing ? null : "Availability is set in steps of 10%.");
  var form = el("form", "form");

  var nameInput = input(editing ? person.name : "");
  form.appendChild(formRow("Name", nameInput));

  var availability = availabilityControl(editing ? person.availability : AVAILABILITY_MAX);
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
  if (editing && !person.archived) {
    var archive = button("btn-danger", "Archive person", function () {
      confirmArchive(node, "Archive this person?",
        function () { openPersonPanel(person, trigger); },
        function () { closePanel(false); archivePerson(person.id); });
    });
    foot.appendChild(archive);
  }
  var spacer = el("span", "panel__spacer");
  foot.appendChild(spacer);
  var save = saveButton(editing ? "Save" : "Add person", function () {
    var name = nameInput.value.trim();
    if (!name) { error.set("A person needs a name."); nameInput.focus(); return; }
    var body = {
      name: name,
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

function openProjectPanel(project, trigger) {
  var editing = !!project;
  var node = panelShell(editing ? "Project" : "Add project",
    editing ? null : "A project exists on its own, before any person.");
  var form = el("form", "form");

  var nameInput = input(editing ? project.name : "");
  form.appendChild(formRow("Name", nameInput));

  var colour = editing ? project.colour : INKS[0];
  var swatches = el("span", "swatches");
  var buttons = INKS.map(function (ink) {
    var sw = el("button", "swatch");
    sw.type = "button";
    sw.style.setProperty("--pick", "var(--proj-" + ink + ")");
    sw.setAttribute("aria-label", "Colour " + ink);
    sw.setAttribute("aria-pressed", ink === colour ? "true" : "false");
    sw.addEventListener("click", function () {
      colour = ink;
      buttons.forEach(function (b) {
        b.setAttribute("aria-pressed", b === sw ? "true" : "false");
      });
    });
    swatches.appendChild(sw);
    return sw;
  });
  form.appendChild(formRow("Colour", swatches));

  var notes = textarea(editing ? project.notes : "");
  form.appendChild(formRow("Notes", notes));

  node.appendChild(form);
  var error = errorLine(node);

  var foot = el("div", "panel__foot");
  if (editing && !project.archived) {
    var archive = button("btn-danger", "Archive project", function () {
      confirmArchive(node, "Archive this project?",
        function () { openProjectPanel(project, trigger); },
        function () { closePanel(false); archiveProject(project.id); });
    });
    foot.appendChild(archive);
  }
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton(editing ? "Save" : "Add project", function () {
    var name = nameInput.value.trim();
    if (!name) { error.set("A project needs a name."); nameInput.focus(); return; }
    var body = { name: name, colour: colour, notes: notes.value };
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

function openAssignmentPanel(a, trigger) {
  var archived = !!(a.raw && a.raw.archived);
  var node = panelShell(a.project.name + " \u00b7 " + a.person.name,
    fmtRange(a.start, a.end));

  var form = el("form", "form");
  // The Share menu and a vertical edge drag reach the same number; the menu
  // opens on the Assignment's current share, so the two cannot disagree.
  var sharePick = shareSelect(a.share);
  var shareControl = el("span", "share-control");
  shareControl.appendChild(sharePick);
  if (!archived) {
    var shareHint = el("span", "soft");
    shareHint.textContent = " or drag an edge";
    shareControl.appendChild(shareHint);
  }
  form.appendChild(formRow("Share", shareControl));
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
  } else {
    var archive = button("btn-danger", "Archive assignment", function () {
      confirmArchive(node, "Archive this assignment?",
        function () { openAssignmentPanel(a, trigger); },
        function () { closePanel(false); archiveAssignment(a.id); });
    });
    foot.appendChild(archive);
  }
  foot.appendChild(el("span", "panel__spacer"));
  var save = saveButton("Save", function () {
    submitPanel(node, error, function () {
      return api("PATCH", "/api/assignments/" + encodeURIComponent(a.id), {
        share: clampShare(Number(sharePick.value)),
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
// set by drawing, never typed - the Share menu opens on 100%, and the Project
// is required, because an Assignment cannot exist without one.
function openNewAssignmentPanel(person, range, rect, trigger) {
  var start = addDays(rangeStart, range.start);
  var end = addDays(rangeStart, range.end);
  var node = panelShell("New assignment", person.name);

  var fields = el("dl", "fields");
  fields.appendChild(field("Dates", fmtRange(start, end)));
  node.appendChild(fields);

  var form = el("form", "form");
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

  // Creating an Assignment starts at the whole range; the menu offers every
  // other share, exactly as an edge drag would set it.
  var sharePick = shareSelect(100);
  form.appendChild(formRow("Share", sharePick));

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
        share: clampShare(Number(sharePick.value)),
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

/* --- zoom ---------------------------------------------------------------- */

// Bring today into the middle of the day area, leaving the sticky row-header
// column clear, and put the Marker back on today so the row headers read as of
// now again. Both effects happen in one press; today is always inside the
// range, so the control always has work.
function goToToday() {
  if (!data) return;
  var today = data.today ? udate(data.today) : rangeStart;
  var index = clamp(dayDiff(rangeStart, today), 0, DAYS - 1);
  setMarker(index);
  var visible = scroller.clientWidth - headWidth();
  var left = (index + 0.5) * dayWidth() - visible / 2;
  scroller.scrollLeft = Math.max(0, left);
}

function initZoom() {
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".zoom__btn"));
  function choose(zoom) {
    // Hold the Marker where it sits on screen while the scale changes.
    var sRect = scroller.getBoundingClientRect();
    var before = marker.getBoundingClientRect().left - sRect.left;
    root.setAttribute("data-zoom", zoom);
    buttons.forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-zoom") === zoom ? "true" : "false");
    });
    var after = marker.getBoundingClientRect().left - sRect.left;
    scroller.scrollLeft += after - before;
    queueBlockLabels();
  }
  buttons.forEach(function (b) {
    b.addEventListener("click", function () { choose(b.getAttribute("data-zoom")); });
  });
  choose(root.getAttribute("data-zoom") || "day");
}

/* --- row height ---------------------------------------------------------- */

// The top-bar pair that changes the drawn height of every row. Each press
// moves it by one 8px step across 32..120; it is applied to the grid and
// remembered nowhere.
function initRowHeight() {
  var down = document.getElementById("row-decrease");
  var up = document.getElementById("row-increase");
  if (down) {
    down.addEventListener("click", function () {
      rowHeight = stepRowHeight(rowHeight, -1);
      applyRowHeight();
      render();
    });
  }
  if (up) {
    up.addEventListener("click", function () {
      rowHeight = stepRowHeight(rowHeight, 1);
      applyRowHeight();
      render();
    });
  }
  applyRowHeight();
}

/* --- render -------------------------------------------------------------- */

function render() {
  if (!data) return;
  var scrollLeft = scroller.scrollLeft;
  closePanel(false);
  tl.innerHTML = "";
  stackList.innerHTML = "";
  indexData();
  tl.style.setProperty("--days", DAYS);

  var overlay = el("div", "weekends");
  weekends().forEach(function (w) {
    overlay.appendChild(set(el("span", "weekend"), w.i, w.n));
  });

  var corner = el("div", "tl__corner");
  var cornerLabel = el("span", "tl__corner-label");
  cornerLabel.textContent = "Person";
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

  var rows = drawRows();

  tl.appendChild(overlay);
  tl.appendChild(corner);
  tl.appendChild(drawAxis());
  tl.appendChild(rows.heads);
  tl.appendChild(rows.body);
  tl.appendChild(drawMarker());

  drawStack();

  markerIndex = clamp(markerIndex, 0, DAYS - 1);
  setMarker(markerIndex);

  contextEl.textContent = rangeLabel(data.range.start, data.range.end);

  scroller.scrollLeft = scrollLeft;
  drawBlockLabels();
}

/* --- wiring -------------------------------------------------------------- */

function bindChrome() {
  document.getElementById("add-project").addEventListener("click", function (e) {
    openProjectPanel(null, e.currentTarget);
  });
  if (archivedToggle) {
    archivedToggle.addEventListener("click", function () {
      showArchived = !showArchived;
      archivedToggle.setAttribute("aria-pressed", showArchived ? "true" : "false");
      archivedToggle.textContent = showArchived ? "Hide archived" : "Show archived";
      refresh().catch(showError);
    });
  }
  // The Today control returns the owner to now: it brings today back into the
  // middle of the view and puts the Marker back on today. Today is always
  // inside the range, so the control always has work.
  var todayBtn = document.getElementById("today");
  if (todayBtn) {
    todayBtn.addEventListener("click", function () { goToToday(); });
  }
  panelLayer.addEventListener("pointerdown", function (e) {
    if (e.target === panelLayer) closePanel(true);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && panel) closePanel(true);
  });
  scroller.addEventListener("scroll", function () {
    if (panel) closePanel(false);
  });

  // Everything a label's room is decided from: the window, a scale change
  // (whose block widths animate, so the pass runs again when they settle)
  // and the bundled font, which may arrive after the first paint. None of
  // them reloads the page.
  window.addEventListener("resize", function () {
    // The reader's text size can change here, which moves the row height at
    // which the row header's two lines stop fitting.
    applyRowHeight();
    queueBlockLabels();
  });
  tl.addEventListener("transitionend", function (e) {
    if (e.propertyName === "width") queueBlockLabels();
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { drawBlockLabels(); });
  }
}

function boot() {
  api("GET", planUrl()).then(function (plan) {
    data = plan;
    indexData();
    var today = data.today ? udate(data.today) : rangeStart;
    markerIndex = clamp(dayDiff(rangeStart, today), 0, DAYS - 1);
    initRowHeight();
    render();
    initZoom();
    bindChrome();
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
