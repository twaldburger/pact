/*
 * The Azure DevOps connection's rules: the mapping a plan carries, the ranks its
 * slots are checked by, the token file, and where that file lives on each
 * platform.
 *
 * No test here calls Azure DevOps: the backlog payloads are the shapes the
 * spike recorded, and every token lives in a scratch directory. What is checked
 * is the part that decides whether a mapping may be stored and whether a file
 * holds a token at all - the server's calls are covered in ado-api.test.mjs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStore, seedPlan, validatePlan, ValidationError } from "../lib/plan.mjs";
import { adoState, clearToken, readToken, tokenState, writeToken, resolveTokenFile } from "../lib/ado.mjs";
import {
  ADO_CONNECT_FIRST,
  ADO_PLACEHOLDER,
  adoMappingInPlan,
  adoOperationState,
  adoRefusals,
  connectionLine,
  defaultTokenFile,
  mappingRefusal,
  normalizeAdo,
  reportedTypes,
  tokenLine,
  tokenNotice,
  typeRanks
} from "../public/lib/ado.mjs";
import { adoItem, optionGroups, optionsItems } from "../public/lib/options.mjs";
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("ado");
const tempFile = () => path.join(tempDir(), "pact.json");

/* --- the plan's block ---------------------------------------------------- */

const MAPPING = {
  organizationUrl: "https://dev.azure.com/timwaldburger",
  project: "PACT",
  projectLevels: ["Initiative", "Epic"],
  assignmentLevels: ["Feature", "User Story"]
};

test("a plan without an ADO block is valid, exactly as it was", () => {
  assert.deepEqual(validatePlan(seedPlan()), []);
  assert.equal("ado" in seedPlan(), false);
});

test("a plan accepts an ADO block of two addresses and two lists of type names", () => {
  const plan = Object.assign(seedPlan(), { ado: MAPPING });
  assert.deepEqual(validatePlan(plan), []);
  // One type in a list is a list like any other.
  const single = Object.assign(seedPlan(), {
    ado: Object.assign({}, MAPPING, { projectLevels: ["Epic"], assignmentLevels: ["Feature"] })
  });
  assert.deepEqual(validatePlan(single), []);
});

test("a plan written before the lists is read as one-item lists, without a migration", () => {
  const legacy = Object.assign(seedPlan(), {
    ado: {
      organizationUrl: MAPPING.organizationUrl,
      project: "PACT",
      projectLevel: "Epic",
      assignmentLevel: "Feature",
      tagLevel: "User Story"
    }
  });
  // It loads: the singular keys are accepted as the lists of one they mean, and
  // the tag level is accepted rather than merely tolerated.
  assert.deepEqual(validatePlan(legacy), []);
  assert.deepEqual(normalizeAdo(legacy.ado), {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT",
    projectLevels: ["Epic"],
    assignmentLevels: ["Feature"]
  });
  // Read through the store, the plan carries the new shape and the tag level is
  // gone; the file itself still holds what it held until the plan is next
  // written, and that write stores the new shape.
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify(legacy, null, 2) + "\n");
  const store = createStore(file);
  assert.deepEqual(store.get().ado, normalizeAdo(legacy.ado));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).ado.tagLevel, "User Story");
  store.setAdo({ ado: store.get().ado });
  assert.equal("tagLevel" in JSON.parse(fs.readFileSync(file, "utf8")).ado, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).ado.projectLevels, ["Epic"]);
});

test("the plan refuses a credential-shaped key inside its ADO block", () => {
  ["token", "pat", "password", "personalAccessToken"].forEach((key) => {
    const block = Object.assign({}, MAPPING, { [key]: "a-secret" });
    const errors = validatePlan(Object.assign(seedPlan(), { ado: block }));
    assert.equal(errors.length, 1, key + " was accepted inside the plan");
    assert.match(errors[0], new RegExp("remove ado\\." + key));
    assert.match(errors[0], /belongs in the app's own config, never in the plan/);
  });
});

test("the block's shape is checked: the address pair, a non-empty list for each role, no stray key", () => {
  assert.match(adoRefusals(null)[0], /must be an object/);
  assert.match(adoRefusals({}).join(" "), /organisation address is required/);
  assert.match(adoRefusals(Object.assign({}, MAPPING, { organizationUrl: "dev.azure.com/x" })).join(" "), /start http:\/\/ or https:\/\//);
  assert.match(adoRefusals(Object.assign({}, MAPPING, { owner: "tim" })).join(" "), /unknown field 'owner'/);
  // Both lists are required, on a block that carries an address.
  const addressed = { organizationUrl: MAPPING.organizationUrl, project: "PACT" };
  assert.match(adoRefusals(addressed).join(" "), /projectLevels must name at least one work-item type/);
  assert.match(adoRefusals(addressed).join(" "), /assignmentLevels must name at least one work-item type/);
  // And an empty list is refused for what it is for, not for being empty.
  const emptyProject = Object.assign({}, MAPPING, { projectLevels: [] });
  assert.match(adoRefusals(emptyProject).join(" "), /the ADO types whose items become PACT Projects/);
  const emptyAssignment = Object.assign({}, MAPPING, { assignmentLevels: [] });
  assert.match(adoRefusals(emptyAssignment).join(" "), /the ADO types whose items become PACT Assignments/);
  // A list is a list: a bare name is refused in the plural key, and so is a
  // blank entry.
  assert.match(adoRefusals(Object.assign({}, MAPPING, { projectLevels: "Epic" })).join(" "),
    /ado\.projectLevels must be a list of work-item type names/);
  assert.match(adoRefusals(Object.assign({}, MAPPING, { assignmentLevels: ["Feature", "  "] })).join(" "),
    /must hold work-item type names, and nothing blank/);
  // A tag level is no longer part of the mapping: it is accepted, whatever it
  // holds, and left out of what is stored.
  assert.deepEqual(adoRefusals(Object.assign({}, MAPPING, { tagLevel: "  " })), []);
  assert.deepEqual(adoRefusals(Object.assign({}, MAPPING, { tagLevel: 42 })), []);
  assert.equal("tagLevel" in normalizeAdo(Object.assign({}, MAPPING, { tagLevel: "User Story" })), false);
});

test("the block is stored trimmed, with a trailing slash off the address, and a repeated name once", () => {
  assert.deepEqual(normalizeAdo({
    organizationUrl: " https://dev.azure.com/timwaldburger/ ",
    project: " PACT ",
    projectLevels: [" Epic ", "Initiative", "Epic"],
    assignmentLevels: ["Feature"],
    tagLevel: null
  }), {
    organizationUrl: "https://dev.azure.com/timwaldburger",
    project: "PACT",
    projectLevels: ["Epic", "Initiative"],
    assignmentLevels: ["Feature"]
  });
});

test("a plan file carrying a credential inside its block refuses to load", () => {
  const file = tempFile();
  fs.writeFileSync(file, JSON.stringify(Object.assign(seedPlan(), {
    ado: Object.assign({}, MAPPING, { token: "a-secret" })
  })));
  assert.throws(() => createStore(file), /ado must never carry a credential/);
});

/* --- the ranks ----------------------------------------------------------- */

// The backlog levels the spike read from the owner's instance: one number per
// type, higher meaning a higher level.
const BACKLOGS = {
  count: 4,
  value: [
    { id: "Microsoft.TaskCategory", name: "Tasks", rank: 1, workItemTypes: [{ name: "Task" }, { name: "Bug" }] },
    { id: "Microsoft.RequirementCategory", name: "Stories", rank: 2, workItemTypes: [{ name: "User Story" }] },
    { id: "Microsoft.FeatureCategory", name: "Features", rank: 3, workItemTypes: [{ name: "Feature" }] },
    { id: "Microsoft.EpicCategory", name: "Epics", rank: 4, workItemTypes: [{ name: "Epic" }] }
  ]
};

const TYPES = {
  count: 5,
  value: [{ name: "Bug" }, { name: "Epic" }, { name: "Feature" }, { name: "Task" }, { name: "User Story" }]
};

test("the instance's backlog levels become one rank per type, highest first", () => {
  assert.deepEqual(typeRanks(BACKLOGS), [
    { name: "Epic", rank: 4 },
    { name: "Feature", rank: 3 },
    { name: "User Story", rank: 2 },
    { name: "Bug", rank: 1 },
    { name: "Task", rank: 1 }
  ]);
  assert.deepEqual(typeRanks(null), []);
  assert.deepEqual(reportedTypes(TYPES), ["Bug", "Epic", "Feature", "Task", "User Story"]);
});

const INSTANCE = { ranks: typeRanks(BACKLOGS), reported: reportedTypes(TYPES) };

test("two project levels and two assignment levels pass when every assignment ranks below every project", () => {
  assert.equal(mappingRefusal({ projectLevels: ["Epic"], assignmentLevels: ["Feature"] }, INSTANCE), null);
  assert.equal(mappingRefusal({ projectLevels: ["Epic"], assignmentLevels: ["User Story"] }, INSTANCE), null);
  assert.equal(mappingRefusal({ projectLevels: ["Epic", "Feature"], assignmentLevels: ["User Story"], }, INSTANCE), null);
  // A singular block is the same one-item list, so it is checked the same way.
  assert.equal(mappingRefusal({ projectLevel: "Epic", assignmentLevel: "Feature" }, INSTANCE), null);
});

test("an equal or inverted pair refuses, naming both ranks", () => {
  const equal = mappingRefusal({ projectLevels: ["Feature"], assignmentLevels: ["Feature"] }, INSTANCE);
  assert.match(equal, /'Feature' \(rank 3\)/);
  assert.equal((equal.match(/rank 3/g) || []).length, 2);

  const inverted = mappingRefusal({ projectLevels: ["Feature"], assignmentLevels: ["Epic"] }, INSTANCE);
  assert.match(inverted, /'Feature' \(rank 3\)/);
  assert.match(inverted, /'Epic' \(rank 4\)/);
  assert.match(inverted, /must be a higher level/);

  // One list is only as good as its worst pair: the lowest project type against
  // the highest assignment type is the pair that collides.
  const overlapping = mappingRefusal({
    projectLevels: ["Epic", "Feature"],
    assignmentLevels: ["User Story", "Feature"]
  }, INSTANCE);
  assert.match(overlapping, /The project type 'Feature' \(rank 3\)/);
  assert.match(overlapping, /the assignment type 'Feature' \(rank 3\)/);
  assert.match(overlapping, /every assignment type has to rank below every project type/);
});

test("a type with no backlog level cannot sit in either list", () => {
  const noRank = { ranks: typeRanks(BACKLOGS), reported: reportedTypes(TYPES).concat("Test Case") };
  assert.match(mappingRefusal({ projectLevels: ["Test Case"], assignmentLevels: ["Feature"] }, noRank),
    /no backlog level to the project type 'Test Case'/);
  assert.match(mappingRefusal({ projectLevels: ["Epic", "Test Case"], assignmentLevels: ["Feature"] }, noRank),
    /no backlog level to the project type 'Test Case'/);
  assert.match(mappingRefusal({ projectLevels: ["Epic"], assignmentLevels: ["Test Case"] }, noRank),
    /no backlog level to the assignment type 'Test Case'/);
});

/* --- where the token lives ------------------------------------------------ */

test("on Linux and macOS the token sits under XDG_CONFIG_HOME, else ~/.config", () => {
  assert.equal(defaultTokenFile("linux", { XDG_CONFIG_HOME: "/x/conf" }, "/home/tim"), "/x/conf/pact/ado-pat");
  assert.equal(defaultTokenFile("linux", {}, "/home/tim"), "/home/tim/.config/pact/ado-pat");
  assert.equal(defaultTokenFile("darwin", {}, "/Users/tim"), "/Users/tim/.config/pact/ado-pat");
  // A trailing slash is one spelling, not two different directories.
  assert.equal(defaultTokenFile("linux", { XDG_CONFIG_HOME: "/x/conf/" }, "/home/tim"), "/x/conf/pact/ado-pat");
});

test("on Windows the token sits under LOCALAPPDATA, never APPDATA", () => {
  assert.equal(
    defaultTokenFile("win32", { LOCALAPPDATA: "C:\\Users\\tim\\AppData\\Local" }, "C:\\Users\\tim"),
    "C:\\Users\\tim\\AppData\\Local\\pact\\ado-pat"
  );
  // Roaming follows a person between machines, so APPDATA is never the answer.
  const roamingOnly = defaultTokenFile("win32", { APPDATA: "C:\\Users\\tim\\AppData\\Roaming" }, "C:\\Users\\tim");
  assert.equal(roamingOnly, "C:\\Users\\tim\\AppData\\Local\\pact\\ado-pat");
  assert.doesNotMatch(roamingOnly, /Roaming/);
});

test("the config's ado.tokenFile overrides the platform default", () => {
  const dir = tempDir();
  const config = path.join(dir, "config.json");
  fs.writeFileSync(config, JSON.stringify({ ado: { tokenFile: "~/.secrets/pat" } }));
  const posix = resolveTokenFile(config, "/home/tim", { platform: "linux", env: {} });
  assert.equal(posix.path, "/home/tim/.secrets/pat");
  assert.equal(posix.overridden, true);

  const win = resolveTokenFile(config, "C:\\Users\\tim", {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\tim\\AppData\\Local" }
  });
  // A `~` path in the config is still the owner's own path on the platform the
  // server is running on; the default is what the platform branch decides.
  assert.match(win.path, /secrets[\\/]pat$/);

  const plain = path.join(dir, "plain.json");
  fs.writeFileSync(plain, JSON.stringify({}));
  assert.equal(resolveTokenFile(plain, "/home/tim", { platform: "linux", env: {} }).overridden, false);
});

test("the token file: present, absent, empty, and a placeholder that reads as absent", () => {
  const dir = tempDir();
  const file = path.join(dir, "ado-pat");
  const runtime = { platform: "linux", env: {} };
  const state = () => tokenState(null, dir, runtime);

  // No file at all is no token.
  assert.equal(state().present, false);
  assert.equal(state().path, path.join(dir, ".config", "pact", "ado-pat"));

  fs.mkdirSync(path.dirname(state().path), { recursive: true });
  fs.writeFileSync(state().path, "\n");
  assert.equal(state().present, false);

  fs.writeFileSync(state().path, ADO_PLACEHOLDER + "\n");
  assert.equal(state().present, false);
  assert.equal(state().placeholder, true);
  assert.equal(readToken(null, dir, runtime), "");
  assert.match(tokenNotice(state()), /still holds the placeholder text/);

  fs.writeFileSync(state().path, "a-real-token\n");
  assert.equal(state().present, true);
  assert.match(tokenNotice(state()), /token is set at/);
  assert.doesNotMatch(tokenNotice(state()), /a-real-token/);
});

test("the server writes the token where the panel says, with the mode it promises", () => {
  const dir = tempDir();
  const runtime = { platform: "linux", env: {} };
  const written = writeToken(null, dir, "a-real-token", runtime);
  assert.equal(written.present, true);
  assert.equal(readToken(null, dir, runtime), "a-real-token");

  const file = written.path;
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);

  // A loose mode on an existing file is tightened rather than left open.
  fs.chmodSync(file, 0o644);
  writeToken(null, dir, "a-second-token", runtime);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);

  // A placeholder, an empty value, or a value with spaces is refused and the
  // file is left alone.
  const before = fs.readFileSync(file, "utf8");
  assert.throws(() => writeToken(null, dir, ADO_PLACEHOLDER, runtime), /placeholder text/);
  assert.throws(() => writeToken(null, dir, "   ", runtime), /Type the personal access token/);
  assert.throws(() => writeToken(null, dir, "two words", runtime), /one word with no spaces/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("clearing the token deletes the file, and an absent file is already clear", () => {
  const dir = tempDir();
  const runtime = { platform: "linux", env: {} };
  const written = writeToken(null, dir, "a-real-token", runtime);
  const cleared = clearToken(null, dir, runtime);
  assert.equal(cleared.present, false);
  assert.equal(fs.existsSync(written.path), false);
  assert.equal(clearToken(null, dir, runtime).present, false);
});

/* --- the menu's entry ---------------------------------------------------- */

test("the settings are always an entry in the Options menu's last group, after Plan file", () => {
  const groups = optionGroups(optionsItems());
  const last = groups[groups.length - 1];
  assert.deepEqual(last, ["plan-file", "ado"]);
  // Titled for what it configures, with the ellipsis every panel-opener here
  // carries: opening it is the settings and nothing else.
  assert.equal(adoItem(null).label, "Azure DevOps...");
  assert.equal(adoItem(undefined).detail, "Not configured");
  assert.equal(adoItem({ project: "PACT" }).detail, "PACT");
  // A token on this machine is not a mapping: the detail speaks for the plan.
  assert.equal(adoItem({ project: "" }).detail, "Not configured");
});

/* --- the two doors ------------------------------------------------------- */

// The settings hold configuration and the operations hold the import, and the
// top bar's button is the second door. Whether that button may be opened is one
// of the rules, because it is both halves or neither that make an operation
// work: a mapping in the plan and a token on this machine.

const COMPLETE = {
  organizationUrl: "https://dev.azure.com/timwaldburger",
  project: "PACT",
  projectLevels: ["Epic"],
  assignmentLevels: ["Feature"]
};

test("a mapping is in the plan only when both of its lists and its address are", () => {
  assert.equal(adoMappingInPlan(null), false);
  assert.equal(adoMappingInPlan({}), false);
  assert.equal(adoMappingInPlan(COMPLETE), true);
  // A list with nothing in it produces no record, so it is not a mapping.
  assert.equal(adoMappingInPlan(Object.assign({}, COMPLETE, { projectLevels: [] })), false);
  assert.equal(adoMappingInPlan(Object.assign({}, COMPLETE, { assignmentLevels: [] })), false);
  // A half-made mapping is not one: an operation reading it would fail.
  ["organizationUrl", "project", "projectLevels", "assignmentLevels"].forEach((key) => {
    const short = Object.assign({}, COMPLETE);
    delete short[key];
    assert.equal(adoMappingInPlan(short), false, key);
  });
  // A tag level is no longer part of the mapping, so it does not stop one being
  // recognised; a credential-shaped key still does.
  assert.equal(adoMappingInPlan(Object.assign({ tagLevel: "Initiative" }, COMPLETE)), true);
  assert.equal(adoMappingInPlan(Object.assign({ pat: "a-secret" }, COMPLETE)), false);
});

test("no mapping and no token: the button is withheld and says where to go", () => {
  const state = adoOperationState(null, false);
  assert.equal(state.enabled, false);
  assert.equal(state.missing, "both");
  assert.equal(state.title, "Connect PACT to Azure DevOps first: Options then Azure DevOps\u2026");
  assert.equal(ADO_CONNECT_FIRST, state.title);
});

test("a mapping with no token stays withheld, and the reason names the token", () => {
  const state = adoOperationState(COMPLETE, false);
  assert.equal(state.enabled, false);
  assert.equal(state.missing, "token");
  assert.match(state.title, /no token is/);
  assert.match(state.title, /Options then Azure DevOps\u2026$/);
  // Not the sentence for a plan with nothing configured at all: the half that
  // is present is not asked for again.
  assert.notEqual(state.title, ADO_CONNECT_FIRST);
  assert.doesNotMatch(state.title, /^Connect PACT to Azure DevOps first/);
});

test("a token with no mapping stays withheld, and the reason names the mapping", () => {
  const state = adoOperationState(null, true);
  assert.equal(state.enabled, false);
  assert.equal(state.missing, "mapping");
  assert.match(state.title, /no mapping/);
  assert.notEqual(state.title, ADO_CONNECT_FIRST);
});

test("both halves present: the button may be opened, and says what it opens", () => {
  const state = adoOperationState(COMPLETE, true);
  assert.equal(state.enabled, true);
  assert.equal(state.missing, "");
  assert.equal(state.title, "Import a work item from Azure DevOps");
});

test("a token is a flag, not a value: only a set one enables the button", () => {
  // The state is what the server reports, and a token that is absent, still
  // the placeholder, or simply not reported is no token.
  assert.equal(adoOperationState(COMPLETE, undefined).enabled, false);
  assert.equal(adoOperationState(COMPLETE, null).enabled, false);
  assert.equal(adoOperationState(COMPLETE, "a-real-token").enabled, false);
});

test("the store refuses a credential-shaped key on a direct write too", () => {
  const store = createStore(tempFile());
  assert.throws(() => store.setAdo({ ado: Object.assign({}, MAPPING, { pat: "a-secret" }) }), ValidationError);
  assert.equal(store.get().ado, undefined);
  // And nothing was recorded as an undo step by the refusal.
  assert.equal(store.canUndo(), false);
});

test("the mapping round-trips through the store as one undo step", () => {
  const file = tempFile();
  const store = createStore(file);

  const saved = store.setAdo({ ado: MAPPING });
  assert.deepEqual(saved.ado, MAPPING);
  assert.deepEqual(store.get().ado, MAPPING);
  // It is plan data, so it is written to the plan file and reloads with it.
  const reloaded = createStore(file);
  assert.deepEqual(reloaded.get().ado, MAPPING);

  store.undo();
  assert.equal(store.get().ado, undefined);
  assert.deepEqual(createStore(file).get().ado, undefined);

  store.redo();
  assert.deepEqual(store.get().ado, MAPPING);

  // Clearing is its own write and its own undo step.
  store.setAdo({ ado: null });
  assert.equal(store.get().ado, undefined);
  store.undo();
  assert.deepEqual(store.get().ado, MAPPING);
});

test("the connection state reports the mapping and whether a token is set, and no token", () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "plan.json"));
  store.setAdo({ ado: MAPPING });
  writeToken(null, dir, "a-real-token", { platform: "linux", env: {} });
  const state = adoState(store, { configPath: null, home: dir, runtime: { platform: "linux", env: {} } });
  assert.deepEqual(state.mapping, MAPPING);
  assert.equal(state.token.present, true);
  assert.equal(JSON.stringify(state).includes("a-real-token"), false);
});

/* --- the panel's two status lines ---------------------------------------- */

// The panel draws the token's line always, and the connection's only once a
// test has run. Each state is worded here rather than in the browser, so the
// class that colours a good one green is held with the sentence it colours.

test("the token line is green while a token is set and neutral while none is", () => {
  const set = tokenLine({ present: true, path: "/home/tim/.config/pact/ado-pat" });
  assert.equal(set.text, "A personal access token is set at /home/tim/.config/pact/ado-pat.");
  assert.match(set.className, /\bis-ok\b/);
  assert.equal(set.className.includes("is-failed"), false);

  const absent = tokenLine({ present: false, path: "/home/tim/.config/pact/ado-pat" });
  assert.match(absent.text, /^No token is set/);
  assert.equal(/\bis-ok\b|\bis-failed\b/.test(absent.className), false, absent.className);
});

test("there is no connection line until a test has run", () => {
  assert.equal(connectionLine(null), null);
});

test("a successful test names the project, the team and every rank, green, with its status in the title", () => {
  const line = connectionLine({
    ok: true,
    project: "PACT",
    team: "PACT Team",
    types: [
      { name: "Epic", rank: 4 },
      { name: "Feature", rank: 3 },
      { name: "User Story", rank: 2 },
      { name: "Bug", rank: 1 },
      { name: "Task", rank: 1 }
    ],
    status: 203
  });
  // The line names what the mapping rows are chosen from; the URL is already
  // visible in the field above it, so it is not repeated here.
  assert.equal(line.text, "Connected to PACT (PACT Team): Epic 4, Feature 3, User Story 2, Bug 1, Task 1.");
  assert.match(line.className, /\bis-ok\b/);
  assert.equal(line.className.includes("is-failed"), false);
  // The status code is the reader's clue if they are debugging a proxy, and
  // nobody else's business: it is the title, never the words.
  assert.match(line.title, /203/);
  assert.equal(line.text.includes("203"), false);
});

test("a failed test keeps its own message, in the danger treatment", () => {
  const line = connectionLine({ ok: false, message: "Azure DevOps rejected the token (401): it may be expired." });
  assert.equal(line.text, "Azure DevOps rejected the token (401): it may be expired.");
  assert.match(line.className, /\bis-failed\b/);
  assert.equal(line.className.includes("is-ok"), false);
  assert.equal(line.title, "");
});
