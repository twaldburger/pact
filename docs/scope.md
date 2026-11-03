# PACT - scope

Confirmed by the owner on 2026-11-02. The first version is locked except for the interface design, which is still open and will be taken through the frontend-design skill; everything under "later" is deliberately out of it and is not to be built while v1 is unfinished.

## First version

- **People rows** - one row per Person, drawn a full FTE tall, in the order they were added. Each Person's Availability is drawn inside the row as a ceiling line with the unavailable band above it, so an absolute share fills exactly its own height on every row.
- **Person** - name and availability (steps of 10%) required; any number of Person tags and an optional note. No role or skillset field: labels about a person are Person tags.
- **Project stack** - Projects with name, colour and notes; add and edit them here.
- **Drag to create** - dragging a Project from the stack onto a Person's row creates an Assignment over a date range.
- **Horizontal drag** - dragging an Assignment's edge changes its start or end date, snapped to whole days with a readout while dragging.
- **Vertical drag** - dragging an Assignment's edge changes its share of the Person's Availability in 10% steps, between 10% and 100%. The same share is chosen from a menu of the ten values in the Assignment popover and the New assignment panel, so an Allocation is set by dragging or by choosing a step, never free-typed.
- **One share per Assignment** - the share holds for the whole range; a change of share, or a gap, is a second Assignment.
- **Assignment extras** - any number of Assignment tags and an optional note.
- **The Marker** - a draggable vertical line on the Timeline, starting on today, with the date it sits on being the date the per-Person totals are read at. Each Person's row header reads their absolute assigned total together with their Availability - "96% of 80%" - with a warning state when the total passes the Availability.
- **Default view** - opens on the past plus the next eleven months at month resolution, with free scrolling in both directions.
- **Tags** - Person tags and Assignment tags are separate vocabularies. A new one is typed, or an existing one chosen from the same kind: for a Person, tags already used on other People; for an Assignment, tags already used on that Project's other Assignments. The vocabulary is derived from use and matched case-insensitively. Tags are recorded and shown in v1; grouping, filtering and colour-coding by tag are later.
- **Tag display** - a compact marker on the Assignment's rectangle and the Person's row header, with full editing in the Assignment popover and the Person form; the marker is hidden in month zoom, where a rectangle is a few pixels wide.
- **Zoom** - day, week and month views, changing only the drawn width of a day; stored dates stay exact days. Beside the zoom sits a row-height control that changes the drawn height of every row in 8px steps from 32 to 120, defaulting to 56; it is a view setting for the session only, not written to the plan, and returns to its default when the interface reloads.
- **Archive** - a Show archived toggle for People, Projects and Assignments, with restore; archived entries are hidden while it is off and cannot take new Assignments until restored.
- **Persistence** - every change is written to the JSON file; starting the app loads it. The app keeps no backups of its own: one file, backed up by the owner however they choose.

## The interface

Still to be designed, and deliberately out of the grilling: the interface is to be taken through the `frontend-design` skill, whose first pass is a plan - a four-to-six colour palette with roles, one or two typefaces with roles and a scale, ASCII wireframes of the whole screen, the grid at its zoom states, the assignment popover and the person form, and the principles that make it specific to PACT. That plan goes up as a visual board for review before any code exists; the second pass builds it.

Brief given to that pass: **a calm planning instrument** - the grid is the hero, colour is spent only where it carries meaning, one strong typeface with a tight scale and aligned figures, quiet chrome with no cards and no shadows, and none of the templated looks (dashboard card kits, gradient washes, tracked-out capital labels).

## Later, deliberately not in v1

- Filtering the grid by Person, Project, Person tag or Assignment tag.
- Grouping, reporting and colour-coding by tag.
- Public holidays and non-working days.
- Rates and cost, and therefore budget views.
- Reports and exports.
- Forecasting and scenario planning (what if this Project moves).
- Multi-user access and any server-side sharing.
- Import from other planners or spreadsheets.
- A deliberate purge of archived data.

## Out of scope entirely

- Any hosted or cloud service: PACT runs locally over one file.
