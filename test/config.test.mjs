import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONFIG_FILENAME,
  DEFAULT_PLAN_FILENAME,
  LEGACY_PLAN_FILENAME,
  readConfig,
  writeConfig,
  migrateDefaultPlan,
  resolvePlanFile
} from "../lib/config.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pact-config-"));
}

/* --- the settings file ---------------------------------------------------- */

test("an absent config is no config and no problem", () => {
  const dir = tempDir();
  assert.deepEqual(readConfig(path.join(dir, CONFIG_FILENAME)), { config: null, problem: "" });
});

test("the config is written and read back beside the app", () => {
  const dir = tempDir();
  const file = path.join(dir, CONFIG_FILENAME);
  writeConfig(file, { planFile: "/home/tim/plans/work.pact.json" });
  assert.deepEqual(readConfig(file), {
    config: { planFile: "/home/tim/plans/work.pact.json" },
    problem: ""
  });
  // Written as a plain JSON object, not some bespoke encoding.
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    planFile: "/home/tim/plans/work.pact.json"
  });
});

test("a config that exists but cannot be understood is reported, not thrown", () => {
  const dir = tempDir();
  const malformed = path.join(dir, "malformed.json");
  fs.writeFileSync(malformed, "{ broken");
  assert.equal(readConfig(malformed).config, null);
  assert.match(readConfig(malformed).problem, /not valid JSON/);

  const notObject = path.join(dir, "array.json");
  fs.writeFileSync(notObject, "[1, 2, 3]");
  assert.match(readConfig(notObject).problem, /not a settings object/);

  const badField = path.join(dir, "bad-field.json");
  fs.writeFileSync(badField, JSON.stringify({ planFile: 42 }));
  assert.match(readConfig(badField).problem, /planFile that is not a path/);
});

/* --- the default file's move ---------------------------------------------- */

test("the old default name is moved to the new one once", () => {
  const dir = tempDir();
  const oldPath = path.join(dir, LEGACY_PLAN_FILENAME);
  const newPath = path.join(dir, DEFAULT_PLAN_FILENAME);
  fs.writeFileSync(oldPath, "PLAN");

  const moved = migrateDefaultPlan(oldPath, newPath);
  assert.deepEqual(moved, { from: oldPath, to: newPath });
  assert.equal(fs.existsSync(oldPath), false);
  assert.equal(fs.readFileSync(newPath, "utf8"), "PLAN");
  // A second call finds nothing to move.
  assert.equal(migrateDefaultPlan(oldPath, newPath), null);
});

test("the move never writes over an existing default", () => {
  const dir = tempDir();
  const oldPath = path.join(dir, LEGACY_PLAN_FILENAME);
  const newPath = path.join(dir, DEFAULT_PLAN_FILENAME);
  fs.writeFileSync(oldPath, "OLD");
  fs.writeFileSync(newPath, "KEEP");

  assert.equal(migrateDefaultPlan(oldPath, newPath), null);
  assert.equal(fs.readFileSync(oldPath, "utf8"), "OLD");
  assert.equal(fs.readFileSync(newPath, "utf8"), "KEEP");
});

/* --- which plan file the server runs against ------------------------------ */

test("with nothing set, the default plan file is used", () => {
  const dataDir = tempDir();
  const resolved = resolvePlanFile({ dataDir: dataDir });
  assert.equal(resolved.path, path.join(dataDir, DEFAULT_PLAN_FILENAME));
  assert.equal(resolved.source, "default");
  assert.equal(resolved.notice, "");
});

test("PACT_DATA wins over a config, being the per-run choice", () => {
  const dataDir = tempDir();
  writeConfig(path.join(dataDir, CONFIG_FILENAME), { planFile: "/somewhere/from-config.pact.json" });
  const resolved = resolvePlanFile({ dataDir: dataDir, env: "/somewhere/from-env.pact.json" });
  assert.equal(resolved.path, path.resolve("/somewhere/from-env.pact.json"));
  assert.equal(resolved.source, "env");
});

test("the config names the plan file when PACT_DATA is unset", () => {
  const dataDir = tempDir();
  writeConfig(path.join(dataDir, CONFIG_FILENAME), { planFile: "/somewhere/from-config.pact.json" });
  const resolved = resolvePlanFile({ dataDir: dataDir });
  assert.equal(resolved.path, path.resolve("/somewhere/from-config.pact.json"));
  assert.equal(resolved.source, "config");
  assert.equal(resolved.notice, "");
});

test("with no config, the old default is moved and the move is reported", () => {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, LEGACY_PLAN_FILENAME), "PLAN");
  const resolved = resolvePlanFile({ dataDir: dataDir });
  assert.equal(resolved.path, path.join(dataDir, DEFAULT_PLAN_FILENAME));
  assert.equal(resolved.source, "default");
  assert.match(resolved.notice, /Moved .*pact\.json to .*default\.pact\.json/);
  assert.equal(fs.existsSync(path.join(dataDir, LEGACY_PLAN_FILENAME)), false);
  assert.equal(fs.readFileSync(path.join(dataDir, DEFAULT_PLAN_FILENAME), "utf8"), "PLAN");
});

test("a broken config falls back to the default and says why", () => {
  const dataDir = tempDir();
  fs.writeFileSync(path.join(dataDir, CONFIG_FILENAME), "{ broken");
  const resolved = resolvePlanFile({ dataDir: dataDir });
  assert.equal(resolved.path, path.join(dataDir, DEFAULT_PLAN_FILENAME));
  assert.equal(resolved.source, "default");
  assert.match(resolved.notice, /not valid JSON/);
});
