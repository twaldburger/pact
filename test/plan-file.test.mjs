import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_SUFFIX,
  expandHome,
  normalizeAbsolute,
  resolvePlanPath,
  withPlanSuffix,
  planFileName,
  planFileItem,
  planFileView
} from "../public/lib/plan-file.mjs";

/* --- reading a typed path ------------------------------------------------- */

test("a leading tilde is expanded to home, and only a leading one", () => {
  assert.equal(expandHome("~", "/home/tim"), "/home/tim");
  assert.equal(expandHome("~/plans/p.pact.json", "/home/tim"), "/home/tim/plans/p.pact.json");
  assert.equal(expandHome("  ~/x  ", "/home/tim"), "/home/tim/x");
  // A tilde anywhere else is an ordinary character, left alone.
  assert.equal(expandHome("/tmp/~backup", "/home/tim"), "/tmp/~backup");
  assert.equal(expandHome("~someone/x", "/home/tim"), "~someone/x");
});

test("an absolute path is collapsed to a canonical form", () => {
  assert.equal(normalizeAbsolute("/a//b/./c/"), "/a/b/c");
  assert.equal(normalizeAbsolute("/a/b/../c"), "/a/c");
  assert.equal(normalizeAbsolute("/"), "/");
  // A .. above the root is dropped rather than escaping it.
  assert.equal(normalizeAbsolute("/../x"), "/x");
});

test("a plan path is stored absolute and resolved, never relative", () => {
  assert.deepEqual(resolvePlanPath("/tmp/p.pact.json", "/home/tim"), { path: "/tmp/p.pact.json" });
  assert.deepEqual(resolvePlanPath("~/plans/x.json", "/home/tim"), { path: "/home/tim/plans/x.json" });
  assert.deepEqual(resolvePlanPath("/tmp/a/../b.json", "/home/tim"), { path: "/tmp/b.json" });
  // Empty and relative inputs are each refused with their own reason.
  assert.match(resolvePlanPath("", "/home/tim").error, /Enter the path/);
  assert.match(resolvePlanPath("   ", "/home/tim").error, /Enter the path/);
  assert.match(resolvePlanPath("plans/x.json", "/home/tim").error, /absolute path/);
  assert.match(resolvePlanPath("./x.json", "/home/tim").error, /absolute path/);
});

/* --- the suffix a plan is offered under ----------------------------------- */

test("a new plan is offered with the .pact.json suffix", () => {
  assert.equal(PLAN_SUFFIX, ".pact.json");
  assert.equal(withPlanSuffix("/tmp/plan"), "/tmp/plan.pact.json");
  assert.equal(withPlanSuffix("/tmp/plan.json"), "/tmp/plan.pact.json");
  // Already a plan name: left exactly as it is.
  assert.equal(withPlanSuffix("/tmp/plan.pact.json"), "/tmp/plan.pact.json");
  // The suffix follows the last segment, not the whole path.
  assert.equal(withPlanSuffix("/tmp/plans.dir/plan"), "/tmp/plans.dir/plan.pact.json");
});

test("a plan's displayed name is its last path segment", () => {
  assert.equal(planFileName("/a/b/p.pact.json"), "p.pact.json");
  assert.equal(planFileName("p.pact.json"), "p.pact.json");
  assert.equal(planFileName(""), "");
  assert.equal(planFileName(null), "");
});

/* --- the menu entry and the panel view ------------------------------------ */

test("the Plan file entry names the active file, or PACT_DATA", () => {
  const item = planFileItem({ path: "/home/tim/plans/work.pact.json" });
  assert.equal(item.key, "plan-file");
  assert.equal(item.label, "Plan file...");
  assert.equal(item.detail, "work.pact.json");
  // PACT_DATA wins: the entry says so rather than naming a file that cannot be
  // chosen in this run.
  assert.equal(planFileItem({ path: "/x/y.pact.json", locked: true }).detail, "PACT_DATA");
  assert.equal(planFileItem(null).detail, "");
});

test("the panel view states a lock plainly and passes a notice through", () => {
  const open = planFileView({ path: "/a/b.pact.json", locked: false, notice: "Moved x to y." });
  assert.equal(open.path, "/a/b.pact.json");
  assert.equal(open.locked, false);
  assert.equal(open.notice, "Moved x to y.");
  assert.equal(open.lockMessage, "");

  const locked = planFileView({ path: "/a/b.pact.json", locked: true });
  assert.equal(locked.locked, true);
  assert.match(locked.lockMessage, /PACT_DATA is set/);

  const empty = planFileView(undefined);
  assert.equal(empty.path, "");
  assert.equal(empty.locked, false);
  assert.equal(empty.notice, "");
});
