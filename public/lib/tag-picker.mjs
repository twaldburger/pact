/*
 * PACT's picker: the rules behind the list a multi-choice field opens, kept
 * apart from the DOM that draws it so `node --test` pins them. One list serves
 * two fields - a tag field, whose vocabulary is the plan's own tags, and the
 * ADO mapping's lists, whose vocabulary is the types the instance ranks - so
 * the rules and the manners are written once here.
 *
 * A tag field offers the plan's own vocabulary for its editor's vocabulary -
 * a Person field offers other People's tags, a Project field other Projects'
 * and so on, which `suggestPersonTags` and its siblings in panels.mjs decide.
 * This module answers the rest of the question: which of those are offered for
 * what has been typed, which are ticked, and what the field's tags are after a
 * commit.
 *
 * Two things are hidden from the list. The suggestions already leave out the
 * edited record's own tags, and `carried` adds the tags the editor holds right
 * now, so a tag added as a chip during this edit is not offered back either.
 * Everything is matched case-insensitively, by the Filter's own substring rule,
 * so the two surfaces feel alike.
 */
import { matchesQuery } from "./filter.mjs";
import { hasTag, withTag } from "./panels.mjs";

// The word a closed choice field shows when it holds nothing. The ellipsis is
// the app's own: it says a list opens, as the Filter's rows do.
export const CHOOSE_NONE = "Choose\u2026";

function isName(value) {
  return typeof value === "string" && value.trim() !== "";
}

/*
 * What a closed choice field says: the values it holds, in the order it holds
 * them, or the stand-in word when it holds none. One field is one line, so a
 * several-value choice is named on that line rather than as a row per value.
 */
export function choiceText(chosen) {
  const list = (chosen || []).filter(isName);
  return list.length ? list.join(", ") : CHOOSE_NONE;
}

/*
 * The rows a choice list shows: the vocabulary it was given, then any chosen
 * value that vocabulary does not name. A plan may store a type the instance no
 * longer reports, and a list that hid it would change the mapping behind the
 * person's back - so it stays listed, and stays ticked, until the person
 * unticks it themselves.
 */
export function choiceRows(vocabulary, chosen) {
  const rows = (vocabulary || []).filter(isName);
  (chosen || []).filter(isName).forEach(function (name) {
    if (rows.indexOf(name) === -1) rows.push(name);
  });
  return rows;
}

// The commit row's words for a list that replaces its choice: the count of the
// ticks, where choosing none is a real answer rather than an empty one.
export function applyLabel(count) {
  if (count === 0) return "Use no types";
  return count === 1 ? "Use 1 type" : "Use " + count + " types";
}

/*
 * The tags the list shows: the offered vocabulary, minus anything the editor
 * already carries, narrowed by a case-insensitive substring. An empty query
 * keeps everything, as the datalist did.
 */
export function offeredTags(suggestions, carried, query) {
  const own = carried || [];
  const text = String(query == null ? "" : query).trim();
  return (suggestions || []).filter(function (tag) {
    return typeof tag === "string" && !hasTag(own, tag) && matchesQuery(tag, text);
  });
}

/*
 * The tick set after a row is ticked or unticked, in the order the rows were
 * ticked. The set belongs to the open list rather than to the query, so
 * narrowing the list never untick anything: a tag narrowed out of the view is
 * still added by the commit that follows.
 */
export function tickToggled(ticks, tag) {
  const list = ticks || [];
  const kept = list.filter(function (t) { return !hasTag([t], tag); });
  return kept.length === list.length ? list.concat(String(tag)) : kept;
}

// The row a pointer or Enter commits the whole tick set through, and its count
// in words: one tag is a tag, never "Add 1 tags".
export function commitLabel(count) {
  return count === 1 ? "Add 1 tag" : "Add " + count + " tags";
}

/*
 * The field's tags after a commit: the typed text, when there is any, and every
 * ticked tag, added to what the field already carries. Adding is hands-off
 * about duplicates and order, as `withTag` always is: a tag already there is
 * not added twice, and the result is sorted case-insensitively.
 */
export function committedTags(current, typed, ticks) {
  const started = withTag(current, typed);
  return (ticks || []).reduce(function (list, tag) {
    return withTag(list, tag);
  }, started);
}

// A tag as the picker compares texts: a capital letter and a stray space are
// what a keyboard adds by accident, so two tags differing only in those are one
// tag to the person choosing.
function folded(text) {
  return String(text == null ? "" : text).trim().toLowerCase();
}

/*
 * The tags Enter adds, in the order the list ranks them: every ticked row, so
 * the keyboard's multi-select lands whole; else the highlighted row, so a
 * half-typed `skill:back` chooses the `skill:backend` it was narrowing to
 * instead of making a new tag of itself; else the typed text, which is how a
 * genuinely new tag is made. A word that names a row - equal to it but for case
 * and surrounding space - is that row, never a second tag differing by a
 * capital letter.
 *
 * An empty answer is Enter with nothing to add: an empty field with no ticked
 * and no highlighted row.
 */
export function enterTags(typed, ticks, shown, rowIndex) {
  const ticked = ticks || [];
  if (ticked.length) return ticked.slice();
  const rows = shown || [];
  const row = rows[rowIndex];
  if (typeof row === "string") return [row];
  const text = folded(typed);
  if (text === "") return [];
  const named = rows.filter(function (tag) { return folded(tag) === text; })[0];
  return [named === undefined ? String(typed) : named];
}
