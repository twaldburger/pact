import test from "node:test";
import assert from "node:assert/strict";
import {
  offeredTags,
  tickToggled,
  commitLabel,
  committedTags
} from "../public/lib/tag-picker.mjs";
import { suggestPersonTags } from "../public/lib/panels.mjs";

test("an empty field offers the whole vocabulary it was given", () => {
  assert.deepEqual(offeredTags(["delivery", "ops", "qa"], [], ""), ["delivery", "ops", "qa"]);
  assert.deepEqual(offeredTags(["delivery", "ops", "qa"], [], "   "), ["delivery", "ops", "qa"]);
  assert.deepEqual(offeredTags(null, null, null), []);
});

test("the list narrows by a case-insensitive substring, not a prefix", () => {
  const all = ["api:Solar", "api:Stellar", "design", "Design review", "ops"];
  assert.deepEqual(offeredTags(all, [], "api"), ["api:Solar", "api:Stellar"]);
  // Case is ignored on both sides, and the match is anywhere in the tag.
  assert.deepEqual(offeredTags(all, [], "STELL"), ["api:Stellar"]);
  assert.deepEqual(offeredTags(all, [], "review"), ["Design review"]);
  assert.deepEqual(offeredTags(all, [], "sign"), ["design", "Design review"]);
  assert.deepEqual(offeredTags(all, [], "nothing here"), []);
});

test("a tag the record already carries is not offered", () => {
  // The suggestions themselves leave out the edited record's own tags.
  const people = [
    { id: "anna", tags: ["lead", "React"] },
    { id: "ben", tags: ["design", "React"] }
  ];
  assert.deepEqual(suggestPersonTags(people, "anna"), ["design"]);
  // And the picker hides what the editor carries now, whichever route it took.
  assert.deepEqual(offeredTags(["design", "ops"], ["Design"], ""), ["ops"]);
  // A tag added as a chip during this edit is not in the suggestion set's own
  // exclusion, so this is what keeps it out of the list.
  const carried = committedTags(["lead"], "", ["ops"]);
  assert.deepEqual(offeredTags(["design", "ops", "qa"], carried, ""), ["design", "qa"]);
});

test("the tick set survives a narrowing, and its count names the whole set", () => {
  let ticks = tickToggled([], "api:Solar");
  ticks = tickToggled(ticks, "api:Stellar");
  assert.deepEqual(ticks, ["api:Solar", "api:Stellar"]);
  // Narrowing to one row leaves both ticks, and the commit row still says two.
  const shown = offeredTags(["api:Solar", "api:Stellar", "ops"], [], "solar");
  assert.deepEqual(shown, ["api:Solar"]);
  assert.equal(commitLabel(ticks.length), "Add 2 tags");
  // Unticking one leaves the other, whichever order they were ticked in.
  assert.deepEqual(tickToggled(ticks, "API:solar"), ["api:Stellar"]);
  assert.equal(commitLabel(1), "Add 1 tag");
  assert.equal(commitLabel(0), "Add 0 tags");
});

test("a commit adds the typed text and every ticked tag at once", () => {
  // Ticks alone, the keyboard's multi-select: sorted, case-insensitively.
  assert.deepEqual(committedTags(["lead"], "", ["ops", "Design"]), ["Design", "lead", "ops"]);
  // Nothing ticked: the typed text becomes the new tag, exactly as typed.
  assert.deepEqual(committedTags(["lead"], "api: Solar", []), ["api: Solar", "lead"]);
  // Typed text and ticks together, with a duplicate that is added once.
  assert.deepEqual(
    committedTags(["lead"], "qa", ["QA", "ops"]),
    ["lead", "ops", "qa"]
  );
  // Nothing typed and nothing ticked leaves the tags exactly as they were.
  assert.deepEqual(committedTags(["lead"], "", []), ["lead"]);
});
