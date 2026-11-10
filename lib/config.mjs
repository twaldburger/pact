/*
 * PACT's own settings file and the one decision it holds: which plan file is
 * active. `data/config.json` sits beside the plan and is gitignored like the
 * rest of `data/`; its absence simply means the default. It may hold other
 * settings later, so it is read and written as a plain object.
 *
 * The active plan is resolved once, when the server starts. PACT_DATA wins over
 * the config because it is the deliberate per-run choice; otherwise the config
 * names the file; otherwise the default is used, after moving the old default
 * name to the new one if that is what is there.
 */
import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./plan.mjs";
import { normalizeView } from "../public/lib/view.mjs";

export const CONFIG_FILENAME = "config.json";
export const DEFAULT_PLAN_FILENAME = "default.pact.json";
export const LEGACY_PLAN_FILENAME = "pact.json";

/*
 * The config as a mutable plain object, whatever it holds. An absent one is an
 * empty object; one that cannot be read, parsed or understood is an empty
 * object too, because a writer must never turn a broken file into a startup
 * failure - it replaces only the field it was given and leaves the rest alone.
 */
function configObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return {};
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

/*
 * Read the settings file. An absent one is not a problem: it returns no config
 * and no problem. A file that exists but cannot be read, parsed or understood
 * returns the problem as a sentence, so the caller can fall back and say so
 * rather than failing silently.
 */
export function readConfig(filePath) {
  if (!fs.existsSync(filePath)) return { config: null, problem: "" };
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    return { config: null, problem: "could not read " + filePath + ": " + err.message };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { config: null, problem: filePath + " is not valid JSON: " + err.message };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { config: null, problem: filePath + " is not a settings object" };
  }
  if (parsed.planFile !== undefined && typeof parsed.planFile !== "string") {
    return { config: null, problem: filePath + " has a planFile that is not a path" };
  }
  return { config: parsed, problem: "" };
}

export function writeConfig(filePath, config) {
  atomicWrite(filePath, JSON.stringify(config, null, 2) + "\n");
}

/*
 * The view settings as stored, each key falling back on its own. The plan path
 * and any other field are irrelevant here and never touched.
 */
export function readView(filePath) {
  return normalizeView(configObject(filePath).view);
}

/*
 * Store a changed view. The written value is the current stored view with the
 * given keys merged over it, then normalised, so a caller may send one key or
 * all of them and a malformed one is dropped rather than stored. The plan path
 * and every other field in the config are preserved exactly. Returns the view
 * as written.
 */
export function writeView(filePath, patch) {
  const config = configObject(filePath);
  const merged = Object.assign({}, normalizeView(config.view), patch);
  config.view = normalizeView(merged);
  atomicWrite(filePath, JSON.stringify(config, null, 2) + "\n");
  return config.view;
}

/*
 * Remember the active plan file, keeping the view settings and every other
 * field in the config. The plan-file switch and the view share this one file,
 * so neither may write the other away.
 */
export function writePlanFile(filePath, planFile) {
  const config = configObject(filePath);
  config.planFile = planFile;
  atomicWrite(filePath, JSON.stringify(config, null, 2) + "\n");
  return config;
}

/*
 * Move the old default plan name to the new one. It is a rename, never a
 * copy-and-delete, it happens only when the old name exists and the new one does
 * not, and it never writes over an existing default. Returns `{ from, to }` when
 * it moved, or null when there was nothing to do.
 */
export function migrateDefaultPlan(oldPath, newPath) {
  if (oldPath === newPath) return null;
  if (!fs.existsSync(oldPath)) return null;
  if (fs.existsSync(newPath)) return null;
  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    return null;
  }
  return { from: oldPath, to: newPath };
}

/*
 * Decide which plan file the server runs against. `env` is PACT_DATA as it was
 * set, or an empty value. Returns the resolved absolute path, where it came
 * from, and a one-time notice to report.
 */
export function resolvePlanFile(options) {
  const dataDir = options.dataDir;
  const configFile = options.configFile || path.join(dataDir, CONFIG_FILENAME);
  const defaultFile = path.join(dataDir, DEFAULT_PLAN_FILENAME);
  const legacyFile = path.join(dataDir, LEGACY_PLAN_FILENAME);

  if (options.env) {
    return { path: path.resolve(options.env), source: "env", notice: "" };
  }

  const { config, problem } = readConfig(configFile);
  if (config && typeof config.planFile === "string" && config.planFile !== "") {
    return { path: path.resolve(config.planFile), source: "config", notice: "" };
  }

  const moved = migrateDefaultPlan(legacyFile, defaultFile);
  const notice = [];
  if (problem) notice.push(problem);
  if (moved) notice.push("Moved " + moved.from + " to " + moved.to + ".");
  return { path: defaultFile, source: "default", notice: notice.join(" ") };
}
