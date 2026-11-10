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
A short free-text label on a Person, for grouping and filtering people later. A new one can be typed, or one already in use on another Person chosen; people's tags, projects' tags and assignments' tags are separate lists.
_Avoid_: skill, role, attribute, capability, or an unqualified "tag"

**Assignment tag**:
A short free-text label on an Assignment, for grouping and filtering work later. A new one can be typed, or one already used on that Project's other Assignments chosen; assignments' tags, people's tags and projects' tags are separate lists.
_Avoid_: label, keyword, category, or an unqualified "tag"

**Project tag**:
A short free-text label on a Project, for grouping and filtering projects later. A new one can be typed, or one already in use on another Project chosen; projects' tags, people's tags and assignments' tags are separate lists.
_Avoid_: label, keyword, category, or an unqualified "tag"

**Capacity**:
The total time a Person offers, which their Availability expresses as a share of a full working week - so an 80% Availability is 0.8 FTE of Capacity.
_Avoid_: bandwidth, headcount, utilisation

**FTE**:
A full working week of one Person; Availability and Capacity are spoken of in it when a share alone would be ambiguous.
_Avoid_: full-time equivalent, heads

**Allocation**:
The share of a full working week that one Assignment takes, set in the plan's Step. It is absolute: 60% is 0.6 FTE whether the Person is 100% or 80% available, which is what makes FTE-days add up across People and Projects.
_Avoid_: booking, commitment, effort, load, relative share

**Over-allocation**:
The state of a Person on a day whose Allocations add up to more than their Capacity; it is allowed, and the day is flagged.
_Avoid_: overload, conflict, double-booking

**Project**:
A body of work that Assignments place onto People; it carries a name, a colour, any number of Project tags and an optional note, and exists independently of any Person.
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

**Step**:
The plan's granularity for Availability and Allocation: one whole number of per cent from 1 to 100, stored in the plan beside its period and defaulting to 10 when absent. One step is also the floor, and the ceiling stays 100, so a 10% step floors at 10% and a 1% step at 1%. The interface snaps its steppers, panels and vertical drag by it; the server never enforces it, so changing the step leaves every stored value exactly as it was.
_Avoid_: increments, resolution, granularity

**Marker**:
The draggable vertical line on the Timeline. It starts on today, and the date it sits on is the date the per-Person totals are read at.
_Avoid_: today line, now line, cursor, playhead, reference line

**Minimap**:
An overview strip of the Timeline, off by default and turned on under the Options glyph, fixed at the board's bottom-right. Its height is how much of the shown rows' available capacity is used on each day rather than an absolute assigned share, and a day past full is over-allocation, drawn at the top of that scale in the signal colour. It follows the Filter and Show archived as the grid does and shows an empty map when the Filter leaves nothing, and it highlights the stretch of the period the grid currently shows, which can be dragged - or the strip clicked - to scroll the Timeline. It is session-only, exactly like Zoom and Row height, and is independent of the collapsible Stack.
_Avoid_: overview, thumbnail, mini-chart, density chart

**Zoom**:
The drawn width of one day. It changes what you see and never what is stored: dates are always exact days. There are four levels - Day, Week, Sprint and Month - and Sprint shares Week's density while its secondary band names the sprint chain instead of days or weeks.
_Avoid_: granularity, resolution, scale

**Sprint**:
A planning increment with a name and a date range, drawn as one cell of the Sprint zoom's secondary band. Sprints form a contiguous chain with no gaps, each starting the day after the previous ends, and the last one may run past the plan period's end rather than being cut in half.
_Avoid_: iteration, cycle, phase, milestone

**Sprint cadence**:
The rule the sprint chain is derived from: the first sprint's start date, the default length in days, and a name rule of a prefix and a first number, whose spelling sets the numbering's padding width. The plan also holds per-sprint adjustments keyed by ordinal - a length or a name, either of which re-flows every later sprint, or leaves the rule naming the rest. The chain itself is never stored: it is recomputed from the cadence, the adjustments and the plan period, and days before the cadence's start carry no sprint.
_Avoid_: sprint schedule, iteration plan, cadence settings

**Archive**:
To take a Person or a Project out of the Stack and the Timeline while keeping every Assignment it ever had; an archived item can be restored.
_Avoid_: delete, remove, hide, deactivate

**Delete**:
To permanently destroy a Person, a Project or an Assignment; deleting a Person or a Project destroys the Assignments that referenced it too, archived ones included. It is a different act from archiving, which keeps everything and can be restored, and neither is a precondition for the other. An Assignment can also be deleted with the Delete key while the pointer is over its block. There is no trash, and a deletion is recoverable only through the session's Undo history, for as long as the running server holds it.
_Avoid_: remove, purge, destroy, hide

**Undo**:
To step the plan back one change at a time, and Redo to step forward again, from two controls in the top bar. Every change is one step - a move, a reassign or a resize, a panel save, a create, an archive, a delete, a restore, a Plan period change or a Step change - because each is one write, and a delete it reverses brings the record and its Assignments back. Its history is the last 100 changes, held in the running server's memory: it survives a page reload and is lost when the server restarts. Nothing about it is written to disk.
_Avoid_: revert, roll back, history, snapshot

**Filter**:
The one piece of text that hides everything on the grid that does not match it, as a case-insensitive substring. A plain term is read through the Look in scope, across the People, Projects and Assignments it is set to look in; a single `field: value` term names the field it searches and ignores that scope, as in `person tag:architect`, `project tag:platform`, `people: tim` or `project notes: delayed`, with a bare `tag:` spanning all three kinds and `project tag:` narrowing to Projects. A match carries what belongs to it - a matching Project brings all of its Assignments, a matching Person all of their work, and a matching Assignment its Person's row and its Project. It is session-only and respects Show archived.
_Avoid_: search, find, search bar, query
