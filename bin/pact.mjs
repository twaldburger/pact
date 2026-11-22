#!/usr/bin/env node
/*
 * PACT's tool: answer a question about a plan from a checkout, with no server
 * and no browser, and change a plan through the running app.
 *
 * This file is the front end only: it parses argv, resolves the plan file,
 * hands the plan and the period to `lib/query.mjs`, and renders the one object
 * that comes back as text (the default) or as JSON. It does no plan arithmetic
 * and no plan traversal of its own; every figure is the query module's, which
 * is the report's own. Reads never touch the network. The ten writes -
 * `person add --apply`, `project add --apply`, `assignment move --apply`,
 * `assignment add --apply`, and archive and restore for each of the three
 * collections - send the query module's body, patch or archive to the app's own
 * POST /api/people, POST /api/projects, PATCH /api/assignments/<id>,
 * POST /api/assignments, DELETE /api/<collection>/<id> (the archive, as it has
 * always been) and PATCH /api/<collection>/<id> with `archived: false` (the
 * restore) - the routes and bodies the interface itself uses - so the
 * validation, the atomic write and the changed-underneath guard are the app's,
 * and the change is one step back with its Undo control. Nothing here deletes
 * anything: the tool has no route to the app's destruction, no such command,
 * and no flag that reaches one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePlan } from "../lib/plan.mjs";
import * as query from "../lib/query.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

const COMMANDS = {
  plan: {
    period: true,
    subject: false,
    run: function (plan, period) { return query.planSummary(plan, period); }
  },
  people: {
    period: true,
    subject: false,
    run: function (plan, period) { return query.people(plan, period); }
  },
  person: {
    period: true,
    subject: true,
    run: function (plan, period, name) { return query.person(plan, period, name); }
  },
  projects: {
    period: true,
    subject: false,
    run: function (plan, period) { return query.projects(plan, period); }
  },
  project: {
    period: true,
    subject: true,
    run: function (plan, period, name) { return query.project(plan, period, name); }
  },
  tags: {
    period: true,
    subject: false,
    run: function (plan, period) { return query.tags(plan, period); }
  },
  tag: {
    period: true,
    subject: true,
    run: function (plan, period, key) { return query.tag(plan, period, key); }
  },
  capacity: {
    period: true,
    subject: false,
    run: function (plan, period) { return query.capacity(plan, period); }
  },
  holidays: {
    period: false,
    subject: false,
    run: function (plan) { return query.holidays(plan); }
  },
  milestones: {
    period: false,
    subject: false,
    run: function (plan) { return query.milestones(plan); }
  }
};

const HELP = `PACT tool

Answer a question about a plan from a checkout, with no server and no browser.
Ten commands change a plan: person add, project add, assignment add and
assignment move create and change work, and person, project and assignment each
take archive and restore. All of them write through the running app, so the
change is one step back with its Undo control. The figures are computed by the
report's own modules over the period you ask for, so they are the report page's
numbers. The tool never deletes anything; see Deleting below.

Usage
  node bin/pact.mjs --help
  node bin/pact.mjs <command> [name] [options]

Commands
  plan                 [--period]  the plan period, Step, counts and totals
      node bin/pact.mjs plan --period 2026-11
  people               [--period]  each Person: Capacity, Allocated, Remaining, of offer
      node bin/pact.mjs people --period 2026-11
  person <name>        [--period]  one Person, and the Assignments meeting the period
      node bin/pact.mjs person "Anna Meier" --period 2026-11
  projects             [--period]  each Project: Allocated, of plan, of capacity
      node bin/pact.mjs projects --period 2026-11
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

Deleting
  The tool never deletes anything. There is no command and no flag that
  destroys a Person, a Project, an Assignment or a Milestone, and no --force to
  reach one: what this tool can do to a plan is add a Person, add a Project or
  add an Assignment, move an Assignment, and archive or restore a Person, a
  Project or an Assignment, and nothing more. That boundary is deliberate, and
  it is not a gap waiting to be filled.

  Archiving is how work leaves a plan reversibly: archive takes a record out of
  the plan and restore puts it back, and neither destroys anything. A deletion
  stays in the app, where it can be seen, and Undo takes it back.

  A Milestone has no archived state - it either exists or it is destroyed - so
  this tool cannot take one out of a plan at all. It creates and edits no
  Milestone either, and deleting one stays in the app, where it can be seen.

The plan file
  --plan, else PACT_DATA, else data/default.pact.json beside this repository.
  Reads never write it. Its writes - the four that create and change work, and
  the six that archive and restore - go through the running app's API, so
  validation, the atomic write and the guard against a file changed underneath
  are the app's, not a second copy here. It reads the live plan, so archived
  People, Projects and Assignments are left out, as on the default grid; a
  restore is the one command that looks past that rule.

Subjects
  A name or an id, case-insensitive: person anna and person "Anna Meier" find
  the same Person. An unknown or ambiguous name is an error naming the nearest
  matches, never a zero.

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
  "--note": "note"
};

// The options that repeat, each value added to a list: one --tag per tag, since
// a tag is free text and cannot be split on a comma without being rewritten.
const REPEATABLE_OPTIONS = { "--tag": "tags" };

// The options that are a flag alone.
const FLAG_OPTIONS = {
  "--json": "json",
  "--apply": "apply",
  "--dry-run": "dryRun"
};

function parseArgs(argv) {
  const out = {
    command: null, subject: [], plan: undefined, period: undefined, person: undefined,
    from: undefined, to: undefined, share: undefined, location: undefined,
    availability: undefined, colour: undefined, note: undefined, tags: [],
    json: false, apply: false, dryRun: false, help: false
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
  return renderPairs(pairs);
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
  if (data.people.length === 0) lines.push("(no People)");
  else {
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
    rows.push([
      "Total",
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
  if (data.projects.length === 0) lines.push("(no Projects)");
  else {
    const rows = data.projects.map(function (project) {
      return [
        project.name + (project.absence ? " (absence)" : ""),
        figure(project.allocated),
        percent(project.ofPlan),
        percent(project.ofCapacity)
      ];
    });
    rows.push([
      "Total",
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
  if (key === "tags") return args.tags.length > 0;
  return args[key] !== undefined;
}

function refuseOptions(args, keys, where) {
  keys.forEach(function (key) {
    if (!taken(args, key)) return;
    const flag = key === "tags" ? "--tag" : "--" + key;
    throw usage(args.command + " does not take " + flag + "; " + where);
  });
}

const READ_REFUSALS = ["person", "from", "to", "share", "location", "availability",
  "colour", "note", "tags", "apply", "dryRun"];
const ASSIGNMENT_REFUSALS = ["location", "availability", "colour", "note", "tags"];
const PERSON_ADD_REFUSALS = ["person", "from", "to", "share", "colour"];
const PROJECT_ADD_REFUSALS = ["person", "from", "to", "share", "location", "availability"];

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

/* --- archiving and restoring --------------------------------------------- */

// The options the archive and the restore do not take: an Assignment is named
// by its Project and --person, and neither direction changes a date or an
// Allocation. --apply and --dry-run are theirs, as they are every write's.
const ASSIGNMENT_ARCHIVE_REFUSALS = ASSIGNMENT_REFUSALS.concat(["from", "to", "share"]);
const RECORD_ARCHIVE_REFUSALS = ["person", "from", "to", "share", "location",
  "availability", "colour", "note", "tags"];

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
    "--apply writes through the running app: start it with node server.mjs, " +
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
  if (args.command === "assignment") {
    await runAssignment(args);
    return;
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
  if (!spec.subject && args.subject.length > 0) {
    throw usage(args.command + " takes no subject");
  }
  if (spec.subject && args.subject.length === 0) {
    throw usage(args.command + " needs a name");
  }
  if (!spec.period && args.period !== undefined) {
    throw usage(args.command + " does not take a period; it reports the plan as stored");
  }

  const resolved = resolvePlanFile(args.plan);
  const plan = loadPlan(resolved);
  const period = spec.period ? query.resolvePeriod(plan, args.period) : undefined;
  const result = spec.subject
    ? spec.run(plan, period, args.subject.join(" "))
    : spec.run(plan, period);
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
