import test from "node:test";
import assert from "node:assert/strict";
import {
  TAG_LEVELS,
  TAG_LEVEL_LABELS,
  isTagLevel,
  tagKind,
  tagValue,
  isTypedTag,
  tagUnderKey,
  slotForTags,
  tagKeys,
  tagColourSlots,
  assignmentSlot,
  personSlot,
  blockIsHollow,
  planTypedTags,
  tagKindGroups,
  tagsUnderKeys,
  assignTagSlots,
  chooseTagSlot,
  cleanTagColours
} from "../public/lib/tags.mjs";

test("the kind is everything before the first colon, the value everything after", () => {
  assert.equal(tagKind("api:Stellar"), "api");
  assert.equal(tagValue("api:Stellar"), "Stellar");
  // A second colon is part of the value, not a second kind.
  assert.equal(tagKind("api:Stellar:beta"), "api");
  assert.equal(tagValue("api:Stellar:beta"), "Stellar:beta");
  // The outer spaces of both are stripped, as the Filter strips a field term.
  assert.equal(tagKind("  api : Stellar "), "api");
  assert.equal(tagValue("  api : Stellar "), "Stellar");
});

test("an untyped tag is left completely alone", () => {
  assert.equal(tagKind("DevOps"), "");
  assert.equal(tagValue("DevOps"), "");
  assert.equal(isTypedTag("DevOps"), false);
  // A kind with no value, or a value with no kind, is not a typed tag.
  assert.equal(isTypedTag("api:"), false);
  assert.equal(isTypedTag(":Stellar"), false);
  assert.equal(isTypedTag(""), false);
  assert.equal(isTypedTag(undefined), false);
  assert.equal(isTypedTag("api:Stellar"), true);
});

test("the first listed tag under the key wins", () => {
  assert.equal(tagUnderKey(["skill:DevOps", "skill:Design"], "skill"), "skill:DevOps");
  assert.equal(tagUnderKey(["skill:Design", "skill:DevOps"], "skill"), "skill:Design");
  // Only tags of the chosen kind match, and only typed ones.
  assert.equal(tagUnderKey(["api:Stellar", "skill:DevOps"], "skill"), "skill:DevOps");
  assert.equal(tagUnderKey(["skill:", "skill:DevOps"], "skill"), "skill:DevOps");
  assert.equal(tagUnderKey(["DevOps"], "skill"), "");
  assert.equal(tagUnderKey(["skill:DevOps"], ""), "");
  assert.equal(tagUnderKey(undefined, "skill"), "");
});

test("a slot comes only from the first tag under the key, when the mapping has one", () => {
  const colours = { "skill:DevOps": 2, "skill:Design": 4 };
  assert.equal(slotForTags(["skill:DevOps"], "skill", colours), 2);
  // The first listed is uncoloured, so the second must not step in for it.
  assert.equal(slotForTags(["skill:Ops", "skill:Design"], "skill", colours), null);
  assert.equal(slotForTags(["skill:Design"], "skill", colours), 4);
  assert.equal(slotForTags(["skill:Design"], "offKey", colours), null);
  assert.equal(slotForTags(["skill:Design"], "skill", undefined), null);
});

test("an Assignment's own key tag beats its Project's", () => {
  const keys = { projects: "api", people: "skill", assignments: "work" };
  const colours = { "api:Stellar": 1, "work:Release": 5 };
  assert.equal(assignmentSlot(["work:Release"], ["api:Stellar"], keys, colours), 5);
  // No own tag under the key, so the Project's colours it.
  assert.equal(assignmentSlot([], ["api:Stellar"], keys, colours), 1);
  assert.equal(assignmentSlot(["skill:DevOps"], ["api:Stellar"], keys, colours), 1);
  // Neither level colours it, so the block keeps its Project colour.
  assert.equal(assignmentSlot([], [], keys, colours), null);
  // With no key chosen at all, nothing is coloured.
  assert.equal(assignmentSlot(["work:Release"], ["api:Stellar"], {}, colours), null);
});

test("a Person draws from their own tag under the people key, or nothing", () => {
  const keys = { people: "skill" };
  const colours = { "skill:DevOps": 6 };
  assert.equal(personSlot(["skill:DevOps"], keys, colours), 6);
  assert.equal(personSlot(["skill:Ops"], keys, colours), null);
  assert.equal(personSlot([], keys, colours), null);
  assert.equal(personSlot(["skill:DevOps"], {}, colours), null);
});

/*
 * The two states of an untagged block. With no block key chosen the resolution
 * being null changes nothing - the block keeps its Project colour - and only
 * once a block key is chosen does a block no chosen key colours draw hollow.
 */
test("an untagged block draws hollow only once a key colours blocks by", () => {
  const keys = { projects: "api", people: "skill", assignments: "work" };
  const colours = { "api:Stellar": 1, "work:Release": 5, "skill:DevOps": 7 };
  // A chosen key colours the block either way, so it is not hollow.
  assert.equal(blockIsHollow(["work:Release"], ["api:Stellar"], keys, colours), false);
  assert.equal(blockIsHollow([], ["api:Stellar"], keys, colours), false);
  // No chosen key colours this block, so it would fall back to its Project
  // colour and instead draws hollow.
  assert.equal(blockIsHollow([], [], keys, colours), true);
  // With no block key chosen at all nothing changes, even though the skill
  // mapping would not colour the block either.
  assert.equal(blockIsHollow([], [], {}, colours), false);
  assert.equal(blockIsHollow([], [], { people: "skill" }, colours), false);
  // Choosing only the assignments key hollows a block with no own tag, since
  // the projects key is not there to colour it.
  assert.equal(blockIsHollow([], ["api:Stellar"], { assignments: "work" }, colours), true);
});

// A Person has no palette colour to fall back to, so an untagged Person shows
// no mark once the people key is chosen rather than a colour mark.
test("an untagged Person shows no mark under the people key", () => {
  const keys = { people: "skill" };
  const colours = { "skill:DevOps": 6, "skill": 2 };
  assert.equal(personSlot(["skill:Ops"], keys, colours), null);
  assert.equal(personSlot([], keys, colours), null);
  assert.equal(personSlot(["lead"], keys, colours), null);
});

test("the levels are the three a key can be chosen for", () => {
  assert.deepEqual(TAG_LEVELS, ["projects", "people", "assignments"]);
  assert.equal(isTagLevel("projects"), true);
  assert.equal(isTagLevel("people"), true);
  assert.equal(isTagLevel("assignments"), true);
  assert.equal(isTagLevel("Project"), false);
  assert.deepEqual(TAG_LEVEL_LABELS, { projects: "Projects", people: "People", assignments: "Assignments" });
});

test("a stored mapping is read as keys and slots, dropping malformed parts", () => {
  const stored = {
    keys: { projects: "api", people: "", assignments: "work", bogus: "x" },
    colours: { "api:Stellar": 3, "api:Ops": 99, "nottyped": 1, "work:Release": "2" }
  };
  assert.deepEqual(tagKeys(stored), { projects: "api", assignments: "work" });
  assert.deepEqual(tagColourSlots(stored), { "api:Stellar": 3 });
  assert.deepEqual(tagKeys(undefined), {});
  assert.deepEqual(tagColourSlots(undefined), {});
});

test("the plan's typed tags are deduplicated across all three lists", () => {
  const plan = {
    people: [{ tags: ["skill:DevOps", "lead"] }],
    projects: [{ tags: ["api:Stellar", "skill:DevOps"] }],
    assignments: [{ tags: ["work:Release", "api:Stellar"] }, { tags: [] }]
  };
  assert.deepEqual(planTypedTags(plan), ["api:Stellar", "skill:DevOps", "work:Release"]);
  assert.deepEqual(planTypedTags({}), []);
});

test("the tags group by kind with their values", () => {
  assert.deepEqual(tagKindGroups(["api:Stellar", "api:Ops", "skill:DevOps"]), [
    { kind: "api", values: [{ tag: "api:Stellar", value: "Stellar" }, { tag: "api:Ops", value: "Ops" }] },
    { kind: "skill", values: [{ tag: "skill:DevOps", value: "DevOps" }] }
  ]);
  assert.deepEqual(tagKindGroups(["DevOps"]), []);
  assert.deepEqual(tagKindGroups(undefined), []);
});

test("an empty or malformed mapping is no mapping, a set one is canonical", () => {
  assert.equal(cleanTagColours(undefined), null);
  assert.equal(cleanTagColours({}), null);
  assert.equal(cleanTagColours({ keys: {}, colours: {} }), null);
  assert.deepEqual(cleanTagColours({ keys: { projects: "api" }, colours: { "api:Stellar": 2 } }), {
    keys: { projects: "api" },
    colours: { "api:Stellar": 2 }
  });
  // Empty and malformed parts are dropped; a mapping left with nothing is null.
  assert.deepEqual(cleanTagColours({ keys: { people: "" }, colours: { "api:Stellar": 2 } }), {
    colours: { "api:Stellar": 2 }
  });
  assert.equal(cleanTagColours({ keys: { people: "" }, colours: { nottyped: 1 } }), null);
  assert.equal(cleanTagColours("api"), null);
  assert.equal(cleanTagColours(["api"]), null);
});

test("with no key chosen, a plan carrying typed tags colours nothing", () => {
  const projects = [{ id: "atlas", colour: 1, tags: ["api:Stellar"] }];
  const assignments = [
    { id: "a1", projectId: "atlas", tags: ["work:Release"] },
    { id: "a2", projectId: "atlas", tags: ["skill:DevOps"] }
  ];
  const keys = {};
  const colours = { "api:Stellar": 3, "work:Release": 5, "skill:DevOps": 7 };
  assignments.forEach((a) => {
    const project = projects.find((p) => p.id === a.projectId);
    assert.equal(assignmentSlot(a.tags, project.tags, keys, colours), null);
  });
  // The people key is unchosen too, so no Person is marked either.
  assert.equal(personSlot(["skill:DevOps"], keys, colours), null);
});

test("choosing a key colours the items that carry one and leaves the rest", () => {
  const keys = { projects: "api" };
  const colours = { "api:Stellar": 3 };
  const projects = [{ id: "atlas", colour: 1, tags: ["api:Stellar"] }, { id: "ops", colour: 2, tags: [] }];
  assert.equal(assignmentSlot([], projects[0].tags, keys, colours), 3);
  assert.equal(assignmentSlot([], projects[1].tags, keys, colours), null);
});

test("a chosen key selects its typed values, and no key selects nothing", () => {
  const tags = ["api:Stellar", "api:Ops", "skill:DevOps", "DevOps"];
  assert.deepEqual(tagsUnderKeys({ projects: "api" }, tags), ["api:Stellar", "api:Ops"]);
  // Any of the three levels can choose the kind, and the same kind twice still
  // selects its values once.
  assert.deepEqual(tagsUnderKeys({ people: "skill" }, tags), ["skill:DevOps"]);
  assert.deepEqual(tagsUnderKeys({ projects: "api", people: "api" }, tags), ["api:Stellar", "api:Ops"]);
  assert.deepEqual(tagsUnderKeys({}, tags), []);
  assert.deepEqual(tagsUnderKeys({ projects: "" }, tags), []);
  assert.deepEqual(tagsUnderKeys(undefined, tags), []);
});

test("PACT gives each value under a chosen key the next free slot", () => {
  const keys = { projects: "api" };
  const tags = ["api:A", "api:B", "api:C"];
  // Ten values spread across the ten palettes in slot order before any repeat.
  const ten = Array.from({ length: 10 }, (_, i) => "api:v" + i);
  const filled = assignTagSlots(keys, ten, {});
  assert.deepEqual(ten.map((t) => filled[t]), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // The eleventh repeats, and the least-used slot is the one it takes.
  const eleven = assignTagSlots(keys, ten.concat(["api:v10"]), filled);
  assert.equal(eleven["api:v10"], 0);
  // A run of three starts at the first free slot.
  assert.deepEqual(assignTagSlots(keys, tags, {}), { "api:A": 0, "api:B": 1, "api:C": 2 });
  // A value set by hand is never reassigned; the free slots step around it.
  assert.deepEqual(assignTagSlots(keys, tags, { "api:B": 5 }), { "api:B": 5, "api:A": 0, "api:C": 1 });
  // Slots already given are kept exactly, even where another would be free.
  const set = { "api:A": 7, "api:B": 8, "api:C": 9 };
  assert.deepEqual(assignTagSlots(keys, tags, set), set);
});

test("PACT assigns nothing outside a chosen key, and nothing with no key chosen", () => {
  const tags = ["api:Stellar", "skill:DevOps"];
  // Only the values under the chosen key are assigned.
  assert.deepEqual(assignTagSlots({ projects: "api" }, tags, {}), { "api:Stellar": 0 });
  // No key chosen at all is no write: the mapping comes back unchanged.
  assert.deepEqual(assignTagSlots({}, tags, {}), {});
  assert.deepEqual(assignTagSlots({}, tags, { "api:Stellar": 4 }), { "api:Stellar": 4 });
  assert.deepEqual(assignTagSlots(undefined, tags, {}), {});
});

test("pressing a value's chosen slot clears it, pressing another chooses it", () => {
  // Pressing the slot already chosen clears the value - the same control that
  // chooses is the one that clears.
  assert.deepEqual(chooseTagSlot({ "api:A": 3 }, "api:A", 3), {});
  // Pressing any other slot chooses that one instead.
  assert.deepEqual(chooseTagSlot({ "api:A": 3 }, "api:A", 6), { "api:A": 6 });
  // Pressing a slot on an uncoloured value chooses it.
  assert.deepEqual(chooseTagSlot({}, "api:A", 0), { "api:A": 0 });
  // Values other than the pressed one keep their slots.
  assert.deepEqual(chooseTagSlot({ "api:A": 3, "api:B": 1 }, "api:A", 6), { "api:A": 6, "api:B": 1 });
  // The mapping given is not changed.
  const colours = { "api:A": 3 };
  chooseTagSlot(colours, "api:A", 6);
  assert.deepEqual(colours, { "api:A": 3 });
});
