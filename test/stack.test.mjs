import test from "node:test";
import assert from "node:assert/strict";
import {
  STACK_COLLAPSED_DEFAULT,
  isStackCollapsed,
  stackRailVisible,
  stackToggleLabel,
  stackToggleExpanded,
  hasFilterQuery,
  stackMatchCount,
  stackViewState
} from "../public/lib/stack.mjs";

test("the Stack opens expanded and only a true value collapses it", () => {
  assert.equal(STACK_COLLAPSED_DEFAULT, false);
  assert.equal(isStackCollapsed(true), true);
  // A missing, stale or truthy-but-not-true value opens the Stack rather than
  // hiding it, so a malformed state cannot lose the rail.
  [false, 0, 1, "true", null, undefined, {}].forEach((value) => {
    assert.equal(isStackCollapsed(value), false);
  });
});

test("the rail is drawn when open and gone when collapsed", () => {
  assert.equal(stackRailVisible(false), true);
  assert.equal(stackRailVisible(true), false);
});

test("the toggle names the action each state would take", () => {
  assert.equal(stackToggleLabel(false), "Collapse the Stack");
  assert.equal(stackToggleLabel(true), "Expand the Stack");
});

test("the toggle's aria-expanded is true exactly while the Stack is open", () => {
  assert.equal(stackToggleExpanded(false), true);
  assert.equal(stackToggleExpanded(true), false);
});

test("only non-blank text is a filter query", () => {
  assert.equal(hasFilterQuery("atlas"), true);
  assert.equal(hasFilterQuery("  atlas  "), true);
  ["", "   ", "\t\n", null, undefined].forEach((query) => {
    assert.equal(hasFilterQuery(query), false);
  });
});

test("the match count appears only while collapsed with a query", () => {
  // Collapsed and filtered: the filter's own number is carried.
  assert.equal(stackMatchCount(true, "atlas", 3), 3);
  // A query that matches nothing still carries an honest zero.
  assert.equal(stackMatchCount(true, "atlas", 0), 0);
  // Expanded: no count, whatever the query.
  assert.equal(stackMatchCount(false, "atlas", 3), null);
  // Collapsed but unfiltered: no count.
  assert.equal(stackMatchCount(true, "", 3), null);
  assert.equal(stackMatchCount(true, "   ", 3), null);
  // A malformed number settles at zero rather than a broken badge.
  assert.equal(stackMatchCount(true, "atlas", undefined), 0);
  assert.equal(stackMatchCount(true, "atlas", "nope"), 0);
});

test("the collapsed state is never serialized into the plan", () => {
  // The session view state is one field, and it is not a plan field: the plan
  // owns range, people, projects and assignments, so saving the plan can never
  // carry the collapse along with it.
  assert.deepEqual(stackViewState(true), { stackCollapsed: true });
  assert.deepEqual(stackViewState(false), { stackCollapsed: false });
  assert.deepEqual(Object.keys(stackViewState(true)), ["stackCollapsed"]);
  ["range", "people", "projects", "assignments"].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(stackViewState(true), key), false);
  });
});
