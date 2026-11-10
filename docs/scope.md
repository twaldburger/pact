# PACT - scope

Confirmed by the owner on 2026-11-02. The first version is locked except for the interface design, which is still open and will be taken through the frontend-design skill; everything under "later" is deliberately out of it and is not to be built while v1 is unfinished.

## First version

- **People rows** - one row per Person, drawn a full FTE tall, in the order they were added. Each Person's Availability is drawn inside the row as a ceiling line with the unavailable band above it, so an absolute share fills exactly its own height on every row.
- **Person** - name and availability (steps of 10%) required; any number of Person tags and an optional note. No role or skillset field: labels about a person are Person tags.
- **Projects** - Projects with name, colour, tags and notes; add and edit them here. The rail collapses to the left from a control at the right of its header; collapsed, the rail and its list are gone, the timeline and its Person column take the full width, and the same control sits at the left edge at the same height to reopen it. The collapsed state is a view setting for the session only, not written to the plan; while collapsed and filtered, the control shows the number of Projects the filter leaves and the layout stays collapsed.
- **Drag to create** - dragging a Project from the Projects rail onto a Person's row creates an Assignment over a date range.
- **Horizontal drag** - dragging an Assignment's edge changes its start or end date, snapped to whole days with a readout while dragging.
- **Vertical drag** - dragging an Assignment's edge changes its share of the Person's Availability in 10% steps, between 10% and 100%. The same share is set by the plus-and-minus stepper a Person's Availability uses, in the Assignment popover and the New assignment panel, so an Allocation is set by dragging or by stepping, never free-typed.
- **One share per Assignment** - the share holds for the whole range; a change of share, or a gap, is a second Assignment.
- **Assignment extras** - any number of Assignment tags and an optional note.
- **The Marker** - a draggable vertical line on the Timeline, starting on today, with the date it sits on being the date the per-Person totals are read at. Each Person's row header reads their absolute assigned total together with their Availability - "96% of 80%" - with a warning state when the total passes the Availability.
- **Default view** - opens on the past plus the next eleven months at month resolution, with free scrolling in both directions.
- **Tags** - Person tags, Project tags and Assignment tags are separate vocabularies. A new one is typed, or an existing one chosen from the same kind: for a Person, tags already used on other People; for a Project, tags already used on other Projects; for an Assignment, tags already used on that Project's other Assignments. The vocabulary is derived from use and matched case-insensitively. Every element's tags are stored alphabetically, case-insensitive A-Z, so the chips read and the saved array reads the same order. Tags are recorded and shown in v1; grouping and colour-coding by tag are later.
- **Tag display** - a compact marker on the Assignment's rectangle and the Person's row header, with full editing in the Assignment popover and the Person form; the marker is hidden in month zoom, where a rectangle is a few pixels wide.
- **Zoom** - day, week and month views, changing only the drawn width of a day; stored dates stay exact days. Beside the zoom sits a row-height control that changes the drawn height of every row in 8px steps from 32 to 120, defaulting to 48; it is a view setting for the session only, not written to the plan, and returns to its default when the interface reloads.
- **Archive** - a Show archived item in the top bar's Options menu for People, Projects and Assignments, with restore; archived entries are hidden while it is off and cannot take new Assignments until restored.
- **Delete** - a Delete beside Archive in the person panel, the project panel and the assignment popover permanently destroys the record at once, with no confirmation; an Assignment can also be deleted with the Delete key while the pointer is over its block. A deletion needs no prior archive and an archived record can be deleted too; there is no trash, and a deletion is recoverable only through Undo while it remains in the running server's history.
- **Filter** - one field in the top bar that hides everything on the grid not matching a case-insensitive substring, with People, Projects and Assignments all looked in by default and each switchable behind a scope popover that states how many areas are being searched; a matching Project appears in the Projects rail with all of its Assignments, a matching Person with all of their work, and a matching Assignment brings its Person's row and its Project. Typing offers a keyboard-navigable list of the plan's own vocabulary - project names, people's names, Project tags, Assignment tags, Person tags and notes - each labelled with its source and how much it would match, prefix matches first. Row-header figures keep describing the whole plan, the filter is session-only and respects Show archived, and an empty result names what was typed and offers to clear it.
- **Persistence** - every change is written to the JSON file; starting the app loads it. The app keeps no backups of its own: one file, backed up by the owner however they choose.

## The interface

Still to be designed, and deliberately out of the grilling: the interface is to be taken through the `frontend-design` skill, whose first pass is a plan - a four-to-six colour palette with roles, one or two typefaces with roles and a scale, ASCII wireframes of the whole screen, the grid at its zoom states, the assignment popover and the person form, and the principles that make it specific to PACT. That plan goes up as a visual board for review before any code exists; the second pass builds it.

Brief given to that pass: **a calm planning instrument** - the grid is the hero, colour is spent only where it carries meaning, one strong typeface with a tight scale and aligned figures, quiet chrome with no cards and no shadows, and none of the templated looks (dashboard card kits, gradient washes, tracked-out capital labels).

## Later, deliberately not in v1

- Grouping, reporting and colour-coding by tag.
- Public holidays and non-working days.
- Rates and cost, and therefore budget views.
- Reports and exports.
- Forecasting and scenario planning (what if this Project moves).
- Multi-user access and any server-side sharing.
- Import from other planners or spreadsheets.

## Out of scope entirely

- Any hosted or cloud service: PACT runs locally over one file.
