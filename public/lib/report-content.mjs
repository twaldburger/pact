/*
 * PACT report content: the report's own figures - the three pivots, the
 * per-person share table and the two charts - derived from the plan with the
 * app's own rules.
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
 *   - Allocation by person reads that matrix as a share of what each person
 *     offers in the same stretch, so 100% is that person's own ceiling. A
 *     bucket they offer nothing in has no share at all, and reads as null.
 *   - Allocation by tag reads the selected tag rows the same way, over the
 *     capacity the whole plan offers in the same stretch. One denominator for
 *     every row, so the rows and the Other tags residual add up to the plan's
 *     own utilisation - the figure the allocation chart plots. A bucket the
 *     plan offers nothing in has no share at all, and reads as null.
 *   - A project carrying two tags splits its FTE-days evenly between them, so
 *     the tag pivot's totals reconcile exactly with the plan's.
 *   - The by-tag view's rows are the tags the owner ticked, which are stored in
 *     the plan as `tagSplit` (issues #168 and #173).
 *   - Absences are excluded entirely: no absence Project contributes an
 *     FTE-day to any pivot or chart, and the offer is read net of the time off.
 *   - The buckets are the report's own zoom level: a month report has months,
 *     a sprint report has sprints.
 * The pivots keep the order they are handed (the rail's own sort for projects
 * and people); the by-tag pivot is ordered by its own FTE-days, and a row's
 * own tag list is read alphabetically, so a column of tags can be scanned
 * down rather than hunted through.
 */
import { absencesFor, absenceProjectIds, workingDays } from "./workdays.mjs";
import { isTypedTag, tagKind } from "./tags.mjs";

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

// The order a row's tag list is shown in: alphabetical and case-insensitive,
// so `api:Solar` sits among the `a`s whatever its capitalisation or the order
// the project stores its tags in. Two tags differing only in case keep a
// stable order between themselves. A copy, so the plan's own order is not
// touched, and display only, so no figure depends on it.
function compareTagText(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function sortedTags(tags) {
  return tags.slice().sort(compareTagText);
}

/* --- the tags the by-tag view splits by --------------------------------- */

// Every Project tag the plan carries that the report can draw a row for:
// deduplicated across projects and kept in the order the plan reads them.
// Project tags alone, because Project tags are what the by-tag pivot is made
// of, so a tag offered here always has a row to become; an absence Project's
// tags are left out, because no absence contributes a day to any figure and so
// its tags are never rows. A second source - people's tags, an assignment's -
// is another entry in `tagGroups`, not a change to the pivot.
function planProjectTags(plan) {
  const seen = new Set();
  const out = [];
  ((plan && plan.projects) || []).forEach(function (project) {
    if (!project || project.absence) return;
    projectTags(project).forEach(function (tag) {
      if (seen.has(tag)) return;
      seen.add(tag);
      out.push(tag);
    });
  });
  return out;
}

/*
 * What the plan's tag split stands for, as the set of tags the view's rows are.
 * The stored shape is that set, under `tags`.
 *
 * A plan still carrying the shape this replaced - a key plus the tags added
 * beside it - reads as the tags that shape stood for: every Project tag under
 * that key, plus the ones added beside it. Read, never written back, so an old
 * plan opens with its selection intact; the owner's next tick stores the new
 * shape. A malformed split is no selection rather than a broken draw, and the
 * server's validator never lets a saved one be malformed anyway.
 */
export function tagSelection(plan) {
  const split = plan && plan.tagSplit;
  if (!split || typeof split !== "object" || Array.isArray(split)) return [];
  const added = Array.isArray(split.tags) ? split.tags.filter(function (tag) {
    return typeof tag === "string" && tag.trim() !== "";
  }) : [];
  const key = typeof split.key === "string" ? split.key.trim() : "";
  const offer = key === "" ? added : planProjectTags(plan).filter(function (tag) {
    return isTypedTag(tag) && tagKind(tag) === key;
  }).concat(added);
  const seen = new Set();
  const out = [];
  offer.forEach(function (tag) {
    if (seen.has(tag)) return;
    seen.add(tag);
    out.push(tag);
  });
  return out;
}

/*
 * The keys the by-tag view offers as its first row of chips: one entry per key
 * the plan's Project tags carry, alphabetical by key, each key's tags
 * alphabetical too, case insensitive, so a row of chips is scanned rather than
 * hunted through. A tag carrying no key is no entry here - it is a chip in the
 * second row alone, never a key of its own. This is the one function that says
 * what a key is, so a second tag source widens the chips here alone.
 */
export function tagKeyGroups(plan) {
  const byKind = new Map();
  planProjectTags(plan).forEach(function (tag) {
    if (!isTypedTag(tag)) return;
    const kind = tagKind(tag);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind).push(tag);
  });
  return Array.from(byKind.keys()).sort(compareTagText).map(function (kind) {
    return { key: kind, tags: sortedTags(byKind.get(kind)) };
  });
}

/*
 * Every tag the by-tag view offers, as its second row of chips: all the Project
 * tags the report can draw a row for, keyless ones included, alphabetical and
 * case insensitive. This row is the truth - a key's chip is read off it rather
 * than the other way round - so the two rows cannot disagree.
 */
export function tagChoices(plan) {
  return sortedTags(planProjectTags(plan));
}

/*
 * A key's tags read against the selection: how many of them are ticked, and
 * whether that is all of them. A key's chip has no state of its own, so these
 * two readings are its two states and nothing else: it is selected exactly when
 * all of its tags are, and a key holding some of them reads as not selected.
 */
export function tagKeyState(tags, selected) {
  const ticks = new Set(Array.isArray(selected) ? selected : []);
  const list = Array.isArray(tags) ? tags : [];
  const count = list.filter(function (tag) { return ticks.has(tag); }).length;
  return {
    count: count,
    total: list.length,
    all: list.length > 0 && count === list.length
  };
}

/*
 * The selection after one tick: every tag in `tags` selected, or - when they
 * already all are, which is what a key's own tick means - every one of them
 * cleared. Tags outside the list are left alone, so ticking a key never
 * disturbs a tag ticked under another, and a single tag's own tick is the same
 * rule applied to a list of one.
 */
export function tagToggled(selected, tags) {
  const current = Array.isArray(selected) ? selected : [];
  const on = new Set(current);
  if (tags.every(function (tag) { return on.has(tag); })) {
    const off = new Set(tags);
    return current.filter(function (tag) { return !off.has(tag); });
  }
  const out = current.slice();
  tags.forEach(function (tag) {
    if (on.has(tag)) return;
    on.add(tag);
    out.push(tag);
  });
  return out;
}

/*
 * The by-tag view's rows for a set of selected tags, shaped from the complete
 * tag list the pivot already computed: the selected tags in the view's own size
 * order, then one `Other tags` row gathering every tag not selected. A
 * project's FTE-days are split over all its tags, so that residual is exactly
 * what makes the rows reconcile with the plan total - it covers a tag nobody
 * ticked and a project carrying no tag alike, as one row rather than two.
 *
 * The residual is left out when it holds no FTE-days, so a selection that
 * accounts for every day draws no empty row. Null when nothing is selected:
 * there is no split to draw, and the view says so.
 */
export function tagSplitRows(rows, selected) {
  const want = new Set(Array.isArray(selected) ? selected : []);
  if (want.size === 0) return null;
  const all = Array.isArray(rows) ? rows : [];
  // `all` arrives in descending size order, so filtering keeps the rows in it.
  const shown = all.filter(function (row) { return want.has(row.tag); });
  const drawn = new Set(shown.map(function (row) { return row.tag; }));
  const rest = all.filter(function (row) { return !drawn.has(row.tag); });
  const cells = zeros(rest.length > 0 ? rest[0].cells.length : 0);
  let total = 0;
  rest.forEach(function (row) {
    total += row.total;
    row.cells.forEach(function (value, i) { cells[i] += value; });
  });
  const other = Math.abs(total) < 1e-9 ? null : {
    tag: "",
    label: "Other tags",
    slot: null,
    cells: cells,
    total: total
  };

  return { rows: shown, other: other };
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
 * The report writes nothing to the plan, with one exception: the by-tag view's
 * own split is the owner's choice and is stored in the plan like the holidays
 * and the tag colours, so it travels with the plan (issue #168). This module
 * only reads that choice and shapes the view; the write is the store's.
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
      tags: sortedTags(projectTags(p)),
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
      tags: sortedTags(Array.isArray(p.tags) ? p.tags : []),
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

  // --- the by-tag view's own selection ---------------------------------------
  //
  // Shaped from the complete tag list, so the residual is what the rows need to
  // reach the plan total rather than a second reading of the plan, and the
  // view's total row is the pivot's own: the rows and the residual add up to it
  // by construction.
  const tagSplit = tagSplitRows(tagList, tagSelection(plan));
  if (tagSplit) {
    if (tagSplit.other) tagSplit.other.share = planTotal > 0 ? tagSplit.other.total / planTotal : 0;
    tagSplit.total = { cells: tagBuckets, total: planTotal };
  }
  personRows.forEach(function (r) {
    r.pct = r.offered > 0 ? r.total / r.offered : 0;
  });

  // A figure as a share of the capacity the whole plan offers in the same
  // bucket: the one denominator every allocation-by-tag row divides by, so the
  // rows and the residual add up to the plan's own utilisation rather than to
  // 100%. A bucket the plan offers nothing in has no share to state, and is
  // null rather than an Infinity or a 0% that would claim nothing was offered.
  function shareOfCapacity(value, i) {
    return capacityBuckets[i] > 0 ? value / capacityBuckets[i] : null;
  }

  // --- allocation by person: each person's FTE-days over what they offer -----
  //
  // The by-person matrix read as shares: one denominator throughout, the same
  // person's offer in the same bucket, so 100% is their own ceiling whatever
  // their Availability. A row's total is the period figure, not the sum of the
  // cells - percentages do not add - so it is read from the offer over the
  // period rather than accumulated bucket by bucket. A bucket a person offers
  // nothing in (a day off, a weekend day) has no share to state, and is null
  // rather than an Infinity or a 0% that would claim they filled nothing.
  const allocationCells = buckets.map(function (_, i) {
    return capacityBuckets[i] > 0 ? personBuckets[i] / capacityBuckets[i] : null;
  });
  const allocationRows = personRows.map(function (r) {
    return {
      id: r.id,
      name: r.name,
      tags: r.tags,
      cells: r.cells.map(function (value, i) {
        return r.offeredCells[i] > 0 ? value / r.offeredCells[i] : null;
      }),
      total: r.offered > 0 ? r.pct : null
    };
  });
  const byPersonTotal = {
    cells: personBuckets,
    total: planTotal,
    offeredCells: capacityBuckets,
    offered: offeredTotal,
    pct: offeredTotal > 0 ? planTotal / offeredTotal : 0
  };

  // --- allocation by tag: the same rows, over the plan's whole capacity ------
  //
  // The rows the FTE-days view draws - the selection's tags and the Other tags
  // residual - each read as a share of what the whole plan offers in the same
  // bucket, and of everything it offers over the period in the Total column. One
  // denominator for every row, so the rows reconcile with the total row they sit
  // under rather than with 100%. Null while nothing is ticked: there is no split
  // to read.
  function capacityRow(r) {
    return {
      tag: r.tag,
      label: r.label,
      slot: r.slot,
      cells: r.cells.map(shareOfCapacity),
      total: offeredTotal > 0 ? r.total / offeredTotal : null
    };
  }
  const allocationByTag = tagSplit ? {
    rows: tagSplit.rows.map(capacityRow),
    other: tagSplit.other ? capacityRow(tagSplit.other) : null,
    // The plan's overall utilisation, per bucket and over the period: the tag
    // pivot's own total over the capacity the plan offers, which is also what
    // the rows and the residual add up to and the figure the allocation chart
    // plots.
    total: {
      cells: tagBuckets.map(shareOfCapacity),
      total: offeredTotal > 0 ? planTotal / offeredTotal : null
    }
  } : null;

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
      total: byPersonTotal
    },
    allocationByPerson: {
      rows: allocationRows,
      // Everything allocated over everything offered, per bucket and over the
      // period: the same measure the rows carry, with the period figure the
      // by-person total already reads.
      total: {
        cells: allocationCells,
        total: offeredTotal > 0 ? byPersonTotal.pct : null
      }
    },
    byTag: {
      rows: tagList,
      total: { cells: tagBuckets, total: planTotal }
    },
    // The by-tag view's rows as the owner selected them, or null while nothing
    // is ticked. The complete pivot above stays for the chart beside it.
    byTagSplit: tagSplit,
    // The same rows as shares of the plan's own capacity, or null while nothing
    // is ticked. One selection, two readings.
    allocationByTag: allocationByTag,
    charts: charts
  };
}
