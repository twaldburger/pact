import test from "node:test";
import assert from "node:assert/strict";
import { copyName } from "../public/lib/copy.mjs";

test("a copy of an untouched name takes X (copy)", () => {
  assert.equal(copyName("Atlas", []), "Atlas (copy)");
  assert.equal(copyName("Atlas", ["Borealis", "Cinder"]), "Atlas (copy)");
  assert.equal(copyName("Atlas", ["Atlas"]), "Atlas (copy)");
});

test("a name already taken by a live Project is numbered up until it is free", () => {
  assert.equal(copyName("Atlas", ["Atlas", "Atlas (copy)"]), "Atlas (copy 2)");
  assert.equal(copyName("Atlas", ["Atlas (copy)", "Atlas (copy 2)"]), "Atlas (copy 3)");
  // Neither a gap nor a far number trips it: the first free one wins.
  assert.equal(copyName("Atlas", ["Atlas (copy)", "Atlas (copy 2)", "Atlas (copy 4)"]), "Atlas (copy 3)");
  assert.equal(copyName("Atlas", ["Atlas (copy)", "Atlas (copy 2)", "Atlas (copy 3)"]), "Atlas (copy 4)");
});

test("copying a copy numbers it on rather than stacking a suffix on a suffix", () => {
  assert.equal(copyName("Atlas (copy)", []), "Atlas (copy)");
  assert.equal(copyName("Atlas (copy)", ["Atlas (copy)"]), "Atlas (copy 2)");
  assert.equal(copyName("Atlas (copy 2)", ["Atlas (copy)", "Atlas (copy 2)"]), "Atlas (copy 3)");
  assert.equal(copyName("Atlas (copy 7)", []), "Atlas (copy)");
  // Only a real copy suffix is a suffix; the rest of the name is the name.
  assert.equal(copyName("Atlas (copy 0)", []), "Atlas (copy 0) (copy)");
  assert.equal(copyName("Atlas (copy of the plan)", []), "Atlas (copy of the plan) (copy)");
  assert.equal(copyName("Atlas (copy)", ["Atlas (copy 2)"]), "Atlas (copy)");
});

test("the taken list is compared case-insensitively and trimmed", () => {
  assert.equal(copyName("Atlas", ["atlas (COPY)"]), "Atlas (copy 2)");
  assert.equal(copyName("  Atlas  ", ["Atlas (copy) "]), "Atlas (copy 2)");
  // The suggested name never collides with a name that differs only in case.
  assert.equal(copyName("atlas", ["Atlas (copy)"]), "atlas (copy 2)");
});

test("an absent list is treated as no live names", () => {
  assert.equal(copyName("Atlas"), "Atlas (copy)");
  assert.equal(copyName("Atlas", null), "Atlas (copy)");
});
