/*
 * The connection's two doors: the settings under Options and the operations in
 * the top bar.
 *
 * One panel held both kinds of thing - the URL, the mapping rows and the token
 * beside an import - and sync, which is an operation with a diff rather than a
 * setting, would have made that worse. So each door opens exactly one kind, and
 * what is checked here is that the split is real in the script the browser is
 * handed: the settings panel holds configuration and no import control at all,
 * the operations panel holds the import and nothing about URLs, tokens or
 * mapping levels, and the bar's button is the operations' door and never the
 * settings'.
 *
 * The button's own state is a rule in public/lib/ado.mjs, and ado.test.mjs holds
 * it in its three states. What is checked here is the wiring around it: that it
 * is withheld with `aria-disabled` and never with `disabled`, that the words for
 * why come from that one rule rather than a second copy in the markup, that a
 * press while it is withheld explains itself and calls nothing, and that it is
 * opened with the same /api/ado state the settings panel reads rather than a
 * second fetch. What this cannot do is press the button: that is checked against
 * the running app.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const TOPBAR = readFileSync(new URL("../public/lib/topbar.mjs", import.meta.url), "utf8");
const FEATURES = readFileSync(new URL("../docs/features.md", import.meta.url), "utf8");

// One span of the script, from its opening marker to the marker that follows.
function sourceFrom(startMarker, endMarker) {
  const start = APP.indexOf(startMarker);
  assert.ok(start >= 0, startMarker + " is not in the script");
  const end = APP.indexOf(endMarker, start);
  assert.ok(end > start, endMarker + " does not follow " + startMarker);
  return APP.slice(start, end);
}

const SETTINGS = sourceFrom("function openAdoSettingsPanel(", "\n/* --- the Azure DevOps operations panel");
const OPERATIONS = sourceFrom("function openAdoOperationsPanel(", "\n/* --- the bar's ADO button");
const BAR = sourceFrom("/* --- the bar's ADO button", "\n// A type slot's select");
const OPTIONS_ROW = sourceFrom("function buildAdoItem(", "\nfunction updateAdoItem(");

// Every element id a panel gives one of its own controls, in source order.
function idsOf(source) {
  return [...source.matchAll(/\.id = "(ado-[a-z-]+)";/g)].map((match) => match[1]);
}

/* --- the settings panel -------------------------------------------------- */

test("the settings hold configuration, and every control of it", () => {
  // The URL, the mapping's three rows, the token with its two actions, and the
  // two lines that report the token's state and the last test connection.
  assert.deepEqual(idsOf(SETTINGS), [
    "ado-url",
    "ado-project-level",
    "ado-assignment-level",
    "ado-tag-level",
    "ado-token",
    "ado-token-save",
    "ado-token-clear",
    "ado-token-line",
    "ado-connection-line",
    "ado-test",
    "ado-save"
  ]);
  // The footer belongs to configuration, and the import is not in it.
  assert.match(SETTINGS, /button\("btn-ghost", "Test connection", runTest\)/);
  assert.match(SETTINGS, /saveButton\("Save mapping", saveMapping\)/);
  assert.match(SETTINGS, /var foot = el\("div", "panel__foot"\);/);
});

test("no import control survives in the settings panel", () => {
  assert.doesNotMatch(SETTINGS, /ado-import/);
  assert.doesNotMatch(SETTINGS, /\/api\/ado\/import/);
  assert.doesNotMatch(SETTINGS, /runImport|acceptOffer|readWorkItemId|importLine/);
  assert.doesNotMatch(SETTINGS, /"Import"|Import one work item/);
  // Nor does the panel offer a way into the operations: the two doors are
  // separate ones, each opened from the bar or the menu.
  assert.doesNotMatch(SETTINGS, /openAdoOperationsPanel/);
});

/* --- the operations panel ------------------------------------------------ */

test("the operations hold the import, and every part of it", () => {
  assert.deepEqual(idsOf(OPERATIONS), [
    "ado-import-id",
    "ado-import",
    "ado-import-line",
    "ado-import-offer"
  ]);
  // The press, the one work item per press, and the offer that is the only
  // thing which sends createPerson.
  assert.match(OPERATIONS, /button\("btn-ghost", "Import", function \(\) \{ runImport\(false\); \}\)/);
  assert.match(OPERATIONS, /api\("POST", "\/api\/ado\/import", \{ id: reading\.id, createPerson: createPerson === true \}\)/);
  assert.match(OPERATIONS, /One work item at a time; its children are not imported\./);
  assert.match(OPERATIONS, /if \(offer\) runImport\(true\);/);
  // Its own line, drawn from the shared rules' words.
  assert.match(OPERATIONS, /text: importLine\(result\.facts\)/);
});

test("nothing about the address, the token or the mapping levels is in the operations", () => {
  assert.doesNotMatch(OPERATIONS, /ado-url|ado-token|ado-project-level|ado-assignment-level|ado-tag-level/);
  assert.doesNotMatch(OPERATIONS, /ado-token-line|ado-connection-line|ado-test|ado-save/);
  assert.doesNotMatch(OPERATIONS, /addressFromUrl|tokenLine|connectionLine|adoRefusals|fillTypeSelect|adoUrlFor/);
  assert.doesNotMatch(OPERATIONS, /"Test connection"|"Save mapping"|"URL"|"Token"/);
});

test("each panel keeps the status lines that are its own", () => {
  // The token's state and the last test connection are configuration feedback
  // and stay with the settings; the import's line reports one operation.
  assert.match(SETTINGS, /drawLine\(tokenStateLine, tokenLine\(token\)\)/);
  assert.match(SETTINGS, /connectionLine\(\{/);
  assert.match(OPERATIONS, /var importStateLine = el\("p", "ado__line ado__importstate"\);/);
  // One tone for a good import and none for a refusal that carries an offer;
  // every other refusal is the panel's error line, never this one's words.
  assert.match(OPERATIONS, /className: "ado__line ado__importstate is-ok"/);
  assert.doesNotMatch(OPERATIONS, /ado__importstate is-failed/);
});

/* --- the button in the bar ---------------------------------------------- */

test("the button sits in the bar after the history controls and before Options", () => {
  const history = TOPBAR.indexOf('class="history"');
  const button = TOPBAR.indexOf('id="ado-operations"');
  const options = TOPBAR.indexOf('class="options"');
  assert.ok(history >= 0 && options >= 0, "the bar's history and Options controls are not both in the markup");
  assert.ok(history < button && button < options,
    "the ADO button belongs between the history controls and the Options glyph");
  // A word, because the surface has no glyph of its own, and the full name for
  // a reader who cannot see the abbreviation's shape.
  assert.match(TOPBAR, /id="ado-operations"\s+aria-disabled="true" aria-label="Azure DevOps operations">ADO<\/button>/);
});

test("the bar mounts the button withheld, and carries no copy of the words", () => {
  // Withheld until the plan's own state is read: a button that invites a press
  // which cannot work is what the split is meant to avoid.
  assert.match(TOPBAR, /id="ado-operations"\s+aria-disabled="true"/);
  // The reason is a rule, worded once, in public/lib/ado.mjs. The markup states
  // none of it, so the sentence cannot drift from the rule that decides it.
  assert.doesNotMatch(TOPBAR, /Connect PACT to Azure DevOps first/);
  assert.doesNotMatch(TOPBAR, /no token is|no mapping/);
});

test("the button is withheld with aria-disabled, never with disabled", () => {
  assert.match(BAR, /adoOperationsButton\.setAttribute\("aria-disabled", state\.enabled \? "false" : "true"\)/);
  // A natively disabled button takes no focus and its tooltip is unreliable, so
  // neither is used: the press and the focus both stay.
  assert.doesNotMatch(BAR, /adoOperationsButton\.disabled/);
  assert.doesNotMatch(TOPBAR, /id="ado-operations"[^>]*\sdisabled/);
  // It is drawn as unavailable the way the Today control is when its action is
  // withdrawn: one class the stylesheet already holds.
  assert.match(BAR, /adoOperationsButton\.classList\.toggle\("is-disabled", !state\.enabled\)/);
});

test("the title carries the reason, in the state's own words", () => {
  assert.match(BAR, /adoOperationsButton\.title = state\.title;/);
  assert.match(BAR, /return adoOperationState\(state\.mapping, !!\(state\.token && state\.token\.present\)\);/);
});

test("a press while withdrawn explains itself and does nothing else", () => {
  const handler = BAR.slice(
    BAR.indexOf('adoOperationsButton.addEventListener("click"'),
    BAR.indexOf("function currentAdoOperationState(")
  );
  assert.ok(handler.length > 0, "the button has no press handler");
  // The explanation is the app's toast, which carries role="alert", so a press
  // from the keyboard is announced as well as one from the mouse.
  assert.match(handler, /if \(!state\.enabled\) \{\s*showToast\(state\.title\);\s*return;\s*\}/);
  // Nothing is sent and no panel is opened on that branch: the slice from the
  // guard to its return holds no call at all.
  const guard = handler.slice(handler.indexOf("if (!state.enabled)"), handler.indexOf("return;") + "return;".length);
  assert.doesNotMatch(guard, /api\(|refresh|openAdoOperationsPanel|openPanel/);
  // Only an enabled button opens the operations, and it is always these.
  assert.match(handler, /openAdoOperationsPanel\(adoOperationsButton\);/);
});

test("the button's state follows the plan, on the one fetch the panel uses", () => {
  const load = sourceFrom("function loadAdoState(", "\n// The active file is the server's to know");
  assert.equal((load.match(/api\("GET", "\/api\/ado"\)/g) || []).length, 1, "one fetch serves the menu, the panel and the button");
  assert.match(load, /updateAdoItem\(\);\s*updateAdoOperationsButton\(\);/);
  // A token saved or cleared in the settings answers with the whole state, so
  // the button moves with it rather than waiting for a reload.
  assert.match(SETTINGS, /adoState = next;\s*updateAdoItem\(\);\s*updateAdoOperationsButton\(\);/);
});

/* --- the two doors, and the menu's row ---------------------------------- */

test("the Options row opens the settings, and only the settings", () => {
  assert.match(OPTIONS_ROW, /openAdoSettingsPanel\(btn\);/);
  assert.doesNotMatch(OPTIONS_ROW, /openAdoOperationsPanel/);
  // The row is the settings' door: it is the only opener of that panel.
  assert.equal((APP.match(/openAdoSettingsPanel\(/g) || []).length, 2,
    "the settings panel is opened from the menu row and from its own definition only");
});

test("the two lines of prose that name the doors name them right", () => {
  assert.match(FEATURES, /## The Azure DevOps settings/);
  assert.match(FEATURES, /## Importing a work item/);
  // The operations section says where the button is and what withholds it.
  const start = FEATURES.indexOf("## Importing a work item");
  const end = FEATURES.indexOf("\n## ", start + 1);
  const section = FEATURES.slice(start, end === -1 ? FEATURES.length : end);
  assert.match(section, /Where the controls are/);
  assert.match(section, /`ADO` button in the top bar/);
  assert.match(section, /before the Options glyph/);
  assert.match(section, /`aria-disabled` rather\s+than `disabled`/);
  assert.match(section, /Connect PACT to Azure DevOps first: Options then Azure DevOps\.\.\./);
  assert.match(section, /a mapping in the plan[\s\S]*and\*\* a token/);
});
