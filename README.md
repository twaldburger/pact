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

The zoom states (day, week, sprint, month) change only what the calendar draws
and never the stored dates. Sprint shares the week's density and names the
derived sprint chain in its secondary band, and its button is disabled until
the plan holds a sprint cadence.
Beside the zoom, a row-height control changes the drawn height of every row in
8px steps from 32 to 120, defaulting to 48; it is a view setting for the
session only and is not written to the plan. A Today control scrolls the view
so today is visible again and moves the Marker back onto today, and the range
label beside the wordmark names the plan's own extent. The bar is two zones:
the wordmark and range on the left, and on the right the Filter, Zoom, Row
height and Today controls in that order, then the Options menu that holds the
less frequent controls.

The Stack rail collapses to the left from a small chevron control at the right
of its header. Collapsed, the rail and its list are gone and the timeline, with
its Person column, takes the whole board; the same control sits at the left
edge at the same height to bring the rail back, and the Person column keeps its
width. The state is a view setting for the session only, like Zoom and Row
height, and is not written to the plan. While the rail is collapsed and the
Filter is active, the control carries the number of Projects the filter leaves;
the layout stays collapsed. It is a normal button, toggled by click, Enter or
Space, with no global shortcut.

The Stack (Projects) and the People rows can each be ordered by something other
than the order they were added. A small control in each column's header, beside
its title, offers that list's keys and an ascending/descending toggle. Projects
sort by name, first assignment start, last assignment end or total assigned FTE
days - the sum over a project's assignments of `share/100 * inclusive days` -
and People by name, free capacity at the Marker, load at the Marker or
earliest assignment. The default is the order they were added, and ties break
by name. Ordering is
display order only: it is session-only like Zoom and Row height, it never
changes the plan file, and the Filter only changes which rows are shown. A load
or free-capacity order reads the Marker's date when it is applied and when the
Marker is released, never while the Marker is dragged.

The plan's date range is an explicit period the owner sets, not one the app
infers. The Options menu in the top bar carries the plan period control: a
start date and an end date, each a specific `YYYY-MM-DD` day, applied together
and stored in the plan file like any other change. The range label beside the
wordmark reads that period back. Nothing grows or recomputes the extent on its
own, so an Assignment dragged or created outside the period is refused with a
message naming the allowed period, with both ends inclusive. When the period
excludes today the Today control is disabled - it stays labelled and reachable
but does nothing - until the period includes today again. A plan file written
before the period was made explicit keeps its stored range and loads as it is;
any Assignment already outside it is drawn only as far as the axis reaches.

Beside the period control, the Options menu carries the percentage step: one
whole-number field from 1 to 100 and its own Apply, so a half-typed value never
re-steps the plan. The step is plan data, stored beside the period and
defaulting to 10 when absent, and that one value governs both a Person's
Availability and an Assignment's Allocation - the steppers, the panels and the
vertical drag all move by it, and the floor is one step, so a 10% step floors
at 10% exactly as before. The server never enforces the step: it accepts any
whole number from 1 to 100, so changing the step leaves every stored value
exactly as it was, never re-snapped or rewritten.

What the screen can change: drag a Project from the Stack onto a Person's row to
create an Assignment there - a ghost block shows the extent it would create and
the dates it would take, and the row under the pointer stays highlighted; or
draw across a Person's empty row space to select a range, which opens a New
assignment panel with the dates read back, a project to choose, tags and a note.
Drag an Assignment's body to move it in time and onto another Person, keeping
its Allocation, tags and note; drag its left or right edge horizontally to
change its start or end date, snapped to whole days; drag an edge vertically to
change its Allocation in the plan's step. Every drag shows the value being set; the
same Allocation is set by the plus-and-minus stepper a Person's Availability
uses, in the Assignment popover and the New assignment panel, so it is set by
dragging or by stepping, never free-typed.
Over-allocation is allowed and drawn: the part of a block above the Person's
Availability line is hatched in the signal colour, and the row header's
`assigned/availability` figure turns to that colour.

People and Projects are edited in place. A Person carries a name, an
Availability stepped by the plan's percentage step, any number of Person tags
and an optional note; a Project carries a name, a colour slot into the active
ten-colour palette, any number of Project tags, and notes. The `Colour palette` group in the Options menu switches between the two
ColorBrewer schemes, Paired and Set3, for the session only; label ink on a
block is chosen per fill so it stays legible either way. An Assignment's
popover edits its Allocation, Assignment tags and note, and offers archiving;
its dates are set by dragging, never typed. A Person's Person tags are suggested
from other People, a Project's Project tags from other Projects, and an
Assignment's tags from that Project's other Assignments, because the three
vocabularies are separate.

Archiving a Person or a Project keeps every Assignment and takes it out of the
plan. The `Show archived` item in the top bar's Options menu reveals archived
People and Projects in their lists, marked as archived, each with a Restore
button. An archived Person cannot
take a new Assignment: a drop onto one is refused with a message until the
Person is restored.

Deleting is a separate, permanent act. A Delete button sits beside Archive in
the person panel, the project panel and the assignment popover, and beside
Restore on an archived entry; it acts at once, with no confirmation. Deleting a
Person or a Project takes every Assignment that referenced it, archived ones
included, and an Assignment can also be deleted with the Delete key while the
pointer is over its block. A deletion needs no prior archive and an archived
record can be deleted too; there is no trash, and a deletion is recoverable
only through Undo while the running server's history holds it.

The two controls beside the Options button step the plan back and forward one
change at a time, each disabled at the end of its stack. The history is the
last 100 changes, held in the running server's memory: it survives a page
reload and is lost when the server restarts, and nothing about it is written
to disk.

## The API

The server exposes a small JSON API over the plan:

- `GET /api/plan` - the live plan, with the current date as `today`.
  `GET /api/plan?archived=1` also includes archived People and Projects, so the
  archive view can draw and restore them.
- `PATCH /api/plan` - set the plan's period or its percentage step. For the
  period the body is `{"start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}`; both ends
  must be valid dates with the start not after the end, and the response is the
  stored `{"start": "...", "end": "..."}`. This is the one write that changes
  the range. For the step the body is `{"step": 5}`, a whole number from 1 to
  100; the response is the stored `{"step": 5}`. The two are set separately,
  and the step never rewrites a stored Availability or Share.
- `POST /api/people`, `POST /api/projects`, `POST /api/assignments` - create.
- `PATCH /api/people/:id`, `PATCH /api/projects/:id`,
  `PATCH /api/assignments/:id` - update. A Person or Project patch may set
  `"archived": false` to restore it.
- `DELETE /api/people/:id`, `DELETE /api/projects/:id`,
  `DELETE /api/assignments/:id` - archive. The record and every Assignment that
  referenced it stay in the file, marked `archived`, and disappear from the
  plan the interface draws; nothing is destroyed. The response is
  `{"archived": "<id>"}`.
- `DELETE /api/people/:id/destroy`, `DELETE /api/projects/:id/destroy`,
  `DELETE /api/assignments/:id/destroy` - delete permanently. A Person or a
  Project takes its Assignments with it, archived ones included; an Assignment
  removes only itself. The response is `{"deleted": "<id>", "assignments": <n>}`,
  where `n` is the number of Assignments removed.
- `POST /api/undo`, `POST /api/redo` - step one change back or forward through
  the running server's in-memory history, and answer `{"undone": true}` or
  `{"redone": true}`. An empty stack answers `400`.

Invalid input answers `400` with `{"error": "..."}`; an unknown record answers
`404`.

## Tests

```
node --test
```

Node's built-in test runner, no dependency. The tests under `test/` cover the
API's create, update, archive, restore and delete paths, the atomic write (including
that a failed write leaves the previous file intact), the refusal of invalid
input, and the panel rules in `public/lib/panels.mjs` - tag suggestions,
Availability and Allocation stepping by the plan's percentage step, the period
and step controls' validation and refusal wording. Setting the plan's period
and step, the whole 1..100 acceptance of Availability and Share, and the
refusal of work outside the period, are pinned against the store and the API. The Timeline geometry
in `public/lib/timeline.mjs` - drawn ranges, drops, moves and the row-height
steps - is covered without a browser, as is the block-label rule in
`public/lib/label.mjs` - how much of a title a block has room to draw - and its
range label. The collapsible Stack's session rules in `public/lib/stack.mjs` -
the toggle's name and announced state, the collapsed match count and the fact
that the collapsed state is never written to the plan - are pinned the same
way.

## The font

Archivo is bundled under the SIL Open Font License, which permits it. The Latin
subset in `public/fonts/archivo-variable.woff2` carries both the weight and the
width axes. `public/fonts/OFL.txt` records the upstream source and reproduces
the licence. The CSS falls back to `Archivo, "Helvetica Neue", Arial, system-ui,
sans-serif`, so the page still reads if the file is missing.
