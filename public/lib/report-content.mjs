/*
 * PACT report content: the report's own figures - the three pivots and the two
 * charts - derived from the plan with the app's own rules.
 *
 * A plain ES module importing only the working-day rule, so the browser
 * (public/app.js) and `node --test` load exactly the same source. Every figure
 * is the figure the grid itself would print: `workdays.mjs` owns which days
 * count and how much of one (weekends, the Location's holidays and the Person's
 * absences subtracted exactly as the grid does), so a project's row total is
 * the same `share/100 * working days` its measure in `sort.mjs` sums.
 *
 * The report's shape, settled in issue #134:
 *   - Three pivots - by project, by person and by tag - each a matrix of one
 *     row per thing and one column per time bucket, plus a Total column and a
 *     Total row. Each row carries its FTE-days as a share of the report total.
 *   - The by-person table carries the person's offered FTE-days beside the
 *     work, so the percentage of what they offer is readable.
 *   - A project carrying two tags splits its FTE-days evenly between them, so
 *     the tag pivot's totals reconcile exactly with the plan's.
 *   - Absences are excluded entirely: no absence Project contributes an
 *     FTE-day to any pivot or chart, and the offer is read net of the time off.
 *   - The buckets are the report's own zoom level: a month report has months,
 *     a sprint report has sprints.
 * The pivots keep the order they are handed (the rail's own sort for projects
 * and people); the by-tag pivot is ordered by its own FTE-days.
 */
import { absencesFor, absenceProjectIds, workingDays } from "./workdays.mjs";

const DAY_MS = 86400000;
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* --- dates (UTC, so day arithmetic never crosses a DST edge) ------------- */

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

function udate(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

function pad2(n) { return n < 10 ? "0" + n : String(n); }

function toISO(d) {
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

function addDays(d, n) {
  return new Date(d.getTime() + n * DAY_MS);
}

function dayDiff(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function shortDate(iso) {
  return Number(iso.slice(8, 10)) + " " + MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
}

/* --- the report's time buckets ------------------------------------------- */

/*
 * The report's buckets for its own zoom level, in order, each with the ISO
 * bounds the figures are clipped to. The bounds never leave the plan period, so
 * the buckets tile the period exactly and the pivots reconcile with it.
 *
 *   - Day: one bucket per calendar day.
 *   - Week: a run of up to seven days from the period's own start, so the
 *     first week is short or long only at that edge - the same edges the grid
 *     rules on.
 *   - Month: one bucket per calendar month, the first and last clipped.
 *   - Sprint: one bucket per derived sprint; with no cadence there is no
 *     sprint to draw, so the report falls back on months rather than an empty
 *     table.
 */
export function reportBuckets(plan, zoom, sprints) {
  const range = plan && plan.range;
  if (!range || !isISODate(range.start) || !isISODate(range.end) || range.end < range.start) return [];
  const startISO = range.start;
  const endISO = range.end;

  if (zoom === "day") {
    const out = [];
    const start = udate(startISO);
    const n = dayDiff(start, udate(endISO));
    for (let i = 0; i <= n; i++) {
      const iso = toISO(addDays(start, i));
      out.push({ key: iso, label: shortDate(iso), start: iso, end: iso });
    }
    return out;
  }

  if (zoom === "week") {
    const out = [];
    const start = udate(startISO);
    const end = udate(endISO);
    const days = dayDiff(start, end);
    for (let i = 0; i <= days;) {
      const span = Math.min(((7 - ((start.getUTCDay() + i) % 7)) % 7) + 1, days - i + 1);
      const from = toISO(addDays(start, i));
      const to = toISO(addDays(start, i + span - 1));
      out.push({ key: from, label: shortDate(from), start: from, end: to });
      i += span;
    }
    return out;
  }

  if (zoom === "sprint" && Array.isArray(sprints) && sprints.length > 0) {
    return sprints.map(function (sp, i) {
      const from = sp.start < startISO ? startISO : sp.start;
      const to = sp.end > endISO ? endISO : sp.end;
      return {
        key: String(sp.index == null ? i : sp.index),
        label: sp.name || "Sprint " + (i + 1),
        start: from,
        end: to
      };
    });
  }

  const out = [];
  const start = udate(startISO);
  const end = udate(endISO);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const lastMonth = end.getUTCFullYear() * 12 + end.getUTCMonth();
  while (y * 12 + m <= lastMonth) {
    const first = toISO(new Date(Date.UTC(y, m, 1)));
    const lastDay = new Date(Date.UTC(y, m + 1, 0));
    let last = toISO(lastDay);
    if (first > endISO || last < startISO) {
      m += 1;
      if (m > 11) { m = 0; y += 1; }
      continue;
    }
    if (last > endISO) last = endISO;
    const from = first < startISO ? startISO : first;
    out.push({ key: y + "-" + pad2(m + 1), label: MONTHS_SHORT[m], start: from, end: last });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
}

/* --- the figures --------------------------------------------------------- */

// The overlap of an Assignment's own span with a bucket, or null when the two
// do not meet. ISO dates compare exactly as strings.
function clip(startISO, endISO, bucket) {
  const s = startISO > bucket.start ? startISO : bucket.start;
  const e = endISO < bucket.end ? endISO : bucket.end;
  return s <= e ? [s, e] : null;
}

function addCell(cells, i, value) {
  cells[i] += value;
}

function zeros(n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = 0;
  return out;
}

function sum(list) {
  return list.reduce(function (s, v) { return s + v; }, 0);
}

// The project tags a project carries, deduplicated and kept in their order, so
// a repeated tag cannot halve the split twice. A project with no tag is its own
// row, so the tag pivot still reconciles with the plan.
function projectTags(project) {
  const seen = new Set();
  const out = [];
  (project && Array.isArray(project.tags) ? project.tags : []).forEach(function (tag) {
    const text = String(tag);
    if (text === "" || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  });
  return out;
}

/*
 * The whole report: the buckets, the three pivots and the two charts, from a
 * filtered view and the plan it was filtered from.
 *
 * `view` is `{ projects, people, assignments }`, each already in display order
 * (the rail's sort for the first two) and already filtered, so the report's
 * rows and the grid's rows are the same list. `plan` is the whole plan, read
 * for the holidays, the absences and the tag colours. `options` carries the
 * report's zoom, the derived sprint chain, and the resolved tag colour map.
 *
 * The report writes nothing: it only reads.
 */
export function reportContent(view, plan, options) {
  const opts = options || {};
  const buckets = reportBuckets(plan, opts.zoom, opts.sprints);
  const bucketCount = buckets.length;
  const tagSlots = opts.tagSlots || {};
  const absenceIds = absenceProjectIds(plan);

  const people = (view && view.people) || [];
  // An absence Project is never a row: it carries time off, not delivery, and
  // the report measures delivery alone.
  const projects = ((view && view.projects) || []).filter(function (p) {
    return p && !absenceIds.has(p.id);
  });
  const assignments = (view && view.assignments) || [];

  const peopleById = {};
  people.forEach(function (p) { peopleById[p.id] = p; });
  const projectById = {};
  projects.forEach(function (p) { projectById[p.id] = p; });

  // One Person's absences, read once: the whole plan defines them, so a
  // filtered view does not change what a working day is.
  const absenceCache = new Map();
  function absencesOf(personId) {
    if (!absenceCache.has(personId)) absenceCache.set(personId, absencesFor(plan, personId));
    return absenceCache.get(personId);
  }

  // An absence Project contributes nothing to any pivot or chart: its
  // Assignments are the time off, not delivery.
  const work = assignments.filter(function (a) {
    return a && !absenceIds.has(a.projectId);
  });

  const projectCells = {};
  const personCells = {};
  function cellsFor(store, id) {
    if (!store[id]) store[id] = zeros(bucketCount);
    return store[id];
  }
  people.forEach(function (p) { cellsFor(personCells, p.id); });
  projects.forEach(function (p) { cellsFor(projectCells, p.id); });

  work.forEach(function (a) {
    const person = peopleById[a.personId];
    if (!person) return;
    const project = projectById[a.projectId];
    if (!project) return;
    const pc = cellsFor(projectCells, a.projectId);
    const hc = cellsFor(personCells, a.personId);
    const off = absencesOf(a.personId);
    const share = (Number(a.share) || 0) / 100;
    buckets.forEach(function (b, i) {
      const c = clip(a.start, a.end, b);
      if (!c) return;
      const value = share * workingDays(c[0], c[1], person.location, plan.holidays, off);
      addCell(pc, i, value);
      addCell(hc, i, value);
    });
  });

  // A Person's offer over one bucket: their Availability over the working days
  // they are actually there for - absences taken out, because the report
  // measures delivery. The buckets tile the period, so the per-person offers
  // sum to the offer over the whole period.
  function offerCells(person) {
    const off = absencesOf(person.id);
    return buckets.map(function (b) {
      return (Number(person.availability) || 0) / 100 *
        workingDays(b.start, b.end, person.location, plan.holidays, off);
    });
  }

  const projectRows = projects.map(function (p) {
    const cells = projectCells[p.id] || zeros(bucketCount);
    return {
      id: p.id,
      name: p.name,
      colour: p.colour,
      tags: projectTags(p),
      cells: cells,
      total: sum(cells)
    };
  });

  const personRows = people.map(function (p) {
    const cells = personCells[p.id] || zeros(bucketCount);
    const offeredCells = offerCells(p);
    const offered = sum(offeredCells);
    return {
      id: p.id,
      name: p.name,
      tags: Array.isArray(p.tags) ? p.tags.slice() : [],
      cells: cells,
      total: sum(cells),
      offeredCells: offeredCells,
      offered: offered
    };
  });

  // --- the tag pivot: each project's FTE-days split evenly over its tags -----
  const tagRows = new Map();
  function tagRow(key, label) {
    if (!tagRows.has(key)) {
      tagRows.set(key, {
        tag: key,
        label: label,
        slot: Object.prototype.hasOwnProperty.call(tagSlots, key) ? tagSlots[key] : null,
        cells: zeros(bucketCount),
        projects: 0
      });
    }
    return tagRows.get(key);
  }
  projectRows.forEach(function (row) {
    const tags = row.tags.length > 0 ? row.tags : [""];
    const each = 1 / tags.length;
    tags.forEach(function (tag) {
      const target = tagRow(tag, tag === "" ? "Untagged" : tag);
      target.projects += 1;
      for (let i = 0; i < bucketCount; i++) target.cells[i] += row.cells[i] * each;
    });
  });
  const tagList = Array.from(tagRows.values()).map(function (r) {
    r.total = sum(r.cells);
    return r;
  }).sort(function (a, b) {
    if (a.total !== b.total) return b.total - a.total;
    return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  });

  // --- totals ---------------------------------------------------------------
  const projectBuckets = buckets.map(function (_, i) {
    return projectRows.reduce(function (s, r) { return s + r.cells[i]; }, 0);
  });
  const personBuckets = buckets.map(function (_, i) {
    return personRows.reduce(function (s, r) { return s + r.cells[i]; }, 0);
  });
  const tagBuckets = buckets.map(function (_, i) {
    return tagList.reduce(function (s, r) { return s + r.cells[i]; }, 0);
  });
  const capacityBuckets = buckets.map(function (_, i) {
    return personRows.reduce(function (s, r) { return s + r.offeredCells[i]; }, 0);
  });
  const planTotal = sum(projectBuckets);
  const offeredTotal = sum(capacityBuckets);

  function withShare(rows, total) {
    return rows.map(function (r) {
      r.share = total > 0 ? r.total / total : 0;
      return r;
    });
  }
  withShare(projectRows, planTotal);
  withShare(personRows, planTotal);
  withShare(tagList, planTotal);
  personRows.forEach(function (r) {
    r.pct = r.offered > 0 ? r.total / r.offered : 0;
  });

  const charts = {
    stacked: buckets.map(function (b, i) {
      return {
        key: b.key,
        label: b.label,
        segments: tagList.map(function (r) {
          return { tag: r.tag, label: r.label, slot: r.slot, value: r.cells[i] };
        })
      };
    }),
    line: buckets.map(function (b, i) {
      return {
        key: b.key,
        label: b.label,
        alloc: projectBuckets[i],
        capacity: capacityBuckets[i]
      };
    })
  };

  return {
    buckets: buckets,
    planTotal: planTotal,
    offeredTotal: offeredTotal,
    byProject: {
      rows: projectRows,
      total: { cells: projectBuckets, total: planTotal }
    },
    byPerson: {
      rows: personRows,
      total: {
        cells: personBuckets,
        total: planTotal,
        offeredCells: capacityBuckets,
        offered: offeredTotal,
        pct: offeredTotal > 0 ? planTotal / offeredTotal : 0
      }
    },
    byTag: {
      rows: tagList,
      total: { cells: tagBuckets, total: planTotal }
    },
    charts: charts
  };
}
