/*
 * PACT's Azure DevOps calls, and the token file they read. Everything here runs
 * on the server: the token is read from this machine's config directory, used
 * as a Basic credential, and never written into a response, a log line or an
 * error message. The browser is told whether a token is set and where the file
 * is, and nothing more.
 *
 * The only network calls PACT makes are the ones a press caused - the ADO
 * panel's Test connection and Save, and its token actions - and every call is
 * made here, per request, with no cache, timer or background refresh. ADO is
 * read for one thing in this slice: the project, its backlog levels and its
 * work-item types, so the mapping's slots can be checked against the instance.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConfig } from "./config.mjs";
import { expandHome } from "../public/lib/plan-file.mjs";
import {
  ADO_PLACEHOLDER,
  adoRefusals,
  defaultTokenFile,
  mappingRefusal,
  noTokenMessage,
  normalizeAdo,
  reportedTypes,
  trimOrganizationUrl,
  typeRanks
} from "../public/lib/ado.mjs";

// The token lives beside the app's own config, outside the repository,
// readable only by its owner: `$XDG_CONFIG_HOME/pact/ado-pat` or
// `~/.config/pact/ado-pat` on Linux and macOS, `%LOCALAPPDATA%\pact\ado-pat`
// on Windows. `ado.tokenFile` in the config may move it; the plan may not name
// it at all. The path itself is `defaultTokenFile` in the shared module, which
// takes the platform and the environment so its Windows branch is tested.
const TOKEN_FILE_MODE = 0o600;
const TOKEN_DIR_MODE = 0o700;

const ADO_API_VERSION = "7.1";
const TIMEOUT_MS = 15000;

// A refusal PACT words itself, with the status it should reach the browser as.
// Every ADO failure is one of these, so no library's own message - which could
// quote a request - can reach a response.
export class AdoError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AdoError";
    this.status = status || 502;
  }
}

/* --- the token file ------------------------------------------------------ */

// Where the token is read from and written to: `ado.tokenFile` in the app's
// config when it names one, else the platform's own default. Never the plan.
// `runtime` carries `platform` and `env` so a test can stand in for Windows on
// a Linux machine; the running server passes nothing and gets its own.
export function resolveTokenFile(configPath, home, runtime) {
  const options = runtime || {};
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const resolvedHome = home || os.homedir();
  const fallback = defaultTokenFile(platform, env, resolvedHome);
  const { config } = configPath ? readConfig(configPath) : { config: null };
  const ado = config && config.ado;
  const named = ado && typeof ado.tokenFile === "string" ? ado.tokenFile.trim() : "";
  if (named === "") return { path: fallback, overridden: false };
  return { path: path.resolve(expandHome(named, resolvedHome)), overridden: true };
}

function readTokenFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return { present: false, token: "", placeholder: false };
  }
  const value = raw.trim();
  // An empty file, or one still holding the text that shipped in it, is no
  // token: there is nothing to send, so nothing is sent.
  if (value === "" || value === ADO_PLACEHOLDER) {
    return { present: false, token: "", placeholder: value === ADO_PLACEHOLDER };
  }
  return { present: true, token: value, placeholder: false };
}

// The token state as the browser is told it: whether one is set, where the
// file is, and nothing that could be replayed as the credential.
export function tokenState(configPath, home, runtime) {
  const file = resolveTokenFile(configPath, home, runtime);
  const read = readTokenFile(file.path);
  return { present: read.present, path: file.path, overridden: file.overridden, placeholder: read.placeholder };
}

// The token itself, for a call that needs it. Exported for the tests and for
// nothing else: no route serializes this value.
export function readToken(configPath, home, runtime) {
  const { path: filePath } = resolveTokenFile(configPath, home, runtime);
  const read = readTokenFile(filePath);
  return read.present ? read.token : "";
}

// The token a call must have, or the refusal that says where to put one.
function requireToken(configPath, home, runtime) {
  const token = readToken(configPath, home, runtime);
  if (token === "") throw new AdoError(noTokenMessage(tokenState(configPath, home, runtime)), 409);
  return token;
}

// Store a token the owner typed in the panel. The directory is created when it
// is missing, and the mode is forced on every write so an existing file with a
// looser mode is tightened rather than left open.
//
// The POSIX modes are only attempted on POSIX: on Windows fs.chmod toggles the
// read-only bit and says nothing about who may read the file, and the profile's
// own ACL is what protects it there.
export function writeToken(configPath, home, value, runtime) {
  const options = runtime || {};
  const platform = options.platform || process.platform;
  const posix = !String(platform).toLowerCase().startsWith("win");
  const token = typeof value === "string" ? value.trim() : "";
  if (token === "") throw new AdoError("Type the personal access token first.", 400);
  if (token === ADO_PLACEHOLDER) throw new AdoError("That is the placeholder text, not a token.", 400);
  if (/\s/.test(token)) throw new AdoError("A token is one word with no spaces; paste the whole value ADO gave you.", 400);
  if (token.length > 512) throw new AdoError("That is too long to be a personal access token.", 400);
  const file = resolveTokenFile(configPath, home, options);
  fs.mkdirSync(path.dirname(file.path), posix ? { recursive: true, mode: TOKEN_DIR_MODE } : { recursive: true });
  fs.writeFileSync(file.path, token + "\n", posix ? { mode: TOKEN_FILE_MODE } : {});
  if (posix) fs.chmodSync(file.path, TOKEN_FILE_MODE);
  return tokenState(configPath, home, options);
}

// Clearing is deleting the file: an absent file already reads as no token, so
// there is nothing to keep in its place.
export function clearToken(configPath, home, runtime) {
  const file = resolveTokenFile(configPath, home, runtime);
  try {
    fs.unlinkSync(file.path);
  } catch (_) {
    // Nothing there is the state Clear asks for.
  }
  return tokenState(configPath, home, runtime);
}

/* --- talking to ADO ------------------------------------------------------ */

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch (_) {
    return "the address given";
  }
}

async function readJSON(res) {
  let text = "";
  try {
    text = await res.text();
  } catch (_) {
    text = "";
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// One GET against ADO with the token as a Basic credential. The token never
// appears in the URL, and a failure is reported as PACT's own sentence.
function createGetter(fetchImpl) {
  const call = fetchImpl || globalThis.fetch;
  return async function get(url, token) {
    let res;
    try {
      res = await call(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Basic " + Buffer.from(":" + token, "utf8").toString("base64")
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (_) {
      throw new AdoError("PACT could not reach Azure DevOps - no answer from " + originOf(url) +
        ". Check the organisation address and this machine's connection.", 502);
    }
    let body;
    try {
      body = await readJSON(res);
    } catch (_) {
      body = null;
    }
    return { status: res.status, body };
  };
}

function refusalFor(status, what) {
  if (status === 401) {
    return new AdoError("Azure DevOps rejected the token (401): it may be expired, revoked, " +
      "or not allowed to read work items.", 502);
  }
  if (status === 403) {
    return new AdoError("Azure DevOps refused this token the " + what + " (403). " +
      "The token may lack the Work Items (read) scope.", 502);
  }
  if (status === 404) return new AdoError("Azure DevOps has no " + what + " (404).", 404);
  return new AdoError("Azure DevOps answered " + status + " for the " + what + ".", 502);
}

/*
 * What one project of one instance reports, which is everything this slice
 * needs to check a mapping: the project itself, its team, the backlog levels
 * with their type ranks, and the type names it knows. Four reads, all caused by
 * the press that asked for them.
 */
export async function readInstance(options) {
  const base = trimOrganizationUrl(options.organizationUrl);
  const project = String(options.project || "").trim();
  const get = createGetter(options.fetchImpl);

  const projectResult = await get(base + "/_apis/projects/" + encodeURIComponent(project) +
    "?api-version=" + ADO_API_VERSION, options.token);
  if (projectResult.status !== 200) throw refusalFor(projectResult.status, "project '" + project + "' at " + base);
  const record = projectResult.body || {};
  const projectId = typeof record.id === "string" ? record.id : "";
  if (projectId === "") {
    throw new AdoError("Azure DevOps answered about project '" + project + "' without an id.", 502);
  }

  const teamsResult = await get(base + "/_apis/projects/" + encodeURIComponent(projectId) +
    "/teams?api-version=" + ADO_API_VERSION, options.token);
  if (teamsResult.status !== 200) {
    throw refusalFor(teamsResult.status, "teams of project '" + project + "'");
  }
  const teams = Array.isArray(teamsResult.body && teamsResult.body.value) ? teamsResult.body.value : [];
  const team = teams.filter(function (entry) { return entry && typeof entry.name === "string"; })[0];
  if (!team) throw new AdoError("Project '" + project + "' has no team to read its backlog levels from.", 502);

  const backlogsResult = await get(base + "/" + encodeURIComponent(project) + "/" +
    encodeURIComponent(team.name) + "/_apis/work/backlogs?api-version=" + ADO_API_VERSION, options.token);
  if (backlogsResult.status !== 200) {
    throw refusalFor(backlogsResult.status, "backlog levels of project '" + project + "'");
  }

  const typesResult = await get(base + "/" + encodeURIComponent(project) +
    "/_apis/wit/workitemtypes?api-version=" + ADO_API_VERSION, options.token);
  if (typesResult.status !== 200) {
    throw refusalFor(typesResult.status, "work-item types of project '" + project + "'");
  }

  return {
    project: { name: String(record.name || project), id: projectId },
    team: String(team.name),
    ranks: typeRanks(backlogsResult.body),
    reported: reportedTypes(typesResult.body)
  };
}

/*
 * Test connection: read the instance and report what came back. The project,
 * the types and their ranks - never the token, and nothing PACT has to guess.
 */
export async function testConnection(options) {
  const token = requireToken(options.configPath, options.home, options.runtime);
  const instance = await readInstance({
    organizationUrl: options.organizationUrl,
    project: options.project,
    token: token,
    fetchImpl: options.fetchImpl
  });
  return {
    project: instance.project,
    team: instance.team,
    types: instance.ranks,
    reported: instance.reported
  };
}

/*
 * Save the mapping: a plan write through the store, so the validation, the
 * atomic write, the changed-underneath guard and Undo apply as they do to any
 * other plan change. The slots are checked against the instance's own ranks
 * first, and a refused check writes nothing.
 */
export async function saveMapping(options) {
  const refusals = adoRefusals(options.mapping);
  if (refusals.length) throw new AdoError(refusals.join("; "), 400);
  const mapping = normalizeAdo(options.mapping);
  const token = requireToken(options.configPath, options.home, options.runtime);
  const instance = await readInstance({
    organizationUrl: mapping.organizationUrl,
    project: mapping.project,
    token: token,
    fetchImpl: options.fetchImpl
  });
  const refusal = mappingRefusal(mapping, instance);
  if (refusal) throw new AdoError(refusal, 400);
  const saved = options.store.setAdo({ ado: mapping });
  return { mapping: saved.ado };
}

// The state the panel reads at boot and after every token action: the plan's
// mapping and whether a token is set, in one reply with no credential in it.
export function adoState(store, options) {
  return {
    mapping: store.get().ado || null,
    token: tokenState(options.configPath, options.home, options.runtime)
  };
}
