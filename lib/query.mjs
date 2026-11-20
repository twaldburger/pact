/*
 * PACT queries: the questions a caller asks of a plan, answered from the app's
 * own report modules.
 *
 * This module is the tool surface a command-line front end or a protocol
 * adapter exposes. Every function is pure: it takes a plan object (the parsed
 * plan, not a path), returns a plain JSON-serialisable object, and never reads
 * argv or the environment, never touches the filesystem, never prints and never
 * exits. The period it counts over is resolved from the plan and the caller's
 * period spec, and is echoed in every answer with the range it counted, so no
 * figure is ambiguous about what it counted. Figures come from
 * `report-content.mjs` over the plan with its period set to the resolved one,
 * so a tool answer and the report page cannot disagree. Absence Projects are
 * left out of every figure, exactly as the report leaves them out.
 *
 * Errors are `QueryError`, carrying a stable `code` ("bad-period",
 * "unknown-subject" or "ambiguous-subject") and, where there are any, the
 * nearest match strings:
 *
 *   resolvePeriod(plan, period)
 *     period: absent for the plan's own period, or "2026-11" (a month), a
 *       sprint's name such as "Sprint 24" (or "sprint 24" for its ordinal), or
 *       "2026-11-01..2026-11-30" (a range).
 *     returns { kind, label, start, end, outsidePlan }
 *
 *   planSummary(plan, period)
 *     returns { period, units, planPeriod: { start, end }, step,
 *       counts: { people, projects, assignments, milestones },
 *       totals: { capacity, allocated, remaining, ofCapacity } }
 *
 *   people(plan, period)
 *     returns { period, units,
 *       people: [{ id, name, location, availability, tags, note, capacity,
 *         allocated, remaining, ofOffer, overAllocated, buckets }],
 *       totals: { capacity, allocated, remaining, ofCapacity } }
 *     Each bucket is { key, label, start, end, capacity, allocated, remaining,
 *     ofOffer, overAllocated }; capacity and allocated are the Person's own.
 *
 *   person(plan, period, name)
 *     returns { period, units, person: <one people row>,
 *       assignments: [{ id, projectId, project, personId, person, share,
 *         start, end, tags, note, absence }] }
 *     The assignments are the plan's stored facts for that Person whose dates
 *     meet the period, in date order. They are not summed: overlapping
 *     Assignments do not add.
 *
 *   projects(plan, period)
 *     returns { period, units,
 *       projects: [{ id, name, tags, notes, absence, allocated, ofPlan,
 *         ofCapacity, buckets }],
 *       totals: { capacity, allocated, ofPlan, ofCapacity } }
 *     An absence Project is listed with its facts and null figures, since it
 *     contributes no FTE-day. Each bucket is { key, label, start, end,
 *     allocated, capacity, ofCapacity }, where capacity is the whole plan's.
 *
 *   project(plan, period, name)
 *     returns { period, units, project: <one projects row>,
 *       assignments: [{ id, projectId, project, personId, person, share,
 *         start, end, tags, note, absence }] }
 *
 *   tags(plan, period)
 *     returns { period, units,
 *       tags: [{ tag, label, allocated, ofPlan, projects, buckets }],
 *       totals: { allocated, ofPlan, count } }
 *     A row is one row of the report's by-tag pivot, "Untagged" included. Each
 *     bucket is { key, label, start, end, allocated }.
 *
 *   tag(plan, period, key)
 *     key: a tag's name, or a tag key ("api" for every typed tag under it).
 *     returns { period, units, key, match: "tag" | "key", tags: [<tags rows>],
 *       allocated, ofPlan }
 *
 *   capacity(plan, period)
 *     returns { period, units, capacity, allocated, remaining, ofCapacity,
 *       buckets: [{ key, label, start, end, capacity, allocated, remaining,
 *         ofCapacity }] }
 *     The whole plan's Capacity offered against what it is Allocated, overall
 *     and per time bucket.
 *
 *   holidays(plan)
 *     returns { holidays: [{ location, dates: [{ date, kind }] }] }
 *     As stored, read through the app's own holiday rule: Locations
 *     deduplicated and dates in date order.
 *
 *   milestones(plan)
 *     returns { milestones: [{ id, name, date, colour, tags, notes, projectIds,
 *       projects: [{ id, name }] }] }
 *     As stored, with each related Project resolved by the app's own rule.
 *
 * `capacity`, `allocated` and `remaining` are FTE-days; `ofOffer`, `ofPlan` and
 * `ofCapacity` are fractions where 1.0 is 100%, and null where the denominator
 * offers no Capacity. `units` repeats those units in every answer that carries
 * figures, so a machine does not have to guess.
 *
 * A `period` argument may be a resolved period object or the spec string
 * `resolvePeriod` accepts; absent means the plan's own period. The period a
 * query actually counted is always in its answer.
 */
import { reportContent } from "../public/lib/report-content.mjs";
import { sprintsFor } from "../public/lib/sprints.mjs";
import { visiblePlan } from "../public/lib/visibility.mjs";
import { isTypedTag, tagKind } from "../public/lib/tags.mjs";
import { holidayLocations, holidaysFor } from "../public/lib/holidays.mjs";
import { milestoneProjects } from "../public/lib/milestones.mjs";
import { rangeLabel } from "../public/lib/label.mjs";
import { absenceProjectIds } from "../public/lib/workdays.mjs";
import { normalizeStep } from "../public/lib/panels.mjs";

const EPSILON = 1e-9;
const SUGGESTION_LIMIT = 5;

// The units every figure-bearing answer carries, by field name. A stable map
// rather than a sentence, so an adapter can read it.
const UNITS = Object.freeze({
  capacity: "FTE-days",
  allocated: "FTE-days",
  remaining: "FTE-days",
  ofOffer: "fraction, 1.0 = 100%",
  ofPlan: "fraction, 1.0 = 100%",
  ofCapacity: "fraction, 1.0 = 100%"
});

export class QueryError extends Error {
  constructor(message, code, suggestions) {
    super(message);
    this.name = "QueryError";
    this.code = code || "query";
    this.suggestions = Array.isArray(suggestions) ? suggestions.slice() : [];
  }
}

function units() {
  return Object.assign({}, UNITS);
}

/* --- dates and the resolved period --------------------------------------- */

function isISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return d.toISOString().slice(0, 10) === value;
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function isoOf(date) {
  return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
}

function monthEnd(year, month) {
  return isoOf(new Date(Date.UTC(year, month, 0)));
}

function planRange(plan) {
  const range = plan && plan.range;
  return range && isISODate(range.start) && isISODate(range.end) && range.start <= range.end
    ? { start: range.start, end: range.end }
    : null;
}

// The resolved period, always the same five fields: what was asked for, the
// range actually counted, and whether that range lies wholly outside the plan.
function resolvedPeriod(plan, kind, label, start, end) {
  const range = planRange(plan);
  return {
    kind: kind,
    label: label,
    start: start,
    end: end,
    outsidePlan: range ? end < range.start || start > range.end : false
  };
}

function badPeriod(message, suggestions) {
  return new QueryError(message, "bad-period", suggestions);
}

/*
 * Resolve a period spec against the plan. No spec is the plan's own period;
 * a `YYYY-MM` is that calendar month; a sprint is its name or its ordinal in
 * the derived chain; `A..B` is an explicit inclusive range. A spec that names
 * no usable period is a `bad-period` error naming the accepted forms.
 */
export function resolvePeriod(plan, spec) {
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    if (!isISODate(spec.start) || !isISODate(spec.end) || spec.start > spec.end) {
      throw badPeriod("unusable period; use a month (2026-11), a sprint name (Sprint 24), " +
        "or a range (2026-11-01..2026-11-30)");
    }
    const kinds = ["plan", "month", "sprint", "range"];
    return resolvedPeriod(plan, kinds.indexOf(spec.kind) === -1 ? "range" : spec.kind,
      typeof spec.label === "string" && spec.label !== "" ? spec.label : rangeLabel(spec.start, spec.end),
      spec.start, spec.end);
  }

  const text = spec === undefined || spec === null ? "" : String(spec).trim();
  if (text === "") {
    const range = planRange(plan);
    if (!range) throw badPeriod("the plan has no usable period; pass a period such as 2026-11");
    return resolvedPeriod(plan, "plan", rangeLabel(range.start, range.end), range.start, range.end);
  }

  const range = /^(\d{4}-\d{2}-\d{2})\s*\.\.\s*(\d{4}-\d{2}-\d{2})$/.exec(text);
  if (range) {
    if (!isISODate(range[1]) || !isISODate(range[2]) || range[1] > range[2]) {
      throw badPeriod("unusable range \"" + text + "\"; both ends must be valid YYYY-MM-DD dates " +
        "with the start not after the end, as in 2026-11-01..2026-11-30");
    }
    return resolvedPeriod(plan, "range", rangeLabel(range[1], range[2]), range[1], range[2]);
  }

  const month = /^(\d{4})-(\d{2})$/.exec(text);
  if (month) {
    const year = +month[1];
    const number = +month[2];
    const start = month[1] + "-" + month[2] + "-01";
    const end = monthEnd(year, number);
    if (number < 1 || number > 12 || !isISODate(start) || !isISODate(end)) {
      throw badPeriod("unusable month \"" + text + "\"; a month is YYYY-MM from 01 to 12, as in 2026-11");
    }
    return resolvedPeriod(plan, "month", rangeLabel(start, end), start, end);
  }

  // A date-shaped spec that got this far is a malformed range or a bare date,
  // not a sprint name; say so rather than blaming the sprint chain.
  if (/^\d{4}-\d/.test(text) || text.indexOf("..") !== -1) {
    throw badPeriod("unusable period \"" + text + "\"; a range is two full dates, as in " +
      "2026-11-01..2026-11-30, and a month is 2026-11");
  }

  const chain = sprintsFor(plan && plan.cadence, plan && plan.sprints, plan && plan.range);
  const wanted = text.toLowerCase();
  let sprint = chain.find(function (entry) {
    return String(entry.name).trim().toLowerCase() === wanted;
  });
  if (!sprint) {
    const ordinal = /^sprint\s+(\d+)$/i.exec(text);
    if (ordinal) {
      sprint = chain.find(function (entry) { return entry.index === +ordinal[1]; });
    }
  }
  if (sprint) {
    return resolvedPeriod(plan, "sprint", sprint.name, sprint.start, sprint.end);
  }
  if (chain.length === 0) {
    throw badPeriod("no sprints are defined in this plan; use a month (2026-11) " +
      "or a range (2026-11-01..2026-11-30)");
  }
  const names = chain.map(function (entry) { return entry.name; });
  throw badPeriod("no sprint named \"" + text + "\" in this plan; use a month (2026-11) or a " +
    "range (2026-11-01..2026-11-30), or one of its sprints", nearest(wanted, names));
}

// One resolved period for a query: the caller's, or the plan's own when none
// was handed in.
function periodFor(plan, period) {
  return resolvePeriod(plan, period);
}

/* --- the report, and the rows every answer is built from ----------------- */

/*
 * The report's model for a resolved period, over the live plan: the same
 * reportContent call the report page makes, with the period set to the one
 * asked for. The report's own order is the plan's order, since a tool has no
 * sort state; archived records are left out as they are by default on screen.
 */
function reportFor(plan, period) {
  const resolved = periodFor(plan, period);
  const ranged = Object.assign({}, plan, { range: { start: resolved.start, end: resolved.end } });
  const view = visiblePlan(ranged, false);
  const sprints = sprintsFor(ranged.cadence, ranged.sprints, ranged.range);
  const model = reportContent(
    { projects: view.projects, people: view.people, assignments: view.assignments },
    ranged,
    { zoom: resolved.kind === "sprint" ? "sprint" : "month", sprints: sprints, tagSlots: {} }
  );
  return { period: resolved, plan: ranged, view: view, model: model };
}

function bucketBase(bucket) {
  return { key: bucket.key, label: bucket.label, start: bucket.start, end: bucket.end };
}

function personBuckets(model, row, allocation) {
  return model.buckets.map(function (bucket, i) {
    const capacity = row.offeredCells[i];
    const allocated = row.cells[i];
    return Object.assign(bucketBase(bucket), {
      capacity: capacity,
      allocated: allocated,
      remaining: capacity - allocated,
      ofOffer: allocation ? allocation.cells[i] : null,
      overAllocated: allocated > capacity + EPSILON
    });
  });
}

function projectBuckets(model, row, allocation) {
  return model.buckets.map(function (bucket, i) {
    return Object.assign(bucketBase(bucket), {
      allocated: row.cells[i],
      capacity: model.chart[i].capacity,
      ofCapacity: allocation ? allocation.cells[i] : null
    });
  });
}

function tagBuckets(model, row) {
  return model.buckets.map(function (bucket, i) {
    return Object.assign(bucketBase(bucket), { allocated: row.cells[i] });
  });
}

function planTotals(model) {
  const capacity = model.offeredTotal;
  const allocated = model.planTotal;
  return {
    capacity: capacity,
    allocated: allocated,
    remaining: capacity - allocated,
    ofCapacity: model.allocationByPerson.total.total
  };
}

function personRow(model, row, person, allocation) {
  return {
    id: row.id,
    name: row.name,
    location: typeof person.location === "string" ? person.location : "",
    availability: Number(person.availability) || 0,
    tags: row.tags,
    note: typeof person.note === "string" ? person.note : "",
    capacity: row.offered,
    allocated: row.total,
    remaining: row.offered - row.total,
    ofOffer: row.offered > 0 ? row.pct : null,
    overAllocated: row.total > row.offered + EPSILON,
    buckets: personBuckets(model, row, allocation)
  };
}

function projectRow(model, project, row, allocation) {
  if (project.absence === true) {
    return {
      id: project.id,
      name: project.name,
      tags: Array.isArray(project.tags) ? project.tags.slice() : [],
      notes: typeof project.notes === "string" ? project.notes : "",
      absence: true,
      allocated: null,
      ofPlan: null,
      ofCapacity: null,
      buckets: []
    };
  }
  return {
    id: project.id,
    name: project.name,
    tags: row ? row.tags : [],
    notes: typeof project.notes === "string" ? project.notes : "",
    absence: false,
    allocated: row ? row.total : null,
    ofPlan: row ? row.share : null,
    ofCapacity: allocation ? allocation.total : null,
    buckets: row ? projectBuckets(model, row, allocation) : []
  };
}

function tagRow(model, row) {
  return {
    tag: row.tag,
    label: row.label,
    allocated: row.total,
    ofPlan: row.share,
    projects: row.projects,
    buckets: tagBuckets(model, row)
  };
}

// A Person's or a Project's Assignments whose stored dates meet the period.
// Stored facts, never summed: two overlapping Assignments do not add up.
function assignmentsIn(report, period, field, id) {
  const absenceIds = absenceProjectIds(report.plan);
  const byId = {};
  report.view.projects.forEach(function (project) { byId[project.id] = project; });
  return report.view.assignments.filter(function (assignment) {
    return assignment[field] === id &&
      assignment.start <= period.end && assignment.end >= period.start;
  }).map(function (assignment) {
    const project = byId[assignment.projectId];
    return {
      id: assignment.id,
      projectId: assignment.projectId,
      project: project ? project.name : assignment.projectId,
      personId: assignment.personId,
      person: personName(report, assignment.personId),
      share: assignment.share,
      start: assignment.start,
      end: assignment.end,
      tags: Array.isArray(assignment.tags) ? assignment.tags.slice() : [],
      note: typeof assignment.note === "string" ? assignment.note : "",
      absence: absenceIds.has(assignment.projectId)
    };
  }).sort(function (a, b) {
    if (a.start !== b.start) return a.start < b.start ? -1 : 1;
    if (a.end !== b.end) return a.end < b.end ? -1 : 1;
    return a.project < b.project ? -1 : a.project > b.project ? 1 : 0;
  });
}

function personName(report, id) {
  const person = report.view.people.find(function (p) { return p.id === id; });
  return person ? person.name : id;
}

/* --- plan summary --------------------------------------------------------- */

export function planSummary(plan, period) {
  const report = reportFor(plan, period);
  const range = planRange(plan) || { start: report.period.start, end: report.period.end };
  return {
    period: report.period,
    units: units(),
    planPeriod: { start: range.start, end: range.end },
    step: normalizeStep(plan && plan.step),
    counts: {
      people: report.view.people.length,
      projects: report.view.projects.length,
      assignments: report.view.assignments.length,
      milestones: Array.isArray(plan && plan.milestones) ? plan.milestones.length : 0
    },
    totals: planTotals(report.model)
  };
}

/* --- people and one person ------------------------------------------------ */

export function people(plan, period) {
  const report = reportFor(plan, period);
  const model = report.model;
  const byId = {};
  report.view.people.forEach(function (person) { byId[person.id] = person; });
  const allocationById = {};
  model.allocationByPerson.rows.forEach(function (row) { allocationById[row.id] = row; });
  return {
    period: report.period,
    units: units(),
    people: model.byPerson.rows.map(function (row) {
      return personRow(model, row, byId[row.id] || {}, allocationById[row.id]);
    }),
    totals: planTotals(model)
  };
}

export function person(plan, period, name) {
  const wanted = nameText(name, "person");
  const report = reportFor(plan, period);
  const model = report.model;
  const found = matchOne(report.view.people, wanted, "person",
    function (p) { return p.name; },
    function (p) { return [p.name, p.id]; });
  const row = model.byPerson.rows.find(function (r) { return r.id === found.id; });
  const allocation = model.allocationByPerson.rows.find(function (r) { return r.id === found.id; });
  return {
    period: report.period,
    units: units(),
    person: personRow(model, row, found, allocation),
    assignments: assignmentsIn(report, report.period, "personId", found.id)
  };
}

/* --- projects and one project --------------------------------------------- */

export function projects(plan, period) {
  const report = reportFor(plan, period);
  const model = report.model;
  const rowById = {};
  model.byProject.rows.forEach(function (row) { rowById[row.id] = row; });
  const allocationById = {};
  model.allocationByProject.rows.forEach(function (row) { allocationById[row.id] = row; });
  const total = model.allocationByProject.total;
  return {
    period: report.period,
    units: units(),
    projects: report.view.projects.map(function (project) {
      return projectRow(model, project, rowById[project.id], allocationById[project.id]);
    }),
    totals: {
      capacity: model.offeredTotal,
      allocated: model.planTotal,
      ofPlan: model.planTotal > 0 ? 1 : null,
      ofCapacity: total.total
    }
  };
}

export function project(plan, period, name) {
  const wanted = nameText(name, "project");
  const report = reportFor(plan, period);
  const model = report.model;
  const found = matchOne(report.view.projects, wanted, "project",
    function (p) { return p.name; },
    function (p) { return [p.name, p.id]; });
  const row = model.byProject.rows.find(function (r) { return r.id === found.id; });
  const allocation = model.allocationByProject.rows.find(function (r) { return r.id === found.id; });
  return {
    period: report.period,
    units: units(),
    project: projectRow(model, found, row, allocation),
    assignments: assignmentsIn(report, report.period, "projectId", found.id)
  };
}

/* --- tags and one tag or key ---------------------------------------------- */

export function tags(plan, period) {
  const report = reportFor(plan, period);
  return {
    period: report.period,
    units: units(),
    tags: report.model.byTag.rows.map(function (row) { return tagRow(report.model, row); }),
    totals: {
      allocated: report.model.byTag.total.total,
      ofPlan: report.model.byTag.total.total > 0 ? 1 : null,
      count: report.model.byTag.rows.length
    }
  };
}

export function tag(plan, period, key) {
  const wanted = nameText(key, "tag");
  const report = reportFor(plan, period);
  const model = report.model;
  const rows = model.byTag.rows;
  const w = wanted.trim().toLowerCase();

  let match = "tag";
  let found = rows.filter(function (row) {
    return row.tag.trim().toLowerCase() === w || row.label.trim().toLowerCase() === w;
  });
  if (found.length === 0) {
    found = rows.filter(function (row) {
      return isTypedTag(row.tag) && tagKind(row.tag).trim().toLowerCase() === w;
    });
    match = "key";
  }
  if (found.length === 0) {
    const labels = rows.map(function (row) { return row.label; });
    const keys = [];
    rows.forEach(function (row) {
      if (!isTypedTag(row.tag)) return;
      const kind = tagKind(row.tag);
      if (keys.indexOf(kind) === -1) keys.push(kind);
    });
    throw unknown("tag", wanted, nearest(w, labels.concat(keys)));
  }

  const out = found.map(function (row) { return tagRow(model, row); });
  return {
    period: report.period,
    units: units(),
    key: wanted,
    match: match,
    tags: out,
    allocated: out.reduce(function (sum, row) { return sum + row.allocated; }, 0),
    ofPlan: out.reduce(function (sum, row) { return sum + row.ofPlan; }, 0)
  };
}

/* --- capacity ------------------------------------------------------------- */

export function capacity(plan, period) {
  const report = reportFor(plan, period);
  const model = report.model;
  const totals = planTotals(model);
  const shares = model.allocationByPerson.total.cells;
  return {
    period: report.period,
    units: units(),
    capacity: totals.capacity,
    allocated: totals.allocated,
    remaining: totals.remaining,
    ofCapacity: totals.ofCapacity,
    buckets: model.buckets.map(function (bucket, i) {
      const offered = model.chart[i].capacity;
      const allocated = model.chart[i].alloc;
      return Object.assign(bucketBase(bucket), {
        capacity: offered,
        allocated: allocated,
        remaining: offered - allocated,
        ofCapacity: shares[i]
      });
    })
  };
}

/* --- holidays and milestones ---------------------------------------------- */

export function holidays(plan) {
  return {
    holidays: holidayLocations(plan && plan.holidays).map(function (location) {
      return {
        location: location,
        dates: holidaysFor(plan && plan.holidays, location).map(function (day) {
          return { date: day.date, kind: day.kind };
        })
      };
    })
  };
}

export function milestones(plan) {
  const projects = (plan && plan.projects) || [];
  return {
    milestones: ((plan && plan.milestones) || []).map(function (milestone) {
      return {
        id: milestone.id,
        name: milestone.name,
        date: milestone.date,
        colour: milestone.colour,
        tags: Array.isArray(milestone.tags) ? milestone.tags.slice() : [],
        notes: typeof milestone.notes === "string" ? milestone.notes : "",
        projectIds: Array.isArray(milestone.projectIds) ? milestone.projectIds.slice() : [],
        projects: milestoneProjects(milestone, projects).map(function (project) {
          return { id: project.id, name: project.name };
        })
      };
    })
  };
}

/* --- subjects: exact, a unique part of one, or an honest error ------------- */

function nameText(value, what) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (text === "") throw new QueryError("a " + what + " name is required", "unknown-subject");
  return text;
}

// One record by its exact name or id, case-insensitive. A name that matches
// nothing is an error carrying the nearest labels rather than a silent zero;
// two records sharing a name are an error rather than a silent pick.
function matchOne(items, wanted, kind, labelOf, keysOf) {
  const w = wanted.trim().toLowerCase();
  const keys = function (item) {
    return keysOf(item).map(function (key) { return String(key || "").trim().toLowerCase(); });
  };
  const exact = items.filter(function (item) {
    return keys(item).indexOf(w) !== -1;
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) throw ambiguous(kind, wanted, exact.map(labelOf));
  throw unknown(kind, wanted, nearest(w, items.map(labelOf)));
}

function ambiguous(kind, wanted, labels) {
  return new QueryError("more than one " + kind + " matches \"" + wanted + "\": " +
    Array.from(new Set(labels)).join(", "), "ambiguous-subject", labels);
}

function unknown(kind, wanted, suggestions) {
  return new QueryError("unknown " + kind + " \"" + wanted + "\"", "unknown-subject", suggestions);
}

// The labels nearest a wanted one: prefix, then containment, then a small edit
// distance. Matching is case-insensitive because subjects are looked up that
// way; the suggestions keep the plan's own spelling.
function nearest(wanted, labels) {
  const w = wanted.toLowerCase();
  const seen = new Set();
  const scored = [];
  labels.forEach(function (label) {
    const text = String(label === undefined || label === null ? "" : label);
    const key = text.toLowerCase();
    if (text === "" || seen.has(key)) return;
    seen.add(key);
    let score = null;
    if (key === w) score = 0;
    else if (key.startsWith(w)) score = 1 + (key.length - w.length) / 100;
    else if (key.includes(w)) score = 2 + key.indexOf(w) / 100;
    else if (w.includes(key)) score = 3 + (w.length - key.length) / 100;
    else {
      const distance = editDistance(w, key);
      const allowed = w.length <= 4 ? 1 : Math.max(2, Math.floor(w.length / 3));
      if (distance <= allowed) score = 4 + distance / 10;
    }
    if (score !== null) scored.push({ label: text, score: score });
  });
  scored.sort(function (a, b) {
    return a.score - b.score || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  });
  return scored.slice(0, SUGGESTION_LIMIT).map(function (entry) { return entry.label; });
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (a === "") return b.length;
  if (b === "") return a.length;
  let previous = [];
  for (let j = 0; j <= b.length; j += 1) previous.push(j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current.push(Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      ));
    }
    previous = current;
  }
  return previous[b.length];
}
