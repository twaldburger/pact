# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how
long, and how much of their time it takes. One row is one Person, and the height
of a block is how much of that person a Project takes.

## Running it

```
node server.mjs
```

That is the whole of the setup: no install, no build, no dependency. The server
prints the URL it is serving on, by default <http://localhost:4173>, and opens
on a small seeded plan so the screen is not empty. The plan is one JSON file,
`data/default.pact.json`, created on first run from that seed and written as it
changes. That seed is convenience data for the design, and so is the plan behind
the screenshots in this repository's issues and pull requests: neither uses
anyone's real colleagues, clients or engagements.

## What it does

- **A plan of people's time.** Every Project sits on a Person's row for its
  dates, its height the share of that person it takes, over one timeline.
- **Capacity against demand.** Each row reads allocation against what a person
  offers, so an over-committed plan says so before the work is promised. The
  excess is hatched above the line, never hidden.
- **Figures that count working days.** Weekends, a Location's holidays and a
  person's absences come off first: a figure is
  [time worked](GLOSSARY.md#working-day), not time elapsed.
- **Dates that mean something.** [Milestones](docs/features.md#milestones) are
  dated points drawn as rules through the rows; no total counts them.
- **A vocabulary to slice by.** Tags on People, Projects, Assignments and
  Milestones, [typed](docs/features.md#tags-typed-tags-and-colour-by-key) as
  `api: Stellar` where a key helps, read the plan by client or capability.
- **The report reads the plan.** Its seven [views](docs/features.md#the-report)
  give the same period in FTE-days by project, person and tag, as totals, as
  shares, and as a chart of allocation against capacity.
- **Changes cheap to take back.** Undo steps through the last 100 changes, and
  the save status reads Saved, Saving... or Not saved.
- **One file, and no lock-in.** The plan is one
  [JSON file](docs/features.md#the-plan-and-its-file), written atomically and
  readable by anything; `bin/pact.mjs` reads it too, for a person or an agent.

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

## Licence

MIT, 2026 twaldburger - see [LICENSE](LICENSE).
