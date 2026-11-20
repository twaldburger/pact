#!/usr/bin/env node
/*
 * PACT's read tool: answer a question about a plan from a checkout, with no
 * server and no browser.
 *
 * This file is the front end only: it parses argv, resolves the plan file,
 * hands the plan and the period to `lib/query.mjs`, and renders the one object
 * that comes back as text (the default) or as JSON. It does no plan arithmetic
 * and no plan traversal of its own; every figure is the query module's, which
 * is the report's own. It only ever reads the plan.
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

const HELP = `PACT read tool

Answer a question about a plan from a checkout, with no server and no browser.
The figures are computed by the report's own modules over the period you ask
for, so they are the report page's numbers.

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

The plan file
  --plan, else PACT_DATA, else data/default.pact.json beside this repository.
  The tool only reads it and never writes a plan. It reads the live plan, so
  archived People, Projects and Assignments are left out, as on the default
  grid.

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

function parseArgs(argv) {
  const out = { command: null, subject: [], period: undefined, plan: undefined, json: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      out.help = true;
      continue;
    }
    if (out.command === null && arg === "help") {
      out.help = true;
      continue;
    }
    if (arg === "--json") {
      out.json = true;
      continue;
    }
    if (arg === "--plan" || arg === "--period") {
      const value = argv[i + 1];
      if (value === undefined || value.trim() === "" || value.startsWith("-")) {
        throw usage(arg + " needs a value");
      }
      if (arg === "--plan") out.plan = value;
      else out.period = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--plan=")) {
      out.plan = arg.slice("--plan=".length);
      if (out.plan === "") throw usage("--plan needs a value");
      continue;
    }
    if (arg.startsWith("--period=")) {
      out.period = arg.slice("--period=".length);
      if (out.period === "") throw usage("--period needs a value");
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

function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.command === null) {
    process.stdout.write(HELP);
    return;
  }
  const spec = COMMANDS[args.command];
  if (!spec) {
    throw usage('unknown command "' + args.command + '"; commands: ' +
      Object.keys(COMMANDS).join(", "));
  }
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

try {
  run();
} catch (err) {
  if (err instanceof CliError || err instanceof query.QueryError) {
    reportError(err, process.argv.includes("--json"));
  } else {
    process.stderr.write("pact: internal error: " + (err && err.stack ? err.stack : String(err)) + "\n");
    process.exitCode = 1;
  }
}
