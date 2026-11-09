# Deletion exists beside archiving

Deleting permanently destroys a Person, a Project or an Assignment, and it is a separate act from archiving rather than a replacement for it.

Archiving stays what ADR-0005 made it: a removal that keeps every Assignment and can be restored. Deletion removes the record from the file outright, with no trash and no undo, so recovery is the owner's own backup of `data/pact.json`. Neither requires the other - a live thing can be deleted without being archived first, and an archived thing can be deleted once its archive has served its purpose.

Deleting a Person or a Project takes its Assignments with it, archived ones included, and the confirmation names the number first - "This deletes Borealis and the 6 assignments on it." - so the loss is visible before it happens. Deleting an Assignment deletes only that one. Delete sits beside Archive in the person panel, the project panel and the assignment popover, in the signal colour the interface reserves for destructive and failure states, always behind a confirmation that says plainly that it cannot be undone.

This is an addition, not a reversal: ADR-0005 stands unchanged. Extending archiving to mean deletion was rejected because the two states promise different things - an archive that can be brought back, and a deletion that cannot.

Amended later: the running server keeps a 100-step in-memory history, and Undo reverses a deletion for as long as it remains in that history. The confirmation therefore says that Undo can still bring it back rather than that it cannot be undone; the decision above is otherwise unchanged.

Amended later again: the confirmation was removed altogether. One click archives or deletes with no dialog and nothing in its place, an Assignment can also be deleted with the Delete key while the pointer is over its block, and Undo's in-memory history is what makes a mistaken act recoverable.
