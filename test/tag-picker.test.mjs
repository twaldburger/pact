import test from "node:test";
import assert from "node:assert/strict";
import {
  CHOOSE_NONE,
  applyLabel,
  choiceRows,
  choiceText,
  offeredTags,
  tickToggled,
  commitLabel,
  committedTags,
  enterTags
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

test("Enter ranks ticked rows, then the highlighted row, then the typed text", () => {
  const rows = ["skill:backend", "skill:frontend"];
  // Ticked rows outrank the highlight: the multi-select lands whole, and the
  // typed text is spent on narrowing rather than added as a tag of its own.
  assert.deepEqual(enterTags("skill:f", ["ops", "design"], rows, 0), ["ops", "design"]);
  // A highlighted row beats the typed text: a partial word chooses the tag it
  // was narrowing to instead of making a new one of it.
  assert.deepEqual(enterTags("skill:back", [], rows, 0), ["skill:backend"]);
  assert.deepEqual(enterTags("skill:front", [], rows, 1), ["skill:frontend"]);
  // With nothing highlighted, the typed text is only committed when the list
  // holds no row: a term matching nothing is still the way a new tag is made.
  assert.deepEqual(enterTags("skill:mobile", [], rows, -1), ["skill:mobile"]);
  assert.deepEqual(enterTags("skill:mobile", [], [], -1), ["skill:mobile"]);
  // Nothing typed and nothing highlighted adds nothing.
  assert.deepEqual(enterTags("", [], rows, -1), []);
  assert.deepEqual(enterTags("   ", [], [], -1), []);
  assert.deepEqual(enterTags(null, null, null, -1), []);
});

test("typed text differing only by case or surrounding space names the row", () => {
  const rows = ["skill:backend", "ops"];
  // The highlighted row, whatever the case the typist used.
  assert.deepEqual(enterTags(" Skill:Backend ", [], rows, 0), ["skill:backend"]);
  // And even with no highlight to go on, the row answers rather than a second
  // tag differing by a capital letter.
  assert.deepEqual(enterTags("OPS", [], rows, -1), ["ops"]);
  assert.deepEqual(enterTags("  ops", [], rows, -1), ["ops"]);
});

test("a closed choice field names what is chosen, or offers the list", () => {
  // One field is one line: the choice reads as the values it holds, in order.
  assert.equal(choiceText([]), CHOOSE_NONE);
  assert.equal(choiceText(null), CHOOSE_NONE);
  assert.equal(choiceText([""]), CHOOSE_NONE);
  assert.equal(choiceText(["Epic"]), "Epic");
  assert.equal(choiceText(["Epic", "Feature"]), "Epic, Feature");
});

test("the rows are the vocabulary, then any chosen name it does not report", () => {
  assert.deepEqual(choiceRows(["Epic", "Feature"], []), ["Epic", "Feature"]);
  // A type the instance no longer reports is still listed, so a mapping the
  // plan already holds is never changed behind the person's back.
  assert.deepEqual(choiceRows(["Epic", "Feature"], ["Bug"]), ["Epic", "Feature", "Bug"]);
  assert.deepEqual(choiceRows([], ["Bug"]), ["Bug"]);
  // A chosen name the vocabulary does name is one row, not two.
  assert.deepEqual(choiceRows(["Epic"], ["Epic"]), ["Epic"]);
  assert.deepEqual(choiceRows(null, null), []);
});

test("the commit row counts the ticks, and choosing none is a choice", () => {
  // Unlike a tag field, a list that replaces its choice can commit none of it.
  assert.equal(applyLabel(0), "Use no types");
  assert.equal(applyLabel(1), "Use 1 type");
  assert.equal(applyLabel(2), "Use 2 types");
});
