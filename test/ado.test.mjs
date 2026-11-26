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
  ADO_PLACEHOLDER,
  adoRefusals,
  defaultTokenFile,
  mappingRefusal,
  normalizeAdo,
  reportedTypes,
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
  projectLevel: "Epic",
  assignmentLevel: "Feature",
  tagLevel: "User Story"
};

test("a plan without an ADO block is valid, exactly as it was", () => {
  assert.deepEqual(validatePlan(seedPlan()), []);
  assert.equal("ado" in seedPlan(), false);
});

test("a plan accepts an ADO block of two addresses and three type names", () => {
  const plan = Object.assign(seedPlan(), { ado: MAPPING });
  assert.deepEqual(validatePlan(plan), []);
  // The tag slot may be absent, which is a mapping with no tag level at all.
  const partial = Object.assign(seedPlan(), { ado: { organizationUrl: MAPPING.organizationUrl, project: "PACT", projectLevel: "Epic", assignmentLevel: "Feature" } });
  assert.deepEqual(validatePlan(partial), []);
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

test("the block's shape is checked: the address pair, the two required slots, no stray key", () => {
  assert.match(adoRefusals(null)[0], /must be an object/);
  assert.match(adoRefusals({}).join(" "), /organisation address is required/);
  assert.match(adoRefusals(Object.assign({}, MAPPING, { organizationUrl: "dev.azure.com/x" })).join(" "), /start http:\/\/ or https:\/\//);
  assert.match(adoRefusals({ organizationUrl: MAPPING.organizationUrl, project: "PACT" }).join(" "), /projectLevel/);
  assert.match(adoRefusals(Object.assign({}, MAPPING, { owner: "tim" })).join(" "), /unknown field 'owner'/);
  assert.match(adoRefusals(Object.assign({}, MAPPING, { tagLevel: "  " })).join(" "), /tagLevel/);
});

test("the block is stored trimmed, with a trailing slash off the address", () => {
  assert.deepEqual(normalizeAdo({
    organizationUrl: " https://dev.azure.com/timwaldburger/ ",
    project: " PACT ",
    projectLevel: " Epic ",
    assignmentLevel: "Feature",
    tagLevel: null
  }), {
    organizationUrl: "https://dev.azure.com/timwaldburger",
    project: "PACT",
    projectLevel: "Epic",
    assignmentLevel: "Feature"
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

test("the project slot above the assignment slot passes", () => {
  assert.equal(mappingRefusal({ projectLevel: "Epic", assignmentLevel: "Feature" }, INSTANCE), null);
  assert.equal(mappingRefusal({ projectLevel: "Epic", assignmentLevel: "User Story" }, INSTANCE), null);
  assert.equal(mappingRefusal({ projectLevel: "Epic", assignmentLevel: "Feature", tagLevel: "User Story" }, INSTANCE), null);
});

test("equal or inverted ranks refuse, naming both ranks", () => {
  const equal = mappingRefusal({ projectLevel: "Feature", assignmentLevel: "Feature" }, INSTANCE);
  assert.match(equal, /'Feature' \(rank 3\)/);
  assert.equal((equal.match(/rank 3/g) || []).length, 2);

  const inverted = mappingRefusal({ projectLevel: "Feature", assignmentLevel: "Epic" }, INSTANCE);
  assert.match(inverted, /'Feature' \(rank 3\)/);
  assert.match(inverted, /'Epic' \(rank 4\)/);
  assert.match(inverted, /must be a higher level/);
});

test("a type with no backlog level cannot fill either ranked slot", () => {
  const noRank = { ranks: typeRanks(BACKLOGS), reported: reportedTypes(TYPES).concat("Test Case") };
  assert.match(mappingRefusal({ projectLevel: "Test Case", assignmentLevel: "Feature" }, noRank),
    /no backlog level to the project type 'Test Case'/);
  assert.match(mappingRefusal({ projectLevel: "Epic", assignmentLevel: "Test Case" }, noRank),
    /no backlog level to the assignment type 'Test Case'/);
});

test("a tag slot must be a type the instance reports, and may be absent", () => {
  assert.match(
    mappingRefusal({ projectLevel: "Epic", assignmentLevel: "Feature", tagLevel: "Test Case" }, INSTANCE),
    /does not report a type called 'Test Case'/
  );
  assert.equal(mappingRefusal({ projectLevel: "Epic", assignmentLevel: "Feature", tagLevel: "" }, INSTANCE), null);
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

test("ADO is always an entry in the Options menu's last group, after Plan file", () => {
  const groups = optionGroups(optionsItems());
  const last = groups[groups.length - 1];
  assert.deepEqual(last, ["plan-file", "ado"]);
  assert.equal(adoItem(null).label, "ADO...");
  assert.equal(adoItem(undefined).detail, "Not configured");
  assert.equal(adoItem({ project: "PACT" }).detail, "PACT");
  // A token on this machine is not a mapping: the detail speaks for the plan.
  assert.equal(adoItem({ project: "" }).detail, "Not configured");
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
