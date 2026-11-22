# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how
long, and how much of their time it takes. One row is one Person, and the height
of a block is how much of that person a Project takes.

It answers one question: **can the people we have do the work we have taken on,
and when does that stop being true?** A plan like that usually lives in a
spreadsheet, gets updated by hand, and loses its authority the first time a
holiday or a new starter is missed. PACT keeps it as a picture of people against
time and does the arithmetic as the plan changes, so the answer is there while
the work is still being promised rather than a quarter after it was.

## Running it

```
node server.mjs
```

Node 20 or later is the only requirement; beyond that there is nothing to
install, no build step and no dependency. The server prints the URL it serves on,
<http://localhost:4173> by default, and starts from a small seeded plan so the
screen is not empty. The plan is one JSON file, `data/default.pact.json`, created
on first run and written as it changes.

That seed is convenience data for the design, and so is the plan behind the
screenshots in this repository's issues and pull requests: neither uses anyone's
real colleagues, clients or engagements.

## What it does

The board is the plan. People run down the left, the days of the plan run across,
and the Projects sit in a rail at the side that folds away when a full width of
days is more useful than the list. Read across a row and you are reading one
person's time.

- **A plan of people's time.** An Assignment puts a Project on one Person's row
  for a set of dates, and the block's height is the share of that person it
  takes. Two Assignments over the same dates commit that person twice over, and
  the board shows that rather than refusing it.
- **Capacity against demand.** Every Person has an Availability - the most they
  can be scheduled for, their own 100% - and each row sets what is asked of them
  against it. Over-allocation is allowed and drawn: the part of a block above the
  Availability line is hatched, so a plan that asks too much of someone says so
  while the work is being promised rather than when it arrives.
- **Figures that count working time.** A
  [working day](GLOSSARY.md#working-day) is a day the person is actually there, so
  weekends, the public holidays configured for their Location and their Absences
  come off before anything is counted. A figure is therefore time worked rather
  than time elapsed, and a full-time working day is an
  [FTE-day](GLOSSARY.md#fte-day) - the unit every total, share and report is
  expressed in.
- **Milestones.** A delivery, a deployment or a deadline is a dated point in the
  plan, drawn as a rule through the rows in its own colour and naming itself in
  the axis band. No total counts one: a Milestone marks the plan rather than
  changing it.
- **A vocabulary to read it by.** Tags label People, Projects, Assignments and
  Milestones, and any of them can be
  [typed](GLOSSARY.md#typed-tag) as `api: Stellar` beside `api: Nova`, so one key
  holds a family of values and the plan can be read by client, team or capability
  instead of one project at a time. The Filter narrows the board to whatever
  matches a word, or a named field when a word is not precise enough.
- **A report of the same numbers.** [Seven views](docs/features.md#the-report) of
  a single period: the FTE-days each project, person or tag takes; the same work
  as a share of what the plan offers; and Allocation against capacity, drawn as a
  chart. The report reads the plan rather than re-deriving it, so its figures and
  the board's cannot disagree.
- **Changes that are cheap to take back.** Undo steps through the last hundred
  changes and the save status says whether the current one has reached the file,
  so trying a plan out costs nothing and a wrong turn is one step back.
- **One file you own.** The plan is a single
  [JSON file](docs/features.md#the-plan-and-its-file), written atomically and
  readable by anything - version it, copy it, diff it, or open it in an editor.

## Working with an agent

PACT is meant to be read by a colleague's agent as well as by the colleague.

- **[`AGENTS.md`](AGENTS.md) is a map, not a manual**: it says where each answer
  lives, and answers nothing itself, so it cannot drift from the documents it
  points at.
- **The documents can be quoted.** The feature reference gives one section per
  capability, each ending in where its controls live, and the glossary gives each
  term one entry with the words to avoid. A test fails when a capability in the
  app has no section, so neither document can quietly fall behind the code.
- **The numbers are computable.** `bin/pact.mjs` reads the plan file and prints
  the same figures the report draws - FTE-days by project, person or tag, and
  allocation against capacity - so an agent can answer *who is over capacity in
  March* without a browser, and without adding anything up itself. The two list
  reads narrow as they read - `people --location Berlin --over`,
  `projects --tag api --top 3` - and a narrowed answer prints the filter it
  applied and "Matched 2 of 14 People", so a short list is never mistaken for
  the plan. The options are named terms, one flag each, with no expression to
  parse and no operator to get subtly wrong. Its writes
  create a Person, a Project or an Assignment, reschedule and resize one,
  archive and restore any of the three, add or remove one holiday date for
  one Location, and create or move a Milestone, and only through the running
  app: the preview comes first,
  nothing is written without `--apply`, and each change is one the person at the
  screen can step back with Undo. Archiving is how an agent takes work out of a
  plan and puts it back, and it never deletes anything: a holiday date is one
  plan setting rather than a record, and a permanent deletion stays in the app;
  a Milestone can be created and moved but never removed, since it has no
  archived state.
- **Nothing is hidden behind the interface.** A question the documents do not
  answer is a documentation bug, and the repository is written to be read: the
  plan is one file, the rules behind it are plain modules, and the tests that
  hold them together run with one command.

## Tests

```
node --test
```

Node's built-in test runner, no dependency. The suite covers the API and the
atomic write, the plan-file and config rules, and the pure rules behind the
grid, the filter, the panels, sorting and the view state.

## Docs

- [`GLOSSARY.md`](GLOSSARY.md) - the domain model and its language.
- [`docs/features.md`](docs/features.md) - what each capability does, how it
  behaves and where its controls live.
- [`docs/index.md`](docs/index.md) - every page under `docs/`, with what it is
  for.
- [`docs/scope.md`](docs/scope.md) - what the first version covers.
- [`docs/adr/`](docs/adr) - the decisions behind it.
- [`AGENTS.md`](AGENTS.md) - the map for an agent working in this repository.

## Licence

MIT, 2026 twaldburger - see [LICENSE](LICENSE).
