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
 *   view(plan, storedView)
 *     storedView: the View settings as the app holds them (GET /api/view), or
 *       null when nothing is stored; every key falls back on its own, exactly
 *       as the app's own `normalizeView` reads it.
 *     returns { period, planPeriod: { start, end }, step,
 *       cadence: { start, length, namePrefix, nameNumber } | null,
 *       view: <the store, every key present> }
 *     What decides how a reader sees the plan: the View settings, and the
 *     plan-level settings the display rests on - the period, the Step and the
 *     sprint cadence. `plan` may be the parsed plan or the app's own
 *     /api/plan payload: both carry `range`, `step` and `cadence`, so the tool
 *     and the page cannot disagree about what is being drawn. Nothing here
 *     writes, and no figure is computed: this is the settings, as stored.
 *
 *   viewSet(storedView, key, value)
 *     key: one of the View settings' own keys, with a part name for the two
 *       that hold an object: gridSpacing.day, sort.projects and their
 *       siblings. value: the value as it would be typed - on or off for a
 *       toggle, a Zoom level, a whole number of pixels, a palette's name, a
 *       report view's key or label, or a sort key with an optional direction.
 *     returns { key, storeKey, before, after,
 *       change: <the body POST /api/view takes> }
 *     `before` and `after` are that key's value as stored and as it would be;
 *     `change` carries only the one store key, and for the two object-valued
 *     keys the whole object with the one part changed, because the app's store
 *     merges one level deep. A key that is not one of theirs is an
 *     "unknown-view-key" error naming the ones that are; the plan's own
 *     period, Step and cadence are "read-only" errors naming the app's
 *     control; and a value the app would refuse - or silently store as
 *     something else - is a "bad-value" error naming the values it does take.
 *     Nothing here writes.
 *
 *   people(plan, period, narrow)
 *     returns { period, units,
 *       people: [{ id, name, location, availability, tags, note, capacity,
 *         allocated, remaining, ofOffer, overAllocated, buckets }],
 *       totals: { capacity, allocated, remaining, ofCapacity }, filter? }
 *     Each bucket is { key, label, start, end, capacity, allocated, remaining,
 *     ofOffer, overAllocated }; capacity and allocated are the Person's own.
 *     `narrow` is optional; see the narrowing note below.
 *
 *   person(plan, period, name)
 *     returns { period, units, person: <one people row>,
 *       assignments: [{ id, projectId, project, personId, person, share,
 *         start, end, tags, note, absence }] }
 *     The assignments are the plan's stored facts for that Person whose dates
 *     meet the period, in date order. They are not summed: overlapping
 *     Assignments do not add.
 *
 *   projects(plan, period, narrow)
 *     returns { period, units,
 *       projects: [{ id, name, tags, notes, absence, allocated, ofPlan,
 *         ofCapacity, buckets }],
 *       totals: { capacity, allocated, ofPlan, ofCapacity }, filter? }
 *     An absence Project is listed with its facts and null figures, since it
 *     contributes no FTE-day. Each bucket is { key, label, start, end,
 *     allocated, capacity, ofCapacity }, where capacity is the whole plan's.
 *     `narrow` is optional; see the narrowing note below.
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
 * Narrowing a list - people and projects only
 *   narrow: { location?, tags?, over?, under?, top? }, every field optional; a
 *   request with no field at all is the same as none, and then the answer is
 *   exactly what it was before there were narrows - no `filter`, no reorder.
 *     location  a Person's own Location, matched case-insensitively
 *     tags      one or more tags of the subject's own vocabulary; a subject
 *               matches when every one of them is on it, and a term that names
 *               no tag of its own falls back to the tag key it is, the way
 *               `tag <term>` resolves one (case-insensitively)
 *     over      People only: Allocated above Capacity
 *     under     People only: Allocated below Capacity, so the Person at
 *               exactly their Capacity is in neither
 *     top       keep the n largest by the figure the list prints, Allocated in
 *               FTE-days, highest first; plan order breaks a tie
 *   A narrowed answer carries one extra field, `filter`: { text, matched,
 *   total, unit, ...the fields that were given, ordering?, tie? }. `text` is
 *   the filter in plain words, `matched` is the rows the answer holds and
 *   `total` the rows the list held before narrowing. Narrowing never computes a
 *   figure: every row and every total in the answer is the report's own.
 *
 *   capacity(plan, period)
 *     returns { period, units, capacity, allocated, remaining, ofCapacity,
 *       buckets: [{ key, label, start, end, capacity, allocated, remaining,
 *         ofCapacity }] }
 *     The whole plan's Capacity offered against what it is Allocated, overall
 *     and per time bucket.
 *
 *   assignmentMove(plan, request)
 *     request: { project, person, from, to, share, period }
 *       project and person as the other subjects: a name or an id; from and to
 *       are YYYY-MM-DD dates, share a whole number 1..100, each optional, and
 *       a field left out keeps the Assignment's stored value. At least one of
 *       them has to change. period is the stretch the Person's figures are
 *       read over; absent for the plan's own period.
 *     returns { period, units,
 *       assignment: { id, projectId, project, personId, person, start, end,
 *         share, tags, note, absence },
 *       change: { start?, end?, share? },
 *       before: { start, end, share, fteDays, outsidePlan },
 *       after: { start, end, share, fteDays, outsidePlan },
 *       person: { id, name, before: <a position>, after: <a position> } }
 *     where a position is { capacity, allocated, remaining, ofOffer,
 *     overAllocated, overBy }. `change` is the patch a writer sends: the fields
 *     that actually differ from the stored Assignment, in the shape the app's
 *     own PATCH /api/assignments/<id> takes. `fteDays` is the Assignment's own
 *     size - its Allocation over the working days in its dates - so the numbers
 *     are the report's. Nothing here writes, decides or remembers anything: the
 *     same call answers what the diff would say and what the write would send.
 *     No Assignment, or more than one, is an error ("unknown-assignment",
 *     "ambiguous-assignment" naming every candidate); a value the write would
 *     be refused for is one too ("bad-value"), and so is a request that would
 *     change nothing ("no-change").
 *
 *   assignmentAdd(plan, request)
 *     request: { project, person, from, to, share, period }
 *       project and person as the other subjects; from and to are the
 *       Assignment's dates as YYYY-MM-DD and are required; share is a whole
 *       number 1..100 and is 100 when left out. period is the stretch the
 *       Person's and the Project's figures are read over; absent for the plan's
 *       own period.
 *     returns { period, units,
 *       assignment: { projectId, project, personId, person, start, end, share,
 *         absence },
 *       create: { projectId, personId, start, end, share },
 *       fteDays, outsidePlan,
 *       person: { id, name, before: <a position>, after: <a position> },
 *       project: { id, name, absence,
 *         before: { allocated }, after: { allocated } },
 *       overlaps: [{ id, projectId, project, start, end, share, overlapStart,
 *         overlapEnd }] }
 *     `create` is the body the app's own POST /api/assignments takes, and it
 *     carries no id: the server mints one, so a preview never invents the
 *     identity the app owns. `fteDays` is the new Assignment's own size - its
 *     Allocation over the working days in its dates. `overlaps` is every live
 *     Assignment the Person already holds on any date of the new one, each with
 *     the days it shares with it, because a Person committed on those dates is
 *     the mistake this preview exists to prevent. The dates must fall inside
 *     the plan's period, by the app's own rule; anywhere else is a
 *     "bad-value" error rather than a creation the write would refuse.
 *
 *   personAdd(plan, request)
 *     request: { name, location, availability, tags, note, period }
 *       name is required; location and note are free text and empty when left
 *       out; availability is a whole percentage and is 100 when left out; tags
 *       are the Person's own vocabulary, stored exactly as typed. period is the
 *       stretch the offer is read over; absent for the plan's own period.
 *     returns { period, units,
 *       create: { name, location, availability, tags, note },
 *       offered: { availability, location, workingDays, holidayDays, fteDays,
 *         holidays: [{ date, kind }] } }
 *     `create` is the body the app's own POST /api/people takes, and it carries
 *     no id: the server mints one. `offered` is what the Availability is worth
 *     over the period after the Location's holidays - `fteDays` the report's
 *     own count of working days at that Availability, `holidayDays` the working
 *     days the Location's holidays take out of it. A name a live Person already
 *     answers to is a "duplicate-name" error naming that Person, because reads
 *     find a Person by name and two of one name would make every later command
 *     ambiguous.
 *
 *   projectAdd(plan, request)
 *     request: { name, colour, tags, note }
 *       name is required; colour is a slot 0..9, or left out for the
 *       least-used slot; tags are the Project's own vocabulary; note is free
 *       text and lands in the Project's `notes` field.
 *     returns { create: { name, notes, tags, colour? }, colour: { slot, named } }
 *     `create` is the body the app's own POST /api/projects takes, with no id:
 *     the server mints one, and it picks the least-used colour slot when
 *     `colour` is absent, so the preview's predicted slot is never written.
 *     A new Project has no Assignments, by definition, and a name a live
 *     Project already answers to is a "duplicate-name" error.
 *
 *   personEdit(plan, request)
 *     request: { subject, name, location, availability, note, tags, untag, period }
 *       subject is a live Person's name or id; every other field is optional and
 *       a field left out keeps what the Person holds. `tags` are added and
 *       `untag` removed - never replaced - and each is a list of one tag per
 *       entry. period is the stretch the offer is read over; absent for the
 *       plan's own period.
 *     returns { period, units, subject, after, change, diff, offered? }
 *     `subject` is the Person as stored and `after` the Person as the edit would
 *     leave it. `change` is the body the app's own PATCH /api/people/<id> takes,
 *     holding only the fields that differ, and `diff` is those fields as
 *     [{ field, before, after }] in the order the preview prints them. `offered`
 *     is present when the Availability or the Location moves: the report's own
 *     figure for what the Person offers over the period, before and after, net
 *     of their Location's holidays and their own absences - the same Capacity
 *     the report draws, so the preview and the next read cannot disagree. A
 *     rename moves no figure, so none is claimed for it.
 *     A name another live Person answers to is a "duplicate-name" error, as it
 *     is for a creation (renaming a Person to their own name is no rename at
 *     all); a tag the Person already carries ("duplicate-tag") or does not
 *     ("unknown-tag") is a refusal rather than a silent no-op; and an edit that
 *     would change nothing is a "no-change" error rather than a diff of no
 *     lines. Nothing here writes.
 *
 *   projectEdit(plan, request)
 *     request: { subject, name, colour, absence, note, tags, untag, period }
 *       as personEdit's, on a Project: `absence` is "on" or "off" and lands in
 *       the Project's `absence` flag, `note` in its `notes` field, and `colour`
 *       is a slot 0..9.
 *     returns { period, units, subject, after, change, diff, absence? }
 *     `absence` is present when the flag moves: whether it is now `on`, the live
 *     Assignments the Project holds, `fteDays` - the Capacity the plan gains or
 *     loses by the switch, negative when the Assignments now take time out of
 *     Capacity and positive when they go back to adding work - and the plan's
 *     own `capacity` and `allocated` before and after. An unknown colour is a
 *     "bad-value" error, an `--absence` that is neither on nor off is one too,
 *     and an edit that would change nothing is a "no-change" error. Nothing
 *     here writes.
 *
 *   copy(plan, request)
 *     request: { kind, subject, project, person }
 *       kind is person, project or assignment. subject is a live Person's or
 *       Project's name or id, found exactly as the reads find one; an
 *       Assignment is identified by `project` and `person`, exactly as
 *       assignmentMove identifies one.
 *     returns { kind, subject, create, name?, assignments? }
 *     `subject` is the record as stored. `create` is the body the app's own
 *     POST /api/people, POST /api/projects or POST /api/assignments takes, with
 *     no id: the server mints one, and the copy is a creation, so the source is
 *     untouched. A Person's and a Project's answer carries `name`
 *     ({ from, to }: the name the copy rule gave it, from public/lib/copy.mjs)
 *     and `assignments` - the source's own live Assignments, which are not
 *     copied. An Assignment's answer carries neither: its name is its Project's
 *     and its Person's, unchanged. What a copy carries is the app's own list: a
 *     Project's colour, tags, notes and absence flag; a Person's Location,
 *     Availability, tags and note; an Assignment's Person, dates, Share, tags
 *     and note. Nothing here writes, and nothing here is counted: no answer
 *     carries a period or a unit.
 *     An unknown or ambiguous subject is the reads' own error; an archived one
 *     is a "not-live" error naming the restore that brings it back, and a copy
 *     of an Assignment whose every Assignment between its Person and its Project
 *     is archived is refused the same way, because the grid offers no copy of
 *     an archived Assignment either.
 *
 *   milestoneAdd(plan, request)
 *     request: { name, date, colour, tags, note, projects }
 *       name is required; date is a YYYY-MM-DD date; colour is a slot 0..9, or
 *       left out for the least-used slot; tags are the Milestone's own
 *       vocabulary; note is free text and lands in the Milestone's `notes`
 *       field; projects are the Projects it relates to, by the names or ids the
 *       reads resolve.
 *     returns { create: { name, date, tags, notes, projectIds, colour? },
 *       colour: { slot, named }, weekday, projects: [{ id, name }] }
 *     `create` is the body the app's own POST /api/milestones takes, with no
 *     id: the server mints one, and it picks the least-used colour slot when
 *     `colour` is absent, so the preview's predicted slot is never written.
 *     `weekday` is the day the date falls on, and `projects` the related
 *     Projects as the plan holds them, in the order the Milestone names them.
 *     A name a Milestone already answers to is a "duplicate-name" error: a
 *     Milestone has no archived state, so every one in the file is live and
 *     two of one name would make every later command ambiguous.
 *
 *   milestoneEdit(plan, request)
 *     request: { subject, date, colour, tags, note, projects }
 *       subject is a Milestone's name or id; every other field is optional and
 *       a field left out keeps what the Milestone holds.
 *     returns { subject, after, change, diff, weekday, projects }
 *     `subject` is the Milestone as stored and `after` the Milestone as the
 *     edit would leave it, each carrying the related `projects` as
 *     [{ id, name }]. `change` is the body the app's own
 *     PATCH /api/milestones/<id> takes, holding only the fields that differ,
 *     and `diff` is those fields as [{ field, before, after }] in the order the
 *     preview prints them. An edit that would change nothing is a "no-change"
 *     error, and an unknown Milestone, Project or colour is refused by the
 *     reads' own rules.
 *
 *   archive(plan, request)   and   restore(plan, request)
 *     request: { kind, subject, project, person, period }
 *       kind is "person", "project" or "assignment"; subject is a Person's or
 *       a Project's name or id and is unused for an assignment, which is named
 *       by its project and --person, as assignmentMove names one. period is the
 *       stretch the figures are read over; absent for the plan's own period.
 *     returns { period, units, kind, subject,
 *       assignments: [{ id, projectId, project, personId, person, start, end,
 *         share }],
 *       fteDays,
 *       before: { plan: { capacity, allocated }, person?, project? },
 *       after:  { plan: { capacity, allocated }, person?, project? } }
 *     `subject` is the record as stored, with its `archived` state before the
 *     move: a Person's fields, a Project's, or an Assignment's with its
 *     Project's and Person's names. `assignments` is what the move takes with
 *     it or brings back: every live Assignment the Person or the Project holds,
 *     left where it is in the file, or just the one Assignment. `fteDays` is
 *     the Assignment's own size, present only for that kind.
 *
 *     Both figures are the report's own, over the plan before the move and
 *     over the plan after it, so what a preview says leaves the plan is what
 *     the next read of it measures: `plan` is the plan's Capacity and its
 *     Allocated, `person` is one Person's position, `project` is one Project's
 *     row. A figure whose record the move takes out of the plan is null.
 *
 *     Archiving does not cascade: it sets a flag and nothing else, so the
 *     Assignments of an archived Person or Project stay in the file and stop
 *     counting, and a restore brings them back with it.
 *
 *     `archive` resolves its subject as every read does, so an archived record
 *     is not found ("not-live", naming it where one record of that name is
 *     archived). `restore` resolves the record the reads cannot see; a live
 *     record and an archived one answering to one name are refused and both
 *     named ("ambiguous-subject"), never chosen between. Nothing here writes.
 *
 *   holidays(plan)
 *     returns { holidays: [{ location, dates: [{ date, kind }] }] }
 *     As stored, read through the app's own holiday rule: Locations
 *     deduplicated and dates in date order.
 *
 *   holidayChange(plan, request)
 *     request: { action, location, date, kind, period }
 *       action is "add" or "remove"; location is a Location a live Person is
 *       at, by the app's case-insensitive match; date is a YYYY-MM-DD date;
 *       kind is "full" or "half" and only add takes it, a full day when left
 *       out; period is the stretch the figures are read over, absent for the
 *       plan's own period.
 *     returns { period, units, action, location, date, kind, weekday, weekend,
 *       outsidePlan, inPeriod, planPeriod: { start, end },
 *       people: [{ id, name, availability, before, after, fteDays }],
 *       fteDays, before: [{ date, kind }], after: [{ date, kind }],
 *       others: [location], change: { holidays } }
 *     One holiday date for one Location, computed before it is written.
 *     `before` and `after` are that Location's dates as stored and as they
 *     would be: the whole list, so a lost entry is visible before the write.
 *     `people` is every live Person the Location takes its holidays from, with
 *     the Capacity they offer over the period before and after the change - the
 *     report's own figure, over the plan with and without the date, so a
 *     weekend, an absence and a half day all say what they actually change.
 *     `fteDays` is the sum of those moves, signed: negative is capacity taken
 *     off, positive is capacity put back. `change` is the body the app's own
 *     PATCH /api/plan takes - the whole holiday list rebuilt from the plan read
 *     here, with every other Location's group carried through exactly as it was
 *     stored. `others` names the Locations whose groups are untouched.
 *     A date already a holiday there ("duplicate-holiday"), one that is not a
 *     holiday there ("unknown-holiday"), a Location no live Person is at
 *     ("no-people") and a date or kind the plan's own format refuses
 *     ("bad-value") are errors, not writes. Nothing here writes.
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
import { cadenceFrom, sprintsFor } from "../public/lib/sprints.mjs";
import { visiblePlan } from "../public/lib/visibility.mjs";
import { isTypedTag, tagKind, tagTermMatch } from "../public/lib/tags.mjs";
import { PALETTE_NAMES, leastUsedSlot, slotForColour } from "../public/lib/palette.mjs";
import { REPORT_VIEWS } from "../public/lib/report-views.mjs";
import {
  GRID_SPACING_MAX,
  GRID_SPACING_MIN,
  ROW_HEIGHT_MAX,
  ROW_HEIGHT_MIN,
  ROW_HEIGHT_STEP,
  ZOOM_LEVELS,
  clampRowHeight
} from "../public/lib/timeline.mjs";
import { normalizeView } from "../public/lib/view.mjs";
import { ASCENDING, DESCENDING, sortKeys } from "../public/lib/sort.mjs";
import {
  HOLIDAY_KIND_DEFAULT,
  HOLIDAY_KINDS,
  holidayLocations,
  holidaysFor,
  isHolidayKind,
  locationKey
} from "../public/lib/holidays.mjs";
import { copyName } from "../public/lib/copy.mjs";
import { milestoneProjects } from "../public/lib/milestones.mjs";
import { rangeLabel } from "../public/lib/label.mjs";
import { absenceProjectIds, absencesFor, isWeekend, workingDays } from "../public/lib/workdays.mjs";
import { hasTag, normalizeStep, outsideRangeRefusal, withTag, withoutTag } from "../public/lib/panels.mjs";

const EPSILON = 1e-9;
const SUGGESTION_LIMIT = 5;

// The units every figure-bearing answer carries, by field name. A stable map
// rather than a sentence, so an adapter can read it.
const UNITS = Object.freeze({
  capacity: "FTE-days",
  allocated: "FTE-days",
  remaining: "FTE-days",
  fteDays: "FTE-days",
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

function badValue(message) {
  return new QueryError(message, "bad-value");
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

/* --- the view, and the plan settings a display rests on ------------------ */

// A list as a sentence names it: "day, week, sprint and month".
function optionsText(items) {
  if (items.length === 0) return "none";
  if (items.length === 1) return items[0];
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

/*
 * What a reader sees, as the app's own store holds it. The View settings are
 * read through the app's `normalizeView`, so every key is present and a
 * malformed stored value falls back exactly as it does on the screen; the
 * plan-level settings are the app's own readings of the plan - the resolved
 * period, `normalizeStep`, `cadenceFrom` - never a second rule here.
 */
export function view(plan, storedView) {
  const period = periodFor(plan);
  return {
    period: period,
    planPeriod: { start: period.start, end: period.end },
    step: normalizeStep(plan && plan.step),
    cadence: cadenceFrom(plan),
    view: normalizeView(storedView)
  };
}

/* --- one view setting, before it is written ------------------------------ */

// The settings whose value is on or off: the Options menu's checkable rows and
// the Stack rail's fold.
const VIEW_TOGGLES = Object.freeze([
  "weekends", "holidays", "milestones", "availabilityLines", "assignments",
  "dividers", "minimap", "marker", "stackCollapsed"
]);

// Each of the four zooms keeps its own Grid spacing, so the key is one part of
// the store's `gridSpacing` object: the store's own shape, with the part named.
const GRID_SPACING_PARTS = Object.freeze(ZOOM_LEVELS.map(function (zoom) {
  return { key: "gridSpacing." + zoom, part: zoom };
}));
const GRID_SPACING_KEYS = Object.freeze(GRID_SPACING_PARTS.map(function (entry) {
  return entry.key;
}));

// The zoom a `gridSpacing.<zoom>` key names, or "" for any other key.
function gridSpacingPart(key) {
  const found = GRID_SPACING_PARTS.find(function (entry) { return entry.key === key; });
  return found ? found.part : "";
}

// The two sorts, one part each of the store's `sort` object.
const SORT_KEYS = Object.freeze(["sort.projects", "sort.people"]);

// Everything `view set` writes, in one list: the store's own keys, except that
// the two object-valued ones are named part by part.
const VIEW_SET_KEYS = Object.freeze(["zoom", "reportZoom", "reportView",
  "rowHeight"].concat(GRID_SPACING_KEYS, VIEW_TOGGLES, ["palette"], SORT_KEYS));

// The keys a reader may reasonably reach for that belong to the plan rather
// than to the display, with the app's own control for each. Each is refused
// with where it is set, because a flat "unknown key" would send the reader
// looking for a view setting that does not exist.
const PLAN_LEVEL_KEYS = Object.freeze({
  range: "The plan period is set in the app under Options > Plan period.",
  period: "The plan period is set in the app under Options > Plan period.",
  step: "The plan's Percentage step is set in the app under Options > Percentage step.",
  cadence: "The plan's sprint cadence is set in the app under Options > Sprints.",
  sprints: "The plan's sprint cadence is set in the app under Options > Sprints.",
  tagColours: "The colour-by-key choices travel with the plan, under Options > Tags.",
  tagSplit: "The by-tag selection travels with the plan, under Options > Tags.",
  planFile: "The active plan file is chosen in the app under Options > Plan file."
});

const TOGGLE_WORDS = Object.freeze({ on: true, off: false, true: true, false: false });
const ASCENDING_WORDS = Object.freeze({ asc: ASCENDING, ascending: ASCENDING });

function viewBoolValue(text) {
  const word = String(text).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(TOGGLE_WORDS, word)) {
    throw badValue("\"" + text + "\" is not on or off; a toggle is on or off, as in view set " +
      "weekends on");
  }
  return TOGGLE_WORDS[word];
}

function viewZoomValue(text) {
  const word = String(text).trim().toLowerCase();
  if (ZOOM_LEVELS.indexOf(word) === -1) {
    throw badValue("\"" + text + "\" is not a zoom; the zooms are " + optionsText(ZOOM_LEVELS));
  }
  return word;
}

function viewReportViewValue(text) {
  const wanted = String(text).trim().toLowerCase();
  const found = REPORT_VIEWS.find(function (entry) {
    return entry.key === wanted || entry.label.toLowerCase() === wanted;
  });
  if (!found) {
    throw badValue("\"" + text + "\" is not one of the report's views; they are " +
      optionsText(REPORT_VIEWS.map(function (entry) { return entry.key; })) +
      ", or the label each one draws, as in \"Allocation by project\"");
  }
  return found.key;
}

function viewPaletteValue(text) {
  const word = String(text).trim().toLowerCase();
  if (PALETTE_NAMES.indexOf(word) === -1) {
    throw badValue("\"" + text + "\" is not a palette; the palettes are " +
      optionsText(PALETTE_NAMES));
  }
  return word;
}

// A whole pixel count inside the range the app draws. A value outside it is
// clamped by the store rather than refused, so it is refused here: a preview
// that said 50 while the app stored 48 would be a lie about the write.
function viewPixelsValue(text, min, max, what) {
  const raw = String(text).trim();
  const value = Number(raw);
  if (raw === "" || !Number.isInteger(value) || value < min || value > max) {
    throw badValue("\"" + text + "\" is not " + what + ": a whole number of pixels from " +
      min + " to " + max + (raw !== "" && Number.isFinite(value)
        ? " (the app would store " + Math.min(max, Math.max(min, Math.round(value))) + " instead)"
        : ""));
  }
  return value;
}

// A sort key by its own name or the label the menu draws, with an optional
// direction: "fte", "Total assigned FTE desc", or "none".
function viewSortValue(kind, text) {
  const words = String(text).trim().split(/\s+/);
  let direction;
  const last = words[words.length - 1].toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ASCENDING_WORDS, last)) {
    direction = ASCENDING_WORDS[last];
    words.pop();
  } else if (last === DESCENDING || last === "descending") {
    direction = DESCENDING;
    words.pop();
  }
  const wanted = words.join(" ").toLowerCase();
  if (wanted === "none") {
    if (direction !== undefined) {
      throw badValue("none takes no direction: the plan's own order has none to give");
    }
    return null;
  }
  const found = sortKeys(kind).find(function (entry) {
    return entry.key === wanted || entry.label.toLowerCase() === wanted;
  });
  if (!found) {
    throw badValue("\"" + words.join(" ") + "\" is not a sort key for " + kind + "; they are " +
      optionsText(sortKeys(kind).map(function (entry) { return entry.key; })) +
      ", or the label each one draws, as in \"" + sortKeys(kind)[0].label + "\", or none");
  }
  return { key: found.key, direction: direction === undefined ? found.direction : direction };
}

// The value one key would store, from the text that was typed.
function viewSettingValue(key, text) {
  if (key === "zoom" || key === "reportZoom") return viewZoomValue(text);
  if (key === "reportView") return viewReportViewValue(text);
  if (key === "palette") return viewPaletteValue(text);
  if (key === "rowHeight") {
    const value = viewPixelsValue(text, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX, "a row height");
    if (clampRowHeight(value) !== value) {
      throw badValue("\"" + text + "\" is not a row height the app draws: it is a whole " +
        ROW_HEIGHT_MIN + " to " + ROW_HEIGHT_MAX + " in steps of " + ROW_HEIGHT_STEP +
        " (the app would store " + clampRowHeight(value) + " instead)");
    }
    return value;
  }
  if (VIEW_TOGGLES.indexOf(key) !== -1) return viewBoolValue(text);
  if (gridSpacingPart(key) !== "") {
    return viewPixelsValue(text, GRID_SPACING_MIN, GRID_SPACING_MAX, "a grid spacing");
  }
  if (sortKindOf(key) !== "") return viewSortValue(sortKindOf(key), text);
  throw badValue("no value rule for " + key);
}

// The list a dotted sort key names, or "" for every other key.
function sortKindOf(key) {
  if (key === "sort.projects") return "projects";
  if (key === "sort.people") return "people";
  return "";
}

// The current value of one key, as the store holds it.
function viewSettingAt(storedView, key) {
  if (gridSpacingPart(key) !== "") return storedView.gridSpacing[gridSpacingPart(key)];
  if (sortKindOf(key) !== "") return storedView.sort[sortKindOf(key)];
  return storedView[key];
}

/*
 * One View setting, read before it is written: what it holds, what it would
 * hold, and the body the app's own POST /api/view takes. The body carries one
 * store key only - never the whole store - and for the two object-valued keys
 * the whole object with the one part changed, because the store merges one
 * level deep and a part alone would drop its siblings.
 */
export function viewSet(storedView, key, value) {
  const current = normalizeView(storedView);
  if (Object.prototype.hasOwnProperty.call(PLAN_LEVEL_KEYS, key)) {
    throw new QueryError(key + " is not a View setting. " + PLAN_LEVEL_KEYS[key] +
      " Only the View settings are written here", "read-only");
  }
  if (VIEW_SET_KEYS.indexOf(key) === -1) {
    throw new QueryError('unknown view key "' + key + '"; view set writes ' +
      optionsText(VIEW_SET_KEYS), "unknown-view-key");
  }
  const after = viewSettingValue(key, value);
  const before = viewSettingAt(current, key);
  let storeKey = key;
  let change = {};
  if (gridSpacingPart(key) !== "") {
    storeKey = "gridSpacing";
    change[storeKey] = Object.assign({}, current.gridSpacing);
    change[storeKey][gridSpacingPart(key)] = after;
  } else if (sortKindOf(key) !== "") {
    storeKey = "sort";
    change[storeKey] = Object.assign({}, current.sort);
    change[storeKey][sortKindOf(key)] = after;
  } else {
    change[storeKey] = after;
  }
  return { key: key, storeKey: storeKey, before: before, after: after, change: change };
}

/* --- people and one person ------------------------------------------------ */

/*
 * Narrowing a list: the five ways a read can be asked for less than the whole
 * plan, and the line that says what was asked for. Nothing here computes a
 * figure - it keeps or drops rows the report already made, and counts them - so
 * a narrowed answer can never be a number the report does not print.
 */

// A request with no term at all is no request: the answer is then exactly what
// it was before there were narrows. What comes back is a copy, so the caller's
// object is never held on to and every field the narrowers read is present.
function askedFilter(narrow) {
  if (!narrow) return null;
  const filter = { tags: Array.isArray(narrow.tags) ? narrow.tags.slice() : [] };
  if (narrow.location !== undefined) filter.location = String(narrow.location);
  if (narrow.over) filter.over = true;
  if (narrow.under) filter.under = true;
  if (narrow.top !== undefined) filter.top = narrow.top;
  if (filter.location === undefined && filter.tags.length === 0 &&
      !filter.over && !filter.under && filter.top === undefined) return null;
  return filter;
}

// The filter in plain words, the one line both renderings state: what was
// applied, never what it found.
function filterText(filter) {
  const parts = [];
  if (filter.location !== undefined) parts.push("location: " + filter.location);
  if (filter.tags.length === 1) parts.push("tag: " + filter.tags[0]);
  else if (filter.tags.length > 1) parts.push("tags: " + filter.tags.join(" and "));
  if (filter.over) parts.push("over capacity");
  if (filter.under) parts.push("under capacity");
  if (filter.top !== undefined) parts.push("top " + filter.top + " by FTE-days");
  return parts.join(", ");
}

// Whether one of the subject's own tags answers to the term, by the rule
// `tag <term>` resolves with: the tag whose text it is, or a typed tag under the
// key it names. A subject's answer is one yes or no, so the read's exact-over-
// key precedence has nothing to choose between here.
function carriesTagTerm(tags, term) {
  const list = Array.isArray(tags) ? tags : [];
  return list.some(function (tag) { return tagTermMatch(term, tag) !== ""; });
}

// A row's figure as an order reads it: the FTE-days it prints, with a row that
// has none - an absence Project - below every row that has one.
function figureRank(row) {
  const value = row.allocated;
  return value === null || value === undefined || !Number.isFinite(Number(value))
    ? -Infinity
    : Number(value);
}

function sameFigure(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  return Math.abs(Number(a) - Number(b)) < EPSILON;
}

// The rows the cut left out of a tie, or null when it split nothing: the note a
// --top answer owes when the plan's own order, not the figure, decided which of
// several equal rows were shown.
function tieAtCut(ordered, kept, unit) {
  if (kept.length === 0) return null;
  const boundary = kept[kept.length - 1].allocated;
  const tied = ordered.filter(function (row) { return sameFigure(row.allocated, boundary); }).length;
  const shown = kept.filter(function (row) { return sameFigure(row.allocated, boundary); }).length;
  if (tied <= shown) return null;
  return { figure: boundary, tied: tied, shown: shown, unit: unit };
}

// The rows a filter keeps, in the order it states, and the counts that say how
// much of the list that is.
function narrowRows(rows, filter, unit) {
  let kept = rows;
  if (filter.location !== undefined) {
    const wanted = filter.location.trim().toLowerCase();
    kept = kept.filter(function (row) {
      return String(row.location || "").trim().toLowerCase() === wanted;
    });
  }
  if (filter.tags.length > 0) {
    kept = kept.filter(function (row) {
      return filter.tags.every(function (term) { return carriesTagTerm(row.tags, term); });
    });
  }
  if (filter.over) kept = kept.filter(function (row) { return row.overAllocated === true; });
  if (filter.under) {
    kept = kept.filter(function (row) {
      return row.overAllocated === false && row.allocated < row.capacity - EPSILON;
    });
  }

  const answer = {
    text: filterText(filter),
    matched: kept.length,
    total: rows.length,
    unit: unit
  };
  if (filter.location !== undefined) answer.location = filter.location;
  if (filter.tags.length > 0) answer.tags = filter.tags.slice();
  if (filter.over) answer.over = true;
  if (filter.under) answer.under = true;

  if (filter.top !== undefined) {
    const ordered = kept.slice().sort(function (a, b) {
      const left = figureRank(a);
      const right = figureRank(b);
      if (left !== right) return right - left;
      return 0; // the sort is stable, so the plan's own order breaks a tie
    });
    kept = ordered.slice(0, filter.top);
    answer.top = filter.top;
    answer.ordering = "FTE-days, highest first";
    const tie = tieAtCut(ordered, kept, unit);
    if (tie) answer.tie = tie;
  }

  answer.matched = kept.length;
  return { rows: kept, filter: answer };
}

export function people(plan, period, narrow) {
  const report = reportFor(plan, period);
  const model = report.model;
  const byId = {};
  report.view.people.forEach(function (person) { byId[person.id] = person; });
  const allocationById = {};
  model.allocationByPerson.rows.forEach(function (row) { allocationById[row.id] = row; });
  const rows = model.byPerson.rows.map(function (row) {
    return personRow(model, row, byId[row.id] || {}, allocationById[row.id]);
  });
  const out = {
    period: report.period,
    units: units(),
    people: rows,
    totals: planTotals(model)
  };
  const filter = askedFilter(narrow);
  if (!filter) return out;
  const narrowed = narrowRows(rows, filter, "People");
  out.people = narrowed.rows;
  out.filter = narrowed.filter;
  return out;
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

export function projects(plan, period, narrow) {
  const report = reportFor(plan, period);
  const model = report.model;
  const rowById = {};
  model.byProject.rows.forEach(function (row) { rowById[row.id] = row; });
  const allocationById = {};
  model.allocationByProject.rows.forEach(function (row) { allocationById[row.id] = row; });
  const total = model.allocationByProject.total;
  const rows = report.view.projects.map(function (project) {
    return projectRow(model, project, rowById[project.id], allocationById[project.id]);
  });
  const out = {
    period: report.period,
    units: units(),
    projects: rows,
    totals: {
      capacity: model.offeredTotal,
      allocated: model.planTotal,
      ofPlan: model.planTotal > 0 ? 1 : null,
      ofCapacity: total.total
    }
  };
  const filter = askedFilter(narrow);
  if (!filter) return out;
  const narrowed = narrowRows(rows, filter, "Projects");
  out.projects = narrowed.rows;
  out.filter = narrowed.filter;
  return out;
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
    return tagTermMatch(wanted, row.tag) === "tag" || row.label.trim().toLowerCase() === w;
  });
  if (found.length === 0) {
    found = rows.filter(function (row) { return tagTermMatch(wanted, row.tag) === "key"; });
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

/* --- one Assignment's move, computed before it is written ------------------ */

// One date or one Allocation as the caller asked for it. The server validates
// the write too; this refuses first, so a diff is never computed from a value
// the write would be refused for.
function dateOption(value, flag) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!isISODate(text)) throw badValue(flag + " must be a date like 2026-11-02");
  return text;
}

function shareOption(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!/^\d+$/.test(text)) throw badValue("--share must be a whole number from 1 to 100");
  const share = Number(text);
  if (share < 1 || share > 100) throw badValue("--share must be a whole number from 1 to 100");
  return share;
}

function given(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function byDates(a, b) {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  if (a.end !== b.end) return a.end < b.end ? -1 : 1;
  return a.share - b.share;
}

// Whether a span lies wholly outside the plan period, by the rule a resolved
// period reports itself with.
function outsidePlan(plan, start, end) {
  const range = planRange(plan);
  return range ? end < range.start || start > range.end : false;
}

// The FTE-days one span of one Person's time is worth at an Allocation: the
// report's own count of working days, so a moved Assignment is measured exactly
// as the report measures it. The Assignment being measured is left out of the
// absences, or an Absence would hide the very days off it holds.
function spanFteDays(plan, person, start, end, share) {
  const off = absencesFor(plan, person.id);
  return (Number(share) || 0) / 100 * workingDays(start, end, person.location, plan.holidays, off);
}

// The same plan with one Assignment taken out, and with one patched in place.
// A span is measured against the other Assignments only, and the plan after the
// write is the plan with the change in it - never a second arithmetic.
function withoutAssignment(plan, id) {
  return Object.assign({}, plan, {
    assignments: (plan.assignments || []).filter(function (assignment) { return assignment.id !== id; })
  });
}

function withAssignment(plan, id, change) {
  return Object.assign({}, plan, {
    assignments: (plan.assignments || []).map(function (assignment) {
      return assignment.id === id ? Object.assign({}, assignment, change) : assignment;
    })
  });
}

// Where one Person stands over the period: what they offer, what they are
// Allocated against it, and by how much they are over it. A Person the plan no
// longer holds - one an archive has taken out of it - has no figures at all.
function personPosition(report, personId) {
  const row = report.model.byPerson.rows.find(function (entry) { return entry.id === personId; });
  if (!row) return null;
  const over = row.total > row.offered + EPSILON;
  return {
    capacity: row.offered,
    allocated: row.total,
    remaining: row.offered - row.total,
    ofOffer: row.offered > 0 ? row.pct : null,
    overAllocated: over,
    overBy: over ? row.total - row.offered : 0
  };
}

// What a Person holds instead, when the Project they were asked about is not
// one of theirs. The plan's view is the caller's - whatever the command reading
// it has already resolved.
function holdingsElsewhere(view, person) {
  const names = [];
  view.assignments.forEach(function (assignment) {
    if (assignment.personId !== person.id) return;
    const project = view.projects.find(function (entry) { return entry.id === assignment.projectId; });
    const name = project ? project.name : assignment.projectId;
    if (names.indexOf(name) === -1) names.push(name);
  });
  return names;
}

// The one live Assignment of a Project on a Person: the identification every
// command that names one uses, so a move and a copy cannot disagree about which
// Assignment was meant. A Person may hold several Assignments of one Project,
// and guessing which one was meant would change the wrong block, so every
// candidate is named instead; none is an error that says what they do hold.
function oneAssignment(view, project, person) {
  const candidates = view.assignments.filter(function (assignment) {
    return assignment.projectId === project.id && assignment.personId === person.id;
  }).sort(byDates);

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new QueryError("more than one Assignment of " + project.name + " on " + person.name +
      ": " + candidates.map(function (assignment) {
        return assignment.start + " to " + assignment.end + " (" + assignment.share + "%)";
      }).join(", ") + "; this tool takes one Assignment at a time, so change " +
      "these in the app", "ambiguous-assignment");
  }
  const held = holdingsElsewhere(view, person);
  throw new QueryError("no Assignment of " + project.name + " on " + person.name +
    (held.length > 0
      ? "; " + person.name + " holds " + held.join(", ")
      : "; " + person.name + " holds no Assignment in this plan"),
    "unknown-assignment");
}

export function assignmentMove(plan, request) {
  const asked = request || {};
  const wantedProject = nameText(asked.project, "project");
  const wantedPerson = nameText(asked.person, "person");
  const period = resolvePeriod(plan, asked.period);
  const report = reportFor(plan, period);

  const person = matchOne(report.view.people, wantedPerson, "person",
    function (entry) { return entry.name; },
    function (entry) { return [entry.name, entry.id]; });
  const project = matchOne(report.view.projects, wantedProject, "project",
    function (entry) { return entry.name; },
    function (entry) { return [entry.name, entry.id]; });

  // A Person may hold several Assignments of one Project; oneAssignment is the
  // one rule that decides which one is meant, and refuses rather than guessing.
  const target = oneAssignment(report.view, project, person);
  const change = {};
  const start = given(asked.from) ? dateOption(asked.from, "--from") : target.start;
  const end = given(asked.to) ? dateOption(asked.to, "--to") : target.end;
  const share = given(asked.share) ? shareOption(asked.share) : target.share;
  if (start !== target.start) change.start = start;
  if (end !== target.end) change.end = end;
  if (share !== target.share) change.share = share;

  if (Object.keys(change).length === 0) {
    throw new QueryError("the Assignment already runs " + target.start + " to " + target.end +
      " at " + target.share + "%; nothing to change", "no-change");
  }
  if (start > end) {
    throw new QueryError("the Assignment would end before it starts: " + start + " to " + end,
      "bad-value");
  }

  // The plan as it would be after the write, so the Person's figures after it
  // are the report's own over the patched plan rather than a second arithmetic.
  const others = withoutAssignment(plan, target.id);
  const patched = withAssignment(plan, target.id, change);
  const afterReport = reportFor(patched, period);

  return {
    period: period,
    units: units(),
    assignment: {
      id: target.id,
      projectId: project.id,
      project: project.name,
      personId: person.id,
      person: person.name,
      start: target.start,
      end: target.end,
      share: target.share,
      tags: Array.isArray(target.tags) ? target.tags.slice() : [],
      note: typeof target.note === "string" ? target.note : "",
      absence: absenceProjectIds(plan).has(project.id)
    },
    change: change,
    before: {
      start: target.start,
      end: target.end,
      share: target.share,
      fteDays: spanFteDays(others, person, target.start, target.end, target.share),
      outsidePlan: outsidePlan(plan, target.start, target.end)
    },
    after: {
      start: start,
      end: end,
      share: share,
      fteDays: spanFteDays(others, person, start, end, share),
      outsidePlan: outsidePlan(plan, start, end)
    },
    person: {
      id: person.id,
      name: person.name,
      before: personPosition(report, person.id),
      after: personPosition(afterReport, person.id)
    }
  };
}

/* --- one new Assignment, computed before it is written -------------------- */

// The plan as it would be with a new Assignment in it. The Assignment carries
// no id: the write has not happened, so the plan after it is the plan plus the
// fields the app's POST /api/assignments takes, and the id stays the app's.
function withNewAssignment(plan, assignment) {
  return Object.assign({}, plan, {
    assignments: (plan.assignments || []).concat([assignment])
  });
}

// Every live Assignment of one Person whose dates meet the span, with the days
// it shares with it. A Person already committed on those dates is named rather
// than counted, because it is one specific Assignment that is in the way.
function overlappingHoldings(report, person, start, end) {
  const byId = {};
  report.view.projects.forEach(function (project) { byId[project.id] = project; });
  return report.view.assignments.filter(function (assignment) {
    return assignment.personId === person.id && assignment.start <= end && assignment.end >= start;
  }).sort(byDates).map(function (assignment) {
    const project = byId[assignment.projectId];
    return {
      id: assignment.id,
      projectId: assignment.projectId,
      project: project ? project.name : assignment.projectId,
      start: assignment.start,
      end: assignment.end,
      share: assignment.share,
      overlapStart: assignment.start > start ? assignment.start : start,
      overlapEnd: assignment.end < end ? assignment.end : end
    };
  });
}

// What a Project is Allocated over the period, by the report's own row. An
// absence Project contributes no FTE-day, so it has no total to compare.
function projectAllocated(report, projectId) {
  const row = report.model.byProject.rows.find(function (entry) { return entry.id === projectId; });
  return row ? row.total : 0;
}

export function assignmentAdd(plan, request) {
  const asked = request || {};
  const wantedProject = nameText(asked.project, "project");
  const wantedPerson = nameText(asked.person, "person");
  const period = resolvePeriod(plan, asked.period);
  const report = reportFor(plan, period);

  const person = matchOne(report.view.people, wantedPerson, "person",
    function (entry) { return entry.name; },
    function (entry) { return [entry.name, entry.id]; });
  const project = matchOne(report.view.projects, wantedProject, "project",
    function (entry) { return entry.name; },
    function (entry) { return [entry.name, entry.id]; });

  const start = dateOption(asked.from, "--from");
  const end = dateOption(asked.to, "--to");
  const share = given(asked.share) ? shareOption(asked.share) : 100;
  if (start > end) {
    throw new QueryError("the Assignment would end before it starts: " + start + " to " + end,
      "bad-value");
  }
  const refusal = outsideRangeRefusal(start, end, plan.range);
  if (refusal) throw badValue(refusal);

  const absence = absenceProjectIds(plan).has(project.id);
  const create = { projectId: project.id, personId: person.id, start: start, end: end, share: share };
  const afterReport = reportFor(withNewAssignment(plan, create), period);

  return {
    period: period,
    units: units(),
    assignment: {
      projectId: project.id,
      project: project.name,
      personId: person.id,
      person: person.name,
      start: start,
      end: end,
      share: share,
      absence: absence
    },
    create: create,
    fteDays: spanFteDays(plan, person, start, end, share),
    outsidePlan: outsidePlan(plan, start, end),
    person: {
      id: person.id,
      name: person.name,
      before: personPosition(report, person.id),
      after: personPosition(afterReport, person.id)
    },
    project: {
      id: project.id,
      name: project.name,
      absence: absence,
      before: { allocated: absence ? null : projectAllocated(report, project.id) },
      after: { allocated: absence ? null : projectAllocated(afterReport, project.id) }
    },
    overlaps: overlappingHoldings(report, person, start, end)
  };
}

/* --- one new Person and one new Project, before they are written ---------- */

// The tags as typed, in order: a tag is free text with no interpretation, so
// `skill:frontend` is carried to the app exactly as it was written.
function tagOptions(value) {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list.map(function (tag) { return String(tag).trim(); })
    .filter(function (tag) { return tag !== ""; });
}

// A whole percentage, 100 when left out. The range is the app's rule and its
// message, not a second copy here: a value out of range is refused by the write
// with the server's own words, which the tool prints unchanged.
function availabilityOption(value) {
  if (!given(value)) return 100;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw badValue("--availability must be a whole percentage, as 80 for 80%");
  }
  return Number(text);
}

// A colour as the slot the plan stores, by the app's own rule - a slot 0..9, or
// a legacy ink name migrated to its slot - or undefined for a Project that lets
// the server take the least-used slot.
function colourOption(value) {
  if (!given(value)) return undefined;
  const text = String(value).trim();
  const slot = /^\d+$/.test(text) ? slotForColour(Number(text)) : slotForColour(text);
  if (slot === null) throw badValue("--colour must be a slot 0..9");
  return slot;
}

// Reads find a Person or a Project by name or by id, case-insensitively, so two
// live records answering to one name make every later command ambiguous. The
// name about to be created - or, on an edit, moved to - is checked against both
// keys of every other live record of its kind, and the record that is already
// there is named rather than counted. `exceptId` is the one record the check is
// not about: the record being edited, renamed to its own name.
function refuseDuplicateName(plan, kind, name, exceptId) {
  const live = visiblePlan(plan, false);
  const items = kind === "person" ? live.people : live.projects;
  const wanted = name.trim().toLowerCase();
  const clash = items.find(function (item) {
    if (exceptId !== undefined && item.id === exceptId) return false;
    return String(item.name || "").trim().toLowerCase() === wanted ||
      String(item.id || "").trim().toLowerCase() === wanted;
  });
  if (clash) {
    const plural = kind === "person" ? "People" : "Projects";
    throw new QueryError("the plan already holds a " + kind + " called \"" + clash.name +
      "\" (" + clash.id + "); two live " + plural +
      " of one name would make every read that finds one by name ambiguous",
      "duplicate-name");
  }
}

// What one Availability is worth over a period, after the Location's holidays:
// the report's own count of working days at that Availability, and the report's
// own absences for the Person where there are any - a Person being created holds
// no Assignment, so none is taken out of theirs, which is why this is the same
// figure the report counts for them once they exist.
function offerOver(plan, period, availability, location, absences) {
  const off = absences || [];
  const holidays = holidaysFor(plan && plan.holidays, location)
    .filter(function (day) { return day.date >= period.start && day.date <= period.end; });
  const workingDaysHere = workingDays(period.start, period.end, location, plan && plan.holidays, off);
  const withoutHolidays = workingDays(period.start, period.end, location, undefined, off);
  return {
    availability: availability,
    location: location,
    workingDays: workingDaysHere,
    holidayDays: withoutHolidays - workingDaysHere,
    fteDays: (Number(availability) || 0) / 100 * workingDaysHere,
    holidays: holidays.map(function (day) { return { date: day.date, kind: day.kind }; })
  };
}

export function personAdd(plan, request) {
  const asked = request || {};
  const name = nameText(asked.name, "person");
  const period = resolvePeriod(plan, asked.period);
  const availability = availabilityOption(asked.availability);
  const location = given(asked.location) ? String(asked.location).trim() : "";
  const note = given(asked.note) ? String(asked.note).trim() : "";
  const tags = tagOptions(asked.tags);
  refuseDuplicateName(plan, "person", name);

  return {
    period: period,
    units: units(),
    create: {
      name: name,
      location: location,
      availability: availability,
      tags: tags.slice(),
      note: note
    },
    offered: offerOver(plan, period, availability, location)
  };
}

export function projectAdd(plan, request) {
  const asked = request || {};
  const name = nameText(asked.name, "project");
  const note = given(asked.note) ? String(asked.note).trim() : "";
  const tags = tagOptions(asked.tags);
  const colour = colourOption(asked.colour);
  refuseDuplicateName(plan, "project", name);

  // The body carries the store's own field names - a Project has `notes`, where
  // a Person has `note` - and no colour at all when none was named, so the
  // server takes the least-used slot rather than the tool inventing one.
  const create = { name: name, notes: note, tags: tags.slice() };
  if (colour !== undefined) create.colour = colour;

  return {
    create: create,
    colour: {
      slot: colour === undefined ? leastUsedSlot(visiblePlan(plan, false).projects) : colour,
      named: colour !== undefined
    }
  };
}

/* --- one existing Person or Project, before it is written ----------------- */

// One tag, added or removed, against what the record carries: --tag adds and
// --untag removes, and neither replaces the list. Adding a tag the record
// already carries, or removing one it does not, is a refusal rather than a
// silent no-op, because a no-op reads as a change that was made. What "carries"
// means is the app's own rule - hasTag, withTag and withoutTag are the ones the
// grid uses - so a tag differing only in case is the same tag here as there.
function editTags(record, adds, removes) {
  let tags = Array.isArray(record.tags) ? record.tags.slice() : [];
  (Array.isArray(adds) ? adds : []).forEach(function (raw) {
    const tag = String(raw).trim();
    if (tag === "") throw badValue("--tag needs a tag");
    if (hasTag(tags, tag)) {
      throw new QueryError("\"" + record.name + "\" already carries the tag \"" + tag +
        "\"; --tag adds one tag, so there is nothing to add", "duplicate-tag");
    }
    tags = withTag(tags, tag);
  });
  (Array.isArray(removes) ? removes : []).forEach(function (raw) {
    const tag = String(raw).trim();
    if (tag === "") throw badValue("--untag needs a tag");
    if (!hasTag(tags, tag)) {
      throw new QueryError("\"" + record.name + "\" does not carry the tag \"" + tag +
        "\"; --untag removes one tag, so there is nothing to remove", "unknown-tag");
    }
    tags = withoutTag(tags, tag);
  });
  return tags;
}

// on or off, as the flag stores it: the two words a reader types, and nothing
// else. An absence is a Project's flag, not a free value, so "on" and "off"
// are the whole list rather than the first two of a longer one.
function absenceOption(value) {
  const text = String(value).trim().toLowerCase();
  if (text === "on") return true;
  if (text === "off") return false;
  throw badValue("--absence takes on or off, as in --absence on");
}

// The plan as it would be with one field of one record set, so a preview's
// figures are the report's own over the plan after the write rather than a
// second arithmetic. A new list and a new record, so the plan handed in is
// never mutated.
function withField(plan, kind, id, patch) {
  const key = KINDS[kind];
  const next = Object.assign({}, plan);
  next[key] = (plan[key] || []).map(function (record) {
    return record.id === id ? Object.assign({}, record, patch) : record;
  });
  return next;
}

// One record's edit: the fields named that differ from what is stored, in the
// store's own field names, and a diff of exactly those. Only what was named and
// differs goes in the patch, so the diff, the write and a patch that would
// change nothing are one decision. A tag list is a set the store sorts, so an
// edit that only reorders it has changed nothing.
function recordEdit(before, after, named) {
  const change = {};
  const diff = [];
  named.forEach(function (field) {
    const was = before[field];
    const now = after[field];
    if (Array.isArray(now) ? sameItems(now, was) : now === was) return;
    change[field] = now;
    diff.push({ field: field, before: was, after: now });
  });
  return { change: change, diff: diff };
}

export function personEdit(plan, request) {
  const asked = request || {};
  const period = resolvePeriod(plan, asked.period);
  const record = liveSubject(plan, "person", nameText(asked.subject, "person"));
  const subject = subjectOf(plan, "person", { record: record });
  const after = Object.assign({}, subject);
  const named = [];

  if (asked.name !== undefined) {
    after.name = nameText(asked.name, "person");
    named.push("name");
  }
  if (asked.location !== undefined) {
    after.location = String(asked.location).trim();
    named.push("location");
  }
  if (asked.availability !== undefined) {
    after.availability = availabilityOption(asked.availability);
    named.push("availability");
  }
  if (asked.note !== undefined) {
    after.note = String(asked.note).trim();
    named.push("note");
  }
  if (asked.tags !== undefined || asked.untag !== undefined) {
    after.tags = editTags(record, asked.tags, asked.untag);
    named.push("tags");
  }
  if (after.name !== subject.name) refuseDuplicateName(plan, "person", after.name, subject.id);

  const edit = recordEdit(subject, after, named);
  if (edit.diff.length === 0) {
    throw new QueryError("\"" + subject.name + "\" already holds every value this edit names; " +
      "there would be nothing to change", "no-change");
  }

  const answer = {
    period: period,
    units: units(),
    subject: subject,
    after: after,
    change: edit.change,
    diff: edit.diff
  };
  // What the change costs, which is why the command exists: an Availability or
  // a Location moves the Capacity the Person offers, so the report's own figure
  // is stated either side. A rename and a note move no figure, so none is
  // claimed for them.
  if (edit.change.availability !== undefined || edit.change.location !== undefined) {
    const off = absencesFor(plan, subject.id);
    answer.offered = {
      before: offerOver(plan, period, subject.availability, subject.location, off),
      after: offerOver(plan, period, after.availability, after.location, off)
    };
  }
  return answer;
}

export function projectEdit(plan, request) {
  const asked = request || {};
  const period = resolvePeriod(plan, asked.period);
  const record = liveSubject(plan, "project", nameText(asked.subject, "project"));
  const subject = subjectOf(plan, "project", { record: record });
  const after = Object.assign({}, subject);
  const named = [];

  if (asked.name !== undefined) {
    after.name = nameText(asked.name, "project");
    named.push("name");
  }
  if (asked.colour !== undefined) {
    after.colour = colourOption(asked.colour);
    named.push("colour");
  }
  if (asked.absence !== undefined) {
    after.absence = absenceOption(asked.absence);
    named.push("absence");
  }
  if (asked.note !== undefined) {
    after.notes = String(asked.note).trim();
    named.push("notes");
  }
  if (asked.tags !== undefined || asked.untag !== undefined) {
    after.tags = editTags(record, asked.tags, asked.untag);
    named.push("tags");
  }
  if (after.name !== subject.name) refuseDuplicateName(plan, "project", after.name, subject.id);

  const edit = recordEdit(subject, after, named);
  if (edit.diff.length === 0) {
    throw new QueryError("\"" + subject.name + "\" already holds every value this edit names; " +
      "there would be nothing to change", "no-change");
  }

  const answer = {
    period: period,
    units: units(),
    subject: subject,
    after: after,
    change: edit.change,
    diff: edit.diff
  };
  // An absence flag is the one field whose value is a figure rather than a word:
  // switching it decides whether the Project's Assignments take time out of
  // Capacity or add work to Allocated, so both figures are stated either way.
  if (edit.change.absence !== undefined) {
    const report = reportFor(plan, period);
    const toggled = reportFor(withField(plan, "project", subject.id, { absence: after.absence }), period);
    const before = planFigures(report);
    const afterPlan = planFigures(toggled);
    answer.absence = {
      on: after.absence,
      assignments: heldAssignments(plan, "project", subject.id),
      fteDays: afterPlan.capacity - before.capacity,
      plan: { before: before, after: afterPlan }
    };
  }
  return answer;
}

/* --- a copy of one record, before it is written -------------------------- */

// A record's tags as a copy carries them: a list of its own, so a copy can never
// share one with the record it came from.
function tagsOf(record) {
  return Array.isArray(record.tags) ? record.tags.slice() : [];
}

// The names a copy numbers past: the live records of its kind - the ones a read
// finds and the ones the app's own copy counts. An archived record is left out,
// as it is on the grid, so a copy may take a name an archived record still
// holds; the plan stores a name once per live record, so this is all it needs.
function liveNames(plan, kind) {
  const view = visiblePlan(plan, false);
  return (kind === "person" ? view.people : view.projects).map(function (record) {
    return record.name;
  });
}

// The body POST /api/people takes for a copy: what the app's own Copy carries -
// Location, Availability, Person tags and note - under the name the rule gave
// it. No Assignments at all, because a Person's work is their own.
function personCopyBody(record, name) {
  return {
    name: name,
    location: typeof record.location === "string" ? record.location : "",
    availability: record.availability,
    tags: tagsOf(record),
    note: typeof record.note === "string" ? record.note : ""
  };
}

// The body POST /api/projects takes for a copy: the colour, tags, notes and
// absence flag, because a copy of an absence is an absence. No colour is only
// left out where the source holds none, so it is never the tool's to invent.
function projectCopyBody(record, name) {
  const body = {
    name: name,
    tags: tagsOf(record),
    notes: typeof record.notes === "string" ? record.notes : "",
    absence: record.absence === true
  };
  if (record.colour !== undefined) body.colour = record.colour;
  return body;
}

// The body POST /api/assignments takes for a copy: the same Project, the same
// Person, the same dates, Share, tags and note, so the copy draws as a second
// band above the original. Its name is its Project's and its Person's, unchanged,
// which is why a copy needs no naming rule of its own.
function assignmentCopyBody(record) {
  return {
    projectId: record.projectId,
    personId: record.personId,
    start: record.start,
    end: record.end,
    share: record.share,
    tags: tagsOf(record),
    note: typeof record.note === "string" ? record.note : ""
  };
}

// The one Assignment a copy duplicates, identified the way assignment move
// identifies one - the live Project, the live Person, then the Assignment
// between them - and refused where every Assignment between them is archived:
// the grid offers no copy of an archived Assignment either, and the refusal
// names the restore that brings it back.
function copyAssignmentTarget(plan, asked) {
  const project = liveSubject(plan, "project", nameText(asked.project, "project"));
  const person = liveSubject(plan, "person", nameText(asked.person, "person"));
  const held = (plan.assignments || []).filter(function (assignment) {
    return assignment.projectId === project.id && assignment.personId === person.id;
  });
  const archived = held.filter(function (assignment) { return assignment.archived === true; });
  if (held.length > 0 && archived.length === held.length) {
    throw new QueryError("no live Assignment of " + project.name + " on " + person.name + ": " +
      held.map(spanText).join(", ") + (held.length === 1 ? " is" : " are") + " archived, so " +
      "there is nothing to copy; assignment restore " + project.name + " --person \"" +
      person.name + "\" brings it back", "not-live");
  }
  return {
    record: oneAssignment(visiblePlan(plan, false), project, person),
    project: project,
    person: person
  };
}

/*
 * A copy of one record: what it would carry, the name it would take and the body
 * the app's own create route takes, computed from the plan and written by
 * nobody. A copy is a creation rather than a change, so the source is untouched
 * and no work follows it: a Project copy has no Assignments and no Milestone
 * relation, a Person copy has no Assignments, and an Assignment copy is the same
 * Person over the same dates. The name is the app's own rule, imported rather
 * than written again, so a copy made here is named as the interface names one.
 */
export function copy(plan, request) {
  const asked = request || {};
  const kind = kindOf(asked.kind);
  if (kind === "assignment") {
    const target = copyAssignmentTarget(plan, asked);
    return {
      kind: kind,
      subject: subjectOf(plan, kind, target),
      create: assignmentCopyBody(target.record)
    };
  }
  const record = liveSubject(plan, kind, nameText(asked.subject, kind));
  const name = copyName(record.name, liveNames(plan, kind));
  return {
    kind: kind,
    subject: subjectOf(plan, kind, { record: record }),
    name: { from: record.name, to: name },
    create: kind === "person" ? personCopyBody(record, name) : projectCopyBody(record, name),
    // The source's own work stays on the source, which is the one thing a reader
    // could otherwise expect a copy to bring: a copy arrives empty.
    assignments: heldAssignments(plan, kind, record.id)
  };
}

/* --- one new Milestone, and one edited, before they are written ----------- */

// A Milestone has no archived state, so every Milestone in the file is live and
// the reads find one by name: a second of one name would make every later
// command ambiguous, so the name about to be created is checked against both
// keys of every Milestone, as a new Person's or Project's is against theirs.
function refuseDuplicateMilestone(plan, name) {
  const wanted = name.trim().toLowerCase();
  const clash = ((plan && plan.milestones) || []).find(function (milestone) {
    return String(milestone.name || "").trim().toLowerCase() === wanted ||
      String(milestone.id || "").trim().toLowerCase() === wanted;
  });
  if (clash) {
    throw new QueryError("the plan already holds a Milestone called \"" + clash.name + "\" (" +
      clash.id + "); the reads find a Milestone by name, so two of one name would make every " +
      "later command ambiguous", "duplicate-name");
  }
}

// One Milestone by name or id, case-insensitively, among every Milestone in the
// file - there is no archived state to look past - with an unknown or ambiguous
// name the reads' own error naming the nearest matches.
function milestoneSubject(plan, wanted) {
  const items = (plan && plan.milestones) || [];
  return matchOne(items, nameText(wanted, "milestone"), "milestone",
    function (milestone) { return milestone.name; },
    function (milestone) { return [milestone.name, milestone.id]; });
}

// The Projects a Milestone relates to, as the plan's own objects in the
// Milestone's order: the same resolution the `milestones` read prints.
function milestoneLinks(plan, projectIds) {
  return milestoneProjects({ projectIds: projectIds }, (plan && plan.projects) || []).map(
    function (project) { return { id: project.id, name: project.name }; });
}

// The related Projects a --project list names, as ids: the reads' own subject
// rule, so an unknown or ambiguous Project is their error naming the nearest
// matches rather than a silent empty list. A Project named twice is related
// once, since the related Projects are a set.
function milestoneProjectIds(plan, names) {
  const ids = [];
  (Array.isArray(names) ? names : []).forEach(function (name) {
    const id = liveSubject(plan, "project", nameText(name, "project")).id;
    if (ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}

// Whether two lists hold the same items in any order: a Milestone's tags are a
// set the store sorts, and its project ids are a set the panel ticks, so an
// edit that reorders either has changed nothing.
function sameItems(a, b) {
  const left = (Array.isArray(a) ? a : []).slice().sort();
  const right = (Array.isArray(b) ? b : []).slice().sort();
  return left.length === right.length && left.every(function (item, i) { return item === right[i]; });
}

export function milestoneAdd(plan, request) {
  const asked = request || {};
  const name = nameText(asked.name, "milestone");
  const date = dateOption(asked.date, "--date");
  const colour = colourOption(asked.colour);
  const tags = tagOptions(asked.tags);
  const notes = given(asked.note) ? String(asked.note).trim() : "";
  const projectIds = milestoneProjectIds(plan, asked.projects);
  refuseDuplicateMilestone(plan, name);

  // The body carries the store's own field names - a Milestone has `notes` and
  // `projectIds` - and no colour at all when none was named, so the server takes
  // the least-used slot rather than the tool inventing one.
  const create = { name: name, date: date, tags: tags.slice(), notes: notes, projectIds: projectIds };
  if (colour !== undefined) create.colour = colour;

  return {
    create: create,
    colour: {
      slot: colour === undefined ? leastUsedSlot(plan && plan.milestones) : colour,
      named: colour !== undefined
    },
    weekday: weekdayOf(date),
    projects: milestoneLinks(plan, projectIds)
  };
}

export function milestoneEdit(plan, request) {
  const asked = request || {};
  const stored = milestoneSubject(plan, asked.subject);
  const subject = {
    id: stored.id,
    name: stored.name,
    date: stored.date,
    colour: stored.colour,
    tags: Array.isArray(stored.tags) ? stored.tags.slice() : [],
    notes: typeof stored.notes === "string" ? stored.notes : "",
    projectIds: Array.isArray(stored.projectIds) ? stored.projectIds.slice() : [],
    projects: milestoneLinks(plan, stored.projectIds)
  };

  // Only what was named and differs goes in the patch, so the diff, the write
  // and a patch that would change nothing are one decision.
  const change = {};
  const diff = [];
  function note(field, before, after) {
    change[field] = after;
    diff.push({ field: field, before: before, after: after });
  }
  if (asked.date !== undefined) {
    const date = dateOption(asked.date, "--date");
    if (date !== subject.date) note("date", subject.date, date);
  }
  if (asked.colour !== undefined) {
    const colour = colourOption(asked.colour);
    if (colour !== subject.colour) note("colour", subject.colour, colour);
  }
  if (asked.tags !== undefined) {
    const tags = tagOptions(asked.tags);
    if (!sameItems(tags, subject.tags)) note("tags", subject.tags, tags);
  }
  if (asked.note !== undefined) {
    const notes = String(asked.note).trim();
    if (notes !== subject.notes) note("notes", subject.notes, notes);
  }
  if (asked.projects !== undefined) {
    const projectIds = milestoneProjectIds(plan, asked.projects);
    if (!sameItems(projectIds, subject.projectIds)) {
      note("projectIds", subject.projectIds, projectIds);
    }
  }
  if (diff.length === 0) {
    throw new QueryError("\"" + subject.name + "\" already holds every value this edit names; " +
      "there would be nothing to change", "no-change");
  }

  const after = Object.assign({}, subject, change);
  after.projects = milestoneLinks(plan, after.projectIds);
  return {
    subject: subject,
    after: after,
    change: change,
    diff: diff,
    weekday: weekdayOf(after.date),
    projects: after.projects
  };
}

/* --- one record archived or restored, before it is written ---------------- */

// The stored list each kind of record lives in, so the three collections are
// one shape here rather than three.
const KINDS = { person: "people", project: "projects", assignment: "assignments" };

// The plan as it would be with one record's archived state set - the same
// patched copy withField makes for any other field of a record.
function withArchived(plan, kind, id, archived) {
  return withField(plan, kind, id, { archived: archived });
}

function recordLabel(record) {
  return String(record.name || record.id || "");
}

function kindOf(kind) {
  if (!KINDS[kind]) {
    throw badValue('unknown kind "' + kind + '"; the kinds are person, project and assignment');
  }
  return kind;
}

// A record as a refusal names it: what it is called, which record it is, and
// which side of the archive line it is on. Two records of one name are told
// apart by nothing else.
function describeRecord(record) {
  return "\"" + recordLabel(record) + "\" (" + record.id + ", " +
    (record.archived === true ? "archived" : "live") + ")";
}

function namesRecord(record, wanted) {
  const w = wanted.trim().toLowerCase();
  return [record.name, record.id].some(function (key) {
    return String(key === undefined || key === null ? "" : key).trim().toLowerCase() === w;
  });
}

// The record `wanted` names among the ones the reads see. An archived record is
// not in the plan, so it is not found here; where it is the only record of that
// name, the refusal says so rather than call the name unknown.
function liveSubject(plan, kind, wanted) {
  const view = visiblePlan(plan, false);
  const items = kind === "person" ? view.people : view.projects;
  try {
    return matchOne(items, wanted, kind, recordLabel,
      function (item) { return [item.name, item.id]; });
  } catch (err) {
    if (err.code !== "unknown-subject") throw err;
    const archived = (plan[KINDS[kind]] || []).filter(function (item) {
      return item.archived === true && namesRecord(item, wanted);
    });
    if (archived.length !== 1) throw err;
    throw new QueryError(describeRecord(archived[0]) + " is archived, so it is not in the plan; " +
      kind + " restore \"" + recordLabel(archived[0]) + "\" brings it back", "not-live");
  }
}

// The record `wanted` names among the ones the reads cannot see: the record a
// restore exists for. A live record and an archived one answering to one name
// are refused and both named, because a restore that chose one would change
// which record every later read finds under that name.
function archivedSubject(plan, kind, wanted) {
  const items = plan[KINDS[kind]] || [];
  const exact = items.filter(function (item) { return namesRecord(item, wanted); });
  const live = exact.filter(function (item) { return item.archived !== true; });
  const archived = exact.filter(function (item) { return item.archived === true; });
  if (live.length > 0 && archived.length > 0) {
    throw new QueryError("both a live and an archived " + kind + " answer to \"" + wanted +
      "\": " + live.map(describeRecord).join(", ") + " is live and " +
      archived.map(describeRecord).join(", ") + " is archived; a restore names one record, so " +
      "rename the one you do not mean in the app", "ambiguous-subject",
      live.concat(archived).map(recordLabel));
  }
  if (live.length > 0) {
    throw new QueryError(describeRecord(live[0]) + " is not archived; there is nothing to restore",
      "not-archived");
  }
  if (archived.length > 1) {
    throw new QueryError("more than one archived " + kind + " matches \"" + wanted + "\": " +
      archived.map(describeRecord).join(", ") + "; a restore names one record, so rename the " +
      "ones you do not mean in the app", "ambiguous-subject", archived.map(recordLabel));
  }
  if (archived.length === 1) return archived[0];
  throw unknown(kind, wanted, nearest(wanted, items.map(recordLabel)));
}

function spanText(assignment) {
  return assignment.start + " to " + assignment.end + " (" + assignment.share + "%)";
}

// One Assignment of a Project on a Person, as the direction asks for it: the
// live one an archive takes out of the plan, or the archived one a restore
// brings back. A Person may hold several, so more than one is an error naming
// every candidate rather than a pick.
function assignmentSubject(plan, report, asked, only) {
  const project = liveSubject(plan, "project", nameText(asked.project, "project"));
  const person = liveSubject(plan, "person", nameText(asked.person, "person"));
  const held = (plan.assignments || []).filter(function (assignment) {
    return assignment.projectId === project.id && assignment.personId === person.id;
  });
  const candidates = held.filter(function (assignment) {
    return only === "live" ? assignment.archived !== true : assignment.archived === true;
  }).sort(byDates);

  if (candidates.length > 1) {
    throw new QueryError("more than one " + (only === "live" ? "" : "archived ") +
      "Assignment of " + project.name + " on " + person.name + ": " +
      candidates.map(spanText).join(", ") + "; this tool " +
      (only === "live" ? "archives" : "restores") + " one Assignment at a time, so change " +
      "these in the app", "ambiguous-assignment");
  }
  if (candidates.length === 1) return { record: candidates[0], project: project, person: person };
  if (held.length > 0) {
    const spans = held.map(spanText).join(", ") + (held.length === 1 ? " is" : " are");
    throw new QueryError(only === "live"
      ? "no live Assignment of " + project.name + " on " + person.name + ": " + spans +
        " archived; assignment restore " + project.name + " --person \"" + person.name +
        "\" brings it back"
      : "no archived Assignment of " + project.name + " on " + person.name + ": " + spans +
        " live, so there is nothing to restore",
    only === "live" ? "not-live" : "not-archived");
  }
  const elsewhere = holdingsElsewhere(report.view, person);
  throw new QueryError("no Assignment of " + project.name + " on " + person.name +
    (elsewhere.length > 0
      ? "; " + person.name + " holds " + elsewhere.join(", ")
      : "; " + person.name + " holds no Assignment in this plan"),
    "unknown-assignment");
}

function moveTarget(plan, report, kind, asked, only) {
  if (kind === "assignment") return assignmentSubject(plan, report, asked, only);
  const wanted = nameText(asked.subject, kind);
  const record = only === "live"
    ? liveSubject(plan, kind, wanted)
    : archivedSubject(plan, kind, wanted);
  return { record: record };
}

// The Assignments a Person or a Project holds in the file: the ones that stop
// counting when it is archived, and count again when it is restored. Archived
// Assignments are left out of the list because they were not counting before
// the move either - archiving the Person does not change them.
function heldAssignments(plan, kind, id) {
  const field = kind === "person" ? "personId" : "projectId";
  const projects = plan.projects || [];
  const people = plan.people || [];
  return (plan.assignments || []).filter(function (assignment) {
    return assignment[field] === id && assignment.archived !== true;
  }).sort(byDates).map(function (assignment) {
    const project = projects.find(function (entry) { return entry.id === assignment.projectId; });
    const person = people.find(function (entry) { return entry.id === assignment.personId; });
    return {
      id: assignment.id,
      projectId: assignment.projectId,
      project: project ? project.name : assignment.projectId,
      personId: assignment.personId,
      person: person ? person.name : assignment.personId,
      start: assignment.start,
      end: assignment.end,
      share: assignment.share
    };
  });
}

// The plan's own figures, by the report's totals rather than a sum of this
// module's: the two numbers a preview says leave or return with a record.
function planFigures(report) {
  return { capacity: report.model.offeredTotal, allocated: report.model.planTotal };
}

// One Project's row over the period, or nothing where the plan no longer holds
// the Project - the row the projects command prints, by projectRow's own rule.
function projectFigures(report, projectId) {
  const found = report.view.projects.find(function (entry) { return entry.id === projectId; });
  if (!found) return null;
  const row = report.model.byProject.rows.find(function (entry) { return entry.id === projectId; });
  const allocation = report.model.allocationByProject.rows.find(function (entry) {
    return entry.id === projectId;
  });
  return projectRow(report.model, found, row, allocation);
}

function subjectOf(plan, kind, target) {
  const record = target.record;
  const tags = Array.isArray(record.tags) ? record.tags.slice() : [];
  const archived = record.archived === true;
  if (kind === "person") {
    return {
      id: record.id,
      name: record.name,
      location: typeof record.location === "string" ? record.location : "",
      availability: Number(record.availability) || 0,
      tags: tags,
      note: typeof record.note === "string" ? record.note : "",
      archived: archived
    };
  }
  if (kind === "project") {
    return {
      id: record.id,
      name: record.name,
      colour: record.colour,
      tags: tags,
      notes: typeof record.notes === "string" ? record.notes : "",
      absence: record.absence === true,
      archived: archived
    };
  }
  return {
    id: record.id,
    projectId: record.projectId,
    project: target.project.name,
    personId: record.personId,
    person: target.person.name,
    start: record.start,
    end: record.end,
    share: record.share,
    tags: tags,
    note: typeof record.note === "string" ? record.note : "",
    absence: absenceProjectIds(plan).has(record.projectId),
    archived: archived
  };
}

// The answer both directions give, from the two reports: what the move takes
// out of the plan or puts back into it, and where the figures stand either
// side. The only difference between an archive and a restore is the state the
// record is left in, so there is one shape and one arithmetic for both.
function moveAnswer(plan, report, period, kind, target, archived) {
  const after = reportFor(withArchived(plan, kind, target.record.id, archived), period);
  const answer = {
    period: period,
    units: units(),
    kind: kind,
    subject: subjectOf(plan, kind, target),
    before: { plan: planFigures(report) },
    after: { plan: planFigures(after) }
  };
  if (kind === "project") {
    answer.assignments = heldAssignments(plan, kind, target.record.id);
    answer.before.project = projectFigures(report, target.record.id);
    answer.after.project = projectFigures(after, target.record.id);
    return answer;
  }
  if (kind === "person") {
    answer.assignments = heldAssignments(plan, kind, target.record.id);
    answer.before.person = personPosition(report, target.record.id);
    answer.after.person = personPosition(after, target.record.id);
    return answer;
  }
  // The Assignment itself is what leaves or returns; its own size is measured
  // against the plan without it, as a move measures one against the others.
  answer.fteDays = spanFteDays(withoutAssignment(plan, target.record.id), target.person,
    target.record.start, target.record.end, target.record.share);
  answer.before.person = personPosition(report, target.person.id);
  answer.after.person = personPosition(after, target.person.id);
  return answer;
}

// Archiving takes a record out of the plan and leaves everything in the file:
// it sets one flag, and the Assignments it holds stay where they are and stop
// counting. The subject is found the way the reads find one, so a record
// already archived is not found at all.
export function archive(plan, request) {
  const asked = request || {};
  const kind = kindOf(asked.kind);
  const period = resolvePeriod(plan, asked.period);
  const report = reportFor(plan, period);
  return moveAnswer(plan, report, period, kind, moveTarget(plan, report, kind, asked, "live"), true);
}

// Restoring is the same move the other way. Its subject is exactly the record
// the reads leave out, so the lookup here is the one place in the tool that
// looks past them.
export function restore(plan, request) {
  const asked = request || {};
  const kind = kindOf(asked.kind);
  const period = resolvePeriod(plan, asked.period);
  const report = reportFor(plan, period);
  return moveAnswer(plan, report, period, kind, moveTarget(plan, report, kind, asked, "archived"), false);
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

/* --- one holiday date, before it is written ------------------------------ */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The weekday a date falls on, read in UTC like every other date rule here, so
// the preview's "a Thursday" is the day the plan means wherever it is read.
function weekdayOf(iso) {
  const day = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return WEEKDAYS[day.getUTCDay()];
}

function kindLabel(kind) {
  return kind === "half" ? "half day" : "full day";
}

// The Location one holiday date is written for: the live People whose Location
// matches it, by the same case-insensitive rule the holiday lookup uses, and
// the spelling the date lands under - the holidays' own spelling where the plan
// already configures any there, else the first live Person's. A Location no
// Person is at would change no figure, so it is refused rather than recorded.
function holidaySubject(plan, wanted) {
  const text = wanted === undefined || wanted === null ? "" : String(wanted).trim();
  if (text === "") throw badValue("a holiday Location is required");
  const key = locationKey(text);
  const configured = holidayLocations(plan && plan.holidays).find(function (location) {
    return locationKey(location) === key;
  });
  const people = visiblePlan(plan, false).people.filter(function (person) {
    return locationKey(person.location) === key;
  });
  if (people.length === 0) {
    throw new QueryError("no Person is at \"" + text + "\", so a holiday there would change " +
      "no figure" + (configured
        ? "; the plan has holidays configured at " + configured + " but no live Person there"
        : ""), "no-people");
  }
  return {
    key: key,
    location: configured || people[0].location.trim(),
    people: people
  };
}

// A group's dates with one added, in the date order the app's own save keeps
// them and without disturbing the entries already there.
function withDateInserted(dates, date, kind) {
  const entry = { date: date, kind: kind };
  const at = dates.findIndex(function (existing) {
    return existing && typeof existing.date === "string" && existing.date > date;
  });
  if (at === -1) return dates.concat([entry]);
  return dates.slice(0, at).concat([entry], dates.slice(at));
}

// A group's dates without the first entry on `date`, or null when the group
// holds no such entry.
function withDateRemoved(dates, date) {
  const at = dates.findIndex(function (entry) { return entry && entry.date === date; });
  if (at === -1) return null;
  return dates.slice(0, at).concat(dates.slice(at + 1));
}

// The plan's holidays with one date added to, or removed from, the groups of one
// Location, and nothing else touched. A group belonging to another Location is
// carried through as it was stored, field for field, so a rebuild cannot lose
// one; the Location's own dates keep their stored order, the new date landing in
// date order among them, exactly as the app's own save sorts them. A Location
// whose last date is removed leaves no group behind, and a Location with none
// yet gains one - the two states the holidays panel writes the same way.
function rebuildHolidays(holidays, subject, action, date, kind) {
  const groups = Array.isArray(holidays) ? holidays : [];
  const out = [];
  let done = false;
  groups.forEach(function (group) {
    const mine = group && locationKey(group.location) === subject.key;
    const dates = mine && group && Array.isArray(group.dates) ? group.dates : [];
    if (!mine || done) {
      out.push(group);
      return;
    }
    if (action === "add") {
      out.push(Object.assign({}, group, { dates: withDateInserted(dates, date, kind) }));
      done = true;
      return;
    }
    const kept = withDateRemoved(dates, date);
    if (kept === null) {
      out.push(group);
      return;
    }
    done = true;
    if (kept.length > 0) out.push(Object.assign({}, group, { dates: kept }));
  });
  if (action === "add" && !done) {
    out.push({ location: subject.location, dates: [{ date: date, kind: kind }] });
  }
  return out;
}

// The plan with a different holiday list, so the figures after the change are
// the report's own over the plan with it in, never a second arithmetic.
function withHolidays(plan, holidays) {
  return Object.assign({}, plan, { holidays: holidays });
}

// What one Person offers over the report's period: the figure the people
// command prints as Capacity, after their Location's holidays and their own
// absences. A Person the report does not hold - the plan no longer has them -
// offers nothing.
function capacityOf(report, personId) {
  const row = report.model.byPerson.rows.find(function (entry) { return entry.id === personId; });
  return row ? row.offered : 0;
}

/*
 * One holiday date added to, or removed from, one Location: what the write would
 * change, computed before it is made. The whole point is that the app's only
 * holiday write replaces every Location's dates at once, so this answers with
 * the whole list it would send, the Location's own dates before and after, and
 * the Capacity it moves for each Person there - which is the report's figure,
 * so a weekend date says nothing changes and a half day says half of one.
 */
export function holidayChange(plan, request) {
  const asked = request || {};
  const action = asked.action === "add" || asked.action === "remove" ? asked.action : null;
  if (action === null) {
    throw badValue('unknown holiday action "' +
      (asked.action === undefined || asked.action === null ? "" : String(asked.action)) +
      '"; the actions are add and remove');
  }
  const date = dateOption(asked.date, "the holiday date");
  let kind = HOLIDAY_KIND_DEFAULT;
  if (action === "add" && given(asked.kind)) {
    const text = String(asked.kind).trim();
    if (!isHolidayKind(text)) {
      throw badValue('--kind must be one of the app\'s own: ' + HOLIDAY_KINDS.join(" or "));
    }
    kind = text;
  }
  if (action === "remove" && given(asked.kind)) {
    throw badValue("a holiday date is added with a kind and removed as it is stored, so " +
      "remove takes no --kind");
  }

  const subject = holidaySubject(plan, asked.location);
  const before = holidaysFor(plan && plan.holidays, subject.location);
  const already = before.find(function (day) { return day.date === date; });
  if (action === "add" && already) {
    throw new QueryError(date + " is already a holiday at " + subject.location + ", a " +
      kindLabel(already.kind) + (already.kind === kind
        ? "; nothing to add"
        : "; remove it first to record it as a " + kindLabel(kind)), "duplicate-holiday");
  }
  if (action === "remove" && !already) {
    throw new QueryError(date + " is not a holiday at " + subject.location + "; " +
      (before.length === 0
        ? "it has none configured"
        : "its dates are " + before.map(function (day) { return day.date; }).join(", ")),
      "unknown-holiday");
  }

  const holidays = rebuildHolidays(plan && plan.holidays, subject, action, date, kind);
  const period = resolvePeriod(plan, asked.period);
  const was = reportFor(plan, period);
  const now = reportFor(withHolidays(plan, holidays), period);
  const people = subject.people.map(function (person) {
    const offeredBefore = capacityOf(was, person.id);
    const offeredAfter = capacityOf(now, person.id);
    return {
      id: person.id,
      name: person.name,
      availability: person.availability,
      before: offeredBefore,
      after: offeredAfter,
      fteDays: offeredAfter - offeredBefore
    };
  });
  const range = planRange(plan);
  return {
    period: period,
    units: units(),
    action: action,
    location: subject.location,
    date: date,
    kind: action === "add" ? kind : already.kind,
    weekday: weekdayOf(date),
    weekend: isWeekend(date),
    outsidePlan: range ? date < range.start || date > range.end : false,
    inPeriod: date >= period.start && date <= period.end,
    planPeriod: range,
    people: people,
    fteDays: people.reduce(function (sum, person) { return sum + person.fteDays; }, 0),
    before: before,
    after: holidaysFor(holidays, subject.location),
    others: holidayLocations(plan && plan.holidays).filter(function (location) {
      return locationKey(location) !== subject.key;
    }),
    change: { holidays: holidays }
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
