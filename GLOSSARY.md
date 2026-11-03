# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how long, and how much of their time it takes.

## Language

**Person**:
Someone whose time the plan schedules, identified by a name and carrying an Availability, any number of Person tags, and an optional note.
_Avoid_: resource, user, employee, staff member

**Availability**:
The most a Person can be scheduled for - their own 100%, expressed as a share of a full working week. Allocations are absolute, so Availability is the ceiling they are compared against rather than the scale they are measured on.
_Avoid_: capacity, part-time factor, utilisation limit

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
The list of Projects available to drag onto the Timeline; it holds no dates of its own.
_Avoid_: backlog, pool, project list

**Timeline**:
The horizontal axis of the plan - a date range drawn at a chosen Zoom, with one row per Person.
_Avoid_: gantt, grid, chart, schedule

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
To permanently destroy a Person, a Project or an Assignment, with no trash and no undo; deleting a Person or a Project destroys the Assignments that referenced it too, archived ones included. It is a different act from archiving, which keeps everything and can be restored, and neither is a precondition for the other. The confirmation names the number of Assignments a Person or a Project will take with it before it happens.
_Avoid_: remove, purge, destroy, hide

**Filter**:
The one piece of text that hides everything on the grid that does not match it, as a case-insensitive substring anywhere in the People, Projects and Assignments it is set to look in. A match carries what belongs to it - a matching Project brings all of its Assignments, a matching Person all of their work, and a matching Assignment its Person's row and its Project. It is session-only and respects Show archived.
_Avoid_: search, find, search bar, query
