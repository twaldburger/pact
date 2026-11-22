---
type: Guide
title: Checking how PACT looks
description: How to verify what the app draws - by measuring it or looking at it - and what to say when neither happened.
---

# Checking how PACT looks

A plan change is verified by reading the plan back. A drawing is not: **a
visual outcome is verified only if it was measured or somebody looked at it.**
A value in the file, a rule in a module and a green test say what the app
should draw, never what it drew.

This page is the how. It is the one the map's third rule points at.

## Start the app, and note where it serves

```
node server.mjs
```

Node 20 or later is the only requirement. The server prints the URL it serves
on - `http://localhost:4173/` unless `PORT` says otherwise - and the plan file
it opened. Everything below is against that URL. `PACT_URL` is where the tool
looks for the app when it is not on the default port.

## Read the settings first

```
node bin/pact.mjs view
```

That prints the View settings the app is drawing with - the Zoom and each
zoom's Grid spacing, the Row height, the overlays, the palette, the rail's fold,
the report's zoom and view, the two sorts - and the plan-level settings a
display rests on: the plan's period, its Step and its sprint cadence. `--json`
gives the same facts to a script.

This is the cheapest check there is, and it is **not** an appearance check. It
says which setting the screen should be drawing; it says nothing about what the
screen drew.

## What can be measured, and what only an eye can settle

Measured, in the page: that a Person's row is present, the number of day columns
at a zoom, the drawn height of a row against its stored Row height, a block's
position and size against its Assignment's dates and Allocation, the computed
fill of a block against the Colour palette, the count of shaded weekend columns,
whether the Minimap or the Marker exists at all. Each of these is a number or a
yes-or-no that a script can read back and a reviewer can re-run.

Only an eye can settle: whether a label is legible at a zoom, whether two
overlapping blocks read as over-allocation or as a mistake, whether a cut title
still identifies its Project, whether the palette reads against the theme,
whether the whole board reads as the plan. No assertion list decides these, and
a screenshot you did not look at does not either.

Assert data through the app's own API (`/api/plan`, `/api/view`) and keep the
DOM for what the API cannot say: geometry, computed style, and what is actually
on the page.

## Capture the page

This is **one worked example**, not the supported way: this repository has no
dependencies and will not gain one for this. An agent with a browser tool
(Playwright MCP, Chrome DevTools MCP, a headless Chromium on `PATH`) should use
whatever it already has. With Chrome or Chromium on the `PATH` and nothing
installed:

```
chromium --headless=new --disable-gpu --window-size=1600,1000 \
  --virtual-time-budget=3000 \
  --screenshot=/tmp/pact-grid.png http://localhost:4173/
```

Then look at `/tmp/pact-grid.png` - really look, at full size - and assert on
the page itself with the same browser dumping its live DOM:

```
chromium --headless=new --disable-gpu --virtual-time-budget=3000 \
  --dump-dom http://localhost:4173/ > /tmp/pact-dom.html
```

The board is drawn after the app's first request to `/api/plan`, so a dump taken
too early shows an empty shell: raise the budget, or use a tool that can wait
for a row to appear. A dump that does not contain the Person you expect is not
an appearance verdict - it is a capture that has not finished.

Assert before you look, so the screenshot only has to answer the questions you
could not put into a number.

## When neither happened

Say what changed, and ask. "`view set zoom week --apply` stored the zoom as
week; I have not looked at the board" is a complete report. "The zoom is week
now, it looks right" is not, unless you looked.

Never turn "I wrote the value" into "it looks right", and never let a screenshot
stand in for looking at it: a capture nobody read is a file, not a check.

## Where the answers live

- The settings the app is drawing with: `node bin/pact.mjs view`.
- The plan's figures: `node bin/pact.mjs people`, `projects`, `capacity`, and the
  rest of the tool's reads.
- What the screen actually drew: the page, measured or looked at.
- What each setting is: [`features.md`](features.md), under the capability it
  drives.
