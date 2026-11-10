import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The zoom control's two visible contracts: the order its levels read in, and
// the fact that the Sprint level looks disabled while no cadence exists. Both
// live in the markup and stylesheet, so they are read here rather than in a
// browser; the rendered opacity and hover tint are checked by hand.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "..", "public");
const HTML = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const STYLE = fs.readFileSync(path.join(PUBLIC, "style.css"), "utf8");

const GROUP = HTML.match(/<div class="zoom"[^>]*>([\s\S]*?)<\/div>/);

test("the zoom group offers its levels Day, Week, Month, Sprint", () => {
  assert.ok(GROUP, "the .zoom group is missing");
  const order = [...GROUP[1].matchAll(/data-zoom="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["day", "week", "month", "sprint"]);
});

test("the Sprint button is the last child of the zoom group", () => {
  assert.ok(GROUP, "the .zoom group is missing");
  const buttons = [...GROUP[1].matchAll(/<button[^>]*data-zoom="([a-z]+)"[^>]*>/g)];
  assert.ok(buttons.length, "the zoom group has no buttons");
  assert.equal(buttons[buttons.length - 1][1], "sprint");
});

// The disabled look is the interface's one shared treatment: the same
// --op-disabled opacity and default cursor every other exhausted control uses.
test("a disabled zoom button takes the shared disabled treatment", () => {
  const rule = STYLE.match(/\.zoom__btn:disabled[^{}]*\{([^}]*)\}/);
  assert.ok(rule, "the .zoom__btn:disabled rule is missing");
  assert.match(rule[1], /opacity:\s*var\(--op-disabled\)/);
  assert.match(rule[1], /cursor:\s*default/);
  // The token itself is defined, so the opacity is not a bare fallback.
  assert.match(STYLE, /--op-disabled:\s*[^;]+;/);
});

test("the zoom hover does not fire on a disabled button", () => {
  assert.match(
    STYLE,
    /\.zoom__btn:hover:not\(\[aria-pressed="true"\]\):not\(:disabled\)/
  );
});
