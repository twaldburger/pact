---
type: Reference
title: PACT feature reference
description: What each capability does, how it behaves, and where its controls live.
---

# PACT feature reference

A capability by capability account of the app that exists: what each one does,
the rules and edge cases a reader would otherwise trip over, and where its
controls live. The vocabulary is defined once in [`GLOSSARY.md`](../GLOSSARY.md)
and linked from here rather than restated, so the two cannot disagree.

The whole interface is one board: a column of People down the left, a
[Timeline](../GLOSSARY.md#timeline) of days across, and the Projects rail down
the side. Everything else is either in the top bar above it, behind the Options
glyph at that bar's right end, or on the report's own page. The plan itself is
one JSON file, and every change is written to it as it happens.

Start with [the plan and its file](#the-plan-and-its-file) if you are opening
PACT for the first time; the remaining sections are independent and each states
its own controls.

## The plan and its file

The plan is one JSON file holding the [Plan period](../GLOSSARY.md#plan-period),
the People, the Projects, the [Assignments](../GLOSSARY.md#assignment), the
Milestones, the holidays, the sprint cadence, the tag colours and the report's
tag split. The server reads that file at start-up and writes it after every
change; a page reload re-reads it, so the screen is never ahead of the disk.

The default file is `data/default.pact.json`. On a fresh checkout it is created
from a seeded plan - three people and four projects, with one of the people
over-committed - so the first screen is not empty. That seed is convenience
data, not part of anyone's real plan.

The active file is chosen in the [Plan file](../GLOSSARY.md#plan-file)
panel. A path is stored absolute with `~` expanded; there are no relative paths.
Opening a file that is not there is refused plainly and leaves the running plan
loaded; the panel then offers to create it instead, under the `.pact.json`
suffix. Creating one gives a
plan with a default period and nothing else in it. `PACT_DATA` in the
environment wins over the panel and fixes the file for that run, in which case
the panel says so and its field is disabled.

Writes are atomic: the new plan is written to a temporary file beside the old
one and renamed over it, so an interrupted save cannot truncate the plan. A
write is refused when the file changed underneath the app since it last read it,
which is what stops two windows from silently overwriting each other. The app
writes only the active plan file and its own settings file, and keeps no
backups of its own: the view settings live in `data/config.json` beside the
app, not in the plan.

**Where the controls are.** The Options glyph (`...`) at the right end of the
top bar, then `Plan file...`, opens the panel holding the current path, a field
to type another, `Open` and `New plan`.

## Save status

Three words sit beside the wordmark: `Saved`, `Saving...` and `Not saved`. They
track writes only - a half-filled panel, a typed filter or a changed view
setting is not a write and says nothing. While any write is in flight the word
is `Saving...`; with none in flight the most recent write's fate decides, and
`Not saved` stays on screen in the signal colour until a later write lands.

**Where the controls are.** The top bar, after the plan period, beside the
wordmark. It is read-only.

## People

A [Person](../GLOSSARY.md#person) is one row of the Timeline. The row header
carries their name, their
[Availability](../GLOSSARY.md#availability) figure read at the
[Marker](../GLOSSARY.md#marker)'s date as `assigned/availability`, and a
colour mark when their tags are coloured by key.

The panel behind a row holds everything a Person is: a name, an optional
[Location](../GLOSSARY.md#location), an Availability, any number of
[Person tags](../GLOSSARY.md#person-tag), and a note. Availability moves in the
plan's [Step](../GLOSSARY.md#step), from one step up to 100%; one step is also
the floor, so a 10% step floors at 10%.

Location and tags are free text with suggestions, not fixed lists. A Location
is suggested from the Locations other People use and from the Locations the
holidays configure, matched case-insensitively with the first spelling winning.
Tags are sorted alphabetically as they are stored, and suggested only from other
People's tags: teams, roles or Places live in Person tags, while Projects' and
Assignments' tags are separate vocabularies and never appear here.

Archiving a Person takes their row and their work off the grid and keeps every
Assignment. Deleting destroys the Person and every Assignment that referenced
them, archived ones included, and is permanent apart from
[Undo](../GLOSSARY.md#undo) for as long as the running server holds the history.
An archived row remains visible with Show archived on, marked, with `Restore`
and `Delete` beside it; an archived Person cannot take a new Assignment, and a
drop on their row is refused by name.

Copying a Person makes a copy at once, with no form in between: the new Person
carries the source's Location, Availability,
[Person tags](../GLOSSARY.md#person-tag) and note, under the name `X (copy)` -
`X (copy 2)`, `X (copy 3)` and on while a live Person already holds the one
before. It starts with no Assignments, because their work is their own, so a
copy arrives as a row with nothing drawn in it. The source is untouched, the new
name is announced in the app's toast, as `Copied "Anna Meier" as "Anna Meier
(copy)"`, and the copy is one step of [Undo](../GLOSSARY.md#undo) away. A copy
is offered on an archived Person too, since copying creates rather than restores.

**Where the controls are.** The `+` in the People column header adds a Person;
clicking a row header opens it. Copy, Archive and Delete sit at the foot of the
Person panel, in that order and with Copy in the ordinary style rather than the
danger one; Archive and Delete are hidden on an archived Person and Copy is not
- and `Ctrl+C` over a row header then `Ctrl+V` over the People column is the same
copy with no panel in the way (see [Assignments](#assignments)). `Delete` over a
row header is the panel's own Delete with no dialog and no panel to open: the
Person and every Assignment of theirs go in one write, and the notice names the
cascade - `Deleted "Anna Meier" and their 3 Assignments` - where a Person with
no work is named alone. Anywhere else in the column deletes nothing, and
[Undo](../GLOSSARY.md#undo) steps the whole removal back.

## Projects

A [Project](../GLOSSARY.md#project) exists on its own, before any Person. It
carries a name, a colour, any number of
[Project tags](../GLOSSARY.md#project-tag), notes, and one mark that changes how
its work is read: Absence.

A colour is one of ten slots in the active palette, never a free colour, so
switching palette recolours every Project without changing which Project it is.
A new Project takes the least-used slot, which is the one least likely to sit
beside a Project of the same colour.

The rail's row for a Project ends in its whole-plan
[FTE-days](../GLOSSARY.md#fte-day), rounded to whole days, read across all of
its Assignments and never narrowed by the Filter. Archiving a Project keeps its
Assignments and takes it out of the rail; deleting it takes the Assignments with
it. Both behave as they do for People: archived Projects cannot take new work,
and a drop on the grid with one is refused by name.

Copying a Project makes a copy at once, with no form in between: the new
Project carries the source's colour, [tags](../GLOSSARY.md#project-tag), notes
and Absence mark, so a Project that repeats does not have to be retyped. It
takes the name `X (copy)` - `X (copy 2)`, `X (copy 3)` and on while a live
Project already holds the one before - and its colour is the source's own
rather than the least-used slot a new Project would take. It starts with no
Assignments and no Milestone relations of its own, and the source is untouched.
The new name is announced in the app's toast, as `Copied "Atlas" as "Atlas
(copy)"`, and the copy is one step of [Undo](../GLOSSARY.md#undo) away. A copy
is offered on an archived Project too, since copying an old one as a new one is
what an archived Project is most often wanted for.

**Where the controls are.** The `+` in the Projects rail header adds a Project;
clicking a rail row opens it. Copy, Archive and Delete sit at the foot of the
Project panel, in that order and with Copy in the ordinary style rather than the
danger one; Archive and Delete are hidden on an archived Project and Copy is
not - and `Ctrl+C` over a rail row then `Ctrl+V` over the rail is the same copy
with no panel in the way (see [Assignments](#assignments)). `Delete` over a rail
row is the panel's own Delete with no dialog and no panel to open: the Project
and every Assignment of it go in one write, and the notice names the cascade -
`Deleted "Atlas" and its 3 Assignments` - where a Project with no work is named
alone. [Undo](../GLOSSARY.md#undo) steps the whole removal back. Absence is a
checkbox in the same panel.

## Assignments

An [Assignment](../GLOSSARY.md#assignment) is one Project on one Person over a
continuous date range at one [Allocation](../GLOSSARY.md#allocation). It is the
rectangle drawn on the Timeline. A change of share, or a gap, is a second
Assignment - the share holds for the whole range.

An Assignment carries an optional `Name` as well as its tags and note: free
text, set in the Assignment's own dialog, and absent from a plan that never uses
it. It says which work the block is where the Project says only which Project,
so a Person allocated to the same Project twice - or to a Project that is
several different things - produces blocks that read apart. It is not a second
Project: the name carries no colour, no tags and no capacity, and the Project
still decides the fill, the tags and the figures. Two Assignments may share a
name, as they may share a note; nothing is refused. What a block's label names
is the [Block label](../GLOSSARY.md#block-label) setting, and a nameless
Assignment falls back to its Project's name there under every setting.

There are two ways to make one. Dragging a Project from the rail onto a row
creates five days at 100% from the day under the pointer, kept inside the
period. Dragging across an empty stretch of a row opens a New assignment panel
with those dates already set, where a Project, a Share, a name, tags and a note
are chosen. The dates in that
panel are read-only: the drawn range is the range, because drawing is how a
range is set. Only live Projects are offered there; creating a Project stays a
rail action.

Once drawn, an Assignment is changed by its body or its ends. The body moves it
along time and onto another Person, keeping its length; the end handles change
its dates or, dragged vertically, its Allocation. Each drag shows the value it
would set, and Escape during a body drag puts the block back. The vertical drag
moves by the plan's Step and snaps to the same values its Share stepper reaches,
so the two can never store different numbers. The grid keeps every drag inside
the Plan period, and a change that would leave it is refused with a message
naming the period.

Clicking a block opens it: Name, Share, tags and a note, plus Copy, Archive and
Delete. Assignment tags are their own
vocabulary, suggested from that Project's other Assignments. The Delete key
deletes the Assignment under the pointer with no confirmation -
[Undo](../GLOSSARY.md#undo) is the recovery - and `Ctrl+C` then `Ctrl+V` over a
block copies it to the pointer's row at the same share, name, tags, note and
length.
That copy lives in memory only; the system clipboard is never read or written,
and a copy is used up by the paste it makes.
An archived Assignment is history: it is drawn, marked, and can be restored,
but it cannot be dragged or copied until it is.

Copy duplicates the Assignment where it already is, with no form and
no clipboard in between: the copy lands on the same Person over the same start
and end dates and carries the same [Allocation](../GLOSSARY.md#allocation),
name, tags and note, with the tags copied into their own list rather than shared
with
the source. Nothing is destroyed, so Copy sits before Archive and Delete and
wears the ordinary style rather than the danger one. It
is the one create the grid makes anyway, so the grid's own rules hold: an
archived Person or Project refuses by name and nothing is created, and an
archived Assignment offers no copy at all. The source is untouched, the new
Assignment is announced in the app's toast, as `Copied the Assignment of
"Atlas" on "Anna Meier"`, and it is one step of [Undo](../GLOSSARY.md#undo)
away. Because a row stacks a Person's Assignments by cumulative share, the copy
draws as a second band directly above the original, and the row's figure and
hatching then read the duplication.

A Project is copied the same way, but from the rail. With the pointer over a
rail row, `Ctrl+C` holds that Project and says `Copied Atlas`; `Ctrl+V` over
the rail makes the copy at once. It needs no target position - a Project lives
in the rail and sorts itself - and it is the Copy button's own path, so
the copy carries the source's colour, tags, notes and Absence mark, takes the
next free `X (copy)` name, and is one press of [Undo](../GLOSSARY.md#undo)
away. A held Project tints the rail row under the pointer. A block in the grid
carries nothing to `Ctrl+C` - only a rail row does - and over the grid `Ctrl+V`
on a held Project does nothing at all, since there is no position for it to
land at.

A Person is copied by both routes as well, from their own column. `Ctrl+C` over
a row header holds that Person and says `Copied "Anna Meier"`; `Ctrl+V` over the
People column makes the copy at once. A name has no position to place either, so
it sorts itself into the column, and the paste is the Copy button's own path:
the copy carries Location, Availability, Person tags and note and no
Assignments. A held Person tints the row header under the pointer. The rail
carries nothing to `Ctrl+C` about a Person - only a row header does - and
`Ctrl+V` on a held Person over the grid does nothing at all.

One slot holds all three kinds, so what is held decides what a paste can be: a
held Project never pastes as an Assignment or a Person, and neither of those
pastes as a Project. A held Assignment lands on the grid and nowhere else, and
a held Person in the People column and nowhere else.
`Escape` clears the slot whichever kind it holds, and the tint and the ghost go
with it. It keeps its other meanings first: a panel, a list inside one and a
drag in progress each take the key before the clipboard does.

Over-allocation is allowed and drawn, never refused. The part of a block above
the Person's Availability line is hatched, and the row header's figure turns to
the signal colour. A Person row's figure is read at the Marker's date from the
whole plan, so a Filter that hides an Assignment never changes what the row
says; a day that is not a working day for that Person carries no load at all.

**Where the controls are.** Drag a Project from the rail onto a row, or drag
across empty row space, to create. Drag a block's body or ends to change it;
click it, or focus it and press Enter, to open it. Copy, Archive and Delete sit
at the foot of the Assignment dialog, in that order, with Copy in the ordinary
style and Archive and Delete in the danger one. The `Delete` key needs only the
pointer over a block, a row header or a rail row, and it deletes with no
dialog: over a block that Assignment alone, over a row header the Person and
over a rail row the Project - the same record `Ctrl+C` picks up, from the same
lookup. A Person's or a Project's Assignments go with them in one write, the
notice names the count, and [Undo](../GLOSSARY.md#undo) is one step back for all
of it. `Ctrl+C` and `Ctrl+V` need only the pointer over a block; over a rail
row, `Ctrl+C` copies that Project and `Ctrl+V` over the rail makes the copy, and
over a row header, `Ctrl+C` copies that Person and `Ctrl+V` over the People
column makes that one.

## Absences

An [Absence](../GLOSSARY.md#absence) is a Project marked as one, so every
Assignment under it takes time away from the Person instead of adding work. It
is the same Project machinery on purpose: holiday, sick leave and rotation can
be Project tags on one absence Project rather than a Project each.

Its days are not working days for that Person, so the time comes off the
[Capacity](../GLOSSARY.md#capacity) they offer over those days rather than
counting towards what they are allocated. In the grid an absence is drawn
hatched at the bottom of the row: it takes no stacked space, adds no load, and
never triggers the over-allocation band. In the report an absence is not a row
at all and contributes no FTE-day to any figure, which is why every report view
says "Absences are left out" underneath. The Milestones panel does not offer
absence Projects as something a delivery relates to.

**Where the controls are.** The `Absence` checkbox in the Project panel. The
Assignments themselves are made and edited like any other.

## Zoom

[Zoom](../GLOSSARY.md#zoom) is the drawn width of one day, at one of four
levels: Day, Week, Sprint and Month. It changes what is drawn and never what is
stored - dates are always exact days - and it opens on Month by default.

Each level keeps its own [Grid spacing](#grid-spacing), so returning to a level
comes back to the width last set for it rather than resetting it. Day, Week and
Month each name the axis in their own band; Sprint additionally names the
derived sprint chain in place of days or weeks. The Sprint level is present but
disabled until a sprint cadence exists, and if the cadence is cleared while
Sprint is showing, the view steps back to Week rather than drawing a level it
can no longer name.

Changing zoom keeps the Marker where it sits on screen, re-rules the Grid
dividers on the new level's own boundaries, and re-decides which Milestone axis
labels have room.

**Where the controls are.** The `Day`, `Week`, `Sprint` and `Month` buttons in
the top bar, after `Today`. On the report the same group sets the report's own
level, which is the report's [time bucket](#the-reports-time-buckets).

## Row height

Row height is the drawn height of one Person's row: whole pixels, 32 to 120 in
8px steps, defaulting to 48. The row is one step taller than the height an
Assignment fills, so a full-height block never quite touches the row below.

The whole grid follows it - the row-header column and the Timeline together -
and nothing is stored in the plan. Below 48px at the default text size the row
header tightens: its figure steps down a size and an archived row's controls
shrink to fit. Because that threshold is in real pixels, a reader who raises
their text size gets the roomier treatment back on the same row height.

**Where the controls are.** The vertical-arrow pair in the top bar, after the
zoom group: down for shorter rows, up for taller. Each button disables at its
end of the range.

## Grid spacing

[Grid spacing](../GLOSSARY.md#grid-spacing) is the drawn width of one day for
the active zoom: whole pixels, 2 to 48 in 2px steps. The four levels open at Day
44, Week 16, Sprint 8 and Month 5, and each remembers its own width afterwards,
so a level returns to the spacing last set for it rather than to its default.

Pressing `Reset view` restores those four defaults. A block too narrow for its
label draws nothing and names itself on the paper above instead; a block with no
room at all keeps its whole label in the hover tooltip.

**Where the controls are.** The horizontal-arrow pair in the top bar, beside the
row-height pair: left for narrower days, right for wider. Each button disables
at its end of the range.

## The Marker

The [Marker](../GLOSSARY.md#marker) is the draggable vertical line that sets the
date the per-Person totals are read at. It starts on today. The row header's
`assigned/availability` figure is read at the Marker - not at the left edge of
the view, and not at today once the Marker has moved.

The line can be dragged, moved with the arrow keys a day at a time or with
`Home` and `End` to the ends of the period, or placed by clicking the axis band.
The date chip in the axis band is a second handle for the same drag. `Today`
both scrolls today into the middle of the view and puts the Marker back on it.

Hiding the Marker removes the line and its chip, so there is nothing on screen
to drag, and a click in the axis band no longer places it - but the date stays
where it was and every figure keeps reading it. Only whether the Marker is drawn
is a view setting; its date is a cursor and is not stored.

**Where the controls are.** The line itself, the date chip in the axis band, the
`Today` button in the top bar, and `Options` then `Marker` to draw or hide it.

## Availability lines

Each row draws a dashed line at the height that Person's
[Availability](../GLOSSARY.md#availability) reaches, with the over-allocation
band above it. It is drawn by default, so an untouched plan looks as it always
did. The code calls it the ceiling; the interface calls it Availability lines.

Hiding it hides a mark, never a measurement. The row height, the
over-allocation hatch and every figure are drawn from the plan, so they stay
exactly as they were - the only thing lost is the dashed reminder of where the
ceiling sits. This is a view setting, kept in the config and restored on load.

**Where the controls are.** `Options` then `Availability lines`.

## The Assignments toggle

Every row's work is drawn as blocks. `Assignments` draws or hides them,
absences included, leaving a grid of dates with People down the side. It is on
by default. Like the availability lines, it hides drawing rather than work:
every figure stays put, including the row headers and the Marker's totals, and
the over-allocation hatch goes with the blocks because it is drawn on them.

With the blocks hidden the grid cannot make a new Assignment at all. A drag, a
drop or a paste is refused with a message naming the setting, because a block is
what a reader drags and one created there would land where nothing is drawn. A
block is also what a reader clicks, so with the blocks hidden the work already
in the plan has no handle on the grid; turning the setting back on brings every
block back exactly as it was, because nothing about them was ever hidden in the
plan.

**Where the controls are.** `Options` then `Assignments`.

## Weekends

[Weekends](../GLOSSARY.md#weekend) are Saturday and Sunday, everywhere. The
weekend band shades those two days across the whole grid as a view setting; it
follows the rule rather than making it, so switching the band on or off changes
no figure. It is off by default.

**Where the controls are.** `Options` then `Weekends`.

## The holiday band

The holiday band shades, in each row, the dates configured as time off for that
Person's Location. A full day and a half day are drawn differently, and a row
whose Location has no holidays configured is untouched. It is off by default and
is a view setting; the dates themselves are plan data, set in the
[holidays panel](#the-holidays-panel).

**Where the controls are.** `Options` then `Holidays` for the band; `Options`
then `Holidays...` for the dates.

## Grid dividers

Grid dividers are the 1px rules between the cells of the active zoom's finest
unit: days at Day zoom, weeks at Week zoom, the derived sprint cells at Sprint
zoom and months at Month zoom. They are on by default, and are the boundaries
the axis itself divides on, so a rule always sits under an axis separator.

Grid dividers are drawn beneath the rows, so a holiday band or a block paints
over them; a rule is a guide under the work, never a cut through it.

**Where the controls are.** `Options` then `Grid dividers`.

## The Minimap

The [Minimap](../GLOSSARY.md#minimap) is an overview strip of the whole period,
fixed at the board's bottom-right and off by default. Its height is the share of
the shown rows' available capacity that is used on each day, not an absolute
assigned share, so a fully allocated day reaches the top of the strip and a day
past full is drawn at the top in the signal colour. It follows the Filter and
Show archived exactly as the grid does, and shows an empty strip when the Filter
leaves nothing.

The stretch of the period the grid currently shows is highlighted. Dragging that
highlight scrolls the grid; pressing or dragging anywhere else on the strip
moves the view to the day under the pointer.

**Where the controls are.** `Options` then `Minimap`, and the strip itself at
the board's bottom-right.

## Milestones

A [Milestone](../GLOSSARY.md#milestone) is one dated point in the plan - a
delivery, a deployment, a deadline - carrying a name, a date, a palette colour,
its own [tags](../GLOSSARY.md#milestone-tag), notes, and the Projects it relates
to. Its one date is not a span, so nothing is measured between two of them.

With the Milestones switch on, each visible date draws a vertical rule through
the rows in that Milestone's colour, with its name and date in the axis band.
Several Milestones on one date share one rule, named by the first in the plan's
order and counted as `+2`; when the band has no room for a label before the next
date, the label is withdrawn and a bare tick remains.

Which rules are drawn is a visibility rule, not a filter. A Milestone related to
Projects is drawn while at least one of them is in the grid; one related to no
Project - because it names none, or because the Projects it named have been
deleted - is plan-wide and always drawn. A date outside the Plan period is
simply off the axis. The same switch rules the report's chart, where each
Milestone is a vertical rule at its own date, and every other report view leaves
them out.

A Milestone is an annotation: no total, share or over-allocation check counts
it, and it never warns. The Filter can reach one by name, tag or note
(`milestone: api`, `milestone tag: delivery`, `milestone note: signed`). A
Milestone has no archived state - it either exists or it is deleted - and
deleting one is permanent apart from Undo.

**Where the controls are.** `Options` then `Milestones` draws or hides the
rules; `Options` then `Milestones...` opens the panel that lists them, and
`Add milestone` opens the editor, whose `Related projects` row opens its own
searchable list of Projects.

## The Projects rail

The rail is the list of Projects available to drag onto the Timeline. It is
labelled Projects, holds no dates of its own, and can be folded away from the
chevron in its header: folded, the rail and its list are gone and the Timeline
with its Person column takes the whole board, with the same chevron at the
board's left edge at the same height to reopen it.

The folded state is a view setting. While the rail is folded and a Filter is
active, the chevron carries the number of Projects the Filter leaves - a count,
never a reason to expand.

**Where the controls are.** The chevron at the right of the rail's header; the
`+` beside it to add a Project; a rail row to open that Project; and a row
dragged onto the grid to make an Assignment.

## Sorting the rail and the rows

Each list has its own display order, chosen from a small set of keys: the
Projects by Name, First assignment start, Last assignment end or Total assigned
FTE; the People by Name, Location, Free at the Marker, Load at the Marker or
Earliest assignment. A key is applied on its first press in its own sensible
direction, and a separate Ascending/Descending row flips it.

Ordering is display order only. It is a view setting, never written to the plan,
and with no key chosen each list keeps the plan's own order. Ties break by name
in every case, and a missing value - a Person with no Location, a Project with no
Assignment - sorts last in both directions rather than displacing real work.

`Load at the Marker` and `Free at the Marker` read the Marker's date, so they
are recomputed when the order is applied and when the Marker is released, but
never while it is being dragged: rows stay where they are under the pointer. Free
capacity is the Person's Availability minus their load at that date and goes
negative for an over-allocated Person rather than being clamped at zero.

**Where the controls are.** The sort icon in the Projects rail header, and the
sort icon beside the People column header. Each opens a menu of that list's keys
and its direction row.

## The Filter and its Look-in scope

The [Filter](../GLOSSARY.md#filter) is one field that hides everything on the
grid that does not match it. A plain term is a case-insensitive substring
anywhere in a Person's, a Project's or an Assignment's own fields; `rea` finds
React, and whole words are never required.

A match carries what belongs to it: a matching Project brings all of its
Assignments into view, a matching Person brings all of their work, and a matching
Assignment brings its Person's row and its Project. Look in decides which of the
three areas a plain term searches, each area switching on and off
independently; the button states how many are being searched, as `in 3 areas`.
The scope decides what is matched, never what a match takes with it: an area
switched off cannot produce a match of its own, but anything a match does reach
is still shown whole, so a Project that matched still appears in the rail with
all of its Assignments even while Assignments is switched off.

A single `field: value` term names the field it searches and sets the scope
aside: `person tag: architect`, `project notes: delayed`, `people: tim`,
`project tag: platform`, `assignment name: wiring`, `milestone: api`. Both
singular and plural work, a bare
`tag:` searches the rows' three tag kinds and never the Milestones', `name:`
searches every name of the three row kinds - an Assignment's own included - and
`note:` searches Person and Assignment notes.
A tag value that carries its own kind - a colon inside it, as in
`person tag: skill:D` - matches every tag that starts with it, case-insensitively
and trimmed, so a typed tag can be narrowed a character at a time: `skill:D`
finds `skill:DevOps` and `skill:Data`. It reaches the numbered neighbour too,
so `person tag: skill:DevOps` finds `skill:DevOps-2` beside `skill:DevOps`, but
never a bare `DevOps`, which is what the colon asks to be spared. A value
without a colon keeps the loose rule, so `person tag: devops` still finds
`DevOps`, `skill:DevOps` and `skill:DevOps-2`.

The text before a colon that names no field is not a field name, so the whole
term is read as plain text: the plan's own typed vocabulary can be searched as
it is typed, and `skill:De` finds the rows carrying `skill:DevOps` the way any
plain term does. When that plain search leaves nothing, the empty state names
the prefix it could not read as a field and lists the fields the Filter does
know, so a mistyped field still explains itself rather than passing as text.

A term naming a Milestone field narrows the Milestones alone and leaves the rows
whole. That is deliberate: with the Milestone rules switched off, hiding the
rows would leave an empty grid and nothing drawn to explain it. Any other term
leaves the Milestones to the visibility rule, so matching a Milestone never
forces it into view. Milestone tags are their own vocabulary, reachable only by
`milestone tag:`.

Typing offers the plan's own vocabulary as a keyboard-navigable list of at most
eight rows: `Search everywhere` first for a plain term, then the values that
would match, each labelled with its source and how many things selecting it
would leave. Arrow keys move, Enter applies, and choosing a prefix keeps the
caret in the field and offers that field's own values. Matching is drawn from
the areas being looked in, which is why Milestones are offered by their prefixes
instead of by a plain term.

Row-header figures describe the Person, not the query, so they are never
narrowed by the Filter. The Filter is session-only and never written to the
plan; a reload therefore loses it, but moving between the plan and the report
carries it across. An empty result names what was typed, says what was searched
and offers to clear it. The Filter respects Show archived, and a Filter with a
query changes the count the folded rail shows.

**Where the controls are.** The field at the left of the top bar; the `in N
areas` button beside it opens the three Look in switches; the `x` clears the
field; `Esc` closes the open list first, then the scope popover, then the Filter.

## Show archived

[Archiving](../GLOSSARY.md#archive) keeps everything and takes a record out of
the plan as it is drawn. `Show archived` decides whether archived People,
Projects and Assignments are included: off, an archived record of any kind is
never drawn; on, archived records appear alongside the live ones, marked, so
they can be restored.

It is not a display setting. It decides which records are included rather than
how they are drawn, it is session-only - every load starts with it off - and
`Reset view` deliberately leaves it alone, which is why it sits in a group of its
own in the Options menu. The rail, the grid, the Minimap and the report all
follow it, and an Assignment is only drawn while both its Person and its Project
are drawn, so archiving a Person takes their work off the grid with them.

Archived records refuse new work by name; archived Assignments are drawn but
cannot be dragged or copied; archived rows carry `Restore` and `Delete`, both on
the row itself. The `Delete` key over an archived row deletes it as it deletes a
live one, since the row is the record either way - `Restore` stays the route
that keeps it.

**Where the controls are.** `Options` then `Show archived`, alone in the menu's
second group.

## Undo and redo

[Undo](../GLOSSARY.md#undo) steps the plan back one change at a time and redo
steps it forward again. Every write is one step - a move, a reassign or a
resize, a panel save, a create, an archive, a delete, a restore, a Plan period
change, a Step change, a sprint cadence, the holidays, the tag colours, the tag
split - because each is one atomic save. Undoing a delete brings the record and
its Assignments back.

The history is the running server's memory: the last 100 changes. It survives a
page reload because the server does, and it is gone when the server restarts,
because nothing about it is written to disk. Both buttons grey out when there is
nothing to step to.

**Where the controls are.** The two curved-arrow buttons in the top bar, after
the grid-spacing pair. There is no keyboard shortcut, and a report disables
both.

## In-app help

The help is opened from the first entry of the Options menu: this reference and
the [glossary](../GLOSSARY.md), in a panel over the board. It is opened and
never docked - nothing in the grid moves because it exists - and `Esc`, the
close control or a press outside it closes it. Because the menu that opened it
is closed first, focus lands on the page when the panel goes, exactly as it does
for the menu's other panel entries. The entry is in the menu of both pages, so
what a report's own vocabulary means is a search away from the report.

The field at the top of the panel searches the document showing. A section
whose heading carries the search comes before a section that only mentions it
in its text, and within each of those the results stay in reading order; the
search is case-insensitive and covers headings and body text alike. A result
names the section, or the glossary term, and quotes the line that matched, and
choosing one opens that section. A search typed before a switch is kept rather
than cleared, and is run again against the document switched to, so a word
looked up in the reference finds its term in the glossary.

The row under the panel's title is the switch between the two documents:
`Feature reference` and `Glossary`, side by side, the one showing filled the way
the Plan/Report switch fills the page you are on. Choosing the other shows that
document in place - at its opening with the field empty, at the results of a
query already typed - so the lexicon is a press away rather than a search away.
Every visit still starts on this reference, with the field empty: the document
read last is not remembered.

Inside the text, a link to the glossary or to another section of this page
moves within the panel, and the switch marks whichever document the panel is
then showing. A link anywhere else - the README, an ADR, the scope doc - is
drawn as plain text, because reading the rest of the docs tree is not what this
panel is for. The two documents are read from the repository each time the
panel opens rather than kept as a copy, so the help cannot describe a version
of the app that has moved on.

**Where the controls are.** `Options`, then its first entry, `Help...`.

## The Options menu

The Options menu holds the infrequent controls, grouped top to bottom by what
they do, with a divider above the first row of each group after the first:

- `Help...`, alone, because it opens the help rather than changing anything;
- the view settings: `Weekends`, `Holidays`, `Milestones`, `Availability
  lines`, `Assignments`, `Grid dividers`, `Minimap`, `Marker`, then the `Colour
  palette` disclosure, the `Block label` disclosure and `Reset view`;
- `Show archived`, alone, because it decides which records are included rather
  than how they are drawn;
- the plan's own settings: `Plan period` and `Percentage step` disclosures,
  then the `Sprints...`, `Holidays...`, `Tags...` and `Milestones...` panel
  entries, each stating in its detail what opening it will find;
- `Plan file...`.

A disclosure opens its control in place, one at a time, and keeps its own value
line visible while open. A checkable row ticks when its state is on. The menu
closes on `Esc`, on a press outside it, or when it opens a panel.

The bar is shared with the report, and the menu is the same menu there; a report
disables the rows it cannot act on - the grid's display settings and `Reset
view` - rather than moving or hiding them. Which rows those are is stated once,
beside the menu's own items, so the two views cannot disagree. Note what stays
live on a report: `Show archived`, `Help...`, the `Milestones` switch that
rules its chart, and the plan-facing rows, including Plan period and Percentage
step, which are plan changes and not view settings.

**Where the controls are.** The Options glyph (`...`) at the right end of the
top bar.

## Colour palette

The palette is one of two ColorBrewer schemes, Paired and Set3, ten fills each.
A Project's colour is a slot into whichever palette is active, so switching
palette recolours every Project, every Milestone and every coloured tag chip at
once without changing which record is which. Exactly one scheme is ticked. It is
a view setting kept in the config, so the plan never learns which one is active.

**Where the controls are.** `Options` then `Colour palette`, which expands to the
two schemes.

## Block label

What a block's drawn label names: its Project, its Assignment's own name, or
both. The row states the setting in force, and expands to the three - `Project
name`, `Assignment name` and `Both`, the active one checked - as the Colour
palette beside it does.

`Project name` is the default and is what every block said before an Assignment
could be named, so an untouched plan draws exactly as it did. `Assignment name`
draws the Assignment's own name where the Project's used to be, and `Both`
draws the name followed by the Project's. The share follows either way, so a
block reads `PDF export · 40%` or `PDF export · Atlas Platform Rebuild ·
40%`. A nameless Assignment falls back to its Project's name under both of the
settings that ask for a name, so no block is ever left saying only a percentage.

What the label names is not what the block is: the Project still decides the
fill, the tags, the Share and every figure, and the setting changes nothing
anywhere outside the drawing. A block too narrow for its label draws nothing and
names itself on the paper above it instead, in the same words this setting
chose.

It is a view setting kept in the config, so the plan never learns which one is
active, `Reset view` returns it to `Project name`, and a report disables the row
the same way it disables the other grid-only entries: a report page draws no
blocks.

**Where the controls are.** `Options` then `Block label`, directly below
`Colour palette`, which expands to the three settings.

## Plan period

The [Plan period](../GLOSSARY.md#plan-period) is the plan's extent: an explicit
start and end date, both inclusive, set together. It is the extent itself, not a
view setting, and the app never derives or grows it: an Assignment that would
fall outside it is refused with a message naming the period.

The two dates are applied together, so a half-typed pair never re-steps the plan,
and a start after its end or a malformed date is refused in the control rather
than closing it. A change is one undo step. Work already stored outside the
period is not an error: it is drawn only as far as the axis reaches and not at
all if it is wholly outside, while its real dates stay on the record.

The period also governs the report's columns, the Marker's range, the `Today`
button - which is inert while today falls outside it - and which Milestones and
sprint cells have anything to draw.

**Where the controls are.** `Options` then `Plan period`, which expands to
`Start`, `End` and `Apply`.

## Percentage step

The [Step](../GLOSSARY.md#step) is the plan's granularity for Availability and
Allocation: one whole number of per cent from 1 to 100, defaulting to 10 when the
plan carries none. It governs every stepping control - a Person's Availability,
an Assignment's Share - the panels and the vertical drag, all of which snap by
it. One step is also the floor, so a 10% step floors at 10% and a 1% step at 1%;
the ceiling stays 100.

The step is plan data, stored beside the period, and the server never enforces
it: any whole number from 1 to 100 is accepted. Changing the step therefore
leaves every stored value exactly as it was - it changes what the controls can
offer next, not what is already in the plan.

**Where the controls are.** `Options` then `Percentage step`, which expands to a
number field and `Apply`.

## Sprints

A [Sprint](../GLOSSARY.md#sprint) is a planning increment drawn as one cell of
the Sprint zoom's secondary band and as one column of a Sprint report.
Sprints form a contiguous chain with no gaps, each starting the day after the
previous ends, and the last may run past the plan period's end rather than being
cut in half.

The chain is never stored: it is derived from the
[cadence](../GLOSSARY.md#sprint-cadence) - a first start date, a default length
of 1 to 365 days, and a name rule of a prefix and first number - plus any
per-sprint adjustment and the plan period. A prefix's trailing space is what
separates it from the number, and the first number's spelling sets the padding
width, so `Sprint` and `24` give `Sprint 24`, `Sprint 25`, while `26-` and `01`
give `26-01`, `26-02`.

In the panel, each row's name and end date can be edited; changing either writes
an adjustment keyed by the sprint's ordinal and re-flows every later sprint at
once, without closing the panel. Each row also states its calendar length and the
working days it holds, counted over that row's own dates with weekends and the
configured holidays taken out. `Clear cadence` returns the plan to no sprints.

Days before the cadence's start carry no sprint and nothing is derived
backwards, so a period starting earlier than the first sprint shows a blank
stretch. Without a cadence the Sprint zoom is disabled and a Sprint report falls
back to months rather than drawing an empty table.

**Where the controls are.** `Options` then `Sprints...`, whose detail counts the
sprints (`Not defined yet` before one exists), opens the panel.

## The holidays panel

[Holidays](../GLOSSARY.md#holiday) are one date and a full-or-half mark,
configured per Location. They travel with the plan rather than coming from a
library, so they are the owner's own and reach any place a Location names. A
Location is matched case-insensitively and trimmed, so `Switzerland` and
`switzerland` configure the same dates.

The panel holds one card per Location, each with its dates, a full/half choice
per date, `Add date` and `Add location`, and one `Save holidays` for the whole
list. Locations are suggested from the People and from the Locations already
configured. A half day takes half of that day rather than all of it, and two
marks on one date add up only as far as a whole day.

The dates feed two things and nothing else: the
[holiday band](#the-holiday-band) in the grid, and the working-day counts that
every FTE-day figure and every sprint figure is built from. They do not reduce a
Person's Availability, and they are not absences.

**Where the controls are.** `Options` then `Holidays...`, whose detail counts
the dates configured, opens the panel.

## Tags, typed tags and colour by key

Every Person, Project, Assignment and Milestone carries any number of tags, and
each of the four is a separate vocabulary. A [typed tag](../GLOSSARY.md#typed-tag)
is a convention rather than a schema: if a tag has text before a colon and text
after it, the part before is its [key](../GLOSSARY.md#tag-key) and the part after
its value, so `api: Stellar` is a tag of key `api` with value `Stellar`. Nothing
is validated and nothing is enforced; `DevOps` is an ordinary untyped tag and
`api:` is not a typed tag at all, because nothing follows the colon.

The tag field offers the vocabulary of its own editor as you type, from the
same fixed dropdown the Filter uses, and several tags can be taken from it at
once. The list narrows by a case-insensitive match anywhere in the tag, so
`sign` finds both `design` and `Design review`, and an empty field lists the
whole vocabulary. A tag the edited record already carries is not offered, and
neither is one added as a chip earlier in the same edit, because the chips
beside the field already say what is applied.

A tick chooses a row before anything lands. The list opens with its first row
already highlighted, and every narrowing that still has rows highlights the
first of them, so one `Space` ticks the obvious choice without an arrow press.
The arrow keys move the highlight, `Space` ticks the highlighted row, and
`Enter` takes the highlighted row - the first match of what has been typed,
which is what a datalist taught everyone to expect. While a row is ticked the
last row reads `Add N tags` and commits the whole set, so a pointer ticks rows
by clicking them and commits from there, and `Enter` with rows ticked adds them
all rather than the highlight. The typed text stays in the field while the
list is open - one narrowing serves several picks - and clears when the list
closes, whether by `Enter`, `Escape` or a click away. `Enter` makes a new tag
only of a term the list holds no row for, stored exactly as typed, so free text
for a genuinely new tag is never lost to the list and a half-typed `skill:back`
chooses the existing `skill:backend` instead of polluting the vocabulary; text
differing from a row only by case or surrounding space is that row. `Escape`
closes the list and adds nothing, and a second `Escape` then closes the panel.
A comma commits the typed text as it always did, and Backspace on an empty
field removes the last chip. A space ticks nothing while no row is highlighted,
so multi-word free text still reads.

A Location is single-valued, so its suggestion stays a plain browser list: one
value at a time, with nothing to tick.

Colour by key turns those keys into colours. A key can be chosen for each of
three levels - Projects, People and Assignments - and then every typed tag whose
key is chosen takes a palette slot, which is the same ten slots Projects use.
Assign the slots by hand with the swatches, or let a newly seen value take the
next free slot; pressing the slot a value already draws in clears it, so the same
control chooses and clears. A project's block resolves its colour most specific
first: its own tag under the Assignments key, then its Project's tag under the
Projects key, then the Project's own colour. A Person is marked in the People
column by their own tag under the People key, and People have no colour of their
own. Once a key that can colour a block is chosen, a block that no chosen key
colours draws hollow instead of falling back to its Project colour - so a hollow
block means "no tag colour here", which is a different statement from an unkeyed
plan where every block simply wears its Project's colour.

The keys and the value colours are plan data, stored beside the holidays and the
sprint cadence, so they travel with the plan and Undo steps through them. The
report's tag chips carry the same colours, which is why a tag reads the same in
both places.

**Where the controls are.** The tag field in the Person, Project, Assignment
and Milestone panels; `Options` then `Tags...`, whose detail counts the
keys and colours set, opens the panel: a `Projects`, `People` and `Assignments`
select for the key, then the values grouped by key with their swatches.

## The ADO panel

PACT can be told how an Azure DevOps project maps onto the plan. A
[connection](../GLOSSARY.md#connection) is two halves that travel differently: a
[Mapping](../GLOSSARY.md#mapping), which is plan data and is written into the
plan file, and a personal access token, which is a secret and never is.

The panel asks for one URL, because a URL is what a person has to hand - from
the browser bar, or pasted out of a work item - while the organisation's address
and the project's name are what PACT needs and not what anyone thinks in. The
URL is read as it is pasted, and the panel states what it read:
`organisation: timwaldburger · project: PACT`. Five shapes are read:
`https://dev.azure.com/{org}/{project}`, `https://dev.azure.com/{org}` with no
project yet, `https://{org}.visualstudio.com/{project}`,
`https://{org}.visualstudio.com/DefaultCollection/{project}`, and any page below
one of them, such as a work item or a board - the project is a path segment, so
`_workitems` and `_boards` are never taken for it. A query string, a fragment
and a trailing slash are ignored, and `%20`-style encoding is decoded, so
`PACT%20Lab` is the project `PACT Lab`. A host that is neither `dev.azure.com`
nor `{org}.visualstudio.com` is refused rather than coerced into one, and the
refusal names the shapes it does accept. A URL carrying no project is not an
error: the organisation is read, the project is asked for, and a project already
typed is kept. The reading is displayed and never silent - both stored values
stay in their own editable fields, so a wrong reading is corrected by hand
before Test connection, and a URL shape nobody foresaw is still reachable.

The mapping is the plan's `ado` block: the organisation's address, the ADO
project's name, and three work-item type names - the type a Project is drawn
from, the type an Assignment is drawn from, and, optionally, the type a tag is
drawn from. Nothing else is in it. A credential-shaped key (`token`, `pat`,
`password` and the like) inside the block is refused when the plan is read or
written, so a plan can be shared, versioned and diffed with no secret in it, and
a plan without an `ado` block loads and behaves exactly as it did before there
was a connection.

The three slots are checked against the instance's own backlog ranks - the
number ADO gives each backlog level, higher meaning a higher level - not against
a fixed list of type names. The Project type must sit above the Assignment type,
so an Epic-over-Feature instance and a Feature-over-User-Story configuration both
work, while an equal or inverted pair is refused with both ranks named. The Tag
type, when set, must be a type the instance reports, and it may be left unset.
Because the ranks belong to the instance, a mapping is saved only after a
successful Test connection: the check needs the instance, and nothing is written
when it cannot be read.

The token is a personal access token pasted into the panel. The server writes it
to this machine's config directory - `$XDG_CONFIG_HOME/pact/ado-pat` or
`~/.config/pact/ado-pat` on Linux and macOS, `%LOCALAPPDATA%\pact\ado-pat` on
Windows, and never `%APPDATA%`, which roams between machines - with mode 600 and
its directory 700 on POSIX. `ado.tokenFile` in the app's config may name another
path; the plan may not. The browser never sees the token: it reads back only
whether one is set, and offers Replace and Clear, where Clear deletes the file.
A file still holding the placeholder text reads as no token, so a fresh checkout
says "not set" rather than failing against ADO with a 401.

Test connection is the call that reads the instance, and it reports what came
back: the project, its team, and each backlog type with its rank. Every ADO call
is the direct result of a press - opening this panel (which loads the types once,
because the slots are chosen from them), Test connection, Save mapping, or a
token action. There is no status light, no timer and no polling: with ADO
unreachable the plan keeps working exactly as it does today, and the panel says
why the last press failed. Saving the mapping is one plan write, so it is one
Undo step back, like any other change.

The panel holds the URL, the two values read out of it, the three type
selections - offered from the instance once Test connection has answered - and
the token field with its Save and Clear actions. It opens with a stored mapping
shown as the one URL it is, read back by the same rules a paste goes through. A
plan carrying a mapping and no token keeps the panel and says where the token
file goes.

**Where the controls are.** `Options` then `ADO...`, whose detail says
`Not configured` or names the mapped ADO project.

## Reset view

`Reset view` returns every view setting to the default the app ships with, in
one press: zoom and each level's grid spacing, row height, the bands, the
Milestone rules, the availability lines, the assignment blocks, the Grid
dividers, the Minimap, the Marker's visibility, the colour palette, what a
block's label names, the folded
rail, the two sort orders, and the report's own zoom and view.

It leaves the plan alone, and it deliberately leaves the plan path, the Filter,
the Marker's date and Show archived alone too - which is why it is called Reset
view rather than Reset config. A malformed stored value already falls back to
that setting's default on its own, so a broken config never needs this.

**Where the controls are.** `Options` then `Reset view`.

## The report

The report is a second page, `/report.html`, reached from the `Report` link in
the top bar and returned from by `Plan`. It draws the same plan over the same
period, from the same bar and the same rail - the rail lists the report's views
in place of Projects, at the same width, folding by the same chevron, and
remembering the same folded state.

The report reads the plan through the Filter and the two sort orders, and
respects Show archived. It has no grid, so it makes none of the grid's writes:
nothing is dragged and nothing is created. Its own content writes one thing, the
by-tag view's choice of rows, which is stored in the plan so that it travels
with the plan like the holidays.

The bar's grid controls stay in place but are disabled on a report: `Today`, the
row-height pair, the grid-spacing pair and Undo/Redo. The Filter, the zoom and
the Options glyph stay live. Absences are left out of every figure, and each view
says so.

**Where the controls are.** The `Plan`/`Report` links at the left of the top bar;
the report's own rail for its views; the zoom group for its buckets.

## The report's views

There are seven, drawn one at a time, grouped in the rail by what they measure.
All figures are [FTE-days](../GLOSSARY.md#fte-day) computed with the grid's own
working-day rule, so a project's total in the report is the same arithmetic
behind the number the rail shows for it - clipped to the buckets, where the rail
counts the whole assignment.

- `FTE-days by project`, `FTE-days by person`, `FTE-days by tag` - matrices of
  one row per thing and one column per
  [time bucket](#the-reports-time-buckets), plus a Total column, an `Of plan`
  share and a Total row. The by-person view adds `Of offer`: a Person's FTE-days
  against the FTE-days they offer over the period, so someone at 80% can reach
  100%.
- `Allocation by project`, `Allocation by person`, `Allocation by tag` - the
  same rows read as shares. By project and by tag, every row divides by the
  capacity the whole plan offers in the same stretch, so the rows add up to the
  plan's own utilisation rather than to 100%. By person, each row divides by what
  that Person offers in the same stretch, so 100% is that Person's own
  Availability.
  A bucket offering no capacity has no share to state and reads as a dash, never
  as 0% or an infinity. Above 100% is over-allocation and is marked.
- `Allocation against capacity` - the chart, one capacity band with the
  allocation line riding under it, described below.

The by-tag views are shaped by a selection of tags: two rows of chips, one for
the keys the plan's tags carry and one for every tag the view can draw a row for.
Ticking a key ticks all of its tags, ticking a selected one clears them, and
nothing is ticked to begin with - the view then says so rather than guessing at a
taxonomy. A project's FTE-days are split evenly over all of its tags, so the rows
and one `Other tags` residual reconcile exactly with the plan total; the residual
is what covers a tag nobody ticked and a project carrying no tag.

**Where the controls are.** The report's rail lists the seven views; the chips in
the by-tag views are the selection.

## The report's time buckets

A [time bucket](../GLOSSARY.md#time-bucket) is one column of a report table and
one point on its chart. The four are the four zoom levels, taken literally: Day,
Week, Sprint and Month. The report keeps its own level, so moving the grid to Day
never turns the report into 365 columns.

The buckets tile the plan period exactly and are clipped at both ends. Day is one
bucket per calendar day. Week runs from the period's own start to the end of
that calendar week, then whole Sunday-to-Saturday weeks, so only the first and
last buckets are short - not Monday-based weeks. Month is one bucket per
calendar month. Sprint is one bucket per derived sprint, clipped to the period
and named by the sprint; with no cadence the report falls back to months rather
than an empty table.

**Where the controls are.** The `Day`, `Week`, `Sprint` and `Month` buttons in
the top bar. On the report they set the report's level, not the grid's.

## The chart and its ruler

`Allocation against capacity` is one chart: the capacity the plan offers, as a
quiet band whose solid top edge is the roof, and what is allocated, as a line
riding under it. Its vertical scale stops at the smallest round number above the
largest value, so a plan's figures divide into readable ticks rather than into
whatever the maximum happens to be.

The [ruler](../GLOSSARY.md#ruler) is how the chart answers a question. It snaps
to the nearest bucket's centre and states that bucket's own figures in a readout
fixed in the plot's bottom-left corner - the bucket's label, allocated over
capacity in FTE-days, and the share - so a reading never depends on estimating
from the picture. A bucket that offers no capacity says `no capacity` rather than
dividing by zero.

The ruler follows the pointer while it is inside the plot and disappears when the
pointer leaves. The chart is also focusable: focus opens the first bucket's
reading, the arrow keys walk one bucket at a time, and `Home` and `End` jump to
the ends. When the Milestones switch is on, each visible Milestone is a vertical
rule at its own date, in its own colour, under the data ink and under the
readout's paper so the figure stays legible over it.

**Where the controls are.** The chart itself: point at it, or focus it and use the
arrow keys, `Home` and `End`. The Milestones switch that rules its milestones is
`Options` then `Milestones`.
