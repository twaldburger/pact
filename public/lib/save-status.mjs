/*
 * The top bar's save status, kept apart from the DOM so `node --test` can pin
 * the one decision it makes. A non-GET call to api() is a write; the status
 * tracks writes only, not a half-filled panel or a session-only setting.
 */
export const SAVED = "Saved";
export const SAVING = "Saving\u2026";
export const NOT_SAVED = "Not saved";

// While a write is in flight the word is Saving…; with none in flight the most
// recent write's fate decides, and Not saved stays until a later write lands.
export function saveStatusWord(pending, lastWriteFailed) {
  if (pending > 0) return SAVING;
  return lastWriteFailed ? NOT_SAVED : SAVED;
}
