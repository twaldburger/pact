# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how
long, and how much of their time it takes. One row is one Person, and the height
of a block is how much of that person a Project takes. See [GLOSSARY.md](GLOSSARY.md)
and `docs/` for the domain model, scope and decisions.

## Running it

```
node server.mjs
```

That is the whole of the setup: no install, no build, no dependency. The server
prints the URL it is serving on, by default <http://localhost:4173>. It serves
`public/` and keeps the plan in `data/pact.json`, which is created on first run
from a small seeded plan - the three people and four projects the design used,
with Ben over-committed. That seed is convenience data so the screen is not
empty on a fresh checkout; it is not part of the repository and is written once,
on the first run, only if the file is missing.

Set `PORT` to serve elsewhere and `PACT_DATA` to keep the plan file elsewhere.

## The plan file

`data/pact.json` is the single source of truth. It is written as it changes, and
reloading the page shows what was saved. Every write is atomic: the new plan is
written to a temporary file, flushed, then renamed over the old one, so an
interrupted save cannot truncate the plan. A request that would store invalid
data is refused with a clear error and nothing is written. The app keeps no
backups of its own - one file, backed up however you choose.

## The interface

Plain HTML, CSS and JavaScript with no framework, no bundler, no build step and
no runtime dependency.

- `public/index.html` - the shell.
- `public/style.css` - the whole token set (palette, type, sizes, durations) as
  CSS custom properties at the top, then the layout: the Stack rail, the sticky
  row-header column and the timeline grid.
- `public/app.js` - loads the plan from `/api/plan`, draws the calendar bands,
  rows, ceiling lines and blocks, runs the Marker, and sends every change back.
- `public/lib/panels.mjs` - the panel rules that are not about the DOM: the tag
  suggestion lists, Availability stepping and refusal wording. Imported by
  `app.js` and by `node --test`.
- `public/fonts/` - the bundled Archivo variable font and its OFL licence.

The three zoom states (day, week, month) change only the drawn width of a day.
Beside the zoom, a row-height control changes the drawn height of every row in
8px steps from 32 to 120, defaulting to 56; it is a view setting for the
session only and is not written to the plan.

What the screen can change: drag a Project from the Stack onto a Person's row to
create an Assignment there - a ghost block shows the extent it would create and
the dates it would take, and the row under the pointer stays highlighted; or
draw across a Person's empty row space to select a range, which opens a New
assignment panel with the dates read back, a project to choose, tags and a note.
Drag an Assignment's body to move it in time and onto another Person, keeping
its Allocation, tags and note; drag its left or right edge horizontally to
change its start or end date, snapped to whole days; drag an edge vertically to
change its Allocation in 10% steps. Every drag shows the value being set; the
same Allocation is chosen from a menu of the ten values in the Assignment
popover and the New assignment panel, so it is set by dragging or by choosing a
step, never free-typed.
Over-allocation is allowed and drawn: the part of a block above the Person's
Availability line is hatched in the signal colour, and the row header's
`assigned/availability` figure turns to that colour.

People and Projects are edited in place. A Person carries a name, an
Availability in steps of 10%, any number of Person tags and an optional note; a
Project carries a name, one of the six project inks and notes. An Assignment's
popover edits its Allocation, Assignment tags and note, and offers archiving;
its dates are set by dragging, never typed. A Person's Person tags are suggested
from other People and an Assignment's tags from that Project's other
Assignments, because the two vocabularies are separate.

Archiving a Person or a Project keeps every Assignment and takes it out of the
plan. The `Show archived` toggle reveals archived People and Projects in their
lists, marked as archived, each with a Restore button. An archived Person cannot
take a new Assignment: a drop onto one is refused with a message until the
Person is restored.

## The API

The server exposes a small JSON API over the plan:

- `GET /api/plan` - the live plan, with the current date as `today`.
  `GET /api/plan?archived=1` also includes archived People and Projects, so the
  archive view can draw and restore them.
- `POST /api/people`, `POST /api/projects`, `POST /api/assignments` - create.
- `PATCH /api/people/:id`, `PATCH /api/projects/:id`,
  `PATCH /api/assignments/:id` - update. A Person or Project patch may set
  `"archived": false` to restore it.
- `DELETE /api/people/:id`, `DELETE /api/projects/:id`,
  `DELETE /api/assignments/:id` - archive. The record and every Assignment that
  referenced it stay in the file, marked `archived`, and disappear from the
  plan the interface draws; nothing is destroyed. The response is
  `{"archived": "<id>"}`.

Invalid input answers `400` with `{"error": "..."}`; an unknown record answers
`404`.

## Tests

```
node --test
```

Node's built-in test runner, no dependency. The tests under `test/` cover the
API's create, update, archive and restore paths, the atomic write (including
that a failed write leaves the previous file intact), the refusal of invalid
input, and the panel rules in `public/lib/panels.mjs` - tag suggestions,
Availability and Allocation stepping and refusal wording. The Timeline geometry
in `public/lib/timeline.mjs` - drawn ranges, drops, moves and the row-height
steps - is covered without a browser.

## The font

Archivo is bundled under the SIL Open Font License, which permits it. The Latin
subset in `public/fonts/archivo-variable.woff2` carries both the weight and the
width axes. `public/fonts/OFL.txt` records the upstream source and reproduces
the licence. The CSS falls back to `Archivo, "Helvetica Neue", Arial, system-ui,
sans-serif`, so the page still reads if the file is missing.
