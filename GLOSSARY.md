# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how long, and how much of their time it takes.

## Language

**Person**:
Someone whose time the plan schedules, identified by a name and carrying an optional Location, an Availability, any number of Person tags, and an optional note. The individual; the Timeline's row-header column that holds them is headed People.
_Avoid_: resource, user, employee, staff member

**Availability**:
The most a Person can be scheduled for - their own 100%, expressed as a share of a full working week. Allocations are absolute, so Availability is the ceiling they are compared against rather than the scale they are measured on.
_Avoid_: capacity, part-time factor, utilisation limit

**Location**:
The one free-text place a Person is at, for grouping and filtering people later. It is optional and single-valued: a new one can be typed, or one already in use on another Person chosen, matched case-insensitively with the first spelling winning. It is deliberately not a fixed country list, and nothing on the grid draws it.
_Avoid_: office, site, city, country, timezone, or region

**Person tag**:
A short free-text label on a Person, for grouping and filtering people later. A new one can be typed, or one already in use on another Person chosen; people's tags and assignments' tags are separate lists.
_Avoid_: skill, role, attribute, capability, or an unqualified "tag"

**Assignment tag**:
A short free-text label on an Assignment, for grouping and filtering work later. A new one can be typed, or one already used on that Project's other Assignments chosen; assignments' tags and people's tags are separate lists.
_Avoid_: label, keyword, category, or an unqualified "tag"

**Capacity**:
The total time a Person offers, which their Availability expresses as a share of a full working week - so an 80% Availability is 0.8 FTE of Capacity.
_Avoid_: bandwidth, headcount, utilisation

**FTE**:
A full working week of one Person; Availability and Capacity are spoken of in it when a share alone would be ambiguous.
_Avoid_: full-time equivalent, heads

**Allocation**:
The share of a full working week that one Assignment takes, set in steps of 10%. It is absolute: 60% is 0.6 FTE whether the Person is 100% or 80% available, which is what makes FTE-days add up across People and Projects.
_Avoid_: booking, commitment, effort, load, relative share

**Over-allocation**:
The state of a Person on a day whose Allocations add up to more than their Capacity; it is allowed, and the day is flagged.
_Avoid_: overload, conflict, double-booking

**Project**:
A body of work that Assignments place onto People; it carries a name and a colour, and exists independently of any Person.
_Avoid_: engagement, job, client, ticket

**Assignment**:
One Project placed on one Person for a continuous date range at an Allocation - the rectangle drawn on the Timeline. A change of share or a gap means a second Assignment. It carries any number of Assignment tags and an optional note.
_Avoid_: booking, block, slot, shift, work

**Stack**:
The list of Projects available to drag onto the Timeline; it holds no dates of its own. The interface labels this rail Projects.
_Avoid_: backlog, pool

**Timeline**:
The horizontal axis of the plan - a date range drawn at a chosen Zoom, with one row per Person.
_Avoid_: gantt, grid, chart, schedule

**Plan period**:
The plan's extent: an explicit start date and end date the owner sets, both inclusive, which the Timeline draws and every Assignment must fall inside.
It is the extent itself, not a view setting, and the app never derives or grows it.
_Avoid_: range, timeframe, window, horizon

**Marker**:
The draggable vertical line on the Timeline. It starts on today, and the date it sits on is the date the per-Person totals are read at.
_Avoid_: today line, now line, cursor, playhead, reference line

**Zoom**:
The drawn width of one day. It changes what you see and never what is stored: dates are always exact days.
_Avoid_: granularity, resolution, scale

**Archive**:
To take a Person or a Project out of the Stack and the Timeline while keeping every Assignment it ever had; an archived item can be restored.
_Avoid_: delete, remove, hide, deactivate

**Delete**:
To permanently destroy a Person, a Project or an Assignment; deleting a Person or a Project destroys the Assignments that referenced it too, archived ones included. It is a different act from archiving, which keeps everything and can be restored, and neither is a precondition for the other. The confirmation names the number of Assignments a Person or a Project will take with it before it happens. There is no trash, but a deletion stays recoverable through Undo for as long as the running server's history holds it.
_Avoid_: remove, purge, destroy, hide

**Undo**:
To step the plan back one change at a time, and Redo to step forward again, from two controls in the top bar. Every change is one step - a move, a reassign or a resize, a panel save, a create, an archive, a delete, a restore or a Plan period change - because each is one write, and a delete it reverses brings the record and its Assignments back. Its history is the last 100 changes, held in the running server's memory: it survives a page reload and is lost when the server restarts. Nothing about it is written to disk.
_Avoid_: revert, roll back, history, snapshot

**Filter**:
The one piece of text that hides everything on the grid that does not match it, as a case-insensitive substring. A plain term is read through the Look in scope, across the People, Projects and Assignments it is set to look in; a single `field: value` term names the field it searches and ignores that scope, as in `person tag:architect`, `people: tim` or `project notes: delayed`. A match carries what belongs to it - a matching Project brings all of its Assignments, a matching Person all of their work, and a matching Assignment its Person's row and its Project. It is session-only and respects Show archived.
_Avoid_: search, find, search bar, query
