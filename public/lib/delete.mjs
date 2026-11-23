/*
 * PACT's Delete: what the key says it did.
 *
 * The Delete key removes the record under the pointer with no dialog, so the
 * notice is the only account of what went. Destroying a Project or a Person
 * takes every Assignment that referenced them in the same write, and the store
 * answers with the count - so a removal of one record among its work is never
 * spoken as if it were a removal of the record alone. The kind is the
 * clipboard's own, because the key deletes the record Ctrl+C picks up.
 *
 * A plain ES module with one import, so the browser (public/app.js) and
 * `node --test` load exactly the same source.
 */
import { PERSON } from "./clipboard.mjs";

// The count the store returned, as a number. Anything that is not a positive
// count reads as nothing having gone with the record.
function cascadeCount(assignments) {
  const count = Number(assignments);
  return count >= 1 ? Math.floor(count) : 0;
}

/*
 * What a deletion says: the record's own name, and, when Assignments went with
 * it, how many - `Deleted "Atlas" and its 3 Assignments`. One reads as
 * `1 Assignment`, and a record that took nothing with it is named on its own,
 * as `Deleted "Anna Meier"`. A Person is spoken of as the documents speak of
 * one, so their work goes with them.
 */
export function deletionNotice(kind, name, assignments) {
  const quoted = "\"" + String(name == null ? "" : name) + "\"";
  const count = cascadeCount(assignments);
  if (count === 0) return "Deleted " + quoted;
  const possessive = kind === PERSON ? "their" : "its";
  return "Deleted " + quoted + " and " + possessive + " " + count + " " +
    (count === 1 ? "Assignment" : "Assignments");
}
