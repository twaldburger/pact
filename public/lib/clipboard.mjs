/*
 * PACT's Session clipboard: what Ctrl+C holds, and what Ctrl+V makes of it.
 *
 * One slot serves all three things a pointer can pick up - a Project from the
 * rail, an Assignment from a block and a Person from a row header - so the slot
 * carries a kind beside what it holds. That kind is what keeps Ctrl+V honest: a
 * held Project never pastes as an Assignment or a Person, and neither of those
 * pastes as a Project, whichever surface the pointer happens to be over.
 *
 * The clipboard lives in memory only. The system clipboard is never read or
 * written, so copying text elsewhere keeps working and a held copy dies with a
 * page reload.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` load exactly the same source.
 */

// The three surfaces a pointer can be over, as the clipboard reads them: the
// Projects rail, the grid of Person rows, and the People column of row headers
// down the grid's left. Anything else is none of them.
export const RAIL = "rail";
export const GRID = "grid";
export const PEOPLE = "people";

export const PROJECT = "project";
export const ASSIGNMENT = "assignment";
export const PERSON = "person";

// A held Project is its id and nothing else. The Project itself is read from
// the plan at paste time, so a copy is never a snapshot that can go stale
// while it waits.
export function projectCopy(projectId) {
  return { kind: PROJECT, projectId: String(projectId) };
}

// A held Assignment keeps what a paste needs: the Project, the Share, the name,
// the tags, the note and the length in whole days. The id is the Project's,
// never the Assignment's - a paste creates a new one.
export function assignmentCopy(copy) {
  const source = copy || {};
  return {
    kind: ASSIGNMENT,
    projectId: String(source.projectId),
    share: source.share,
    name: source.name || "",
    tags: (source.tags || []).slice(),
    note: source.note || "",
    days: source.days
  };
}

// A held Person is its id and nothing else, as a held Project is. The Person is
// read from the plan at paste time, so the copy is never a snapshot that can go
// stale while it waits - and their Assignments are never part of it, because
// the copy starts with none.
export function personCopy(personId) {
  return { kind: PERSON, personId: String(personId) };
}

// What the slot holds: one of the three kinds, or null when it is empty or holds
// something it cannot name. A clipboard that knows its kind can never be pasted
// as another one.
export function clipboardKind(clipboard) {
  const kind = clipboard && clipboard.kind;
  return kind === PROJECT || kind === ASSIGNMENT || kind === PERSON ? kind : null;
}

/*
 * What Ctrl+C picks up on a surface. A rail row carries its Project, because a
 * Project is what the rail lists; a row header carries its Person, because a
 * Person is what the People column lists. A block in the grid carries nothing:
 * it names a Project the reader happens to hover, and picking one up there
 * would copy something nobody pointed at.
 */
export function pickUpIntent(surface) {
  if (surface === RAIL) return PROJECT;
  if (surface === PEOPLE) return PERSON;
  return null;
}

/*
 * What Ctrl+V means for this clipboard over this surface, as one of the three
 * kinds or null for "nothing happens".
 *
 * A Project needs no target: it lives in the rail and sorts itself, so a paste
 * anywhere over the rail makes the copy, and over the grid there is nothing for
 * it to land on. A Person is the same shape in their own column: a name sorts
 * itself into the People column, so a paste anywhere over that column makes the
 * copy. An Assignment is the reverse - it needs a Person's row to land in, and
 * neither the rail nor the People column has dates.
 */
export function pasteIntent(clipboard, surface) {
  const kind = clipboardKind(clipboard);
  if (kind === PROJECT) return surface === RAIL ? PROJECT : null;
  if (kind === ASSIGNMENT) return surface === GRID ? ASSIGNMENT : null;
  if (kind === PERSON) return surface === PEOPLE ? PERSON : null;
  return null;
}

/*
 * Whether the rail row under the pointer carries the paste tint. It does while
 * the clipboard holds a Project, whichever row that is: a paste over the rail
 * makes the copy wherever the pointer sits, so the tint marks the surface the
 * paste will land on rather than one particular row.
 */
export function railRowTinted(clipboard) {
  return clipboardKind(clipboard) === PROJECT;
}

/*
 * Whether the row header under the pointer carries the tint. It does while the
 * clipboard holds a Person, for the same reason: a paste over the People column
 * makes the copy wherever the pointer sits in it, so the tint marks the column
 * the paste will land in rather than one particular row.
 */
export function rowHeaderTinted(clipboard) {
  return clipboardKind(clipboard) === PERSON;
}
