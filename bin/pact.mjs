#!/usr/bin/env node
/*
 * PACT's tool: answer a question about a plan from a checkout, with no server
 * and no browser, and change a plan through the running app.
 *
 * This file is the front end only: it parses argv, resolves the plan file,
 * hands the plan and the period to `lib/query.mjs`, and renders the one object
 * that comes back as text (the default) or as JSON. It does no plan arithmetic
 * and no plan traversal of its own; every figure is the query module's, which
 * is the report's own. Reads never touch the network - except `view`, which
 * reads the app's View settings and the plan it is showing, because neither
 * exists anywhere else. The fourteen writes -
 * `person add --apply`, `project add --apply`, `assignment move --apply`,
 * `assignment add --apply`, archive and restore for each of the three
 * collections, `holiday add --apply` and `holiday remove --apply`, and
 * `milestone add --apply` and `milestone edit --apply` - send the query
 * module's body, patch or archive to the app's own
 * POST /api/people, POST /api/projects, PATCH /api/assignments/<id>,
 * POST /api/assignments, DELETE /api/<collection>/<id> (the archive, as it has
 * always been), PATCH /api/<collection>/<id> with `archived: false` (the
 * restore), PATCH /api/plan with the whole rebuilt holiday list (the app's
 * one holiday write) and POST /api/milestones and PATCH /api/milestones/<id>
 * (the app's two Milestone writes) - the routes and bodies the interface
 * itself uses - so the validation, the atomic write and the changed-underneath
 * guard are the app's, and the change is one step back with its Undo control.
 * Nothing here deletes a record: the tool has no route to the app's
 * destruction, no such command, and no flag that reaches one. `holiday remove`
 * takes a holiday date out of one plan setting, which is not a record and is
 * restorable by adding the date back, and a Milestone is created and edited but
 * never removed, because it has no archived state; see Deleting in the help.
 *
 * One command is neither a plan read nor a plan write: `view` reads how the app
 * is displaying the plan, and `view set` changes one View setting, both
 * through the running app's own GET and POST /api/view. It writes the display
 * store only - never the plan, never the plan's period, Step, cadence or tag
 * selections - so it is not one of the fourteen above and it reaches nothing
 * that deletes.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { validatePlan } from "../lib/plan.mjs";
import * as query from "../lib/query.mjs";
import { reportViewLabel } from "../public/lib/report-views.mjs";
import { directionLabel, findSortKey } from "../public/lib/sort.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

// The options that narrow a list: `people` takes every one of them, `projects`
// the two a Project is known by, and a read of one subject none, because it is
// already one. An option a command does not take is refused, never ignored.
const ALL_NARROWS = ["location", "tags", "over", "under", "top"];
const PROJECT_NARROWS = ["tags", "top"];

const COMMANDS = {
  plan: {
    period: true,
    subject: false,
    narrows: [],
    run: function (plan, period) { return query.planSummary(plan, period); }
  },
  people: {
    period: true,
    subject: false,
    narrows: ALL_NARROWS,
    run: function (plan, period, narrow) { return query.people(plan, period, narrow); }
  },
  person: {
    period: true,
    subject: true,
    narrows: [],
    run: function (plan, period, name) { return query.person(plan, period, name); }
  },
  projects: {
    period: true,
    subject: false,
    narrows: PROJECT_NARROWS,
    run: function (plan, period, narrow) { return query.projects(plan, period, narrow); }
  },
  project: {
    period: true,
    subject: true,
    narrows: [],
    run: function (plan, period, name) { return query.project(plan, period, name); }
  },
  tags: {
    period: true,
    subject: false,
    narrows: [],
    run: function (plan, period) { return query.tags(plan, period); }
  },
  tag: {
    period: true,
    subject: true,
    narrows: [],
    run: function (plan, period, key) { return query.tag(plan, period, key); }
  },
  capacity: {
    period: true,
    subject: false,
    narrows: [],
    run: function (plan, period) { return query.capacity(plan, period); }
  },
  holidays: {
    period: false,
    subject: false,
    narrows: [],
    run: function (plan) { return query.holidays(plan); }
  },
  milestones: {
    period: false,
    subject: false,
    narrows: [],
    run: function (plan) { return query.milestones(plan); }
  }
};

const HELP = `PACT tool

Answer a question about a plan from a checkout, with no server and no browser.
Fourteen commands change a plan: person add, project add, assignment add and
assignment move create and change work, person, project and assignment each
take archive and restore, holiday add and holiday remove each write one
holiday date for one Location, and milestone add and milestone edit create a
Milestone and change one. All of them write through the running app, so
the change is one step back with its Undo control. The figures are computed
by the report's own modules over the period you ask for, so they are the report
page's numbers, and the two list reads can be narrowed to the rows a question is
about: see Narrowing a list below. Two more commands are about neither the plan
nor its figures but how the app draws it - view reads the View settings, and
view set changes one - and they are not plan writes: see The view, and how it
looks below. The tool never deletes anything; see Deleting below.

Usage
  node bin/pact.mjs --help
  node bin/pact.mjs <command> [name] [options]

Commands
  plan                 [--period]  the plan period, Step, counts and totals
      node bin/pact.mjs plan --period 2026-11
  people               [--period]  each Person: Capacity, Allocated, Remaining, of offer
      node bin/pact.mjs people --period 2026-11
      node bin/pact.mjs people --location Berlin --over --period 2026-11
  person <name>        [--period]  one Person, and the Assignments meeting the period
      node bin/pact.mjs person "Anna Meier" --period 2026-11
  projects             [--period]  each Project: Allocated, of plan, of capacity
      node bin/pact.mjs projects --period 2026-11
      node bin/pact.mjs projects --tag api --top 3 --period 2026-11
  project <name>       [--period]  one Project, and the Assignments meeting the period
      node bin/pact.mjs project Atlas --period 2026-11
  tags                 [--period]  each tag with its FTE-days
      node bin/pact.mjs tags --period 2026-11
  tag <tag|key>        [--period]  one tag by name, or every tag under a tag key
      node bin/pact.mjs tag api --period 2026-11
  capacity             [--period]  Capacity offered against Allocated, per time bucket
      node bin/pact.mjs capacity --period 2026-11
  holidays                         the holidays as stored, by Location
      node bin/pact.mjs holidays
  milestones                       the Milestones as stored
      node bin/pact.mjs milestones
  view                             how the app is displaying the plan, and where it serves
      node bin/pact.mjs view
  view set <key> <value>           change one View setting, through the app
      node bin/pact.mjs view set zoom week
      node bin/pact.mjs view set zoom week --apply
  person add <name>                create one Person, through the app
      node bin/pact.mjs person add "Clara Nowak" --location Berlin \\
          --availability 80 --tag "skill:frontend" --tag "team:atlas"
  project add <name>               create one Project, through the app
      node bin/pact.mjs project add Northwind --tag "api:Northwind"
  assignment add <project>         create one Assignment, through the app
      node bin/pact.mjs assignment add Atlas --person "Anna Meier" \\
          --from 2026-11-23 --to 2026-12-04 --share 60
  assignment move <project>        reschedule or resize one Assignment, through the app
      node bin/pact.mjs assignment move Atlas --person "Anna Meier" \\
          --from 2026-11-02 --to 2026-11-20
  person archive <name>            archive one Person, through the app
      node bin/pact.mjs person archive "Anna Meier"
  person restore <name>            restore an archived Person, through the app
      node bin/pact.mjs person restore "Anna Meier"
  project archive <name>           archive one Project, through the app
      node bin/pact.mjs project archive Atlas
  project restore <name>           restore an archived Project, through the app
      node bin/pact.mjs project restore Atlas
  assignment archive <project>     archive one Assignment, through the app
      node bin/pact.mjs assignment archive Atlas --person "Anna Meier"
  assignment restore <project>     restore an archived Assignment, through the app
      node bin/pact.mjs assignment restore Atlas --person "Anna Meier"
  holiday add <location> <date>    add one holiday date for one Location, through the app
      node bin/pact.mjs holiday add Berlin 2026-12-24
  holiday remove <location> <date> remove one holiday date for one Location, through the app
      node bin/pact.mjs holiday remove Berlin 2026-12-24
  milestone add <name>             create one Milestone, through the app
      node bin/pact.mjs milestone add "API launch" --date 2026-12-04 \\
          --project Atlas --tag "delivery:phase-2"
  milestone edit <name>            move or change one Milestone, through the app
      node bin/pact.mjs milestone edit "API launch" --date 2026-12-11

Options
  --period <period>    the stretch to count; without it, the plan's own period
                       month:   2026-11
                       sprint:  "Sprint 24", or sprint 24 for its ordinal
                       range:   2026-11-01..2026-11-30
  --plan <path>        the plan file; a relative path is from this directory,
                       and a leading ~ is expanded
  --json               the same data as JSON; see JSON below
  -h, --help           this text; --help works before or after a command
  --period=<period> and --plan=<path> also work.

people takes these as well
  --location <location>  a Person's own Location, matched case-insensitively
  --over                 Allocated above Capacity
  --under                Allocated below Capacity, so a Person at exactly their
                       Capacity is in neither; --over and --under together are
                       refused

people and projects take these as well
  --tag <tag>          a tag of the subject's own vocabulary, repeated to
                       require every one of them: --tag team:atlas --tag lead.
                       A term that names one of its tags matches that tag, and
                       a term that names a tag key matches every tag under that
                       key, case-insensitively - exactly as tag <key> resolves
                       one
  --top <n>            the n largest by the FTE-days column, highest first

  No other read takes any of these five, and one it is given is refused rather
  than ignored: person <name> and project <name> are already one subject, so
  there is nothing there to narrow.

assignment add and assignment move take these as well
  --person <name>      the Person the Assignment is on; required
  --from <date>        add: the start date, as 2026-11-23; required
                       move: the new start date, as 2026-11-02
  --to <date>          add: the end date, as 2026-12-04; required
                       move: the new end date, as 2026-11-20
  --share <percent>    the Allocation, a whole number from 1 to 100
                       add: 100 when left out
                       move: the new Allocation, kept when left out
  --apply              write it; without this, and with --dry-run, nothing is written
  --dry-run            the preview, and nothing written: the same as the default

person add and project add take these as well
  --tag <tag>          a tag, repeated once per tag: --tag a --tag b. Tags are the
                       record's own vocabulary, so a Person's tags and a
                       Project's are separate lists, and a typed tag such as
                       skill:frontend is stored exactly as typed
  --note <text>        free text; it lands in the Person's note, or the
                       Project's notes
  --apply              write it; without this, and with --dry-run, nothing is written
  --dry-run            the preview, and nothing written: the same as the default

person add takes these as well
  --location <name>    the Person's Location; its holidays are the ones taken out
                       of the Capacity the preview states
  --availability <pct> the Availability, a whole percentage; 100 when left out.
                       The app validates the range and its refusal is printed as
                       the app wrote it

project add takes these as well
  --colour <slot>      the Project's colour slot, 0 to 9; without it the app takes
                       the least-used slot, and the preview names the one it
                       expects to be taken

person archive, person restore, project archive, project restore,
assignment archive and assignment restore take these as well
  --person <name>      the two assignment ones: the Person the Assignment is on;
                       required, as it is for assignment move
  --apply              write it; without this, and with --dry-run, nothing is written
  --dry-run            the preview, and nothing written: the same as the default

holiday add takes this as well
  --kind full|half     a whole or a half day off; full when left out, as the
                       app's own default is

holiday add and holiday remove take these as well
  --apply              write it; without this, and with --dry-run, nothing is written
  --dry-run            the preview, and nothing written: the same as the default

milestone add takes these as well
  --date <date>        the Milestone's one date, as 2026-12-04; required
  --colour <slot>      the colour slot, 0 to 9; without it the app takes the
                       least-used slot among the Milestones, and the preview
                       names the one it expects to be taken
  --tag <tag>          a tag, repeated once per tag. A Milestone's tags are their
                       own vocabulary, separate from a Person's or a Project's
  --project <project>  a Project the Milestone relates to, repeated once per
                       Project, by the name the reads resolve
  --note <text>        free text; it lands in the Milestone's notes
  --apply              write it; without this, and with --dry-run, nothing is written
  --dry-run            the preview, and nothing written: the same as the default

milestone edit takes these as well
  --date <date>        the new date; the weekday of it is stated
  --colour <slot>      the new colour slot, 0 to 9
  --tag <tag>          the Milestone's new tags, replacing the ones it holds;
                       repeated once per tag
  --project <project>  the Projects it now relates to, replacing those it named;
                       repeated once per Project
  --note <text>        the new notes
  --apply              write it; without this, and with --dry-run, nothing is written
  --dry-run            the preview, and nothing written: the same as the default
                       A field left out keeps what the Milestone holds.

Holidays, one date at a time
  holiday add and holiday remove write one holiday date for one Location. The
  app's only holiday write replaces every Location's dates at once, so the tool
  reads the plan, adds or removes that one date, and sends the whole list back
  rebuilt from that read - through the app's own PATCH /api/plan, so the
  validation, the atomic write, the changed-underneath guard and the undo step
  are the app's. The preview therefore prints the resulting holiday list for
  that Location in full, and says that the other Locations are untouched: a lost
  entry is visible before it is written. The read back then asks the app's plan
  for exactly the array that was sent - every Location's group and every date in
  it, in order - so a rebuild that lost or moved anything fails rather than
  reports success.

  The preview states what a reader cannot see: the weekday of the date, whether
  it falls on a weekend, how many People the Location affects, and the FTE-days
  the date takes off or puts back over --period - all of them the report's own
  figure for those People, before and after, so a weekend date and a half day
  say exactly what they change. A date outside the plan period is allowed and
  noted.

  It refuses a date that is already a holiday there, a date that is not one
  there, a Location no live Person is at (the holiday would change nothing), a
  --kind the app does not have, and a date the plan's format does not accept.
  The kind is the app's own list: full or half.

Creating a Person or a Project
  person add creates one Person and prints what it would create: their name,
  Location and Availability, their tags, and what that Availability is worth
  over the period - the report's own working days at that Availability, after
  their Location's holidays, with the days those holidays take out named when
  they take any. project add creates one Project and prints the colour slot it
  would take, that it starts with no Assignments, and its tags.

  A name the live plan already answers to is refused before anything is written,
  naming the record that holds it. Reads find a Person or a Project by name, so
  two live records of one name would make every later command ambiguous.

  --apply sends the create body through the app's own POST /api/people or
  POST /api/projects, so the server mints the id - and, for a Project with no
  --colour, takes its least-used colour slot. The tool then reads the plan back
  and confirms the record the app holds has the values it asked for; a creation
  the plan does not show exits non-zero and says it did not land.

Creating an Assignment
  assignment add creates one Assignment on a Project and a Person, over --from
  and --to at --share, and prints what it would create: its dates and
  Allocation, its FTE-days, the Person's Allocated of their Capacity after it,
  the Project's new total, and every Assignment the Person already holds on
  those dates, named one by one. Over-allocation is allowed, never refused, so a
  new Assignment can put a Person over their Capacity; the preview states it
  before it is made rather than after.

  --apply sends the create body through the app's own POST /api/assignments, so
  the server mints the id, and its validation, its atomic write and its guard
  against a file changed underneath all apply. The tool then reads the plan back
  and confirms the Assignment the app holds has the Project, Person, dates and
  Allocation it asked for; a creation the plan does not show exits non-zero and
  says it did not land.

Rescheduling or resizing an Assignment
  assignment move identifies one Assignment by a Project and a Person, and sets
  its dates and its Allocation: --from and --to are the dates, --share the
  Allocation, and a field left out keeps what the Assignment holds.

  It prints a diff and writes nothing - the old and new dates, the old and new
  FTE-days, and the Person's Allocated of their Capacity before and after, so an
  over-allocation is visible before it is made rather than after. --apply sends
  exactly the fields the diff shows, through the app's own
  PATCH /api/assignments/<id>, then reads the plan back and confirms the
  Assignment holds them; a write that did not land exits non-zero.

  A Person may hold several Assignments of one Project. More than one match is
  an error naming the candidates, never a guess.

  The app must be the one holding this plan file: the tool reads the app's
  /api/plan-file and refuses rather than change a different plan. Where the app
  is: PACT_URL, else http://localhost:4173. Reads need no server.

  The change is one step back with the app's Undo control, because the app made
  it: nothing about the write bypasses the plan store.

Creating a Milestone, and moving one
  milestone add creates one Milestone and prints what it would create: its name
  and date, the weekday that date falls on, the colour slot it would take, its
  tags, its notes, and whether it relates to Projects or to none. A Milestone
  related to Projects draws its rule only while one of them is in view; one
  related to none is plan-wide. The preview says which, because that is what the
  reader of the plan cannot see from a date alone, and adds the reminder that no
  total, share or over-allocation check counts a Milestone: it is an annotation.

  A new Milestone with no --colour takes the least-used slot among the plan's
  Milestones, and the server picks it: the preview names the slot it expects,
  but the create body carries no colour at all. A named --colour is honoured and
  the preview says it was named rather than predicted.

  milestone edit identifies one Milestone by name, and sets the fields it names:
  --date, --colour, --tag, --project and --note, with a field left out keeping
  what the Milestone holds. It prints a diff of exactly the fields that change
  and writes nothing; --apply sends exactly those fields, through the app's own
  PATCH /api/milestones/<id>, then reads the plan back and confirms the
  Milestone holds them. A write that did not land exits non-zero.

  It refuses a name a Milestone already answers to (the reads find a Milestone
  by name, so two of one name would make every later command ambiguous), a date
  the plan's format does not accept, an unknown or ambiguous Project, an unknown
  colour, and an edit that would change nothing. It never removes a Milestone:
  a Milestone has no archived state, so there is no action, option or route here
  to the app's deletion, which stays in the app where it can be seen.

Archiving and restoring
  person archive, project archive and assignment archive take a record out of
  the plan and destroy nothing: it is one flag in the plan file, written by the
  app's own DELETE on the record, which has always been the archive rather than
  a deletion. The preview states what leaves the plan - the record's own figure
  going to nothing, the FTE-days that leave the plan's total, and the
  Assignments that stay in the file and stop counting - and nothing is written
  without --apply.

  Archiving does not cascade. A Person's or a Project's Assignments stay in the
  file exactly as they were and stop counting, which is why the preview states
  them: nothing is lost, and the plan's totals simply no longer carry them. An
  archived Person or Project cannot take new work, and the app's Show archived
  draws whatever this tool has archived.

  person restore, project restore and assignment restore are the same move the
  other way: the app's own PATCH that sets archived back to false, with the
  record, the Assignments and the FTE-days it brings back stated before it is
  made. Every read leaves archived records out, so a restore cannot find its
  subject the way the other commands do: it looks past that rule, and where an
  archived record and a live one answer to one name it refuses and names both
  rather than choosing between them.

  Either way the read back is the proof: an archived record must be absent from
  the app's live plan and still in its file, marked archived; a restored one
  must be in the live plan again. Anything less exits non-zero.

The view, and how it looks
  view reads what decides how the app draws the plan, in the app's own words:
  the View settings - the Zoom and each zoom's Grid spacing, the Row height, the
  weekend band, the holiday band, the Milestone rules, the availability lines,
  the assignment blocks, the Grid dividers, the Minimap, whether the Marker is
  drawn, the Colour palette, whether the Stack rail is folded, the report's own
  zoom and which of its seven views is showing, and the two sort orders - and
  the plan-level settings a display rests on: the plan's period, its Step and
  its sprint cadence. It also prints the URL the app serves on, so an agent that
  is about to check appearance knows where to open, and the house rule that
  governs that check is docs/checking-appearance.md. --json carries the same
  facts under the store's own keys.

  Both commands read the running app rather than the plan file: the display
  settings live in the app's config, and the plan-level rows are the app's own
  reading of the plan it has open, so what the tool prints is what the screen
  shows. view writes nothing at all.

  view set <key> <value> writes one View setting through the app's own
  POST /api/view, which stores only the keys it is sent over the stored view:
  the tool reads the current value, shows the change, and sends the one key. The
  keys it writes are zoom, reportZoom, reportView, rowHeight, gridSpacing.day,
  gridSpacing.week, gridSpacing.sprint, gridSpacing.month, weekends, holidays,
  milestones, availabilityLines, assignments, dividers, minimap, marker,
  palette, stackCollapsed, sort.projects and sort.people. A value is what you
  would type there: day, week, sprint or month for a zoom, on or off for a
  toggle, a whole number of pixels for the height and the spacing, paired or
  set3 for the palette, a report view's key or the label it wears, and a sort
  key by its name or label with an optional direction - or none. An unknown key,
  or a value the app would refuse or silently store as something else, is an
  error naming what it does take.

  The preview comes first and nothing is written without --apply. The app's
  Undo covers the plan and not its display, so a view change is not an Undo
  step; the preview prints the command that puts the setting back.

  The plan-level settings are read-only here, and the refusal says where each is
  set: view set step 5, or the period, or the cadence, names the app's own
  control. The colour-by-key and by-tag selections are not here either: they
  travel with the plan, under Options > Tags.

  Nothing here is one of the fourteen commands above that change a plan: a view
  write touches no plan record, no figure, and nothing that deletes.

Deleting
  The tool never deletes anything. There is no command and no flag that
  destroys a Person, a Project, an Assignment or a Milestone, and no --force to
  reach one: what this tool can do to a plan is add a Person, add a Project or
  add an Assignment, move an Assignment, archive or restore a Person, a Project
  or an Assignment, add or remove one holiday date for one Location, and create
  or edit a Milestone, and nothing more. That boundary is deliberate, and it is
  not a gap waiting to be filled.

  Archiving is how work leaves a plan reversibly: archive takes a record out of
  the plan and restore puts it back, and neither destroys anything. A deletion
  stays in the app, where it can be seen, and Undo takes it back.

  holiday remove is not a deletion either: a holiday date is one setting in the
  plan, not a record, so taking it out edits one entry and destroys nothing. It
  is restorable by adding the date back, it costs one Undo step, and the plan
  keeps every other date of that Location and every other Location's list.

  A Milestone has no archived state - it either exists or it is destroyed - so
  this tool cannot take one out of a plan at all. It creates one and it edits
  one, and deleting one stays in the app, where it can be seen and Undo takes it
  back.

The plan file
  --plan, else PACT_DATA, else data/default.pact.json beside this repository.
  Reads never write it. Its writes - the four that create and change work, the
  six that archive and restore, the two that add and remove a holiday date, and
  the two that create and edit a Milestone - go through the running app's API,
  so validation, the atomic write and the guard against a file changed
  underneath are the app's, not a second copy here. It reads the live plan, so
  archived People, Projects and Assignments are left out, as on the default
  grid; a restore is the one command that looks past that rule.

Subjects
  A name or an id, case-insensitive: person anna and person "Anna Meier" find
  the same Person. An unknown or ambiguous name is an error naming the nearest
  matches, never a zero. A Milestone is found by name or id the same way, and so
  is a Project named by --project.

Narrowing a list
  people and projects print whole lists, which is the wrong size for one
  question: "who in Berlin is over capacity" wants the People it names, not
  every Person in the plan. The five options above answer that and nothing more.
  Each is a named term the tool applies itself: there is no expression, no
  operator and no text to parse, because a query language is where an answer
  goes subtly wrong with nobody checking it.

  A narrowed answer states the filter in plain words and how much of the list it
  kept - "Filter location: Berlin, over capacity" and "Matched 2 of 14 People" -
  because a partial list that does not say it is partial can be read as the
  whole plan. Its Total row is still the whole plan's, so it is headed Plan
  total there. A --top answer states its order too ("Order FTE-days, highest
  first") and, where the cut falls inside a tie, says how many rows share the
  boundary figure and that the plan's own order decided which of them are shown.

  An empty result is still an answer: it says no Person matched, names the
  filter, and exits zero.

  The options narrow and compute nothing. Every figure on a narrowed row is that
  row's own, over the same plan and the same period, exactly as the unfiltered
  list would print it: a filter can hide a number, never make one up.

What the figures mean, in the glossary's words
  Capacity is what a Person offers over the period, net of their Location's
  holidays and their absences. Allocated is the FTE-days their Assignments
  take; Remaining is the difference, and may be negative. Of offer is Allocated
  over Capacity; of plan is a row over the plan's own total; of capacity is a
  row over what the whole plan offers in the same stretch. A stretch offering
  no Capacity has no share and reads as "-". Absence Projects are left out of
  every figure, as in the report.

JSON
  --json prints the same data the text renders, with the same keys, plus
  "command", "planFile" and "planSource" ("--plan", "PACT_DATA" or "default").
  Every answer with a period carries "period" as
  {"kind","label","start","end","outsidePlan"}, and every answer with figures
  carries "units". Capacity, allocated and remaining are FTE-days; ofOffer,
  ofPlan and ofCapacity are fractions where 1.0 is 100%, or null when the
  denominator offers no Capacity. Numbers are not rounded.

    node bin/pact.mjs people --period 2026-11 --json
    {"command":"people","planFile":"...","planSource":"default","period":{...},
     "units":{...},"people":[{"id":"...","name":"...","capacity":16,
     "allocated":19.2,"remaining":-3.2,"ofOffer":1.2,"overAllocated":true,
     "buckets":[...]}],"totals":{...}}

  A narrowed people or projects answer carries one more key, "filter": the
  filter in plain words ("text"); the terms it was given ("location", "tags",
  "over", "under", "top"); the rows it kept ("matched") and the rows the list
  held ("total"); what it counted ("unit", "People" or "Projects"); "ordering"
  when --top set one; and "tie": { figure, tied, shown, unit } when the cut fell
  inside one. An unfiltered answer carries no "filter" at all, so a caller can
  tell a narrowed answer from a complete one.

  person add adds "action" and "applied" (false until it is written), and once
  written "server" and "readBack" (the id and values the app's plan holds
  afterwards). Its "create" is the body POST /api/people takes - no id, since
  the server mints one - and its "offered" is { availability, location,
  workingDays, holidayDays, fteDays, holidays } over the resolved period.

  project add is the same shape. Its "create" is the body POST /api/projects
  takes, with no "colour" at all when none was named, and its "colour" is
  { slot, named }: the slot the app is expected to take, and whether the tool
  named it or the server chooses.

  assignment add adds "action" and "applied" (false until it is written), and
  once written "server" and "readBack" (the id and the dates, Project, Person
  and Allocation the app's plan holds afterwards). Its "assignment" is the one
  it would create, "create" the body POST /api/assignments takes - no id, since
  the server mints one - and "overlaps" the Assignments the Person already
  holds on those dates.

  assignment move adds "action" and "applied" (false until it is written), and
  once written "server" and "readBack" (the dates and Allocation the app's plan
  holds afterwards). Its "change" is the patch that was sent: only the fields
  that differ, in the shape the app's PATCH /api/assignments/<id> takes.

  holiday add and holiday remove add "action", "applied" (false until it is
  written) and, once written, "server" and "readBack" (the Location and the
  dates the app's plan holds afterwards). Its "location", "date", "kind",
  "weekday" and "weekend" are the date it writes; "before" and "after" are
  that Location's dates as stored and as they would be; "others" names the
  Locations whose holidays are untouched; "people" is each live Person there
  with the Capacity they offer before and after and the "fteDays" that moves,
  and "fteDays" is the signed sum of those - negative for capacity taken off,
  positive for capacity put back; "change" is the body PATCH /api/plan takes,
  the whole holiday list rebuilt.

  person archive and person restore are one shape, and so is each of the other
  two pairs: "kind", "action" and "applied" (false until it is written), then
  "subject" (the record as stored, with the archived state it had before the
  move), "assignments" (what the move takes with it or brings back, each with
  its Project's and Person's names), and "before" and "after". Each of the last
  two carries "plan" - the plan's "capacity" and "allocated" - and the figure
  the move changes: "person" for a Person or an Assignment, "project" for a
  Project. A figure the move takes out of the plan is null. An Assignment's
  answer carries "fteDays", its own size, and no "assignments" list, because it
  is the Assignment itself; once written it carries "server" and "readBack".

  milestone add adds "action" and "applied" (false until it is written), and
  once written "server" and "readBack" (the id and fields the app's plan holds
  afterwards). Its "create" is the body POST /api/milestones takes - no id,
  since the server mints one, and no "colour" at all when none was named - and
  its "colour" is { slot, named }: the slot the app is expected to take, and
  whether the tool named it or the server chooses. "weekday" is the day the
  date falls on, and "projects" the related Projects as { id, name }.

  milestone edit adds "action" and "applied" (false until it is written), and
  once written "server" and "readBack". Its "subject" is the Milestone as
  stored, its "after" the Milestone as the edit would leave it, both carrying
  their related "projects" as { id, name }; "change" is the patch that was
  sent - only the fields that differ, in the shape the app's
  PATCH /api/milestones/<id> takes - and "diff" is those fields as
  [{ field, before, after }] in the order the preview prints them.

  view has no period of its own to choose and no units, because it computes no
  figure: it carries "planPeriod", "step", "cadence" ({ start, length,
  namePrefix, nameNumber }, or null when the plan defines none), "view" - the
  View settings with every key present, read through the app's own rules - and
  "open", the URL the app serves on. It reads the running app, so "planFile" is
  the app's active file and "planSource" is "default", "config" (chosen in the
  app) or "PACT_DATA".

  view set carries "key", "before", "after" and "change": the body the app's
  POST /api/view takes, holding only that one store key - and for gridSpacing
  and sort the whole object with the one part changed, because the store merges
  one level deep. Once written it carries "server" and "readBack", the view the
  app holds afterwards.

  If the tool is on your PATH as pact, "pact --help" and "pact help"
  print this too.
`;

class CliError extends Error {
  constructor(message, code, exitCode, hint) {
    super(message);
    this.name = "CliError";
    this.code = code || "usage";
    this.exitCode = Number.isInteger(exitCode) ? exitCode : 2;
    this.hint = hint || "";
  }
}

function usage(message) {
  return new CliError(message, "usage", 2, "see --help for the commands and options");
}

/* --- argv ---------------------------------------------------------------- */

// The options that carry a value, by the name they are typed with.
const VALUE_OPTIONS = {
  "--plan": "plan",
  "--period": "period",
  "--person": "person",
  "--from": "from",
  "--to": "to",
  "--share": "share",
  "--location": "location",
  "--availability": "availability",
  "--colour": "colour",
  "--note": "note",
  "--kind": "kind",
  "--date": "date",
  "--top": "top"
};

// The options that repeat, each value added to a list: one --tag per tag, since
// a tag is free text and cannot be split on a comma without being rewritten,
// and one --project per Project a Milestone relates to.
const REPEATABLE_OPTIONS = { "--tag": "tags", "--project": "projects" };

// The options that are a flag alone.
const FLAG_OPTIONS = {
  "--json": "json",
  "--apply": "apply",
  "--dry-run": "dryRun",
  "--over": "over",
  "--under": "under"
};

function parseArgs(argv) {
  const out = {
    command: null, subject: [], plan: undefined, period: undefined, person: undefined,
    from: undefined, to: undefined, share: undefined, location: undefined,
    availability: undefined, colour: undefined, note: undefined, kind: undefined,
    date: undefined, top: undefined, over: false, under: false,
    tags: [], projects: [], json: false, apply: false, dryRun: false, help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help" || (out.command === null && arg === "help")) {
      out.help = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(FLAG_OPTIONS, arg)) {
      out[FLAG_OPTIONS[arg]] = true;
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg : arg.slice(0, equals);
    const repeatable = Object.prototype.hasOwnProperty.call(REPEATABLE_OPTIONS, name);
    if (repeatable || Object.prototype.hasOwnProperty.call(VALUE_OPTIONS, name)) {
      let value;
      if (equals === -1) {
        value = argv[i + 1];
        if (value === undefined || value.trim() === "" || value.startsWith("-")) {
          throw usage(name + " needs a value");
        }
        i += 1;
      } else {
        value = arg.slice(equals + 1);
        if (value.trim() === "") throw usage(name + " needs a value");
      }
      if (repeatable) out[REPEATABLE_OPTIONS[name]].push(value);
      else out[VALUE_OPTIONS[name]] = value;
      continue;
    }
    if (arg.startsWith("-")) {
      throw usage('unknown option "' + arg + '"');
    }
    if (out.command === null) out.command = arg;
    else out.subject.push(arg);
  }
  return out;
}

/* --- the plan file ------------------------------------------------------- */

function resolvePlanPath(value) {
  const raw = String(value).trim();
  if (raw === "") throw usage("--plan needs a path");
  if (raw === "~") return os.homedir();
  if (raw.startsWith("~/")) return path.resolve(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function resolvePlanFile(option) {
  if (option !== undefined) return { path: resolvePlanPath(option), source: "--plan" };
  const env = process.env.PACT_DATA;
  if (typeof env === "string" && env.trim() !== "") {
    return { path: path.resolve(env), source: "PACT_DATA" };
  }
  return { path: path.join(ROOT, "data", "default.pact.json"), source: "default" };
}

function loadPlan(resolved) {
  let raw;
  try {
    raw = fs.readFileSync(resolved.path, "utf8");
  } catch (err) {
    const hint = resolved.source === "default" && err.code === "ENOENT"
      ? "run node server.mjs once to create the default plan, or pass --plan <path>"
      : "";
    throw new CliError("cannot read plan file " + resolved.path + ": " + err.message,
      "plan-file", 1, hint);
  }
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (err) {
    throw new CliError(resolved.path + " is not valid JSON: " + err.message, "plan-file", 1);
  }
  const errors = validatePlan(plan);
  if (errors.length > 0) {
    throw new CliError(resolved.path + " is not a valid plan: " + errors.join("; "), "plan-file", 1);
  }
  return plan;
}

/* --- rendering: one object, two renderings ------------------------------- */

function figure(value) {
  if (value === null || value === undefined) return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  const rounded = Math.round(n * 10) / 10;
  return (Object.is(rounded, -0) ? 0 : rounded).toFixed(1);
}

function percent(fraction) {
  if (fraction === null || fraction === undefined) return "-";
  const n = Number(fraction);
  if (!Number.isFinite(n)) return "-";
  return Math.round(n * 100) + "%";
}

function renderColumns(headers, rows, right) {
  const widths = headers.map(function (header, i) {
    return Math.max.apply(null, [header.length].concat(rows.map(function (row) {
      return String(row[i] === undefined || row[i] === null ? "" : row[i]).length;
    })));
  });
  function line(cells) {
    return cells.map(function (cell, i) {
      const text = String(cell === undefined || cell === null ? "" : cell);
      return right[i] ? text.padStart(widths[i]) : text.padEnd(widths[i]);
    }).join("  ").replace(/\s+$/, "");
  }
  return [line(headers)].concat(rows.map(line));
}

function renderPairs(pairs) {
  const width = Math.max.apply(null, pairs.map(function (pair) { return pair[0].length; }));
  return pairs.map(function (pair) {
    return pair[0].padEnd(width) + "  " + pair[1];
  });
}

function sourceText(data) {
  if (data.planSource === "PACT_DATA") return " (PACT_DATA)";
  if (data.planSource === "default") return " (default)";
  return "";
}

function header(data) {
  const pairs = [["Plan file", data.planFile + sourceText(data)]];
  if (data.period) {
    pairs.push(["Period", data.period.label + " (" + data.period.start + " to " + data.period.end + ")"]);
    if (data.period.outsidePlan) {
      pairs.push(["Note", "the period lies wholly outside the plan period"]);
    }
  }
  if (data.filter) pairs.push.apply(pairs, narrowLines(data.filter));
  return renderPairs(pairs);
}

// The narrowing as the header states it: the filter in plain words, the order
// --top set, how much of the list it kept, and the tie the cut fell inside. A
// partial list that does not say it is partial is the failure this prevents.
function narrowLines(filter) {
  const pairs = [["Filter", filter.text]];
  if (filter.ordering) pairs.push(["Order", filter.ordering]);
  pairs.push(["Matched", filter.matched + " of " + filter.total + " " + filter.unit]);
  if (filter.tie) {
    const tie = filter.tie;
    pairs.push(["Note", tie.shown + " of " + tie.tied + " " + tie.unit + " share " +
      (tie.figure === null ? "no figure" : figure(tie.figure) + " FTE-days") +
      " at the cut; the plan's own order decides which of them are shown"]);
  }
  return pairs;
}

// An empty narrowed answer is an answer: it says what was asked and that nothing
// matched, rather than printing an empty list.
function noMatchText(one, filter) {
  return "No " + one + " matched: " + filter.text + ".";
}

const ABSENCE_NOTE = "Absence Projects are left out of every figure.";

function renderPlan(data) {
  const lines = header(data);
  lines.push("");
  lines.push.apply(lines, renderPairs([
    ["Plan period", data.planPeriod.start + " to " + data.planPeriod.end],
    ["Step", data.step + "%"],
    ["People", String(data.counts.people)],
    ["Projects", String(data.counts.projects)],
    ["Assignments", String(data.counts.assignments)],
    ["Milestones", String(data.counts.milestones)],
    ["Capacity", figure(data.totals.capacity) + " FTE-days"],
    ["Allocated", figure(data.totals.allocated) + " FTE-days"],
    ["Remaining", figure(data.totals.remaining) + " FTE-days"],
    ["Of capacity", percent(data.totals.ofCapacity)]
  ]));
  lines.push("");
  lines.push("Counts are of the live plan; the figures are for the period above.");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function personState(row) {
  if (row.ofOffer === null) return "no Capacity offered";
  if (row.overAllocated) return "over-allocated";
  if (Math.abs(row.allocated - row.capacity) < 1e-9) return "at Capacity";
  return "within Capacity";
}

function renderAssignments(assignments, subject) {
  if (assignments.length === 0) return ["(no Assignments meet the period)"];
  const rows = assignments.map(function (assignment) {
    return [
      subject === "person" ? assignment.project : assignment.person,
      String(assignment.share) + "%",
      assignment.start,
      assignment.end,
      assignment.absence ? "yes" : "",
      assignment.tags.join(", ") || "-"
    ];
  });
  return renderColumns(
    [subject === "person" ? "Project" : "Person", "Allocation (%)", "Start", "End", "Absence", "Tags"],
    rows, [false, true, false, false, false, false]
  );
}

function renderPeople(data) {
  const lines = header(data);
  lines.push("");
  if (data.people.length === 0) {
    lines.push(data.filter ? noMatchText("Person", data.filter) : "(no People)");
  } else {
    const rows = data.people.map(function (person) {
      return [
        person.name,
        figure(person.capacity),
        figure(person.allocated),
        figure(person.remaining),
        percent(person.ofOffer),
        person.overAllocated ? "over-allocated" : ""
      ];
    });
    // A narrowed list's total is still the whole plan's, so it says so rather
    // than reading as the total of the rows above it.
    rows.push([
      data.filter ? "Plan total" : "Total",
      figure(data.totals.capacity),
      figure(data.totals.allocated),
      figure(data.totals.remaining),
      percent(data.totals.ofCapacity),
      ""
    ]);
    lines.push.apply(lines, renderColumns(
      ["Person", "Capacity (FTE-days)", "Allocated (FTE-days)", "Remaining (FTE-days)",
        "Of offer (%)", "State"],
      rows, [false, true, true, true, true, false]
    ));
  }
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function renderPerson(data) {
  const person = data.person;
  const lines = header(data);
  lines.push("");
  lines.push.apply(lines, renderPairs([
    ["Person", person.name],
    ["Id", person.id],
    ["Location", person.location || "-"],
    ["Availability", person.availability + "%"],
    ["Tags", person.tags.length > 0 ? person.tags.join(", ") : "-"],
    ["Note", person.note || "-"],
    ["Capacity", figure(person.capacity) + " FTE-days"],
    ["Allocated", figure(person.allocated) + " FTE-days"],
    ["Remaining", figure(person.remaining) + " FTE-days"],
    ["Of offer", percent(person.ofOffer)],
    ["State", personState(person)]
  ]));
  if (person.buckets.length > 1) {
    lines.push("");
    lines.push("By bucket");
    lines.push.apply(lines, renderColumns(
      ["Bucket", "Start", "End", "Capacity (FTE-days)", "Allocated (FTE-days)",
        "Remaining (FTE-days)", "Of offer (%)"],
      person.buckets.map(function (bucket) {
        return [bucket.label, bucket.start, bucket.end, figure(bucket.capacity),
          figure(bucket.allocated), figure(bucket.remaining), percent(bucket.ofOffer)];
      }),
      [false, false, false, true, true, true, true]
    ));
  }
  lines.push("");
  lines.push("Assignments (stored dates)");
  lines.push.apply(lines, renderAssignments(data.assignments, "person"));
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function renderProjects(data) {
  const lines = header(data);
  lines.push("");
  if (data.projects.length === 0) {
    lines.push(data.filter ? noMatchText("Project", data.filter) : "(no Projects)");
  } else {
    const rows = data.projects.map(function (project) {
      return [
        project.name + (project.absence ? " (absence)" : ""),
        figure(project.allocated),
        percent(project.ofPlan),
        percent(project.ofCapacity)
      ];
    });
    rows.push([
      data.filter ? "Plan total" : "Total",
      figure(data.totals.allocated),
      percent(data.totals.ofPlan),
      percent(data.totals.ofCapacity)
    ]);
    lines.push.apply(lines, renderColumns(
      ["Project", "Allocated (FTE-days)", "Of plan (%)", "Of capacity (%)"],
      rows, [false, true, true, true]
    ));
  }
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function renderProject(data) {
  const project = data.project;
  const lines = header(data);
  lines.push("");
  lines.push.apply(lines, renderPairs([
    ["Project", project.name],
    ["Id", project.id],
    ["Tags", project.tags.length > 0 ? project.tags.join(", ") : "-"],
    ["Notes", project.notes || "-"],
    ["Absence", project.absence ? "yes, so it contributes no FTE-days" : "no"],
    ["Allocated", figure(project.allocated) + " FTE-days"],
    ["Of plan", percent(project.ofPlan)],
    ["Of capacity", percent(project.ofCapacity)]
  ]));
  if (project.buckets.length > 1) {
    lines.push("");
    lines.push("By bucket");
    lines.push.apply(lines, renderColumns(
      ["Bucket", "Start", "End", "Allocated (FTE-days)", "Capacity (FTE-days)", "Of capacity (%)"],
      project.buckets.map(function (bucket) {
        return [bucket.label, bucket.start, bucket.end, figure(bucket.allocated),
          figure(bucket.capacity), percent(bucket.ofCapacity)];
      }),
      [false, false, false, true, true, true]
    ));
  }
  lines.push("");
  lines.push("Assignments (stored dates)");
  lines.push.apply(lines, renderAssignments(data.assignments, "project"));
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function tagTable(rows, showTotal, total) {
  const body = rows.map(function (row) {
    return [row.label, figure(row.allocated), percent(row.ofPlan), String(row.projects)];
  });
  if (showTotal) {
    body.push(["Total", figure(total.allocated), percent(total.ofPlan), ""]);
  }
  return renderColumns(["Tag", "FTE-days", "Of plan (%)", "Projects"], body, [false, true, true, true]);
}

function renderTags(data) {
  const lines = header(data);
  lines.push("");
  if (data.tags.length === 0) lines.push("(no tags on a Project)");
  else {
    lines.push.apply(lines, tagTable(data.tags, true, {
      allocated: data.totals.allocated,
      ofPlan: data.totals.ofPlan
    }));
  }
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function renderTag(data) {
  const lines = header(data);
  lines.push("");
  lines.push.apply(lines, renderPairs([[data.match === "key" ? "Tag key" : "Tag", data.key]]));
  lines.push("");
  if (data.tags.length === 0) lines.push("(no tags)");
  else {
    lines.push.apply(lines, tagTable(data.tags, data.tags.length > 1, {
      allocated: data.allocated,
      ofPlan: data.ofPlan
    }));
  }
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function renderCapacity(data) {
  const lines = header(data);
  lines.push("");
  lines.push.apply(lines, renderPairs([
    ["Capacity", figure(data.capacity) + " FTE-days"],
    ["Allocated", figure(data.allocated) + " FTE-days"],
    ["Remaining", figure(data.remaining) + " FTE-days"],
    ["Of capacity", percent(data.ofCapacity)]
  ]));
  if (data.buckets.length > 1) {
    lines.push("");
    lines.push("By bucket");
    lines.push.apply(lines, renderColumns(
      ["Bucket", "Start", "End", "Capacity (FTE-days)", "Allocated (FTE-days)",
        "Remaining (FTE-days)", "Of capacity (%)"],
      data.buckets.map(function (bucket) {
        return [bucket.label, bucket.start, bucket.end, figure(bucket.capacity),
          figure(bucket.allocated), figure(bucket.remaining), percent(bucket.ofCapacity)];
      }),
      [false, false, false, true, true, true, true]
    ));
  }
  lines.push("");
  lines.push(ABSENCE_NOTE);
  return lines.join("\n") + "\n";
}

function renderHolidays(data) {
  const lines = header(data);
  lines.push("");
  if (data.holidays.length === 0) lines.push("(no holidays configured)");
  else {
    const rows = [];
    data.holidays.forEach(function (group) {
      group.dates.forEach(function (day) {
        rows.push([group.location, day.date, day.kind]);
      });
    });
    if (rows.length === 0) lines.push("(no holidays configured)");
    else lines.push.apply(lines, renderColumns(["Location", "Date", "Kind"], rows, [false, false, false]));
  }
  return lines.join("\n") + "\n";
}

function renderMilestones(data) {
  const lines = header(data);
  lines.push("");
  if (data.milestones.length === 0) lines.push("(no Milestones)");
  else {
    lines.push.apply(lines, renderColumns(
      ["Date", "Milestone", "Projects", "Tags", "Note"],
      data.milestones.map(function (milestone) {
        return [
          milestone.date,
          milestone.name,
          milestone.projects.length > 0
            ? milestone.projects.map(function (project) { return project.name; }).join(", ")
            : "-",
          milestone.tags.length > 0 ? milestone.tags.join(", ") : "-",
          milestone.notes || "-"
        ];
      }),
      [false, false, false, false, false]
    ));
  }
  return lines.join("\n") + "\n";
}

/* --- one holiday date ---------------------------------------------------- */

// What the change is worth over the period, in the report's own FTE-days: taken
// off for a date that lands on a working day, put back for one removed, and
// named as no change at all where nothing moves - a weekend date is recorded
// and takes nothing off anyone, which must read as that rather than as a saving.
// How many People, in the glossary's own words: one Person, two People.
function peopleCount(count) {
  return count + (count === 1 ? " Person" : " People");
}

function holidayFigure(data) {
  const who = peopleCount(data.people.length) + " at " + data.location;
  if (Math.abs(data.fteDays) < 1e-9) {
    return "Affects " + who + ": no FTE-day changes over " + data.period.label + " figures";
  }
  return "Affects " + who + ": " + figure(Math.abs(data.fteDays)) + " FTE-days " +
    (data.fteDays < 0 ? "off" : "put back over") + " " + data.period.label + " figures";
}

// The command that puts a removed date back, so a removal is one line from
// being undone by hand as well as by the app's Undo.
function holidayAddCommand(data) {
  return "holiday add \"" + data.location + "\" " + data.date +
    (data.kind === "half" ? " --kind half" : "");
}

function renderHoliday(data) {
  const lines = header(data);
  lines.push("");
  lines.push("Holiday");
  lines.push("  " + data.location + ", " + data.date + ", a " + data.weekday + ", " +
    (data.kind === "half" ? "half day" : "full day"));
  lines.push("  " + holidayFigure(data));
  // The whole list, not the change: a lost entry has to be visible before the
  // write, and a list is only readable when all of it is there.
  lines.push("  " + data.location + "'s holidays after this: " + (data.after.length === 0
    ? "none"
    : data.after.map(function (day) {
      return day.date + (day.kind === "half" ? " (half)" : "");
    }).join(", ")));
  lines.push("  " + (data.others.length === 0
    ? "No other Location has holidays configured."
    : "Other Locations' holidays are untouched: " + data.others.join(", ") + "."));

  if (data.weekend) {
    lines.push("");
    lines.push("Note: " + data.date + " is a " + data.weekday + ", a weekend date. It changes");
    lines.push("no working day, so it takes nothing off anyone's Capacity: the plan records");
    lines.push("it and no figure moves.");
  }
  if (!data.inPeriod) {
    lines.push("");
    lines.push("Note: the date lies outside " + data.period.label + ", the period counted, so its");
    lines.push("FTE-days are not in the figure above.");
  }
  if (data.outsidePlan) {
    lines.push("");
    lines.push("Note: the date lies outside the plan period (" + data.planPeriod.start + " to " +
      data.planPeriod.end + "), so the app");
    lines.push("draws no holiday band for it; the plan still records it.");
  }

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const back = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + back.location +
    " holds " + (back.dates.length === 0 ? "no dates" : countText(back.dates.length, "date")) +
    ", and every other");
  lines.push("Location's holidays are exactly as they were.");
  lines.push("Undo: the change is one step back with the app's Undo control.");
  if (data.action === "remove") {
    lines.push("");
    lines.push("Nothing else was touched: a holiday date is one plan setting, not a record,");
    lines.push("and nothing was destroyed. Put it back with: " + holidayAddCommand(data));
  }
  return lines.join("\n") + "\n";
}

const RENDERERS = {
  plan: renderPlan,
  people: renderPeople,
  person: renderPerson,
  projects: renderProjects,
  project: renderProject,
  tags: renderTags,
  tag: renderTag,
  capacity: renderCapacity,
  holidays: renderHolidays,
  milestones: renderMilestones
};

/* --- one Assignment's change --------------------------------------------- */

// "16.5 of 18.0": what a Person is Allocated of the Capacity they offer - the
// columns the people command prints - with the over-allocation named where there
// is one, so both ends of a move state it rather than leave it to be worked out.
function positionText(position) {
  return figure(position.allocated) + " of " + figure(position.capacity) +
    (position.overAllocated ? "  (over by " + figure(position.overBy) + ")" : "");
}

function renderAssignmentMove(data) {
  const lines = header(data);
  const before = data.before;
  const after = data.after;
  lines.push("");
  lines.push("Assignment " + data.assignment.project + " / " + data.assignment.person);
  const pairs = [
    [before.start + " to " + before.end, "->  " + after.start + " to " + after.end]
  ];
  // The Allocation is its own line only when it moves: the FTE-days already
  // show a resize, and a line that never changes is noise.
  if (before.share !== after.share) {
    pairs.push([before.share + "%", "->  " + after.share + "%"]);
  }
  pairs.push([figure(before.fteDays) + " FTE-days", "->  " + figure(after.fteDays) + " FTE-days"]);
  pairs.push([
    data.person.name + ": " + positionText(data.person.before),
    "->  " + positionText(data.person.after)
  ]);
  lines.push.apply(lines, renderPairs(pairs.map(function (pair) {
    return ["  " + pair[0], pair[1]];
  })));

  if (data.assignment.absence) {
    lines.push("");
    lines.push("Note: " + data.assignment.project + " is an Absence Project, so this");
    lines.push("Assignment is the Person's time away: it changes Capacity, not Allocated.");
  }
  if (after.outsidePlan && !before.outsidePlan) {
    lines.push("");
    lines.push("Note: the new dates lie outside the plan period, so the app draws no");
    lines.push("block for this Assignment.");
  }

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const readBack = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " +
    readBack.start + " to " + readBack.end + " at " + readBack.share + "%.");
  lines.push("Undo: the change is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

function renderAssignmentAdd(data) {
  const lines = header(data);
  const created = data.assignment;
  lines.push("");
  lines.push("New Assignment");
  lines.push("  " + created.project + " / " + created.person);
  lines.push("  " + created.start + " to " + created.end + ", " + created.share + "%");
  lines.push("  " + figure(data.fteDays) + " FTE-days");
  lines.push("");

  const pairs = [[
    data.person.name + ": " + positionText(data.person.before),
    "->  " + positionText(data.person.after)
  ]];
  // An Absence Project contributes no FTE-day, so it has no total to compare.
  if (!data.project.absence) {
    pairs.push([
      data.project.name + ": " + figure(data.project.before.allocated) + " FTE-days",
      "->  " + figure(data.project.after.allocated) + " FTE-days"
    ]);
  }
  lines.push.apply(lines, renderPairs(pairs.map(function (pair) {
    return ["  " + pair[0], pair[1]];
  })));

  if (data.project.absence) {
    lines.push("");
    lines.push("Note: " + created.project + " is an Absence Project, so this");
    lines.push("Assignment is the Person's time away: it changes Capacity, not Allocated.");
  }

  lines.push("");
  if (data.overlaps.length === 0) {
    lines.push("No other Assignment of " + created.person + " meets " + created.start +
      " to " + created.end + ".");
  } else {
    lines.push(created.person + " already holds " +
      (data.overlaps.length === 1 ? "an Assignment" : "Assignments") + " on those dates:");
    lines.push.apply(lines, renderColumns(
      ["Project", "Start", "End", "Allocation (%)", "Sharing"],
      data.overlaps.map(function (overlap) {
        return [overlap.project, overlap.start, overlap.end, String(overlap.share),
          overlap.overlapStart + " to " + overlap.overlapEnd];
      }),
      [false, false, false, true, false]
    ).map(function (line) { return "  " + line; }));
  }

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const readBack = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + readBack.id + ",");
  lines.push("  " + readBack.project + " / " + readBack.person + "  " + readBack.start +
    " to " + readBack.end + " at " + readBack.share + "%.");
  lines.push("Undo: the creation is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

function renderPersonAdd(data) {
  const create = data.create;
  const offered = data.offered;
  const lines = header(data);
  lines.push("");
  lines.push("New Person");
  lines.push("  " + create.name + (create.location ? ", " + create.location : "") +
    ", available " + create.availability + "%");
  lines.push("  Tags: " + (create.tags.length > 0 ? create.tags.join(", ") : "-"));
  if (create.note !== "") lines.push("  Note: " + create.note);
  // What the Availability is worth, which is the figure nobody can read off a
  // percentage: the report's own working days at that Availability, with the
  // days the Location's holidays take out of them named when there are any.
  lines.push("  " + data.period.label + ": " + figure(offered.fteDays) + " FTE-days offered (" +
    dayCount(offered.workingDays) + " working days at " + create.availability + "%)");
  if (offered.holidayDays > 0) {
    lines.push("  " + offered.location + " holidays take " + dayCount(offered.holidayDays) +
      (offered.holidayDays === 1 ? " working day" : " working days") + " out of it: " +
      offered.holidays.map(function (day) {
        return day.date + (day.kind === "half" ? " (half)" : "");
      }).join(", "));
  }

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const readBack = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + readBack.id + ",");
  lines.push("  " + readBack.name + (readBack.location ? ", " + readBack.location : "") +
    ", available " + readBack.availability + "%.");
  lines.push("Undo: the creation is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

/* --- one Milestone, before it is written --------------------------------- */

// A Milestone's own sentence, in every preview: a deadline that nobody adds up
// is the one thing a reader of the plan could mistake for work.
const MILESTONE_ANNOTATION = "Milestones are annotations: no total, share or " +
  "over-allocation check counts them.";

// What the reader cannot see about where the rule is drawn: a Milestone related
// to Projects appears only while one of them is in view, and one related to no
// Project - or to Projects the plan no longer holds - is plan-wide.
function milestoneRelation(projects) {
  const names = projects.map(function (project) { return project.name; });
  if (names.length === 0) return "Related to no Project, so the rule is plan-wide";
  if (names.length === 1) {
    return "Related to " + names[0] + ", so the rule is drawn while " + names[0] + " is in view";
  }
  return "Related to " + names.join(", ") + ", so the rule is drawn while one of them is in view";
}

// One field as a diff line says it, in the plan's own words: a tag list and a
// related-Projects list read as "none" when empty, so an empty value is stated
// rather than left as a gap in the output.
function milestoneFieldText(field, value, projects) {
  if (field === "colour") return "colour slot " + value;
  if (field === "tags") return "Tags: " + (value.length === 0 ? "none" : value.join(", "));
  if (field === "notes") return "Notes: " + (value === "" ? "none" : value);
  if (field === "projectIds") {
    return projects.length === 0
      ? "Related to no Project"
      : "Related to " + projects.map(function (project) { return project.name; }).join(", ");
  }
  return String(value);
}

// What a read back holds, in one line: the fields the store keeps, in the order
// a reader meets them.
function milestoneReadBack(record) {
  return record.name + ", " + record.date + ", colour slot " + record.colour + ", " +
    (record.tags.length === 0 ? "no tags" : countText(record.tags.length, "tag")) + ", " +
    (record.projectIds.length === 0
      ? "related to no Project"
      : "related to " + countText(record.projectIds.length, "Project"));
}

function renderMilestoneAdd(data) {
  const create = data.create;
  const lines = header(data);
  lines.push("");
  lines.push("New Milestone");
  lines.push("  " + create.name + ", " + create.date + ", a " + data.weekday +
    ", colour slot " + data.colour.slot +
    (data.colour.named ? " (as named)" : " (the least used)"));
  lines.push("  Tags: " + (create.tags.length > 0 ? create.tags.join(", ") : "none"));
  if (create.notes !== "") lines.push("  Notes: " + create.notes);
  lines.push("  " + milestoneRelation(data.projects) + ".");
  lines.push("  " + MILESTONE_ANNOTATION);

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const back = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + back.id + ",");
  lines.push("  " + milestoneReadBack(back) + ".");
  lines.push("Undo: the creation is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

function renderMilestoneEdit(data) {
  const lines = header(data);
  lines.push("");
  lines.push("Milestone " + data.subject.name);
  lines.push.apply(lines, renderPairs(data.diff.map(function (entry) {
    // The related-Projects list is ids in the patch and names here, so each side
    // of the diff is read through the Projects the plan resolved for it.
    const before = entry.field === "projectIds" ? data.subject.projects : data.projects;
    const after = entry.field === "projectIds" ? data.projects : data.subject.projects;
    return ["  " + milestoneFieldText(entry.field, entry.before, before),
      "->  " + milestoneFieldText(entry.field, entry.after, after)];
  })));
  lines.push("  " + data.after.date + " is a " + data.weekday + ".");
  lines.push("  " + milestoneRelation(data.projects) + ".");
  lines.push("  " + MILESTONE_ANNOTATION);

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const back = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + back.id + ",");
  lines.push("  " + milestoneReadBack(back) + ".");
  lines.push("Undo: the change is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

function renderProjectAdd(data) {
  const create = data.create;
  const lines = header(data);
  lines.push("");
  lines.push("New Project");
  lines.push("  " + create.name + ", colour slot " + data.colour.slot +
    (data.colour.named ? " (as named)" : " (the least used)"));
  lines.push("  Tags: " + (create.tags.length > 0 ? create.tags.join(", ") : "-"));
  if (create.notes !== "") lines.push("  Notes: " + create.notes);
  lines.push("  No Assignments yet.");

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const readBack = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + readBack.id + ",");
  lines.push("  " + readBack.name + ", colour slot " + readBack.colour + ", no Assignments.");
  lines.push("Undo: the creation is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

/* --- one record archived or restored ------------------------------------- */

// What each direction says: what the record does, what its Assignments do, and
// which way the FTE-days go. Both directions print the same layout, so the two
// cannot drift into different shapes.
const MOVE_WORDS = {
  archive: {
    title: "Archive",
    record: "leaves the plan",
    one: "stays in the file and stops counting",
    many: "stay in the file and stop counting",
    fte: "leave the plan",
    allocated: "leaves the plan with it"
  },
  restore: {
    title: "Restore",
    record: "returns to the plan",
    one: "comes back and counts again",
    many: "come back and count again",
    fte: "return to the plan",
    allocated: "returns to the plan with it"
  }
};

const KIND_TITLES = { person: "Person", project: "Project", assignment: "Assignment" };

function countText(count, noun) {
  return count + " " + noun + (count === 1 ? "" : "s");
}

// A Person's Allocated of their Capacity, as a bare pair of figures: the over
// clause says the rest. A Person the plan no longer holds reads as nothing at
// all, which is what an archive leaves behind.
function personAmount(position) {
  if (!position) return "0.0 of 0.0";
  return figure(position.allocated) + " of " + figure(position.capacity);
}

// A Project's Allocated as a figure, or "0.0" once the plan no longer holds
// the Project. An Absence Project has no such figure at all.
function projectAmount(project) {
  return project && !project.absence ? figure(project.allocated) : "0.0";
}

// Whether the Person is over their Capacity, and where that changed: an archive
// can take them out of over-allocation, a restore can put them back into it.
function overClause(move) {
  const before = move.before.person;
  const after = move.after.person;
  if (!after) return "";
  if (after.overAllocated) {
    return ", " + (before && before.overAllocated ? "still " : "") +
      "over-allocated by " + figure(after.overBy);
  }
  if (before && before.overAllocated) return ", no longer over-allocated";
  return "";
}

function moveSubjectLine(move) {
  const subject = move.subject;
  const words = MOVE_WORDS[move.action];
  if (move.kind === "assignment") {
    return subject.project + " / " + subject.person + ", " + subject.start + " to " +
      subject.end + " at " + subject.share + "%";
  }
  const parts = [];
  if (move.kind === "person") {
    parts.push("available " + subject.availability + "%");
    if (subject.location !== "") parts.push(subject.location);
  } else {
    parts.push("colour slot " + subject.colour);
    if (subject.absence) parts.push("an Absence Project");
  }
  if (subject.tags.length > 0) parts.push(countText(subject.tags.length, "tag"));
  return subject.name + " " + words.record + ": " + parts.join(", ");
}

// The command that undoes this one: an archive is only worth making if the way
// back is one line away.
function restoreCommand(move) {
  if (move.kind === "assignment") {
    return "assignment restore " + move.subject.project + " --person \"" +
      move.subject.person + "\"";
  }
  return move.kind + " restore \"" + move.subject.name + "\"";
}

function renderSubjectMove(data) {
  const words = MOVE_WORDS[data.action];
  const before = data.before;
  const after = data.after;
  const lines = header(data).concat([""]);
  lines.push(words.title + " " + KIND_TITLES[data.kind]);
  lines.push("  " + moveSubjectLine(data));

  if (data.kind === "assignment") {
    if (data.subject.absence) {
      lines.push("  " + data.subject.project + " is an Absence Project, so this Assignment is");
      lines.push("  the Person's time away: it contributes no FTE-day, and no Allocated");
      lines.push("  " + words.allocated + ".");
    } else {
      lines.push("  " + figure(data.fteDays) + " FTE-days " + words.fte + ".");
    }
    lines.push("  " + data.subject.person + ": " + personAmount(before.person) +
      " FTE-days  ->  " + personAmount(after.person) + overClause(data));
    lines.push("  " + data.period.label + ": plan total " + figure(before.plan.allocated) +
      " -> " + figure(after.plan.allocated));
  } else {
    // An Absence Project has no Allocated to lose, so there is no figure of its
    // own to state: the time away it was taking out of Capacity is the whole of
    // what it was doing in the plan.
    const absence = data.kind === "project" && data.subject.absence;
    if (absence) {
      lines.push("  An Absence Project contributes no FTE-day, so no Allocated " +
        words.allocated + ".");
    }
    const held = data.assignments.length;
    lines.push("  " + data.subject.name + "'s " + countText(held, "Assignment") + " " +
      (held === 1 ? words.one : words.many));
    if (data.kind === "person") {
      lines.push("  " + data.period.label + ": " + personAmount(before.person) +
        " FTE-days -> " + personAmount(after.person) + ", plan total " +
        figure(before.plan.allocated) + " -> " + figure(after.plan.allocated));
    } else if (!absence) {
      lines.push("  " + data.period.label + ": " + projectAmount(before.project) +
        " FTE-days -> " + projectAmount(after.project) + ", plan total " +
        figure(before.plan.allocated) + " -> " + figure(after.plan.allocated));
    }
  }

  // Capacity is the second figure, and only the one that moves is worth a line:
  // a Person takes their own capacity with them, and an Absence Project takes
  // the time away it was holding out of everyone's.
  if (Math.abs(before.plan.capacity - after.plan.capacity) > 1e-9) {
    lines.push("  Plan Capacity: " + figure(before.plan.capacity) + " -> " +
      figure(after.plan.capacity) + " FTE-days");
  }

  if (data.action === "archive") {
    lines.push("");
    lines.push("Further commands will not find this " + KIND_TITLES[data.kind] +
      " until it is restored.");
    lines.push("Bring it back with: " + restoreCommand(data) + ".");
  }

  lines.push("");
  if (!data.applied) {
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  const back = data.readBack;
  lines.push("Applied through " + data.server + "; read back from its plan: " + back.name +
    " (" + back.id + ")" + (back.live
      ? " is in the live plan again."
      : " is out of the live plan and still in the file, archived."));
  lines.push("Undo: the " + data.action + " is one step back with the app's Undo control.");
  return lines.join("\n") + "\n";
}

// A count of working days: whole days read as whole, a half day as 0.5.
function dayCount(value) {
  const n = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(n) ? String(n) : "-";
}

// The options one command does not take, refused before the plan is read: a
// read has no business with any of the write's options, and neither create
// takes the other's.
function taken(args, key) {
  if (key === "apply" || key === "dryRun") return args[key] === true;
  if (key === "over" || key === "under") return args[key] === true;
  if (key === "tags" || key === "projects") return args[key].length > 0;
  return args[key] !== undefined;
}

function flagOf(key) {
  if (key === "tags") return "--tag";
  if (key === "projects") return "--project";
  return "--" + key;
}

function refuseOptions(args, keys, where) {
  keys.forEach(function (key) {
    if (!taken(args, key)) return;
    throw usage(args.command + " does not take " + flagOf(key) + "; " + where);
  });
}

// Where each narrow belongs, for the refusal that names it. A filter that
// cannot apply is refused rather than ignored: a silently ignored one answers
// a question nobody asked, and the answer looks complete while doing it.
const NARROW_WHERE = {
  location: "only the people command takes --location, a Person's own Location",
  tags: "only the people and projects commands take --tag, a subject's own tags",
  over: "only the people command takes --over: it reads Allocated against Capacity",
  under: "only the people command takes --under: it reads Allocated against Capacity",
  top: "only the people and projects commands take --top: a list has an order to cut, " +
    "one subject does not"
};

// A command as the refusal names it: `person add`, `projects`, `assignment move`.
function commandName(args) {
  return args.command + (args.subject.length > 0 ? " " + args.subject[0] : "");
}

// The read of one subject is already one thing, so it takes none of them, and
// says that rather than naming a command that would have taken the option.
const SUBJECT_ACTIONS = ["add", "archive", "restore"];

function narrowWhere(args, key) {
  const action = args.subject.length > 0 ? args.subject[0] : "";
  if ((args.command === "person" || args.command === "project") &&
      SUBJECT_ACTIONS.indexOf(action) === -1) {
    return "it is already one " + (args.command === "person" ? "Person" : "Project") +
      ", so there is nothing to narrow";
  }
  return NARROW_WHERE[key];
}

// --over, --under and --top cut a list, so only the two list reads take them. A
// write, a read of one subject, or the view - which reads settings rather than
// rows - refuses them before a plan is read or anything is written.
const CUT_OPTIONS = ["over", "under", "top"];
const WRITE_COMMANDS = ["assignment", "milestone", "holiday", "view"];

function refuseCut(args) {
  const takes = Object.prototype.hasOwnProperty.call(COMMANDS, args.command)
    ? COMMANDS[args.command].narrows
    : [];
  CUT_OPTIONS.forEach(function (key) {
    if (takes.indexOf(key) !== -1 || !taken(args, key)) return;
    throw usage(commandName(args) + " does not take " + flagOf(key) + "; " + narrowWhere(args, key));
  });
}

// --location and --tag are a field of one write and a narrow of one read each,
// so a read that takes neither refuses them as well.
function refuseNarrowing(args, takes) {
  ["location", "tags"].forEach(function (key) {
    if (takes.indexOf(key) !== -1 || !taken(args, key)) return;
    throw usage(commandName(args) + " does not take " + flagOf(key) + "; " + narrowWhere(args, key));
  });
}

// The narrowing a read was asked for, or nothing at all when it was asked for
// none: an unfiltered answer then carries no filter and is unchanged.
function narrowRequest(args) {
  if (args.over && args.under) throw usage("--over and --under contradict each other; give one");
  const filter = {};
  if (args.location !== undefined) filter.location = args.location;
  if (args.tags.length > 0) filter.tags = args.tags.slice();
  if (args.over) filter.over = true;
  if (args.under) filter.under = true;
  if (args.top !== undefined) filter.top = topCount(args.top);
  return Object.keys(filter).length > 0 ? filter : undefined;
}

// --top is a whole number of rows from 1: a cut of nothing, or of half a Person,
// is a refusal rather than a quietly different answer.
function topCount(value) {
  const text = String(value).trim();
  if (!/^[0-9]+$/.test(text)) throw usage("--top needs a whole number, as in --top 3");
  const n = Number(text);
  if (n < 1) throw usage("--top needs a whole number of 1 or more");
  return n;
}

const READ_REFUSALS = ["person", "from", "to", "share", "availability",
  "colour", "note", "kind", "date", "projects", "apply", "dryRun"];
const ASSIGNMENT_REFUSALS = ["location", "availability", "colour", "note", "kind", "date",
  "tags", "projects"];
const PERSON_ADD_REFUSALS = ["person", "from", "to", "share", "colour", "kind", "date",
  "projects"];
const PROJECT_ADD_REFUSALS = ["person", "from", "to", "share", "location", "availability",
  "kind", "date", "projects"];
// A holiday is named by its Location, its date and its kind, and by nothing a
// Person, a Project or an Assignment is named by.
const HOLIDAY_REFUSALS = ["person", "from", "to", "share", "location", "availability",
  "colour", "note", "tags", "projects"];
// A Milestone is named by its own name, and takes the six fields it has: a date,
// a colour, tags, a note and the Projects it relates to. Nothing a Person, an
// Assignment or a holiday is named by belongs here.
const MILESTONE_REFUSALS = ["person", "from", "to", "share", "location", "availability",
  "kind"];

function rejectForeignOptions(args) {
  refuseOptions(args, READ_REFUSALS, "the commands that change a plan do");
}

async function runAssignment(args) {
  const action = args.subject.length > 0 ? args.subject[0] : "";
  if (action === "") {
    throw usage("assignment needs an action; the actions are move, add, archive and " +
      "restore: assignment move <project> --person <name>, or assignment add <project> " +
      "--person <name> --from <date> --to <date>");
  }
  if (action === "move") return runAssignmentMove(args);
  if (action === "add") return runAssignmentAdd(args);
  if (action === "archive" || action === "restore") return runSubjectMove(args, action);
  throw usage('unknown assignment action "' + action + '"; the actions are move, add, ' +
    "archive and restore");
}

async function runAssignmentMove(args) {
  const project = args.subject.slice(1).join(" ").trim();
  if (project === "") throw usage("assignment move needs a Project name");
  if (args.person === undefined) throw usage("assignment move needs --person <name>");
  if (args.apply && args.dryRun) throw usage("--apply and --dry-run contradict each other");
  refuseOptions(args, ASSIGNMENT_REFUSALS, "the commands that create a Person or a Project do");
  if (args.from === undefined && args.to === undefined && args.share === undefined) {
    throw usage("assignment move needs at least one of --from, --to or --share");
  }

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const diff = query.assignmentMove(plan, {
    project: project,
    person: args.person,
    from: args.from,
    to: args.to,
    share: args.share,
    period: args.period
  });
  const data = Object.assign({
    command: "assignment",
    action: "move",
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, diff);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = await applyMove(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderAssignmentMove(data));
}

async function runAssignmentAdd(args) {
  const project = args.subject.slice(1).join(" ").trim();
  if (project === "") throw usage("assignment add needs a Project name");
  if (args.person === undefined) throw usage("assignment add needs --person <name>");
  if (args.from === undefined) throw usage("assignment add needs --from <date>");
  if (args.to === undefined) throw usage("assignment add needs --to <date>");
  if (args.apply && args.dryRun) throw usage("--apply and --dry-run contradict each other");
  refuseOptions(args, ASSIGNMENT_REFUSALS, "the commands that create a Person or a Project do");

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const created = query.assignmentAdd(plan, {
    project: project,
    person: args.person,
    from: args.from,
    to: args.to,
    share: args.share,
    period: args.period
  });
  const data = Object.assign({
    command: "assignment",
    action: "add",
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, created);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = await applyAdd(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderAssignmentAdd(data));
}

/* --- one new Person and one new Project ---------------------------------- */

function rejectWriteFlags(args) {
  if (args.apply && args.dryRun) throw usage("--apply and --dry-run contradict each other");
}

async function runPersonAdd(args) {
  const name = args.subject.slice(1).join(" ").trim();
  if (name === "") throw usage("person add needs a name");
  rejectWriteFlags(args);
  refuseOptions(args, PERSON_ADD_REFUSALS, "the commands that create a Person or a Project do");

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const created = query.personAdd(plan, {
    name: name,
    location: args.location,
    availability: args.availability,
    tags: args.tags,
    note: args.note,
    period: args.period
  });
  const data = Object.assign({
    command: "person",
    action: "add",
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, created);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = await applyPersonAdd(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderPersonAdd(data));
}

async function runProjectAdd(args) {
  const name = args.subject.slice(1).join(" ").trim();
  if (name === "") throw usage("project add needs a name");
  rejectWriteFlags(args);
  if (args.period !== undefined) {
    throw usage("project add does not take a period; a new Project starts with no Assignments");
  }
  refuseOptions(args, PROJECT_ADD_REFUSALS, "the commands that create a Person or a Project do");

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const created = query.projectAdd(plan, {
    name: name,
    colour: args.colour,
    tags: args.tags,
    note: args.note
  });
  const data = Object.assign({
    command: "project",
    action: "add",
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, created);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = await applyProjectAdd(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderProjectAdd(data));
}

/* --- one new Milestone, and one edited ----------------------------------- */

// `milestone add` creates one and `milestone edit` moves one. There is no third
// action and no flag: a Milestone has no archived state, so a removal would be
// the app's own destruction route, and nothing here can reach it.
async function runMilestone(args) {
  const action = args.subject[0];
  const name = args.subject.slice(1).join(" ").trim();
  if (name === "") throw usage("milestone " + action + " needs a name");
  rejectWriteFlags(args);
  refuseOptions(args, MILESTONE_REFUSALS,
    "a Milestone is a name, a date, a colour, tags, a note and its Projects");
  if (args.period !== undefined) {
    throw usage("milestone " + action + " does not take a period; a Milestone is an annotation " +
      "and no figure counts it");
  }
  if (action === "add" && args.date === undefined) {
    throw usage("milestone add needs --date <date>");
  }
  if (action === "edit" && args.date === undefined && args.colour === undefined &&
      args.note === undefined && args.tags.length === 0 && args.projects.length === 0) {
    throw usage("milestone edit needs at least one of --date, --colour, --tag, --project or --note");
  }

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  // An edit that names no tag and no Project keeps the ones the Milestone
  // holds: an empty list here means "not named", which is why the parser's own
  // empty list is passed as nothing at all.
  const answer = action === "add"
    ? query.milestoneAdd(plan, {
      name: name,
      date: args.date,
      colour: args.colour,
      tags: args.tags,
      note: args.note,
      projects: args.projects
    })
    : query.milestoneEdit(plan, {
      subject: name,
      date: args.date,
      colour: args.colour,
      tags: args.tags.length > 0 ? args.tags : undefined,
      note: args.note,
      projects: args.projects.length > 0 ? args.projects : undefined
    });
  const data = Object.assign({
    command: "milestone",
    action: action,
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, answer);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = action === "add"
      ? await applyMilestoneAdd(base, data, resolved.path)
      : await applyMilestoneEdit(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(action === "add" ? renderMilestoneAdd(data) : renderMilestoneEdit(data));
}

/* --- archiving and restoring --------------------------------------------- */

// The options the archive and the restore do not take: an Assignment is named
// by its Project and --person, and neither direction changes a date or an
// Allocation. --apply and --dry-run are theirs, as they are every write's.
const ASSIGNMENT_ARCHIVE_REFUSALS = ASSIGNMENT_REFUSALS.concat(["from", "to", "share"]);
const RECORD_ARCHIVE_REFUSALS = ["person", "from", "to", "share", "location",
  "availability", "colour", "note", "kind", "date", "tags", "projects"];

// The six commands are one command with two directions and three collections:
// the same preview-then-apply, the same refusals and the same read back.
async function runSubjectMove(args, action) {
  const kind = args.command;
  const name = args.subject.slice(1).join(" ").trim();
  if (kind === "assignment") {
    if (name === "") throw usage("assignment " + action + " needs a Project name");
    if (args.person === undefined) throw usage("assignment " + action + " needs --person <name>");
    refuseOptions(args, ASSIGNMENT_ARCHIVE_REFUSALS,
      "an archive or a restore changes no date and no Allocation");
  } else {
    if (name === "") throw usage(kind + " " + action + " needs a name");
    refuseOptions(args, RECORD_ARCHIVE_REFUSALS,
      "an archive or a restore changes nothing but which records are in the plan");
  }
  rejectWriteFlags(args);

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const request = {
    kind: kind,
    subject: name,
    project: kind === "assignment" ? name : undefined,
    person: args.person,
    period: args.period
  };
  const answer = action === "archive" ? query.archive(plan, request) : query.restore(plan, request);
  const data = Object.assign({
    command: kind,
    action: action,
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, answer);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = action === "archive"
      ? await applyArchive(base, data, resolved.path)
      : await applyRestore(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderSubjectMove(data));
}

/* --- one holiday date, added or removed ---------------------------------- */

// The Location is every word before the last one, so a Location with a space in
// it stays one Location and the date is always unambiguous.
async function runHoliday(args) {
  const action = args.subject[0];
  const words = args.subject.slice(1);
  if (words.length < 2) {
    throw usage("holiday " + action + " needs a Location and a date, as holiday " + action +
      " Berlin 2026-12-24");
  }
  const date = words[words.length - 1];
  const location = words.slice(0, -1).join(" ").trim();
  if (location === "") throw usage("holiday " + action + " needs a Location before the date");
  rejectWriteFlags(args);
  refuseOptions(args, HOLIDAY_REFUSALS,
    "a holiday is a Location, a date and a kind, and nothing else");
  if (action === "remove" && args.kind !== undefined) {
    throw usage("holiday remove does not take --kind: a holiday date is removed as it is " +
      "stored, and adding it again with --kind records it as that kind");
  }

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const change = query.holidayChange(plan, {
    action: action,
    location: location,
    date: date,
    kind: args.kind,
    period: args.period
  });
  const data = Object.assign({
    command: "holiday",
    planFile: resolved.path,
    planSource: resolved.source,
    applied: false
  }, change);

  if (args.apply) {
    const base = serverBase();
    data.server = base;
    data.readBack = await applyHoliday(base, data, resolved.path);
    data.applied = true;
  }

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderHoliday(data));
}

/* --- the running app, for the one write ---------------------------------- */

const DEFAULT_SERVER = "http://localhost:4173";
const SERVER_TIMEOUT_MS = 5000;

// Where the app serves: PACT_URL when it is set, else the port the app prints.
function serverBase() {
  const env = process.env.PACT_URL;
  const raw = typeof env === "string" && env.trim() !== "" ? env.trim() : DEFAULT_SERVER;
  let url = null;
  try {
    url = new URL(raw);
  } catch (_) {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new CliError('PACT_URL is not an http address: "' + raw + '"', "no-server", 1,
      "it is where the app serves, such as " + DEFAULT_SERVER);
  }
  return raw.replace(/\/+$/, "");
}

// Nothing answered, or nothing answered in time. A short, actionable error
// rather than the fetch failure: the fix is always to start the app.
function unreachable(base, err) {
  const code = err && err.cause && err.cause.code ? err.cause.code : "";
  const why = err && err.name === "TimeoutError"
    ? "it did not answer within " + SERVER_TIMEOUT_MS / 1000 + "s"
    : code === "ECONNREFUSED" ? "nothing is listening there"
      : "the request failed: " + (err && err.message ? err.message : String(err));
  return new CliError("no PACT server at " + base + " (" + why + ")", "no-server", 1,
    "the view is read there and --apply writes there: start it with node server.mjs, " +
    "or set PACT_URL to where it serves");
}

async function ask(base, method, route, body) {
  const options = { method: method, signal: AbortSignal.timeout(SERVER_TIMEOUT_MS) };
  if (body !== undefined) {
    options.headers = { "content-type": "application/json" };
    options.body = JSON.stringify(body);
  }
  let response;
  let text;
  try {
    response = await fetch(base + route, options);
    text = await response.text();
  } catch (err) {
    throw unreachable(base, err);
  }
  let payload = null;
  try {
    payload = text.trim() === "" ? null : JSON.parse(text);
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const said = payload && typeof payload.error === "string" ? payload.error : "HTTP " + response.status;
    throw new CliError("the app refused " + method + " " + route + ": " + said, "server-refused", 1);
  }
  return payload;
}

// Symlinks resolved when the path exists, so two spellings of one file compare
// equal; the resolved absolute path otherwise.
function realPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch (_) {
    return path.resolve(filePath);
  }
}

// The app has its own active plan file, and writing through it would change
// whichever plan it holds. This is the check that makes the write safe: prove
// the app has the file this command read, and refuse rather than guess.
async function requireSamePlan(base, planPath) {
  const state = await ask(base, "GET", "/api/plan-file");
  if (!state || typeof state.path !== "string" || state.path === "") {
    throw new CliError("the app at " + base + " did not say which plan it holds", "plan-mismatch", 1,
      "nothing was written");
  }
  const theirs = realPath(state.path);
  const mine = realPath(planPath);
  if (theirs !== mine) {
    throw new CliError("refusing to write: the app at " + base + " has a different plan open",
      "plan-mismatch", 1,
      "it holds " + theirs + ", this command read " + mine +
      "; pass --plan " + theirs + ", or open this plan in the app");
  }
}

// The write: the same route and body the interface sends for a drag or a panel
// save, then a read back of the app's plan. A write is done when the plan shows
// it, never when the request returned 200.
async function applyMove(base, diff, planPath) {
  await requireSamePlan(base, planPath);
  const route = "/api/assignments/" + encodeURIComponent(diff.assignment.id);
  await ask(base, "PATCH", route, diff.change);
  const plan = await ask(base, "GET", "/api/plan");
  const landed = ((plan && plan.assignments) || []).find(function (assignment) {
    return assignment.id === diff.assignment.id;
  });
  if (!landed) {
    throw new CliError("the write did not land: the app's plan holds no Assignment " +
      diff.assignment.id, "write-lost", 1,
      "the app is the authority here: read the Assignment there before trying again");
  }
  if (landed.start !== diff.after.start || landed.end !== diff.after.end ||
      landed.share !== diff.after.share) {
    throw new CliError("the write did not land: the app's plan holds " + landed.start + " to " +
      landed.end + " at " + landed.share + "%, not " + diff.after.start + " to " +
      diff.after.end + " at " + diff.after.share + "%", "write-lost", 1,
      "the app is the authority here: read the Assignment there before trying again");
  }
  return { start: landed.start, end: landed.end, share: landed.share };
}

// The creation: the app's own POST, then a read back of its plan. The reply
// names the record the server minted; the write is done when that record is in
// the plan the tool reads, holding what was asked for, never when the request
// returned 201. One read back serves every creation, so a Person, a Project and
// an Assignment are all verified by the same rule.
async function readBackCreate(base, route, collection, create, cleanName, holds, describe) {
  const reply = await ask(base, "POST", route, create);
  const plan = await ask(base, "GET", "/api/plan");
  const landed = ((plan && plan[collection]) || []).find(function (record) {
    return record.id === reply.id;
  });
  if (!landed) {
    throw new CliError("the creation did not land: the app's plan holds no " + cleanName + " " +
      reply.id, "write-lost", 1,
      "the app is the authority here: read the plan there before trying again");
  }
  if (!holds(landed)) {
    throw new CliError("the creation did not land: the app's plan holds " + describe(landed) +
      ", not " + describe(create), "write-lost", 1,
      "the app is the authority here: read the plan there before trying again");
  }
  return landed;
}

// A creation's tags are a set: the store sorts them by its own rule, so what a
// read back compares is the tags asked for, not the order they came back in.
function sameTags(a, b) {
  const left = (Array.isArray(a) ? a : []).slice().sort();
  const right = (Array.isArray(b) ? b : []).slice().sort();
  return left.length === right.length && left.every(function (tag, i) { return tag === right[i]; });
}

function tagsText(tags) {
  return Array.isArray(tags) && tags.length > 0 ? tags.join(", ") : "no tags";
}

async function applyAdd(base, add, planPath) {
  await requireSamePlan(base, planPath);
  const asked = add.create;
  const landed = await readBackCreate(base, "/api/assignments", "assignments", asked, "Assignment",
    function (record) {
      return record.projectId === asked.projectId && record.personId === asked.personId &&
        record.start === asked.start && record.end === asked.end && record.share === asked.share;
    },
    function (record) {
      return record.projectId + " / " + record.personId + " from " + record.start +
        " to " + record.end + " at " + record.share + "%";
    });
  return {
    id: landed.id,
    project: add.assignment.project,
    person: add.assignment.person,
    start: landed.start,
    end: landed.end,
    share: landed.share
  };
}

async function applyPersonAdd(base, add, planPath) {
  await requireSamePlan(base, planPath);
  const asked = add.create;
  const landed = await readBackCreate(base, "/api/people", "people", asked, "Person",
    function (record) {
      return record.name === asked.name && record.location === asked.location &&
        record.availability === asked.availability && record.note === asked.note &&
        sameTags(record.tags, asked.tags);
    },
    function (record) {
      return '"' + record.name + '" in ' + (record.location || "no Location") + " at " +
        record.availability + "% with " + tagsText(record.tags);
    });
  return {
    id: landed.id,
    name: landed.name,
    location: landed.location,
    availability: landed.availability,
    tags: landed.tags.slice(),
    note: landed.note
  };
}

// Whether a Milestone in the app's plan holds every field this command named.
// A field left out is not the tool's to pin, so a colour the server chose and a
// note nobody changed are both passed over; the two lists are sets, because the
// store sorts tags and the related Projects are a set of ids.
function milestoneHolds(record, asked) {
  if (asked.name !== undefined && record.name !== asked.name) return false;
  if (asked.date !== undefined && record.date !== asked.date) return false;
  if (asked.colour !== undefined && record.colour !== asked.colour) return false;
  if (asked.notes !== undefined && String(record.notes || "") !== String(asked.notes)) return false;
  if (asked.tags !== undefined && !sameTags(record.tags, asked.tags)) return false;
  if (asked.projectIds !== undefined && !sameTags(record.projectIds, asked.projectIds)) return false;
  return true;
}

// What a read back or a refusal says a Milestone holds, so a lost write names
// the plan it found rather than only the plan it asked for.
function milestoneDescription(record) {
  const related = Array.isArray(record.projectIds) ? record.projectIds.length : 0;
  return '"' + record.name + '" on ' + record.date + " in colour slot " +
    (record.colour === undefined ? "unset" : record.colour) + " with " + tagsText(record.tags) +
    " and " + (related === 0 ? "no related Project" : countText(related, "related Project"));
}

function milestoneRecord(record) {
  return {
    id: record.id,
    name: record.name,
    date: record.date,
    colour: record.colour,
    tags: Array.isArray(record.tags) ? record.tags.slice() : [],
    notes: typeof record.notes === "string" ? record.notes : "",
    projectIds: Array.isArray(record.projectIds) ? record.projectIds.slice() : []
  };
}

// The creation: the app's own POST /api/milestones, then a read back of its
// plan. The reply names the Milestone the server minted, and the creation is
// done when the plan the tool reads holds that record with the name, the date,
// the tags, the note and the related Projects asked for - and the colour, only
// where one was named.
async function applyMilestoneAdd(base, add, planPath) {
  await requireSamePlan(base, planPath);
  const asked = add.create;
  const landed = await readBackCreate(base, "/api/milestones", "milestones", asked, "Milestone",
    function (record) { return milestoneHolds(record, asked); },
    milestoneDescription);
  return milestoneRecord(landed);
}

// The edit: the app's own PATCH /api/milestones/<id> with the fields the diff
// showed and nothing else, then a read back of the plan, which must hold every
// one of them. The record is found by id, so an edit can never write a second
// Milestone by mistake.
async function applyMilestoneEdit(base, edit, planPath) {
  await requireSamePlan(base, planPath);
  const id = edit.subject.id;
  await ask(base, "PATCH", "/api/milestones/" + encodeURIComponent(id), edit.change);
  const plan = await ask(base, "GET", "/api/plan");
  const landed = ((plan && plan.milestones) || []).find(function (milestone) {
    return milestone.id === id;
  });
  if (!landed) {
    throw new CliError("the write did not land: the app's plan holds no Milestone " + id,
      "write-lost", 1,
      "the app is the authority here: read the Milestone there before trying again");
  }
  if (!milestoneHolds(landed, edit.change)) {
    throw new CliError("the write did not land: the app's plan holds " + milestoneDescription(landed) +
      ", not " + milestoneDescription(Object.assign({}, edit.subject, edit.change)),
      "write-lost", 1,
      "the app is the authority here: read the Milestone there before trying again");
  }
  return milestoneRecord(landed);
}

async function applyProjectAdd(base, add, planPath) {
  await requireSamePlan(base, planPath);
  const asked = add.create;
  const landed = await readBackCreate(base, "/api/projects", "projects", asked, "Project",
    function (record) {
      // A colour the tool named must come back as named; one the server chose is
      // not the tool's to pin, so only its presence is checked.
      return record.name === asked.name && record.notes === asked.notes &&
        (asked.colour === undefined || record.colour === asked.colour) &&
        sameTags(record.tags, asked.tags);
    },
    function (record) {
      return '"' + record.name + '" in colour slot ' +
        (record.colour === undefined ? "unset" : record.colour) + " with " + tagsText(record.tags);
    });
  return {
    id: landed.id,
    name: landed.name,
    colour: landed.colour,
    notes: landed.notes,
    tags: landed.tags.slice()
  };
}

// The collection a kind of record lives in, in the API and in the plan alike.
function collectionOf(kind) {
  return kind === "person" ? "people" : kind === "project" ? "projects" : "assignments";
}

// The one record's route in the API: the collection route the interface itself
// writes for a Person, a Project and an Assignment.
function recordRoute(kind, id) {
  return "/api/" + collectionOf(kind) + "/" + encodeURIComponent(id);
}

// What a read back calls the record it went looking for: the Person's or the
// Project's name, or the Assignment's Project and Person.
function recordLabel(move) {
  if (move.kind === "assignment") return move.subject.project + " / " + move.subject.person;
  return move.subject.name;
}

function findRecord(plan, kind, id) {
  return ((plan && plan[collectionOf(kind)]) || []).find(function (record) {
    return record.id === id;
  }) || null;
}

// The archive: the app's own DELETE on the record, which has always been the
// archive rather than a deletion, so the bare DELETE is not the destruction
// route and this tool has no way to reach that one. The read back asks two
// questions, because "gone from the plan" alone cannot tell an archive from a
// deletion: the live plan must not hold the record any more, and the archive
// view must hold it, marked archived. A record answering neither was deleted.
async function applyArchive(base, move, planPath) {
  await requireSamePlan(base, planPath);
  const id = move.subject.id;
  await ask(base, "DELETE", recordRoute(move.kind, id));
  if (findRecord(await ask(base, "GET", "/api/plan"), move.kind, id)) {
    throw new CliError("the archive did not land: the app's live plan still holds " + id,
      "write-lost", 1,
      "the app is the authority here: read this record there before trying again");
  }
  const kept = findRecord(await ask(base, "GET", "/api/plan?archived=1"), move.kind, id);
  if (!kept || kept.archived !== true) {
    throw new CliError("the archive did not land: the app's file does not hold " + id +
      " as archived, so the record is gone from the plan rather than archived",
      "write-lost", 1, "read the plan in the app before doing anything else");
  }
  return { id: id, name: recordLabel(move), archived: true, live: false };
}

// The restore: the app's own PATCH that sets archived back to false, the same
// request the Restore control sends, then a read back of the live plan, which
// must hold the record again.
async function applyRestore(base, move, planPath) {
  await requireSamePlan(base, planPath);
  const id = move.subject.id;
  await ask(base, "PATCH", recordRoute(move.kind, id), { archived: false });
  const live = findRecord(await ask(base, "GET", "/api/plan"), move.kind, id);
  if (!live || live.archived === true) {
    throw new CliError("the restore did not land: the app's live plan does not hold " + id,
      "write-lost", 1,
      "the app is the authority here: read this record there before trying again");
  }
  return { id: id, name: recordLabel(move), archived: false, live: true };
}

// Which Locations the holidays the app holds and the ones this command sent
// disagree about, so a failed read back says where to look rather than only
// that something moved. The map is keyed by the Location's spelling, so two
// spellings of one Location read as two, which is what differs.
function holidayDiff(stored, expected) {
  const byLocation = function (list) {
    const map = new Map();
    (list || []).forEach(function (group) {
      const name = group && typeof group.location === "string" ? group.location : "";
      map.set(name, JSON.stringify(group));
    });
    return map;
  };
  const sent = byLocation(expected);
  const held = byLocation(stored);
  const names = new Set(Array.from(sent.keys()).concat(Array.from(held.keys())));
  const differ = Array.from(names).filter(function (name) {
    return sent.get(name) !== held.get(name);
  });
  if (differ.length === 0) return "the same Locations, but in a different order";
  return "the Locations that differ: " + differ.map(function (name) {
    return name === "" ? "(no Location)" : name;
  }).join(", ");
}

// The holiday write, and the proof of the rebuild. The app has one holiday
// write, setHolidays, which replaces every Location's dates at once, so this
// sends the whole list rebuilt from a read taken moments before - and then asks
// the app's plan for that exact array back: every group, every date, in order.
// Equal arrays are what make "exactly one date changed and no other Location
// was touched" a measured fact rather than a hope. The rest of the safety - the
// validation, the atomic write, the changed-underneath guard and the undo step -
// is the app's, because the route and the body are the app's own.
async function applyHoliday(base, change, planPath) {
  await requireSamePlan(base, planPath);
  await ask(base, "PATCH", "/api/plan", change.change);
  const plan = await ask(base, "GET", "/api/plan");
  const stored = (plan && plan.holidays) || [];
  const expected = change.change.holidays;
  if (JSON.stringify(stored) !== JSON.stringify(expected)) {
    throw new CliError("the write did not land: the app's plan holds different holidays from " +
      "the ones this command sent (" + holidayDiff(stored, expected) + ")", "write-lost", 1,
      "the app is the authority here: read the holidays in the app before trying again");
  }
  const kept = query.holidays(plan).holidays.find(function (group) {
    return group.location === change.location;
  });
  return { location: change.location, dates: kept ? kept.dates : [] };
}

/* --- the view, and how it looks ------------------------------------------ */

// Where the app's plan file came from, said the way it was chosen. The app's
// own state names the source "env", "config" or "default"; a read that
// resolves its own path says "--plan" or "PACT_DATA". Either way the sentence
// is the same, so a reader is never told two words for one thing.
function viewSourceText(source) {
  if (source === "PACT_DATA" || source === "env") return " (PACT_DATA)";
  if (source === "config") return " (chosen in the app)";
  if (source === "default") return " (default)";
  return "";
}

// The app's plan-file state as the tool's own planSource speaks it.
function appPlanSource(source) {
  if (source === "env") return "PACT_DATA";
  return source === "config" ? "config" : "default";
}

function onOff(value) {
  return value ? "on" : "off";
}

// The four Grid spacings, in the Zooms' own order, because each is its own
// stored width and the read shows all four.
function spacingText(spacing) {
  return ["day", "week", "sprint", "month"].map(function (zoom) {
    return zoom + " " + spacing[zoom];
  }).join(" / ");
}

// The overlays, in the order the Options menu lists them, so the read and the
// menu are read in one order.
function overlaysText(view) {
  return [
    "weekends " + onOff(view.weekends),
    "holidays " + onOff(view.holidays),
    "milestones " + onOff(view.milestones),
    "availability lines " + onOff(view.availabilityLines),
    "assignments " + onOff(view.assignments),
    "dividers " + onOff(view.dividers),
    "minimap " + onOff(view.minimap),
    "marker " + onOff(view.marker)
  ].join(", ");
}

// The cadence as the three rules it is: where its first sprint starts, how long
// the default length is, and what it names them - never the derived chain, which
// is a drawing rather than a setting.
function cadenceText(cadence) {
  if (!cadence) return "none: the plan defines no sprints, so the Sprint zoom names none";
  const firstName = cadence.namePrefix + cadence.nameNumber;
  return "first sprint " + firstName + " starts " + cadence.start + ", " + cadence.length +
    " days each, named \"" + firstName + "\", \"" + cadence.namePrefix +
    (Number(cadence.nameNumber) + 1) + "\", ...";
}

// One list's sort, in the menu's own words: the key's label and the direction.
function sortText(kind, sort) {
  if (!sort) return "none";
  const def = findSortKey(kind, sort.key);
  return (def ? def.label : sort.key) + ", " + directionLabel(sort.direction).toLowerCase();
}

// A labelled row whose value is longer than one line: the value wraps at a
// comma and the continuation lines up under the first word, so a list of
// overlays reads as a list rather than as a paragraph.
function wrappedPair(label, width, value, maxWidth) {
  const indent = " ".repeat(width + 2);
  const items = value.split(", ");
  const lines = [];
  let line = [];
  items.forEach(function (item) {
    if (line.length > 0 && indent.length + line.concat(item).join(", ").length > maxWidth) {
      lines.push(line.join(", ") + ",");
      line = [item];
    } else {
      line = line.concat(item);
    }
  });
  if (line.length > 0) lines.push(line.join(", "));
  return [label.padEnd(width) + "  " + lines[0]].concat(
    lines.slice(1).map(function (rest) { return indent + rest; }));
}

// A setting's value as a reader says it: the store's own word for a toggle, a
// sort in the menu's words, and the value itself for everything else.
function settingValueText(key, value) {
  if (key.indexOf("sort.") === 0) return sortText(key.slice(5), value);
  if (key === "reportView") return reportViewLabel(value);
  if (typeof value === "boolean") return onOff(value);
  if (value === null || value === undefined) return "none";
  return String(value);
}

// The value as the command that stores it spells it: a sort keeps its key and
// direction, which the read's label would not give back.
function settingToken(key, value) {
  if (key.indexOf("sort.") === 0) {
    return value === null ? "none" : value.key + " " + (value.direction === "desc" ? "desc" : "asc");
  }
  if (typeof value === "boolean") return onOff(value);
  return String(value);
}

function viewSetCommand(key, value) {
  return "node bin/pact.mjs view set " + key + " " + settingToken(key, value) + " --apply";
}

function renderView(data) {
  const view = data.view;
  const header = [
    ["Plan file", data.planFile + viewSourceText(data.planSource)],
    ["Open", data.open]
  ];
  const rows = [
    ["Plan", data.period.label + ", step " + data.step + "%"],
    ["Cadence", cadenceText(data.cadence)],
    ["Grid", "zoom " + view.zoom + ", row height " + view.rowHeight + ", spacing " +
      spacingText(view.gridSpacing)],
    ["Overlays", overlaysText(view)],
    ["Palette", view.palette],
    ["Report", "zoom " + view.reportZoom + ", " + reportViewLabel(view.reportView)],
    ["Sort", "projects: " + sortText("projects", view.sort.projects) + ", people: " +
      sortText("people", view.sort.people)],
    ["Rail", view.stackCollapsed ? "folded away" : "open"]
  ];
  // One column for the whole block, header included, so a label and its value
  // line up whichever row a reader is on.
  const width = header.concat(rows).reduce(function (most, row) {
    return Math.max(most, row[0].length);
  }, 0);
  const lines = header.map(function (row) { return row[0].padEnd(width) + "  " + row[1]; });
  lines.push("");
  rows.forEach(function (row) {
    if (row[0] === "Overlays") lines.push.apply(lines, wrappedPair(row[0], width, row[1], 76));
    else lines.push(row[0].padEnd(width) + "  " + row[1]);
  });
  lines.push("");
  lines.push("These are the app's own View settings, kept in its Config beside the plan");
  lines.push("file. The period, the Step and the cadence are the plan's, and the only rows here");
  lines.push("that travel with it. The Filter and the Marker's date are session-only and are");
  lines.push("not stored at all. None of it changes a figure or a plan record.");
  return lines.join("\n") + "\n";
}

function renderViewSet(data) {
  // Where the app serves, spelled as the read spells it, and in its column.
  const lines = ["Open".padEnd(9) + "  " + data.open];
  lines.push("");
  lines.push("View setting");
  lines.push("  " + data.key + ": " + settingValueText(data.key, data.before) + " -> " +
    settingValueText(data.key, data.after));
  lines.push("");
  if (!data.applied) {
    lines.push("Only this setting is written: the app stores the keys it is sent over the");
    lines.push("stored view, so every other setting keeps exactly the value it has now.");
    lines.push("Nothing written. Re-run with --apply.");
    return lines.join("\n") + "\n";
  }
  lines.push("Applied through " + data.server + "; read back from its view: " + data.key +
    " is " + settingValueText(data.key, data.after) + ", and");
  lines.push("every other setting is exactly as it was.");
  lines.push("The view is not part of the plan, so this is not one of the app's Undo steps.");
  lines.push("Put it back with: " + viewSetCommand(data.key, data.before));
  return lines.join("\n") + "\n";
}

// The three things `view` reads, from the one app that decides them: its
// View settings, the plan it is showing, and which file that plan is. Nothing
// is read from a plan file here, because the display belongs to the app's plan
// whether or not this checkout can see it.
async function readAppView(base) {
  const stored = await ask(base, "GET", "/api/view");
  const plan = await ask(base, "GET", "/api/plan");
  const file = await ask(base, "GET", "/api/plan-file");
  return { stored: stored, plan: plan, file: file };
}

async function runView(args) {
  // The view is not a list of rows, so it takes no narrowing: a Filter would be
  // a query it cannot answer and a silently ignored one answers nothing.
  refuseNarrowing(args, []);
  const action = args.subject.length > 0 ? args.subject[0] : "";
  if (action === "set") return runViewSet(args);
  if (action !== "") {
    throw usage('unknown view action "' + action + '"; view reads how the app is showing the ' +
      "plan, and view set changes one setting: view set <key> <value>");
  }
  refuseOptions(args, VIEW_REFUSALS,
    "view reads the running app's own View settings and plan, so it takes neither");
  const base = serverBase();
  const read = await readAppView(base);
  const data = Object.assign({
    command: "view",
    planFile: typeof read.file.path === "string" ? read.file.path : "",
    planSource: appPlanSource(read.file.source),
    open: base + "/"
  }, query.view(read.plan, read.stored));
  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderView(data));
}

// One View setting, previewed and then written through the app's own
// POST /api/view. The key is the store's own, so nothing here invents a schema;
// the query module reads the value by the app's rules and returns the exact
// body the store takes.
async function runViewSet(args) {
  const words = args.subject.slice(1);
  if (words.length < 2) {
    throw usage("view set needs a key and a value, as view set zoom week; view prints every " +
      "setting and its stored value");
  }
  rejectWriteFlags(args);
  refuseOptions(args, VIEW_SET_REFUSALS,
    "view set changes one View setting and reads the app's own view, so it takes neither");
  const key = words[0];
  const typed = words.slice(1).join(" ");
  // The key and the value are judged before the app is asked anything: an
  // unknown key, or a value the app would refuse or store as something else, is
  // an error whether or not the app is running, and names what it does take.
  query.viewSet(null, key, typed);
  const base = serverBase();
  const stored = await ask(base, "GET", "/api/view");
  const change = query.viewSet(stored, key, typed);
  const data = Object.assign({
    command: "view",
    action: "set",
    applied: false,
    server: base,
    open: base + "/"
  }, change);
  if (args.apply) {
    const applied = await applyViewChange(base, key, typed);
    data.before = applied.before;
    data.after = applied.after;
    data.change = applied.change;
    data.readBack = applied.view;
    data.applied = true;
  }
  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(renderViewSet(data));
}

// The write itself, and the proof of it: the app is read again and the change
// rebuilt from that read, so a setting another hand moved between the preview
// and this write is kept and only this key is sent. Then one POST, and a read
// back that must be the stored view with exactly that one key changed. A write
// is done when the app's view shows it, never when the request returned 200.
async function applyViewChange(base, key, typed) {
  const before = await ask(base, "GET", "/api/view");
  const now = query.viewSet(before, key, typed);
  await ask(base, "POST", "/api/view", now.change);
  const after = await ask(base, "GET", "/api/view");
  const expected = Object.assign({}, before, now.change);
  if (!isDeepStrictEqual(after, expected)) {
    const differing = Object.keys(expected).filter(function (name) {
      return !isDeepStrictEqual(after[name], expected[name]);
    });
    throw new CliError("the write did not land: the app's view differs from what was sent in " +
      (differing.length === 0 ? "every key" : differing.join(", ")), "write-lost", 1,
      "the app is the authority here: run view to read its settings before trying again");
  }
  return {
    before: now.before,
    after: now.after,
    change: now.change,
    view: after
  };
}

// What the view does not take: --plan and --period are the app's, not the
// caller's, and every plan write's own option belongs to a plan write. `view`
// takes no --apply either, being a read; `view set` does, being the write.
const VIEW_REFUSALS = ["plan", "period"].concat(READ_REFUSALS);
const VIEW_SET_REFUSALS = ["plan", "period"].concat(READ_REFUSALS.filter(function (key) {
  return key !== "apply" && key !== "dryRun";
}));

/* --- the run ------------------------------------------------------------- */

function reportError(err, json) {
  const code = err && typeof err.code === "string" ? err.code : "internal";
  const suggestions = err && Array.isArray(err.suggestions) ? err.suggestions : [];
  const hint = err && typeof err.hint === "string" ? err.hint : "";
  const exit = err && Number.isInteger(err.exitCode) ? err.exitCode : 1;
  if (json) {
    const body = { error: err.message, code: code };
    if (suggestions.length > 0) body.suggestions = suggestions;
    if (hint !== "") body.hint = hint;
    process.stderr.write(JSON.stringify(body, null, 2) + "\n");
  } else {
    process.stderr.write("pact: " + err.message + "\n");
    if (suggestions.length > 0 && code !== "ambiguous-subject") {
      process.stderr.write("  nearest: " + suggestions.map(function (name) {
        return "\"" + name + "\"";
      }).join(", ") + "\n");
    }
    if (hint !== "") process.stderr.write("  " + hint + "\n");
  }
  process.exitCode = exit;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.command === null) {
    process.stdout.write(HELP);
    return;
  }
  // The three that cut a list are refused for every command that does not take
  // them - a write and a read of one subject alike - before anything is read.
  // An unknown command still gets its own refusal, from below.
  if (Object.prototype.hasOwnProperty.call(COMMANDS, args.command) ||
      WRITE_COMMANDS.indexOf(args.command) !== -1) {
    refuseCut(args);
  }
  if (args.command === "view") {
    await runView(args);
    return;
  }
  if (args.command === "assignment") {
    await runAssignment(args);
    return;
  }
  // `milestone add` and `milestone edit` change a Milestone; `milestones` reads
  // every one. A Milestone has no archived state, so the actions are two and
  // neither of them removes one: the app's own destruction route is unreachable
  // from here, which is why there is no third word to type.
  if (args.command === "milestone") {
    if (args.subject[0] === "add" || args.subject[0] === "edit") {
      await runMilestone(args);
      return;
    }
    const said = args.subject.length > 0 ? 'unknown milestone action "' + args.subject[0] + '"' : "";
    throw usage((said === "" ? "" : said + "; ") +
      "milestone needs an action, and they are add and edit: milestone add <name> --date <date>, " +
      "or milestone edit <name> --date <date>. A Milestone is never removed from this tool");
  }
  // `person add` and `project add` create a record; `person <name>` and
  // `project <name>` read one. The action is the first word, as in `assignment`.
  if (args.command === "person" && args.subject[0] === "add") {
    await runPersonAdd(args);
    return;
  }
  if (args.command === "project" && args.subject[0] === "add") {
    await runProjectAdd(args);
    return;
  }
  // `holiday add` and `holiday remove`: one date at a time, for one Location.
  if (args.command === "holiday") {
    if (args.subject[0] === "add" || args.subject[0] === "remove") {
      await runHoliday(args);
      return;
    }
    const said = args.subject.length > 0 ? 'unknown holiday action "' + args.subject[0] + '"' : "";
    throw usage((said === "" ? "" : said + "; ") +
      "holiday needs an action, and they are add and remove: holiday add <location> <date>, " +
      "or holiday remove <location> <date>");
  }
  // `person archive` and `person restore`, and the same on a Project: the
  // action is the first word, as it is for `assignment`.
  if ((args.command === "person" || args.command === "project") &&
      (args.subject[0] === "archive" || args.subject[0] === "restore")) {
    await runSubjectMove(args, args.subject[0]);
    return;
  }
  const spec = COMMANDS[args.command];
  if (!spec) {
    throw usage('unknown command "' + args.command + '"; commands: ' +
      Object.keys(COMMANDS).concat("assignment").join(", "));
  }
  rejectForeignOptions(args);
  refuseNarrowing(args, spec.narrows);
  if (!spec.subject && args.subject.length > 0) {
    throw usage(args.command + " takes no subject");
  }
  if (spec.subject && args.subject.length === 0) {
    throw usage(args.command + " needs a name");
  }
  if (!spec.period && args.period !== undefined) {
    throw usage(args.command + " does not take a period; it reports the plan as stored");
  }
  const narrow = spec.narrows.length > 0 ? narrowRequest(args) : undefined;

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const period = spec.period ? query.resolvePeriod(plan, args.period) : undefined;
  const result = spec.subject
    ? spec.run(plan, period, args.subject.join(" "))
    : spec.run(plan, period, narrow);
  const data = Object.assign({
    command: args.command,
    planFile: resolved.path,
    planSource: resolved.source
  }, result);

  if (args.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(RENDERERS[args.command](data));
}

function fail(err) {
  if (err instanceof CliError || err instanceof query.QueryError) {
    reportError(err, process.argv.includes("--json"));
  } else {
    process.stderr.write("pact: internal error: " + (err && err.stack ? err.stack : String(err)) + "\n");
    process.exitCode = 1;
  }
}

run().catch(fail);
