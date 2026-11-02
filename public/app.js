/* PACT - interface pass 2. Plain JavaScript, no framework, no build step.
 * The screen is drawn from window.PACT_FIXTURE (see data/fixture.js).
 * Nothing here is persisted: dragging the Marker changes the reading, never
 * the data. */
(function () {
  "use strict";

  var data = window.PACT_FIXTURE;
  var root = document.documentElement;
  var tl = document.getElementById("tl");
  var scroller = document.getElementById("scroller");
  var stackList = document.getElementById("stack-list");
  var panelLayer = document.getElementById("panel-layer");
  var contextEl = document.getElementById("context");

  if (!data || !tl || !scroller) {
    document.body.textContent = "PACT could not load its fixture data.";
    return;
  }

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
    "Sep", "Oct", "Nov", "Dec"];
  var DAY_MS = 86400000;
  var INKS = ["steel", "moss", "teal", "iris", "plum", "umber"];

  /* --- dates (UTC, so day arithmetic never crosses a DST edge) ------------- */

  function udate(iso) {
    var p = iso.split("-");
    return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
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

  /* --- fixture index ------------------------------------------------------- */

  var rangeStart = udate(data.range.start);
  var rangeEnd = udate(data.range.end);
  var DAYS = dayDiff(rangeStart, rangeEnd) + 1;
  var startDow = dow(rangeStart);

  var projectById = {};
  data.projects.forEach(function (p) { projectById[p.id] = p; });
  var personById = {};
  data.people.forEach(function (p) { personById[p.id] = p; });

  var assignments = data.assignments.map(function (a) {
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

  var markerIndex = clamp(dayDiff(rangeStart, udate(data.today)), 0, DAYS - 1);

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
      var head = el("button", "rowhead");
      head.type = "button";
      head.setAttribute("data-person", person.id);
      var name = el("span", "rowhead__name");
      name.textContent = person.name;
      var fig = el("span", "rowhead__fig");
      fig.setAttribute("data-fig", person.id);
      head.appendChild(name);
      head.appendChild(fig);
      head.addEventListener("click", function () {
        openPersonPanel(person, head);
      });
      heads.appendChild(head);

      var row = el("div", "row");
      var ceiling = el("span", "ceiling");
      ceiling.style.setProperty("--avail", person.availability / 100);
      row.appendChild(ceiling);

      layoutPerson(person).forEach(function (group) {
        group.segs.forEach(function (s) {
          row.appendChild(blockFor(group, s));
        });
      });

      body.appendChild(row);
    });

    return { heads: heads, body: body };
  }

  function blockFor(group, s) {
    var a = group.a;
    var b = el("button", "blk");
    b.type = "button";
    b.setAttribute("data-assignment", a.id);
    b.setAttribute("aria-label", a.project.name + " on " + a.person.name + ", " +
      a.share + "% from " + fmtRange(a.start, a.end));
    b.style.setProperty("--block-ink", "var(--proj-" + a.project.colour + ")");
    set(b, s.start, s.end - s.start + 1);
    b.style.setProperty("--b", r4(s.offset));
    b.style.setProperty("--h", r4(group.h));
    b.style.setProperty("--hatch", r4(s.hatch));
    if (s.end - s.start + 1 <= 1) b.classList.add("is-tight");
    if (s.hatch > 0) b.appendChild(el("span", "blk__hatch"));
    var tag = el("span", "blk__tag");
    tag.textContent = a.project.name + " \u00b7 " + a.share + "%";
    b.appendChild(tag);
    b.addEventListener("click", function () {
      select(b);
      openAssignmentPanel(a, b);
    });
    return b;
  }

  /* --- drawing: marker ----------------------------------------------------- */

  var marker, markerDate;

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
    var headW = tl.querySelector(".tl__heads").getBoundingClientRect().width;
    var dayW = (tlRect.width - headW) / DAYS;
    return clamp(Math.floor((x - (tlRect.left + headW)) / dayW), 0, DAYS - 1);
  }

  var dragging = false;

  function onMarkerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragging = true;
    root.classList.add("is-dragging");
    try { marker.setPointerCapture(e.pointerId); } catch (err) { /* synthetic input */ }
    e.preventDefault();
    marker.focus();
  }
  function onMarkerMove(e) {
    if (!dragging) return;
    setMarker(indexFromClientX(e.clientX));
  }
  function onMarkerUp(e) {
    if (!dragging) return;
    dragging = false;
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
        openProjectPanel(project, item);
      });
      stackList.appendChild(item);
    });
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

  function openPanel(node, trigger) {
    closePanel(false);
    panelTrigger = trigger || null;
    panelLayer.hidden = false;
    panelLayer.appendChild(node);
    panel = node;
    var close = node.querySelector(".panel__close");
    if (close) close.focus();

    var r = trigger.getBoundingClientRect();
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

  function chipsFor(tags) {
    var wrap = el("span", "chips");
    (tags || []).forEach(function (t) {
      var c = el("span", "chip");
      c.textContent = t;
      wrap.appendChild(c);
    });
    var add = el("button", "chip-add");
    add.type = "button";
    add.textContent = "+";
    add.setAttribute("aria-label", "Add a tag");
    wrap.appendChild(add);
    return wrap;
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

  function footnote(node) {
    var p = el("p", "panel__note");
    p.textContent = "Fixture preview - edits are not saved in this pass.";
    node.appendChild(p);
  }

  function openAssignmentPanel(a, trigger) {
    var node = panelShell(a.project.name + " \u00b7 " + a.person.name,
      fmtRange(a.start, a.end));
    var fields = el("dl", "fields");
    var share = el("span");
    share.textContent = a.share + "%";
    var hint = el("span", "soft");
    hint.textContent = "  (drag to change)";
    share.appendChild(hint);
    fields.appendChild(field("Share", share));
    fields.appendChild(field("Tags", chipsFor(a.raw.tags)));
    fields.appendChild(field("Note", a.raw.note || "-"));
    node.appendChild(fields);

    var foot = el("div", "panel__foot");
    var archive = el("button", "btn-ghost");
    archive.type = "button";
    archive.textContent = "archive";
    foot.appendChild(archive);
    node.appendChild(foot);
    footnote(node);
    openPanel(node, trigger);
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

  function openPersonPanel(person, trigger) {
    var node = panelShell(person ? "Person" : "Add person",
      person ? null : "Availability is set in steps of 10%.");
    var form = el("form", "form");
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    form.appendChild(formRow("Name", input(person ? person.name : "")));

    var select = document.createElement("select");
    for (var v = 10; v <= 100; v += 10) {
      var opt = document.createElement("option");
      opt.value = String(v);
      opt.textContent = v + " %";
      if (person && person.availability === v) opt.selected = true;
      select.appendChild(opt);
    }
    form.appendChild(formRow("Availability", select));
    form.appendChild(formRow("Tags", chipsFor(person ? person.tags : [])));
    form.appendChild(formRow("Note", input(person ? person.note : "")));
    node.appendChild(form);
    footnote(node);
    openPanel(node, trigger);
  }

  function openProjectPanel(project, trigger) {
    var node = panelShell(project ? "Project" : "Add project",
      project ? null : "A project exists on its own, before any person.");
    var form = el("form", "form");
    form.addEventListener("submit", function (e) { e.preventDefault(); });

    form.appendChild(formRow("Name", input(project ? project.name : "")));

    var swatches = el("span", "swatches");
    INKS.forEach(function (ink) {
      var sw = el("button", "swatch");
      sw.type = "button";
      sw.style.setProperty("--pick", "var(--proj-" + ink + ")");
      sw.setAttribute("aria-label", "Colour " + ink);
      sw.setAttribute("aria-pressed", project && project.colour === ink ? "true" : "false");
      swatches.appendChild(sw);
    });
    form.appendChild(formRow("Colour", swatches));

    var notes = document.createElement("textarea");
    notes.value = project ? project.notes : "";
    form.appendChild(formRow("Notes", notes));
    node.appendChild(form);

    var foot = el("div", "panel__foot");
    var save = el("button", "btn-ghost");
    save.type = "button";
    save.textContent = "save";
    foot.appendChild(save);
    node.appendChild(foot);
    footnote(node);
    openPanel(node, trigger);
  }

  /* --- zoom ---------------------------------------------------------------- */

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
    }
    buttons.forEach(function (b) {
      b.addEventListener("click", function () { choose(b.getAttribute("data-zoom")); });
    });
    choose(root.getAttribute("data-zoom") || "day");
  }

  /* --- wiring -------------------------------------------------------------- */

  function init() {
    tl.style.setProperty("--days", DAYS);

    var overlay = el("div", "weekends");
    weekends().forEach(function (w) {
      overlay.appendChild(set(el("span", "weekend"), w.i, w.n));
    });

    var corner = el("div", "tl__corner");
    corner.textContent = "Person";

    var rows = drawRows();

    tl.appendChild(overlay);
    tl.appendChild(corner);
    tl.appendChild(drawAxis());
    tl.appendChild(rows.heads);
    tl.appendChild(rows.body);
    tl.appendChild(drawMarker());

    drawStack();
    setMarker(markerIndex);
    initZoom();

    contextEl.textContent =
      MONTHS_SHORT[rangeStart.getUTCMonth()] + " - " +
      MONTHS_SHORT[rangeEnd.getUTCMonth()] + " " + rangeEnd.getUTCFullYear();

    document.getElementById("add-person").addEventListener("click", function (e) {
      openPersonPanel(null, e.currentTarget);
    });
    document.getElementById("add-project").addEventListener("click", function (e) {
      openProjectPanel(null, e.currentTarget);
    });

    panelLayer.addEventListener("pointerdown", function (e) {
      if (e.target === panelLayer) closePanel(true);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panel) closePanel(true);
    });
    scroller.addEventListener("scroll", function () {
      if (panel) closePanel(false);
    });

    window.requestAnimationFrame(function () {
      var tlRect = tl.getBoundingClientRect();
      var headW = rows.heads.getBoundingClientRect().width;
      var dayW = (tlRect.width - headW) / DAYS;
      scroller.scrollLeft = Math.max(0, markerIndex * dayW - scroller.clientWidth * 0.3);
    });
  }

  init();
})();
