---
type: Guide
title: PACT's command line
description: Working a plan from a terminal - the reads, the writes, the limits, and the command table the tool prints for itself.
---

# PACT's command line

`bin/pact.mjs` is PACT's tool: one command line over the same plan file the app
draws and the same figures the report counts. It is how you - or a colleague's
agent - answers a question about a plan without opening a browser, and how a
change is made from a terminal without editing the JSON by hand. Node 20 or
later is the only requirement: no install, no dependency, no build step, and
every command below is run from the repository root.

**The tool never deletes anything.** That is the boundary this page is ordered
by, so it comes first: the rest is easier to trust once it is known.

## The tool never deletes anything

There is no command, option or flag here that destroys a
[Person](../GLOSSARY.md#person), a [Project](../GLOSSARY.md#project), an
[Assignment](../GLOSSARY.md#assignment) or a [Milestone](../GLOSSARY.md#milestone).

Archiving is how work leaves a plan reversibly. `person archive`,
`project archive` and `assignment archive` take a record out of the plan, and
`person restore`, `project restore` and `assignment restore` put it back.
Neither destroys anything: `archived` is one flag in the plan file, the record
and its Assignments stay in the file exactly as they were, and the plan's totals
simply stop counting them. Archiving does not cascade, and the app's Show
archived draws whatever the tool archived.

A [Holiday](../GLOSSARY.md#holiday) date is one plan setting rather than a record,
so `holiday remove` edits one entry of one Location's list and destroys nothing.
It is restorable by adding the date back, it costs one Undo step, and every
other date of that Location is untouched.

Deletion stays in the app, where it can be seen, and Undo takes it back. The
boundary is deliberate, and it is not a gap waiting to be filled.

## Running the tool

`node bin/pact.mjs people --period 2026-11`

The plan file is `--plan <path>`, else `PACT_DATA`, else
`data/default.pact.json` beside the repository; a relative `--plan` is from the
directory you ran the tool in. Reads never write that file.

The period is `--period`: a month as `2026-11`, a sprint as `Sprint 24` or its
ordinal `24`, or a range as `2026-11-01..2026-11-30`. Without it the plan's own
period is counted, and a period outside it is allowed and stated.

`--json` prints the same answer as data instead of as text. `--help` prints
everything the tool can do, and `--help table` prints the commands as the table
at the end of this page, which is generated from the tool's own list. Put the
tool on your `PATH` as `pact` and `pact people --period 2026-11` is the same
command.

## Answering a question about a plan

**A read works from the plan file with no app running**, no server and no
network.

- `plan` - the plan period, Step, counts and totals.
- `people` - each Person's Capacity, Allocated and Remaining, and Allocated as a
  share of what that Person offers.
- `person <name>` - one Person, and the Assignments that meet the period.
- `projects` and `project <name>` - the same on the Project side: Allocated, and
  its share of the plan and of what the plan offers.
- `tags` and `tag <tag>` - each tag's FTE-days; a tag key names every tag under
  it.
- `capacity` - Capacity offered against Allocated, per time bucket.
- `holidays` and `milestones` - those records as they are stored.

A subject is a name or an id, case-insensitive: `person anna` and
`person "Anna Meier"` find the same Person. An unknown or ambiguous name is an
error naming the nearest matches, never a zero. Every read leaves archived
records out, exactly as the grid does.

## Reading the figures

The figures are the report's own, because the tool imports the report's modules
rather than counting anything itself: the same working days, the same holiday
and Absence rules, the same FTE-days. `people --period 2026-11` prints what the
report's people view draws for that period, and `--json` carries the same
numbers under the same keys - unrounded, where the text rounds to one decimal.

- Capacity is what a Person offers over the period, net of their Location's
  holidays and their Absences. Allocated is the FTE-days their Assignments take,
  Remaining is the difference and may be negative. Absence Projects are left out
  of every figure, as in the report.
- Of offer is Allocated over Capacity; of plan is a row over the plan's own
  total; of capacity is a row over what the whole plan offers in the same
  stretch. A stretch offering no Capacity has no share and reads as `-`.

`lib/query.mjs` is the seam a future protocol adapter would share. It takes a
plan and a period and returns one answer object, with no printing, no file and
no process: the tool renders that object as text or `--json`, and a server
route or a protocol server would render the same one. So a figure can gain a
second mouth without gaining a second calculation.

## Capacity, and who is over it

`people` and `projects` print whole lists, which is the wrong size for one
question: who in Berlin is over capacity wants two rows, not fourteen.

`node bin/pact.mjs people --location Berlin --over --period 2026-11`

Five options narrow a list: `--location`, `--tag` (repeated, one per tag),
`--over`, `--under` and `--top <n>`. `people` takes all five, `projects` takes
`--tag` and `--top`, and any other read refuses one rather than ignoring it.
Each is a named term, with no expression to parse and no operator to get subtly
wrong, and `--over` with `--under` is refused: a Person at exactly their
Capacity is in neither.

A narrowed answer says so. It prints the filter in plain words and how much of
the list it kept - "Filter location: Berlin, over capacity" and "Matched 2 of
14 People" - and its Total row is headed Plan total, because that row is still
the whole plan's. `--top` states its order, and a cut that falls inside a tie
says how many rows share the boundary figure. An empty result is still an
answer: it names the filter, says nothing matched, and exits zero.

The options narrow and compute nothing. Every figure on a narrowed row is that
row's own, over the same plan and the same period, exactly as the unfiltered
list would print it: a filter can hide a number, never make one up.

## Changing a plan

Nineteen commands change a plan, and every one of them goes through the running
app. **Nothing is written without `--apply`**: each prints a preview first -
what would be created, the old and new value, the figures before and after -
and the preview is the default. `--dry-run` says the same thing out loud.

- `person add <name>` and `project add <name>` create one record. A name the
  live plan already answers to is refused, naming the record that holds it.
- `person copy <name>`, `project copy <name>` and
  `assignment copy <project> --person <name>` create a second record from one
  that exists, carrying what the app's own Copy carries: a Project's colour,
  tags, notes and absence flag; a Person's Location, Availability, tags and
  note; an Assignment's Person, dates, Share, tags and note. **No work follows
  a copy** - a copied Person or Project has no Assignments - and the source is
  untouched. The name is the app's own rule, `<source> (copy)` and then
  `(copy 2)`, `(copy 3)` while a live record holds it.
- `person edit <name>` and `project edit <name>` change a record that already
  exists, and print a diff of exactly the fields that change. The preview also
  states what the change costs: an Availability or a Location change prints the
  FTE-days the Person offers before and after, and switching a Project's
  `--absence` prints the FTE-days its Assignments are worth and the plan's
  Capacity and Allocated either side. Tags are **added and removed, never
  replaced** - `--tag` adds one, `--untag` removes one, and the preview prints
  the resulting tag list in full - so no tag somebody else added is dropped
  silently. There is no `--tags` to replace the list.
- `assignment add <project>` creates one Assignment on a Person over `--from`
  and `--to` at `--share`; `assignment move <project>` reschedules or resizes
  one. Over-allocation is allowed and stated before it is made, never refused.
- `person archive` and `person restore` - and the same pair for a Project and
  for an Assignment - are the reversible way out, described above.
- `holiday add <location> <date>` and `holiday remove <location> <date>` write
  one date of one Location's list. The preview prints that Location's resulting
  list in full, so a lost entry is visible before it is written.
- `milestone add <name>` and `milestone edit <name>` create a Milestone and move
  or change one. **A Milestone can be created and edited but never removed**: it
  has no archived state, so there is no action here to take one out of a plan,
  and deleting one stays in the app where it can be seen.

The app has to be started at all - `node server.mjs`, with `PACT_URL` naming it
when it is not on `http://localhost:4173` - and it has to be the one holding this
plan file: before writing, the tool reads the app's `/api/plan-file` and refuses
rather than change a different plan. Each write then sends its body through the
app's own route, the route the interface itself uses. So the validation, the
atomic write and the guard against a file changed underneath are the app's, not
a second copy here, and the change is one step back with the Undo control.

After writing, the tool reads the plan back and confirms the record holds what
it asked for. A write the plan does not show exits non-zero and says it did not
land. The preview and that read-back are the proof; a zero exit on its own is
not.

## Seeing what the app shows

Two commands are about neither the plan nor its figures but how the app draws
it. Both read the running app, because the display settings live there.

- `view` prints the View settings - the Zoom and each zoom's Grid spacing, the
  Row height, the overlays, the palette, whether the Stack rail is folded, the
  report's zoom and which of its views is showing, the two sort orders - the
  plan period, Step and sprint cadence they rest on, and the URL the app serves
  on, so a reader knows where to open.
- `view set <key> <value>` changes one of those settings, previews first, and
  needs `--apply` like a plan write. The app's Undo covers the plan and not its
  display, so the preview prints the command that puts the setting back.

Neither touches a plan record, a figure, or anything that deletes.

What `view` prints is what the screen should be drawing, never what it drew.
**Appearance is checked by looking**, and
[Checking how PACT looks](checking-appearance.md) says how: measured, or looked
at, and what to say when neither happened.

## What it will not do

- Delete anything, or take a record out of a plan for good. Nothing here reaches
  the app's deletion.
- Remove a Milestone. It is created and edited; deleting one stays in the app.
- Change a plan with the app closed, or change a plan the app is not holding.
- Change the plan period, the Step or the sprint cadence, or set a View key it
  does not name. The refusal says which control in the app does.
- Tell you what the screen looks like. Only measuring it or looking at it does.

## The commands, in full

The table below is generated from the tool's own list of commands, by
`node bin/pact.mjs --help table`, and a test compares the two so that neither
can change alone. One row per command, in one stated order: the reads that
answer a question, then the writes that change a plan, then the two about how
the app draws it. The Needs column is the difference that matters: a row that
needs the plan file works from a checkout with no app running, and a row that
needs the app is refused when nothing is serving it.

<!-- command-table:begin (generated by node bin/pact.mjs --help table; edit the tool, not this block) -->
| Command                          | What it does                                            | Needs                 |
| -------------------------------- | ------------------------------------------------------- | --------------------- |
| `plan`                           | the plan period, Step, counts and totals                | the plan file         |
| `people`                         | each Person: Capacity, Allocated, Remaining, of offer   | the plan file         |
| `person <name>`                  | one Person, and the Assignments meeting the period      | the plan file         |
| `projects`                       | each Project: Allocated, of plan, of capacity           | the plan file         |
| `project <name>`                 | one Project, and the Assignments meeting the period     | the plan file         |
| `tags`                           | each tag with its FTE-days                              | the plan file         |
| `tag <tag>`                      | one tag by name, or every tag under a tag key           | the plan file         |
| `capacity`                       | Capacity offered against Allocated, per time bucket     | the plan file         |
| `holidays`                       | the holidays as stored, by Location                     | the plan file         |
| `milestones`                     | the Milestones as stored                                | the plan file         |
| `person add <name>`              | create one Person                                       | the app               |
| `project add <name>`             | create one Project                                      | the app               |
| `person copy <name>`             | copy one Person, with no Assignments                    | the app               |
| `project copy <name>`            | copy one Project, with no Assignments                   | the app               |
| `person edit <name>`             | change one Person's fields                              | the app               |
| `project edit <name>`            | change one Project's fields                             | the app               |
| `assignment add <project>`       | create one Assignment                                   | the app               |
| `assignment move <project>`      | reschedule or resize one Assignment                     | the app               |
| `assignment copy <project>`      | duplicate one Assignment                                | the app               |
| `person archive <name>`          | archive one Person                                      | the app               |
| `person restore <name>`          | restore an archived Person                              | the app               |
| `project archive <name>`         | archive one Project                                     | the app               |
| `project restore <name>`         | restore an archived Project                             | the app               |
| `assignment archive <project>`   | archive one Assignment                                  | the app               |
| `assignment restore <project>`   | restore an archived Assignment                          | the app               |
| `holiday add <location> <date>`  | add one holiday date for one Location                   | the app               |
| `holiday remove <location> <date>` | remove one holiday date for one Location                | the app               |
| `milestone add <name>`           | create one Milestone                                    | the app               |
| `milestone edit <name>`          | move or change one Milestone                            | the app               |
| `view`                           | how the app is displaying the plan, and where it serves | the app, reading only |
| `view set <key> <value>`         | change one View setting                                 | the app               |
<!-- command-table:end -->

The options a command takes, the JSON keys its `--json` answer carries, and the
words of every refusal are in `--help`, under the command's own heading.
