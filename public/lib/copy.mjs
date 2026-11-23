/*
 * PACT's Copy: the name a copy of a Project takes.
 *
 * Copy creates the new Project at once, so the only rule that is not the DOM's
 * is this one - what the copy is called. A copy cannot keep the source's name
 * and stay findable, so it wears a suffix, numbered up while a live Project
 * holds that name already.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source.
 */

// A name already ending in a copy suffix, so copying a copy numbers it on
// rather than nesting one suffix inside the next.
const COPY_SUFFIX = /\s+\(copy(?: (\d+))?\)$/;

// The name without a copy suffix: what a copy numbers from. `(copy 0)` is
// only ever part of a name, so it leaves the name alone.
function baseName(name) {
  const text = String(name == null ? "" : name).trim();
  const match = COPY_SUFFIX.exec(text);
  if (!match) return text;
  const number = match[1] === undefined ? 1 : Number(match[1]);
  if (number < 1) return text;
  return text.slice(0, match.index).trim();
}

function nameKey(name) {
  return String(name).trim().toLowerCase();
}

/*
 * The name a copy takes: `X (copy)`, then `X (copy 2)`, `X (copy 3)` and so on
 * until it is a name no live Project holds. Matching is case-insensitive,
 * because two names that differ only in case read as the same name.
 *
 * A source already ending in a suffix keeps its own base, so copying
 * `Atlas (copy 2)` names the copy `Atlas (copy 3)` rather than stacking one
 * suffix on the next. The list is finite, so the search always ends.
 */
export function copyName(sourceName, liveNames) {
  const base = baseName(sourceName);
  const taken = new Set((liveNames || []).map(nameKey));
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? base + " (copy)" : base + " (copy " + n + ")";
    if (!taken.has(nameKey(candidate))) return candidate;
  }
}
