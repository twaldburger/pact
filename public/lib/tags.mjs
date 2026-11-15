/*
 * PACT typed tags and colouring by key: the reading rule that lets a free-text
 * tag carry a kind before a colon, and the rules that turn a tag under a chosen
 * key into a palette slot.
 *
 * A plain ES module with one import (the slot count), so the server's plan
 * validator (lib/plan.mjs), the browser (public/app.js) and `node --test` all
 * read exactly the same source. Every rule here is pure.
 *
 * A tag is any string. Typed tags are a convention, not a schema: nothing is
 * validated, nothing is enforced, and an untyped tag like `DevOps` is untouched
 * by any of this. The kind is everything before the first colon and the value
 * is everything after it, trimmed at their outer spaces, exactly as the
 * Filter's parseFilterTerm reads a `field: value` term.
 *
 * The colours themselves are plan data: the three colour-by-key choices and a
 * slot per typed tag. They travel with the plan, absent until configured, and
 * live in the same ten palette slots the Projects use.
 */
import { SLOT_COUNT } from "./palette.mjs";

// The three levels a key can be chosen for, one key each. The plan stores the
// chosen kind under each of these names, absent while unchosen.
export const TAG_LEVELS = ["projects", "people", "assignments"];
export const TAG_LEVEL_LABELS = Object.freeze({
  projects: "Projects",
  people: "People",
  assignments: "Assignments"
});

export function isTagLevel(value) {
  return TAG_LEVELS.indexOf(value) !== -1;
}

/*
 * The kind of a tag: everything before the first colon, trimmed, or "" when the
 * tag carries no colon or nothing before it. A tag with a kind is read as typed
 * only when a value follows too, so `api:` is not a typed tag.
 */
export function tagKind(tag) {
  const text = String(tag == null ? "" : tag);
  const colon = text.indexOf(":");
  return colon === -1 ? "" : text.slice(0, colon).trim();
}

// The value of a tag: everything after the first colon, trimmed, or "" when the
// tag carries no colon.
export function tagValue(tag) {
  const text = String(tag == null ? "" : tag);
  const colon = text.indexOf(":");
  return colon === -1 ? "" : text.slice(colon + 1).trim();
}

export function isTypedTag(tag) {
  return tagKind(tag) !== "" && tagValue(tag) !== "";
}

/*
 * The first tag in the list whose kind matches the chosen key, or "" when the
 * key is unchosen or no tag carries it. The tag list is ordered and the first
 * listed wins, so a second tag under the same key never overrides the first.
 */
export function tagUnderKey(tags, key) {
  if (typeof key !== "string" || key === "") return "";
  const list = Array.isArray(tags) ? tags : [];
  for (let i = 0; i < list.length; i += 1) {
    if (tagKind(list[i]) === key && tagValue(list[i]) !== "") return String(list[i]);
  }
  return "";
}

/*
 * The slot the first tag under the key draws in, or null when there is no such
 * tag or the mapping gives it no colour. Only the first tag under the key is
 * consulted, so a second tagged value can never step in for the first.
 */
export function slotForTags(tags, key, colours) {
  const tag = tagUnderKey(tags, key);
  if (tag === "") return null;
  const slot = colours ? colours[tag] : null;
  return Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT ? slot : null;
}

/*
 * The typed tags a chosen key selects: every tag whose kind is the key chosen
 * for any of the three levels, in the order given. A kind chosen for two
 * levels still selects its values once. This is what PACT colours when a key
 * is chosen, and nothing at all while every level is unchosen.
 */
export function tagsUnderKeys(keys, tags) {
  const chosen = new Set();
  TAG_LEVELS.forEach(function (level) {
    const kind = keys && keys[level];
    if (typeof kind === "string" && kind !== "") chosen.add(kind);
  });
  if (chosen.size === 0) return [];
  return (Array.isArray(tags) ? tags : []).filter(function (tag) {
    return isTypedTag(tag) && chosen.has(tagKind(tag));
  }).map(String);
}

/*
 * The slot PACT gives a value: the lowest-numbered slot no colour uses yet, so
 * ten values spread across the ten palettes in slot order before any repeats,
 * and the least-used one after that. The counts are of a mapping's own slots.
 */
function nextFreeSlot(counts) {
  let best = 0;
  for (let i = 1; i < SLOT_COUNT; i += 1) {
    if (counts[i] < counts[best]) best = i;
  }
  return best;
}

function slotCounts(colours) {
  const counts = new Array(SLOT_COUNT).fill(0);
  Object.keys(colours).forEach(function (tag) {
    const slot = colours[tag];
    if (Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT) counts[slot] += 1;
  });
  return counts;
}

/*
 * A mapping with a slot given to every value under a chosen key that has none,
 * and every slot already set - by PACT earlier or by hand - kept exactly as it
 * was. A value the user set is never reassigned, and a value that carries no
 * colour under a chosen key takes the next free slot. With no key chosen there
 * is nothing to assign, so the mapping comes back unchanged: opening the panel
 * writes nothing.
 */
export function assignTagSlots(keys, tags, colours) {
  const out = Object.assign({}, colours);
  const counts = slotCounts(out);
  tagsUnderKeys(keys, tags).forEach(function (tag) {
    if (Object.prototype.hasOwnProperty.call(out, tag)) return;
    const slot = nextFreeSlot(counts);
    out[tag] = slot;
    counts[slot] += 1;
  });
  return out;
}

/*
 * A mapping after one swatch press: pressing the slot the value already draws
 * in clears the value, so the same control that chooses also clears; pressing
 * any other chooses that slot. The mapping given is never changed.
 */
export function chooseTagSlot(colours, tag, slot) {
  const out = Object.assign({}, colours);
  if (out[tag] === slot) delete out[tag];
  else out[tag] = slot;
  return out;
}

// The keys a stored mapping chooses, each a kind, with unchosen and malformed
// ones dropped. Never the stored object itself, so a caller cannot mutate it.
export function tagKeys(tagColours) {
  const keys = tagColours && tagColours.keys;
  const out = {};
  TAG_LEVELS.forEach(function (level) {
    const kind = keys && keys[level];
    if (typeof kind === "string" && kind.trim() !== "") out[level] = kind;
  });
  return out;
}

// The typed tags a stored mapping colours, each a slot 0..9, dropping anything
// that is not a typed tag or not a slot. A copy, never the stored object.
export function tagColourSlots(tagColours) {
  const colours = tagColours && tagColours.colours;
  const out = {};
  if (colours && typeof colours === "object" && !Array.isArray(colours)) {
    Object.keys(colours).forEach(function (tag) {
      const slot = colours[tag];
      if (isTypedTag(tag) && Number.isInteger(slot) && slot >= 0 && slot < SLOT_COUNT) out[tag] = slot;
    });
  }
  return out;
}

/*
 * The slot an Assignment's block draws in, most specific first: its own tag
 * under the assignments key, then its Project's tag under the projects key,
 * then null for the Project's own palette colour. A level whose first tag has
 * no colour paints nothing, so the next level still gets its chance.
 */
export function assignmentSlot(assignmentTags, projectTags, keys, colours) {
  const own = slotForTags(assignmentTags, keys && keys.assignments, colours);
  if (own !== null) return own;
  return slotForTags(projectTags, keys && keys.projects, colours);
}

// The slot a Person draws in from their own tag under the people key, or null
// for no mark.
export function personSlot(personTags, keys, colours) {
  return slotForTags(personTags, keys && keys.people, colours);
}

/*
 * Every typed tag the plan carries, deduplicated, across People, Projects and
 * Assignments alike. The Tags panel reads this to list the kinds and values in
 * use; it is sorted so two draws of the same plan read the same.
 */
export function planTypedTags(plan) {
  const seen = new Set();
  function collect(list) {
    (Array.isArray(list) ? list : []).forEach(function (item) {
      (item && Array.isArray(item.tags) ? item.tags : []).forEach(function (tag) {
        if (isTypedTag(tag)) seen.add(String(tag));
      });
    });
  }
  collect(plan && plan.people);
  collect(plan && plan.projects);
  collect(plan && plan.assignments);
  return Array.from(seen).sort(function (a, b) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
  });
}

/*
 * The same tags grouped by kind, each kind's values in order: what the Tags
 * panel lists so one kind's values sit together under their colour choices.
 */
export function tagKindGroups(tags) {
  const groups = new Map();
  (Array.isArray(tags) ? tags : []).forEach(function (tag) {
    if (!isTypedTag(tag)) return;
    const kind = tagKind(tag);
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind).push({ tag: String(tag), value: tagValue(tag) });
  });
  return Array.from(groups.keys()).sort(function (a, b) {
    const x = a.toLowerCase();
    const y = b.toLowerCase();
    return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1;
  }).map(function (kind) {
    return { kind: kind, values: groups.get(kind) };
  });
}

/*
 * A stored mapping made canonical, or null when nothing is configured. Each
 * level's key is kept only while it names a kind, each colour only while it
 * names a typed tag and a slot, and the whole is dropped when both are empty -
 * so an unchosen mapping leaves the plan as it was, the way an empty holidays
 * list does.
 */
export function cleanTagColours(tagColours) {
  if (!tagColours || typeof tagColours !== "object" || Array.isArray(tagColours)) return null;
  const keys = tagKeys(tagColours);
  const colours = tagColourSlots(tagColours);
  const hasKeys = TAG_LEVELS.some(function (level) { return level in keys; });
  const hasColours = Object.keys(colours).length > 0;
  if (!hasKeys && !hasColours) return null;
  const out = {};
  if (hasKeys) out.keys = keys;
  if (hasColours) out.colours = colours;
  return out;
}
