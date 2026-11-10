# Text overflow standard

Confirmed by the owner on 2026-11-10. Behaviour only: the plan data does not
change. One rule governs every surface that draws a name or other text.

## The rule

- **Wrap where there is room to grow.** A surface that can become taller lets a
  long name continue onto further lines. The Stack rail and the panels do this.
- **Truncate where the space is fixed.** A surface whose width is set keeps its
  text on one line and ends it in an ellipsis. The Assignment block labels, the
  row headers, and the Filter with its suggestions do this.
- **The cut prefers a word boundary.** `Meridian Design…` rather than
  `Meridia…`: the longest whole-word prefix that fits with the ellipsis is
  drawn. When not even the first word fits, the cut falls back to the
  character-level prefix that does.
- **The floor is three characters.** A surface narrower than roughly three
  characters draws nothing rather than a fragment with no name left in it.
- **A truncated value carries its full text on hover**, everywhere the rule
  truncates - a native `title`, or the tooltip a block already carries.
- **The top bar scrolls sideways.** It has no text to cut, so the rule does not
  reach it.

Wrapping and truncation are the two answers to the same question, and the
surface's own width decides which it gets: one that can grow taller wraps, one
whose width the grid fixes truncates.

## Where it lives

The block-label cut is `blockLabel` in [`public/lib/label.mjs`](../public/lib/label.mjs);
the rest is the CSS each surface is drawn with in
[`public/style.css`](../public/style.css), with the hover text set where the
element is built in [`public/app.js`](../public/app.js).
