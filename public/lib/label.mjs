/*
 * PACT block labels: whether a block has room for its title, and how much of
 * it. The rule is about the room the block actually has - its measured box
 * against the label's measured width - never the zoom, and never the number of
 * days the block spans. A wide block shows its title at any scale, and a block
 * without room shows nothing rather than a fragment.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source. All measurements are pixels in
 * the label's own font: the caller measures, this decides.
 */

// The label as it is drawn: the Project's name, then its share of the Person.
// Both have to fit before the label is worth writing at all, because a bare
// percentage inside an unidentified block reads as noise - and the share is
// already in the Assignment popover and in the row header.
export const LABEL_SEPARATOR = " \u00b7 ";

// What marks a title that had to be cut.
export const ELLIPSIS = "\u2026";

// The months as the range label and the axis name them.
export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul",
  "Aug", "Sep", "Oct", "Nov", "Dec"];

/*
 * The plan's own extent, named unambiguously from its two ISO dates: both
 * years when they differ ("Sep 2026 - Oct 2027"), a single year when the
 * months share one ("Sep - Oct 2026"), and a single month when the range is
 * one ("Sep 2026"). A year is never left to be inferred from the end alone.
 */
export function rangeLabel(startISO, endISO) {
  const startMonth = +startISO.slice(5, 7) - 1;
  const endMonth = +endISO.slice(5, 7) - 1;
  const startYear = startISO.slice(0, 4);
  const endYear = endISO.slice(0, 4);
  const startName = MONTHS_SHORT[startMonth];
  const endName = MONTHS_SHORT[endMonth];
  if (startYear !== endYear) return startName + " " + startYear + " - " + endName + " " + endYear;
  if (startMonth !== endMonth) return startName + " - " + endName + " " + startYear;
  return startName + " " + startYear;
}

// A cut title keeps at least this many characters. Below it the block would
// show a fragment with no name left in it, which is worse than showing nothing.
export const LABEL_MIN_CHARS = 3;

export function labelText(title, share) {
  return title + LABEL_SEPARATOR + share + "%";
}

/*
 * The block's native title: the label, and beneath it the Assignment's note
 * when it has one. A newline is a second line in the native tooltip that
 * renders it. The note is written as stored - the panel's own field - but a
 * note with nothing in it, or only whitespace, adds no line at all.
 */
export function hoverText(title, share, note) {
  const text = note == null ? "" : String(note);
  return text.trim() ? labelText(title, share) + "\n" + text : labelText(title, share);
}

/*
 * What a block draws, given the room its label has and a `measure(text)` of
 * the drawn width of a string:
 *
 *   - `width` and `height` are the room the label has, in the label's own
 *     pixels, with the block's insets already taken off;
 *   - `textHeight` is the height one line of the label needs to be legible
 *     (its font size), so a short block draws nothing;
 *   - `title` and `share` are the Assignment's, as `labelText` draws them.
 *
 * The whole label is preferred. When only the title fits, the title is drawn
 * whole. When less than that fits, the title is cut at a word boundary when one
 * fits - the longest whole-word prefix that still leaves room for the ellipsis -
 * and only then falls back to the longest character-level prefix, which is the
 * cut a single unbreakable word has to take. Either cut is kept only when
 * `minChars` characters survive it. Anything less draws nothing at all.
 */
export function blockLabel(options) {
  const title = options.title == null ? "" : String(options.title);
  const measure = options.measure;
  const width = Number(options.width);
  const height = Number(options.height);
  const textHeight = Number(options.textHeight);
  const minChars = options.minChars == null ? LABEL_MIN_CHARS : options.minChars;
  if (!title || typeof measure !== "function") return "";
  if (!(width > 0) || !(height >= textHeight)) return "";

  const full = labelText(title, options.share);
  if (measure(full) <= width) return full;
  if (measure(title) <= width) return title;

  const wordCut = wordBoundaryCut(title, width, measure, minChars);
  if (wordCut !== "") return wordCut;

  for (let n = title.length - 1; n >= minChars; n--) {
    if (measure(title.slice(0, n) + ELLIPSIS) <= width) {
      return title.slice(0, n) + ELLIPSIS;
    }
  }
  return "";
}

/*
 * The prefixes of `title` that end on a whole word, longest first, with the
 * whitespace that followed each one dropped: "Meridian Design System" gives
 * "Meridian Design System", then "Meridian Design", then "Meridian". The
 * caller takes the longest that fits, so a cut lands after a word rather than
 * inside one:
 *
 *     Meridian Design...   rather than   Meridia...
 *
 * A single word has no boundary but its own end, which the whole-title
 * preference has already rejected, so the caller falls through to the
 * character-level cut.
 */
function wordBoundaryPrefixes(title) {
  const out = [];
  let i = 0;
  while (i < title.length) {
    while (i < title.length && /\s/.test(title.charAt(i))) i++;
    const start = i;
    while (i < title.length && !/\s/.test(title.charAt(i))) i++;
    if (i > start) out.push(title.slice(0, i));
  }
  return out.reverse();
}

// The longest whole-word cut that fits with the ellipsis and keeps at least
// `minChars` characters. "" when no word boundary works, which is what sends
// `blockLabel` to its character-level fallback.
function wordBoundaryCut(title, width, measure, minChars) {
  const prefixes = wordBoundaryPrefixes(title);
  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i];
    if (prefix.length < minChars) break;
    if (measure(prefix + ELLIPSIS) <= width) return prefix + ELLIPSIS;
  }
  return "";
}
