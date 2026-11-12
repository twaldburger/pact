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
changes. `PORT` serves elsewhere, and `PACT_DATA` keeps the plan file elsewhere.

## What it does

One board: a column of People down the left, a Timeline of days across, and the
Projects rail down the side, which folds away from the chevron in its header.

- **Assignments.** Drag a Project from the rail onto a Person's row to create
  one, or draw across an empty row space. Drag a block's body to move it in time
  and onto another person, its ends to change its dates, or an end vertically to
  change its Allocation in the plan's step. Every drag shows the value it is
  setting. Over-allocation is allowed and drawn: the part of a block above the
  person's Availability line is hatched, and the row header's
  `assigned/availability` figure turns to the signal colour.
- **People and Projects.** A Person carries a name, an optional Location, an
  Availability, any number of Person tags and a note; a Project carries a name,
  a colour, any number of Project tags and notes. Tags are typed or picked from
  the ones already in use - each vocabulary its own - and suggested as you type.
  Archiving keeps every Assignment and takes a record out of the plan, with a
  Show archived view to bring it back; deleting is permanent and takes its
  Assignments with it. Both sit in the panels, and an Assignment can also be
  deleted with the Delete key over its block.
- **Filter.** One field hides everything on the grid that does not match. By
  default it looks in People, Projects and Assignments, and a scope control
  states how many areas it is searching and switches each. A plain term is a
  case-insensitive substring; a `field: value` term names one field, as in
  `person tag:architect` or `project notes: delayed`. Typing offers the plan's
  own vocabulary as keyboard-navigable suggestions, each labelled with how much
  it would match.
- **Zoom and spacing.** Day, Week, Sprint and Month change only what the grid
  draws, never the stored dates. Each keeps its own day width, moved by the
  grid-spacing stepper; the row-height stepper sizes the rows. Sprint draws a
  sprint cadence defined in a panel from the Options menu - a first start, a
  length and a naming rule - and is disabled until one exists.
- **Instruments.** A draggable Marker reads each person's totals at its date.
  Today scrolls back to it. The Minimap, off by default, is an overview strip of
  the whole period that doubles as a scrollbar. The two lists can each be sorted
  by name, dates, location or load, as display order only.
- **Display toggles.** Highlight weekends, Grid dividers and the Minimap sit in
  the Options menu; the Colour palette group switches the block fills between
  Paired and Set3.
- **Undo and redo.** Two controls step the plan back and forward one change at a
  time, the last 100 changes held in the running server's memory. The save
  status beside the wordmark reads Saved, Saving... or Not saved as writes land.
- **The plan itself.** An explicit start and end date, set together under
  Options, is the plan's extent, and nothing grows it on its own. Beside it, the
  percentage step (1 to 100, default 10) governs every Availability and
  Allocation stepper and drag. The `Plan file...` entry chooses the active JSON
  file, the view settings are kept in `data/config.json`, and `Reset view`
  returns them to their defaults.

## Tests

```
node --test
```

Node's built-in test runner, no dependency. The suite covers the API and the
atomic write, the plan-file and config rules, and the pure rules behind the
grid, the filter, the panels, sorting and the view state.

## Docs

- [`GLOSSARY.md`](GLOSSARY.md) - the domain model and its language.
- [`docs/scope.md`](docs/scope.md) - what the first version covers.
- [`docs/adr/`](docs/adr) - the decisions behind it.

## Licence

MIT, 2026 twaldburger - see [LICENSE](LICENSE).
