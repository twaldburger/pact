# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how long, and how much of their time it takes.

## Language

**Person**:
Someone whose time the plan schedules, identified by a name and carrying an optional Location, an optional email, an Availability, any number of Person tags, and an optional note. The individual; the Timeline's row-header column that holds them is headed People.
_Avoid_: resource, user, employee, staff member

**Availability**:
The most a Person can be scheduled for - their own 100%, expressed as a share of a full working week. The full working week is the nominal week an FTE describes, not the particular calendar week a date falls in, so a week holding a holiday or an absence holds fewer working days rather than a smaller share. Allocations are absolute, so Availability is the ceiling they are compared against rather than the scale they are measured on.
_Avoid_: capacity, part-time factor, utilisation limit

**Availability line**:
The dashed rule each row draws at the height its Person's Availability reaches, with the over-allocation band above it. It is drawn by default, and drawn or hidden from the Options menu; hiding it hides a mark of the measurement, never the measurement, so the row height, the over-allocation band and every figure stay exactly as they were. The code and the earlier writing call it the ceiling, and the interface now calls it Availability lines.
_Avoid_: ceiling, availability marker, capacity line, limit line

**Location**:
The one free-text place a Person is at, for grouping and filtering people later. It is optional and single-valued: a new one can be typed, or one already in use on another Person chosen, matched case-insensitively with the first spelling winning. It is deliberately not a fixed country list, and it is also the key a Person's holidays are configured under, so the dates configured for a Location are the ones shaded on that Location's rows.
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

**Typed tag**:
A free-text tag with a kind written before a colon and a value after it, as in `api: Stellar`. It is a convention rather than a schema: nothing is validated, an untyped tag like `DevOps` is untouched by it, and a kind with no value after it - `api:` - is not a typed tag. Its kind is what colour by key colours.
_Avoid_: namespaced tag, prefixed tag, key-value tag

**Tag key**:
The kind a typed tag carries before its colon - `api` in `api: Stellar` - and the unit colour by key chooses, one key per level: Projects, People and Assignments. The values under a chosen key take palette slots, and in the report's by-tag view a key's chip ticks or clears all of its tags at once.
_Avoid_: tag type, prefix, namespace, category

**Calendar day**:
A single day as the plan counts it, however it is worked: one column of the Timeline at Day zoom, and the unit a Plan period, a sprint's length and an Assignment's date range are stated in. It is the raw span, weekends, holidays and absences included, where a Working day is the day the plan counts as worked.
_Avoid_: day, weekday, business day

**Weekend**:
Saturday and Sunday, the two days of the week the plan treats as not worked for everyone, wherever they are. The weekend band shades them across the grid as a view setting; the shading follows the rule rather than making it.
_Avoid_: rest day, non-working day, holiday

**Holiday**:
A date configured against a Location and marked as a full day or a half day off, so the People at that Location do not work it. The list travels with the plan rather than coming from a library, so it is the owner's own and reaches any place a Location names, and a half day takes half of that day rather than all of it.
_Avoid_: public holiday, bank holiday, vacation, leave, absence

**Absence**:
A Project marked as an absence, so every Assignment under it takes time away from the Person rather than adding work to them: its days are not working days, and the time comes off the Capacity the Person offers on the days it covers instead of counting towards what they are allocated. Because it is a Project, it is tracked like any other work - a date range, a share, tags - so holiday, sick leave and rotation can be its Project tags rather than a Project each.
_Avoid_: holiday, leave, time off, vacation, non-working day

**Working day**:
A calendar day that is not a weekend, a holiday or an absence - a day the plan counts as worked. It is the unit the figures that measure time are counted in, so an Assignment spanning a holiday week is smaller than the same span in an ordinary one.
_Avoid_: business day, workday, weekday

**Capacity**:
The total time a Person offers, which their Availability expresses as a share of a full working week - so an 80% Availability is 0.8 FTE of Capacity. A holiday or an absence takes its time out of the Capacity the Person offers on the days it covers, so an absence lowers what is available instead of counting towards what is allocated.
_Avoid_: bandwidth, headcount, utilisation

**FTE**:
A full working week of one Person; Availability and Capacity are spoken of in it when a share alone would be ambiguous.
_Avoid_: full-time equivalent, heads

**FTE-day**:
One working day of one Person at a full Allocation, the unit a Project's or an Assignment's size is summed in; the FTE is the same unit one week long. A 60% Assignment over five working days is 3 FTE-days.
_Avoid_: person-day, man-day, day

**Allocation**:
The share of a full working week that one Assignment takes, set in the plan's Step. It is absolute: 60% is 0.6 FTE whether the Person is 100% or 80% available, which is what makes FTE-days add up across People and Projects.
_Avoid_: booking, commitment, effort, load, relative share

**Over-allocation**:
The state of a Person on a day whose Allocations add up to more than their Capacity; it is allowed, and the day is flagged.
_Avoid_: overload, conflict, double-booking

**Project**:
A body of work that Assignments place onto People; it carries a name, a colour, any number of Project tags and an optional note, an optional [Link](#link) to the Azure DevOps work item it was imported from, and exists independently of any Person.
_Avoid_: engagement, job, client, ticket

**Assignment**:
One Project placed on one Person for a continuous date range at an Allocation - the rectangle drawn on the Timeline. A change of share or a gap means a second Assignment. It carries any number of Assignment tags, an optional note, and an optional name: free text that says which work the block is, so a Person allocated to the same Project twice can tell the two apart. The name is never a second Project - it carries no colour, no tags and no capacity, and the Project still decides the fill.
_Avoid_: booking, block, slot, shift, work, title

**Stack**:
The list of Projects available to drag onto the Timeline; it holds no dates of its own. The interface labels this rail Projects, and a report mounts the same rail - same width, same fold, same remembered collapsed state - listing the report's views instead.
_Avoid_: backlog, pool

**Timeline**:
The horizontal axis of the plan - a date range drawn at a chosen Zoom, with one row per Person.
_Avoid_: gantt, grid, chart, schedule

**Plan period**:
The plan's extent: an explicit start date and end date the owner sets, both inclusive, which the Timeline draws and every Assignment must fall inside.
It is the extent itself, not a view setting, and the app never derives or grows it.
_Avoid_: range, timeframe, window, horizon

**Plan file**:
The one JSON file that holds the active plan, by default `data/default.pact.json`, chosen from the `Plan file...` entry under the Options glyph. A path is stored absolute and resolved, with `~` expanded; the choice is remembered in the config beside the app, and `PACT_DATA` wins when it is set. An existing file opens as asked, a missing, read-only or deleted one is refused plainly, and a new plan is created truly empty under the `.pact.json` suffix.
The app writes only this file, and refuses a write when the file changed underneath it since it was last read.
_Avoid_: database, data store, document, save, dataset

**Config**:
The app's own settings file, `data/config.json`, kept beside the app rather than beside any plan file - it lives in the app's own `data/`, wherever the plan it names happens to be - and gitignored like the rest of `data/`. It holds the active plan file's path - one active plan, never a list of recent ones - and the [View settings](#view-setting), and it may hold the path of the [Connection](#connection)'s token file. Its absence means the default; if it exists but cannot be read, the default is used and the app says so rather than failing silently.
_Avoid_: preferences, settings, options, registry

**Connection**:
A configured Azure DevOps organisation and project: a [Mapping](#mapping) in the plan, plus a personal access token in this machine's config. The mapping travels with the plan and may be shared; the token is a secret that is never in the plan, never leaves the server and is never shown in the browser, which reads back only whether one is set. It is set up in one place and used in another: the settings - the organisation's URL, the mapping's two lists and the token - are reached from `Options` then `Azure DevOps...`, and using it is the [ADO operations](#ado-operations), opened from the `ADO` button in the top bar. It reaches Azure DevOps only in answer to a press - opening the settings panel, `Test connection`, `Save mapping`, an import or a write back - which is the whole of the egress: there is no timer, no poll and no background check. Writing or clearing the token is not one of those presses, being a file on this machine, and it reaches nothing. With Azure DevOps unreachable, the plan keeps working exactly as it does without a connection.
_Avoid_: integration, sync, account, login, credential

**ADO operations**:
The surface where a [Connection](#connection) is used rather than set up: importing one work item by its id or its link, writing one linked [Assignment](#assignment) back, and the per-field sync when it lands. It opens from the `ADO` button in the top bar, which is always there and withheld until an operation could work - a [Mapping](#mapping) in the plan and a token on this machine - because an operation needs both halves; the button says which half is missing. An operation answers with what it did or refused, so its line is its own, while the token's state and the last connection's ranks stay with the settings.
_Avoid_: ADO panel, sync panel, import panel, integration

**Write back**:
One linked [Assignment](#assignment) published to its work item, and the whole of what PACT writes to Azure DevOps: a comment naming the Person, their [Allocation](#allocation), the dates and the [FTE-days](#fte-day), and the iteration path of the sprint the Assignment starts in. Nothing a team reports on is written, nothing is read back, and no date PACT assumed is ever published - a write happens only once a person has set the dates. The comment is one per work item and PACT's own: its first line is **Allocation, from PACT** in bold, a comment that begins with that wording is edited in place, and PACT never posts a second one. The iteration is resolved by containing the start date, both ends inclusive and read in UTC, and never by name; a day no sprint covers, or two of them, is refused rather than guessed or written to the project's root.
_Avoid_: sync, push, export, publish, upload

**Mapping**:
The `ado` block in the plan: the Azure DevOps organisation's address, the project's name, and two lists of work-item type names - the types whose items become Projects (`projectLevels`) and the types whose items become Assignments (`assignmentLevels`). A tag level is no longer part of it: the lists say directly what a tag slot only ever approximated. It holds type names and an address and never a secret, and a credential-shaped key inside it is refused so a shared plan cannot carry one. Both lists must be non-empty and every name in them is checked against the instance's own backlog ranks when the mapping is saved, by one rule: every assignment type ranks below every project type, so a list of Initiatives and Epics over a list of Features and User Stories is one mapping. A refused pair names both offending types and both ranks; an empty list is refused with what that list produces. A plan written before the lists carries singular `projectLevel`/`assignmentLevel` keys, which are read as the one-item lists they mean, and a `tagLevel`, which is accepted and left out the next time the plan is written - so no plan needs migrating. A plan without a mapping behaves exactly as it did before there was a connection.
_Avoid_: schema, field map, binding, metadata

**Link**:
What ties a record to the Azure DevOps work item it was imported from: the work item's id, the type it was read as, its [Baseline](#baseline), and whether the Assignment's dates are the item's own or PACT's guess. It has two homes, the same shape in each: an Assignment's link is the work an item became on a Person's row, and a Project's link is the item an import at the project level became. It sits in the plan beside the Assignment or the Project, because the plan is what travels, and it is optional everywhere - an Assignment typed onto the grid has none, a Project added by hand has none, and a plan without links behaves exactly as it did before there was an import. Type names and an address may appear in it; a token never does, and a credential-shaped key inside it is refused when the plan is read or written. A Project's link carries no owner's email, because an import at that level reads no owner, and no dates, because a Project has none. A linked record is ordinary in every other way: same panels, same figures, same rules, with the link shown read-only.
_Avoid_: reference, attachment, foreign key, pointer, sync record

**Baseline**:
The values both sides last agreed, kept inside a [Link](#link) so a later sync can tell what changed, on which side and in which field, rather than comparing two records that run on independent clocks. It holds the work item's revision and the agreed values - the title, the owner's email, the Project's work-item title, the start and end dates ADO holds (which are empty when it holds none), and the iteration path - beside a marker saying whether the dates are assumed. ADO's revision is what a conditional write is checked against; the marker is what keeps an assumed date from being published as if a person had decided it, and a person setting the dates is what clears it. A [Write back](#write-back) records the revision the work item is at once its comment has landed - a comment is a revision of its own, one past the patch's - beside the dates and iteration path it published and the cleared marker, so the next comparison starts from what both sides now hold. A Project's baseline holds the title and the revision alone: it has no owner to record and no dates to assume.
_Avoid_: snapshot, sync state, checkpoint, watermark

**View setting**:
One of the display choices kept in the Config - which sits beside the app and holds the plan path - and restored on each load: the Zoom and its Grid spacing, the Row height, the weekend band, the holiday band, the Milestone rules, the availability lines, whether the assignment blocks are drawn, the Grid dividers, the Minimap, whether the Marker is drawn, the Colour palette, what a [Block label](#block-label) names, whether the Stack is collapsed, the report's own zoom level and which of its views is showing, and the two sort orders. The Filter is deliberately not a view setting, being a query, so it does not persist; nor does the Marker's date, being a cursor into the timeline - only whether the Marker is drawn does. `Reset view`, under the Options glyph, returns every view setting to its default in one press, leaving the plan, the plan path, the Filter and the Marker's date alone. A malformed stored value falls back to that setting's default on its own.
_Avoid_: preference, option, display state

**Step**:
The plan's granularity for Availability and Allocation: one whole number of per cent from 1 to 100, stored in the plan beside its period and defaulting to 10 when absent. One step is also the floor, and the ceiling stays 100, so a 10% step floors at 10% and a 1% step at 1%. The interface snaps its steppers, panels and vertical drag by it; the server never enforces it, so changing the step leaves every stored value exactly as it was.
_Avoid_: increments, resolution, granularity

**Milestone**:
A single dated point in the plan that something is delivered or due by: it carries a name, a colour, its own tags and an optional note, and optionally the Projects it relates to. It belongs to the plan rather than to a view, and its one date is not a span, so nothing is measured between two of them; it never compares itself to the work around it and never warns, being an annotation the Filter understands rather than an alarm. It is drawn as a vertical rule through the rows when milestones are switched on: one related to Projects appears only while at least one of them is in view, and one related to none is plan-wide.
_Avoid_: deadline, checkpoint, gate, release, flag, marker

**Milestone tag**:
A short free-text label on a Milestone, for grouping and for filtering Milestones, as in `milestone tag: api`. A new one can be typed, or one already in use on another Milestone chosen; milestones' tags, people's tags, projects' tags and assignments' tags are separate lists, so a bare `tag:` searches the rows' three and never the Milestones'.
_Avoid_: label, keyword, category, or an unqualified "tag"

**Marker**:
The draggable vertical line on the Timeline. It starts on today, and the date it sits on is the date the per-Person totals are read at. It is the reading cursor, not a Milestone: a Milestone is a dated point in the plan, while the Marker only sets the date the plan is read at. It is drawn by default and can be hidden from the Options menu, which takes the line and its date chip away - so there is nothing to drag - while leaving the reading where it was: a hidden Marker still sets the date the totals are read at.
_Avoid_: today line, now line, cursor, playhead, reference line, milestone

**Minimap**:
An overview strip of the Timeline, off by default and turned on under the Options glyph, fixed at the board's bottom-right. Its height is how much of the shown rows' available capacity is used on each day rather than an absolute assigned share, and a day past full is over-allocation, drawn at the top of that scale in the signal colour. It follows the Filter and Show archived as the grid does and shows an empty map when the Filter leaves nothing, and it highlights the stretch of the period the grid currently shows, which can be dragged - or the strip clicked - to scroll the Timeline. It is a view setting, kept in the Config and restored on load like Zoom and Row height, and is independent of the collapsible Stack.
_Avoid_: overview, thumbnail, mini-chart, density chart

**Block label**:
What the label drawn inside a block names: its Project's name, its Assignment's own name, or both - `Project · 40%`, `PDF export · 40%` or `PDF export · Atlas Platform Rebuild · 40%`. The choice is one row in the Options menu that states the setting in force and expands to the three, the active one checked, stored as a [View setting](#view-setting) and restored by `Reset view`. It chooses words and nothing else: the Project still decides the colour, the tags and every figure, and the Share follows the name whatever is chosen. A nameless Assignment falls back to its Project's name under the settings that ask for a name, so a block is never left saying only a percentage.
_Avoid_: title, caption, block text, assignment label, block name

**Zoom**:
The drawn width of one day. It changes what you see and never what is stored: dates are always exact days. There are four levels - Day, Week, Sprint and Month - each opening on its own Grid spacing; Sprint opens at half Week's width, so by default a two-week sprint spans what one week does at Week zoom, while its secondary band names the sprint chain instead of days or weeks.
_Avoid_: granularity, resolution, scale

**Grid spacing**:
The drawn width of one day for the active Zoom, in whole pixels, set by the horizontal-arrow pair between the row-height stepper and Undo/Redo. Each of the four zooms remembers its own value, so re-entering a zoom returns to the width last set for it rather than resetting. The Zoom buttons open the defaults - Day 44, Week 16, Sprint 8, Month 5 - and the pair then moves the active zoom's width in 2px steps between 2 and 48, disabled at each end. A block too narrow for its label draws nothing, exactly as before, and its label above names it in the words the Block label setting chose.
_Avoid_: day width, column width, density, gap

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
The one piece of text that hides everything on the grid that does not match it, as a case-insensitive substring. A plain term is read through the Look in scope, across the People, Projects and Assignments it is set to look in; a single `field: value` term names the field it searches and ignores that scope, as in `person tag:architect`, `project tag:platform`, `people: tim`, `assignment name: wiring` or `project notes: delayed`, with a bare `tag:` spanning the rows' three tag kinds, `name:` spanning every row name - an Assignment's own included - and `project tag:` narrowing to Projects. A match carries what belongs to it - a matching Project brings all of its Assignments, a matching Person all of their work, and a matching Assignment its Person's row and its Project. The Filter also reaches Milestones, by name, tag and note (`milestone: api`, `milestone tag: delivery`, `milestone note: signed`): a term naming a milestone field narrows the Milestones alone and leaves the rows whole, because a Milestone is an annotation over the rows rather than one of them, and it still obeys the visibility rule that decides which Milestones are drawn. Milestone tags are their own fourth vocabulary, so a bare `tag:` never reaches them. It is session-only and respects Show archived.
_Avoid_: search, find, search bar, query

**Tag split**:
The by-tag report's own choice of what its rows are, read as rows in the view's head: the set of tags that are ticked, grouped by tag key with a row per key whose tick selects or clears all of that key's tags, and a final group for the tags belonging to no key. A key is only a shortcut for selecting its tags, never a mode the table is in: the ticked tags are the rows, in the view's own size order, and one `Other tags` row gathers every tag not ticked. A project's FTE-days are split evenly over all its tags, as everywhere in the report, so that residual is what makes the rows reconcile with the plan's total; it covers a tag nobody ticked and a project carrying no tag alike. Nothing is ticked to begin with, and the set is stored in the plan beside the holidays and the tag colours, so it travels with the plan.
_Avoid_: grouping, pivot key, split setting, tag filter

**Report view**:
One of the seven readings a report shows at a time - the three FTE-days views, the three Allocation views, and Allocation against capacity last - each named for its subject and its measure rather than for the shape of the table or chart that draws it. The selection is a view setting, so returning to the report resumes where it was left.
_Avoid_: tab, page, report tab

**Time bucket**:
One column of a report table and one point on its chart: the stretch of the Plan period a figure is counted over. The buckets are the report's own Zoom level - days, weeks, the derived sprints or months - tiled across the period and clipped at both ends, so they add up to the period exactly and a project's buckets sum to its total.
_Avoid_: interval, timeslot, slice, period

**Ruler**:
The chart's reading cursor, over the pointer or the keyboard: it snaps to the nearest bucket's centre and states that bucket's label, its allocated and capacity FTE-days and the share between them, so a reading never depends on an estimate from the picture. It is not the Marker: the Marker sets the date the plan is read at on the grid, while the ruler reads one bucket of a report's chart.
_Avoid_: cursor, crosshair, tooltip, marker
