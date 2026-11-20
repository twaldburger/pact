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

- **A plan of people's time.** Every Project sits on a Person's row for its
  dates, its height the share of that person it takes, over one timeline.
- **Capacity against demand.** Each row reads an Allocation against what its
  Person offers, so an over-committed plan says so before the work is promised,
  the excess hatched above the line rather than hidden.
- **Figures that count working time.** Weekends, each Location's holidays and
  each Person's Absences come off first, so a figure is
  [time worked](GLOSSARY.md#working-day) rather than time elapsed, and a
  full-time working day is an [FTE-day](GLOSSARY.md#fte-day).
- **Milestones.** A delivery, a deployment or a deadline, drawn as a rule through
  the rows at its own date; no total counts them.
- **A vocabulary to read it by.** [Typed tags](GLOSSARY.md#typed-tag) on People,
  Projects, Assignments and Milestones - `api: Stellar` beside `api: Nova` - so
  the plan reads by client, team or capability.
- **A report of the same numbers.** [Seven views](docs/features.md#the-report) of
  one period: FTE-days by project, person and tag, as totals and as shares of
  what the plan offers, and Allocation against capacity as a chart.
- **Changes that are cheap to take back.** Undo steps through the last hundred
  changes, and the save status says whether the current one has landed.
- **One file you own.** The plan is a single
  [JSON file](docs/features.md#the-plan-and-its-file), written atomically and
  readable by anything; `bin/pact.mjs` reads it too, for a person at a terminal
  or for an agent.

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
