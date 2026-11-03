# PACT

People Allocation & Capacity Tracker: a local plan of who works on what, for how
long, and how much of their time it takes. One row is one Person, and the height
of a block is how much of that person a Project takes. See [GLOSSARY.md](GLOSSARY.md)
and `docs/` for the domain model, scope and decisions.

## The interface

The screen is plain HTML, CSS and JavaScript with no framework, no bundler, no
build step and no runtime dependency. Open `public/index.html` directly from the
file system - there is nothing to install or start.

- `public/index.html` - the shell.
- `public/style.css` - the whole token set (palette, type, sizes, durations) as
  CSS custom properties at the top, then the layout: the Stack rail, the sticky
  row-header column and the timeline grid.
- `public/app.js` - draws the calendar bands, rows, ceiling lines and blocks
  from the fixture, and runs the Marker.
- `public/data/fixture.js` - the small fixture the screen draws.
- `public/fonts/` - the bundled Archivo variable font and its OFL licence.

The three zoom states (day, week, month) change only the drawn width of a day.

### The fixture

`public/data/fixture.js` is placeholder data: the three people, four projects
and few assignments the review board shows, with Ben over-committed at the
Marker. It is the seam for the real thing. Once the Node server and its JSON
file exist, replace this file and load the real data instead; the screen keeps
drawing from the same object shape.

It is handed to the page as a classic script rather than being fetched, because
a browser refuses `fetch()` from a `file://` page and the screen has to work
opened straight from disk.

### The font

Archivo is bundled under the SIL Open Font License, which permits it. The Latin
subset in `public/fonts/archivo-variable.woff2` carries both the weight and the
width axes. `public/fonts/OFL.txt` records the upstream source and reproduces
the licence. The CSS falls back to `Archivo, "Helvetica Neue", Arial, system-ui,
sans-serif`, so the page still reads if the file is missing.
