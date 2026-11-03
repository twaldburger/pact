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

// A cut title keeps at least this many characters. Below it the block would
// show a fragment with no name left in it, which is worse than showing nothing.
export const LABEL_MIN_CHARS = 3;

export function labelText(title, share) {
  return title + LABEL_SEPARATOR + share + "%";
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
 * whole. When less than that fits, the title is cut to the longest prefix that
 * still leaves room for the ellipsis, and only when `minChars` characters
 * survive the cut. Anything less draws nothing at all.
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

  for (let n = title.length - 1; n >= minChars; n--) {
    if (measure(title.slice(0, n) + ELLIPSIS) <= width) {
      return title.slice(0, n) + ELLIPSIS;
    }
  }
  return "";
}
