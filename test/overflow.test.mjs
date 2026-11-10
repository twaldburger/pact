import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// One overflow standard, pinned at the two places it is applied: the CSS each
// surface is drawn with, and the script that builds the elements and their
// hover text. The rule is in docs/overflow.md. This reads the real declarations
// so a surface cannot drift back on its own.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");
const APP = fs.readFileSync(path.join(PUBLIC, "app.js"), "utf8");

// A rule's body, with comments stripped so the prose does not read as
// declarations. The selector must start a line, so a bare `.x` matches the
// rule and not `:root .x` or `.y .x` elsewhere.
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const found = STYLE.match(new RegExp("(?:^|\\n)" + escaped + "\\s*\\{([^}]*)\\}"));
  assert.ok(found, "the " + selector + " rule is missing");
  return found[1].replace(/\/\*[\s\S]*?\*\//g, "");
}

function has(body, declaration) {
  return new RegExp(declaration + "\\s*:").test(body);
}

test("the Stack rail and the panels wrap a long name", () => {
  const stack = rule(".stack__name");
  assert.ok(has(stack, "overflow-wrap"), ".stack__name does not wrap");
  assert.ok(!has(stack, "text-overflow"), ".stack__name must not truncate");
  assert.ok(!has(stack, "white-space"), ".stack__name must not be held to one line");

  const panel = rule(".panel__title");
  assert.ok(!has(panel, "text-overflow"), ".panel__title must not truncate");
  assert.ok(!has(panel, "white-space"), ".panel__title must not be held to one line");
});

test("the row header and the Filter suggestion value truncate with an ellipsis", () => {
  for (const selector of [".rowhead__name", ".filter__val", ".ax-sprint__label"]) {
    const body = rule(selector);
    assert.ok(has(body, "text-overflow"), selector + " does not ellipsise");
    assert.ok(has(body, "white-space"), selector + " is not held to one line");
    assert.ok(has(body, "overflow"), selector + " does not clip its overflowing text");
  }
});

test("each truncating surface carries its full value on hover", () => {
  // The row header name.
  assert.match(APP, /name\.title = person\.name/);
  // The Filter suggestion value and the Look in summary.
  assert.match(APP, /val\.title = item\.value/);
  assert.match(APP, /filterScopeBtn\.title = filterScopeBtn\.getAttribute\("aria-label"\)/);
  // The Sprint zoom's cell label.
  assert.match(APP, /label\.title = c\.name/);
  // The block already names itself through the tooltip it carries, note and all.
  assert.match(APP, /b\.title = hoverText\(a\.project\.name, a\.share, a\.raw && a\.raw\.note\)/);
});
