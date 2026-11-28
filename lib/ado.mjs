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
import { todayISO } from "./plan.mjs";
import { sprintsFor } from "../public/lib/sprints.mjs";
import { expandHome } from "../public/lib/plan-file.mjs";
import {
  ADO_FIELDS,
  ADO_PLACEHOLDER,
  adoRefusals,
  allocationComment,
  assignedIdentity,
  childIdsOf,
  datePart,
  defaultTokenFile,
  existingProjectOffer,
  importLevel,
  importLevelRefusal,
  importPlacement,
  iterationForDate,
  iterationRefusal,
  iterationStartFor,
  iterationWindows,
  mappingRefusal,
  nestingOffer,
  noTokenMessage,
  normalizeAdo,
  normalizeLink,
  parentIdOf,
  personForEmail,
  projectForTitle,
  projectFromChain,
  readWorkItemId,
  reportedTypes,
  schedulingFields,
  trimOrganizationUrl,
  typeRanks,
  unmatchedAssigneeOffer,
  WRITE_BACK_MARKER,
  writeBackLine,
  writeBackState
} from "../public/lib/ado.mjs";
import { spanFteDays } from "../public/lib/workdays.mjs";
import { copyName } from "../public/lib/copy.mjs";

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

// What ADO's answer held, read once: the status, the body text, the parsed body
// when it is JSON at all, and the content type and location a refused call is
// recognised by.
async function readAnswer(res) {
  let text = "";
  try {
    text = await res.text();
  } catch (_) {
    text = "";
  }
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = null;
    }
  }
  const headers = res.headers;
  const header = (name) => (headers && typeof headers.get === "function" ? String(headers.get(name) || "") : "");
  return { status: res.status, text: text, body: body, type: header("content-type"), location: header("location") };
}

// One call against ADO with the token as a Basic credential. The token never
// appears in the URL, and a failure is reported as PACT's own sentence.
//
// A write names its own verb and content type, because the JSON Patch a
// conditional write needs is not JSON and is refused when it is sent as such.
function createSender(fetchImpl) {
  const call = fetchImpl || globalThis.fetch;
  return async function send(method, url, token, body, contentType) {
    let res;
    try {
      res = await call(url, {
        method: method,
        headers: {
          accept: "application/json",
          authorization: "Basic " + Buffer.from(":" + token, "utf8").toString("base64"),
          "content-type": contentType || "application/json"
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (_) {
      throw new AdoError("PACT could not reach Azure DevOps - no answer from " + originOf(url) +
        ". Check the organisation address and this machine's connection.", 502);
    }
    return readAnswer(res);
  };
}

function createGetter(fetchImpl) {
  const send = createSender(fetchImpl);
  return function get(url, token) {
    return send("GET", url, token);
  };
}

// A status that carried a body PACT can read. Any 2xx, not just 200: an
// intermediary between the client and ADO can answer 203 Non-Authoritative
// Information for a response it rewrote, and that is still the instance
// telling us what it holds.
function carriedBody(status) {
  return status >= 200 && status < 300;
}

// A 2xx is not on its own an answer. A request Azure DevOps did not accept is
// redirected to its sign-in page, which answers 203 with an HTML login form -
// read as the project, that would report a connection over a form.
// So a call is answered only when its status is 2xx and its body is JSON;
// anything else is refused in words a person can act on.
const SIGN_IN_PAGE = /_signin|sign in to your account/i;

function signInRefusal(what) {
  return new AdoError("Azure DevOps did not accept the token: it redirected the request for the " + what +
    " to its sign-in page. The token may be wrong for this organisation, expired or revoked, or missing a " +
    "scope: Work Items (read) and Project and Team (read) both need to be granted.", 502);
}

function answerBody(answer, what) {
  const signIn = SIGN_IN_PAGE.test(answer.location || "") ||
    String(answer.type || "").toLowerCase().includes("text/html") ||
    SIGN_IN_PAGE.test(answer.text || "");
  if (!carriedBody(answer.status)) {
    if (signIn) throw signInRefusal(what);
    throw refusalFor(answer.status, what);
  }
  if (signIn && (!answer.body || typeof answer.body !== "object")) throw signInRefusal(what);
  if (!String(answer.text || "").trim()) {
    throw new AdoError("Azure DevOps answered " + answer.status + " for the " + what + " with no content.", 502);
  }
  if (!answer.body || typeof answer.body !== "object") {
    throw new AdoError("Azure DevOps answered " + answer.status + " for the " + what +
      " with a body that is not JSON.", 502);
  }
  return answer.body;
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
 * The project and its first team, which is what every later read is addressed
 * by: the backlog levels are a team's, and so are the iterations. Two reads,
 * made by whoever asks for them.
 */
async function readProjectAndTeam(base, project, get, token) {
  const projectResult = await get(base + "/_apis/projects/" + encodeURIComponent(project) +
    "?api-version=" + ADO_API_VERSION, token);
  const record = answerBody(projectResult, "project '" + project + "' at " + base);
  const projectId = typeof record.id === "string" ? record.id : "";
  if (projectId === "") {
    throw new AdoError("Azure DevOps answered about project '" + project + "' without an id.", 502);
  }

  const teamsResult = await get(base + "/_apis/projects/" + encodeURIComponent(projectId) +
    "/teams?api-version=" + ADO_API_VERSION, token);
  const teamsBody = answerBody(teamsResult, "teams of project '" + project + "'");
  const teams = Array.isArray(teamsBody.value) ? teamsBody.value : [];
  const team = teams.filter(function (entry) { return entry && typeof entry.name === "string"; })[0];
  if (!team) throw new AdoError("Project '" + project + "' has no team to read its backlog levels from.", 502);

  return { record: record, projectId: projectId, team: team, status: projectResult.status };
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

  const instance = await readProjectAndTeam(base, project, get, options.token);
  const record = instance.record;
  const projectId = instance.projectId;
  const team = instance.team;

  const backlogsResult = await get(base + "/" + encodeURIComponent(project) + "/" +
    encodeURIComponent(team.name) + "/_apis/work/backlogs?api-version=" + ADO_API_VERSION, options.token);
  const backlogsBody = answerBody(backlogsResult, "backlog levels of project '" + project + "'");

  const typesResult = await get(base + "/" + encodeURIComponent(project) +
    "/_apis/wit/workitemtypes?api-version=" + ADO_API_VERSION, options.token);
  const typesBody = answerBody(typesResult, "work-item types of project '" + project + "'");

  return {
    project: { name: String(record.name || project), id: projectId },
    team: String(team.name),
    ranks: typeRanks(backlogsBody),
    reported: reportedTypes(typesBody),
    // The status the project read came back with, for the panel's `title`: a
    // 203 is a clue that something sits between this machine and ADO, and no
    // business of a reader who is not debugging one.
    status: instance.status
  };
}

/*
 * Test connection: read the instance and report what came back. The project,
 * the types and their ranks - never the token, and nothing PACT has to guess.
 * The status travels so the panel can put it in the success line's `title`.
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
    reported: instance.reported,
    status: instance.status
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

/* --- importing one work item ---------------------------------------------- */

/*
 * How far up a hierarchy an import will walk looking for the project level. ADO
 * hierarchies are four or five levels deep in every template; the limit is only
 * there so a malformed parent chain cannot loop, and a chain that hits it is
 * refused as one that reaches no project level.
 */
const PARENT_LIMIT = 20;

// A Person created by an import is full time until somebody says otherwise:
// ADO knows nothing about availability, and guessing a reduced one would hide
// capacity the plan actually has.
const IMPORTED_AVAILABILITY = 100;

// An imported Assignment takes the whole of that Person for those dates. ADO has
// no notion of "40% of Anna", and neither the plan's step nor anything else in
// the work item suggests a slice, so a smaller number would be a guess dressed
// as a plan. The person narrows it in the panel when the work is not full time,
// and over-allocation is drawn rather than hidden, so an import that commits
// somebody past their Availability says so on the grid instead of understating
// the work.
//
// Exported because the feature reference states the share it starts at, and a
// sentence quoting a constant cannot go stale behind it.
export const IMPORTED_SHARE = 100;

/*
 * One work item, read as the fields the import needs. The work item is
 * addressed inside the mapped project, so a token scoped to one project cannot
 * be pointed at another by a pasted id.
 */
async function readWorkItem(base, project, id, get, token) {
  const what = "work item " + id + " in project '" + project + "'";
  const url = base + "/" + encodeURIComponent(project) + "/_apis/wit/workitems/" + id +
    "?$expand=relations&api-version=" + ADO_API_VERSION;
  const body = answerBody(await get(url, token), what);
  return {
    id: Number(body && body.id) || id,
    rev: Number(body && body.rev) || 0,
    fields: body && typeof body.fields === "object" && body.fields ? body.fields : {},
    relations: Array.isArray(body && body.relations) ? body.relations : []
  };
}

/*
 * The start date of the iteration a path names, or empty. Best effort on
 * purpose: a project with no team, iterations switched off, or a token without
 * Project and Team (read) must not refuse an import whose work item was read
 * perfectly well - the block then takes the assumed month and the panel's line
 * says the sprint could not be matched.
 */
async function readIterationStart(base, project, path, get, token) {
  try {
    const instance = await readProjectAndTeam(base, project, get, token);
    const url = base + "/" + encodeURIComponent(project) + "/" + encodeURIComponent(instance.team.name) +
      "/_apis/work/teamsettings/iterations?api-version=" + ADO_API_VERSION;
    const body = answerBody(await get(url, token), "iterations of project '" + project + "'");
    return iterationStartFor(Array.isArray(body.value) ? body.value : [], path);
  } catch (_) {
    return "";
  }
}

function describeAssignment(assignment, person, project) {
  const name = assignment.name ? "\"" + assignment.name + "\"" : "an unnamed Assignment";
  return name + " (" + (person ? person.name : "an unknown Person") + " on " +
    (project ? project.name : "an unknown Project") + ")";
}

/*
 * The records the plan already carries a link on, by work-item id. A linked
 * Project and a linked Assignment both count, because the warning is about the
 * same work sitting on the plan twice; an archived record has been put away and
 * so plans nothing. `place` is the word the warning uses for what the item
 * became, and `title` is that record's name on the plan.
 */
function linkedRecords(plan) {
  const found = new Map();
  const add = function (record, place) {
    const link = record && record.link;
    if (!link || !Number.isInteger(link.workItemId) || found.has(link.workItemId)) return;
    found.set(link.workItemId, {
      id: link.workItemId,
      type: String(link.workItemType || "").trim(),
      place: place,
      title: String(record.name || "").trim()
    });
  };
  (plan.projects || []).forEach(function (project) {
    if (project && !project.archived) add(project, "Project");
  });
  (plan.assignments || []).forEach(function (assignment) {
    if (assignment && !assignment.archived) add(assignment, "Assignment");
  });
  return found;
}

// How many work items a descendant search will read before giving up. The
// warning is a courtesy - one level of a hierarchy is a handful of items, and an
// unbounded walk over a large Epic would cost more than the answer is worth.
const NESTING_READ_LIMIT = 25;

/*
 * The first linked record below the item, or null. The item's own read already
 * carried the ids of its children; each child is read only to reach its own, so
 * an item nested two levels below is still found. Best effort throughout: a
 * child that cannot be read is skipped, and a search that hits the limit says
 * nothing rather than failing an import - the warning exists so a person can
 * see the overlap, never so an import can be refused for want of an answer.
 */
async function linkedDescendant(item, linked, readItem) {
  const queue = childIdsOf(item);
  const seen = new Set();
  let read = 0;
  while (queue.length && read < NESTING_READ_LIMIT) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const found = linked.get(id);
    if (found) return found;
    read += 1;
    let child = null;
    try {
      child = await readItem(id);
    } catch (_) {
      continue;
    }
    childIdsOf(child).forEach(function (next) { queue.push(next); });
  }
  return null;
}

/*
 * The nesting warning this import would get, or null. An ancestor of the item -
 * the chain the import walks anyway - and any descendant of it are both asked
 * about, because the same work can be planned at either end: an Epic imported
 * above a Feature already on the plan, and a Feature imported above a User Story
 * already on it, are the same overlap seen from two sides.
 */
async function nestingWarning(options) {
  const linked = linkedRecords(options.plan);
  if (linked.size === 0) return null;
  const ancestor = options.chain
    .map(function (entry) { return linked.get(entry.id); })
    .filter(Boolean)[0];
  if (ancestor) return nestingOffer({ workItemId: options.id, workItemType: options.workItemType, relation: "ancestor", relative: ancestor });
  const descendant = await linkedDescendant(options.item, linked, options.readItem);
  if (descendant) return nestingOffer({ workItemId: options.id, workItemType: options.workItemType, relation: "descendant", relative: descendant });
  return null;
}

/*
 * A project-level import: the item's own type is the mapping's project level,
 * so the item becomes the Project - the title verbatim as its name, the
 * least-used colour as any new Project takes, no notes - and its `AssignedTo`
 * is never read, because a Project needs no owner.
 *
 * A live Project already carrying that title is not duplicated behind the
 * panel's back: the refusal carries the offer to use it or to import a copy,
 * and nothing is written until one of those is pressed. Using it stores the
 * link on it and creates nothing; a copy takes the app's own `X (copy)` name,
 * numbered while a live Project holds that name. Each outcome is one commit, so
 * the Project and its link land together or not at all.
 */
function importProjectItem(options) {
  const plan = options.plan;
  const title = options.title;
  // A Project has no dates, so its baseline holds the revision and the agreed
  // title and leaves the dates empty: whether a block's dates are assumed is
  // the Assignment's business, and a Project's link never had any.
  const link = normalizeLink({
    workItemId: options.id,
    rev: options.item.rev,
    workItemType: options.workItemType,
    datesAssumed: false,
    values: { title: title, project: title, start: null, end: null, iterationPath: null }
  }, "project");
  const liveNames = plan.projects.filter(function (project) {
    return project && !project.archived;
  }).map(function (project) {
    return String(project.name || "");
  });
  const existing = projectForTitle(plan.projects, title);

  if (existing && !options.useExisting && !options.copyProject) {
    const offer = existingProjectOffer(existing, copyName(title, liveNames));
    const refusal = new AdoError(offer.message, 409);
    // The panel draws the two presses from this field, never by parsing the
    // sentence back out of it.
    refusal.offer = offer;
    throw refusal;
  }

  const facts = { workItemId: options.id, workItemType: options.workItemType };
  if (existing && options.useExisting) {
    const project = options.store.linkProject({ projectId: existing.id, link: link });
    facts.created = false;
    facts.projectName = project.name;
    return { kind: "project", project: project, facts: facts };
  }

  const name = existing ? copyName(title, liveNames) : title;
  const project = options.store.importProject({
    project: { name: name, notes: "", tags: [] },
    link: link
  });
  facts.created = true;
  facts.projectName = project.name;
  return { kind: "project", project: project, facts: facts };
}

/*
 * Import one work item. What it becomes is decided by the item's own level
 * before anything else: a project-level item becomes a Project carrying its
 * link (or takes the offer to use one already on the plan); an assignment-level
 * item - and a level between that and the project's - resolves its Person, its
 * Project and its dates and is written as an Assignment; a tag-level or
 * below-the-assignment-level item is refused for what its level is for.
 *
 * Every refusal happens before the commit, so nothing is half-imported by
 * construction: the only writes are the store's own - importAssignment,
 * importProject and linkProject - each of which validates, writes atomically
 * and records one undo step, or throws and writes nothing at all. The order of
 * the refusals is the order a reader would want them in: what was pasted, right
 * for an Assignment whether it is already on the plan, whether PACT may talk to
 * ADO, then what the item turned out to be.
 */
export async function importWorkItem(options) {
  const plan = options.store.get();
  const mapping = plan.ado;
  if (!mapping) {
    throw new AdoError("The plan has no ADO mapping, so there is nothing to import into. " +
      "Give the URL and the two lists of types in the settings under Options, then press Save mapping.", 409);
  }

  const reading = readWorkItemId(options.id);
  if (reading.refusal) throw new AdoError(reading.refusal, 400);
  const id = reading.id;

  // One work item may be several Assignments by design, so a duplicate is not
  // refused on principle - but a second press of the same paste almost always
  // is a mistake, and a duplicate that says which one it duplicates is cheap.
  const already = plan.assignments.filter(function (assignment) {
    return assignment && !assignment.archived && assignment.link && assignment.link.workItemId === id;
  })[0];
  if (already) {
    const person = plan.people.filter(function (candidate) { return candidate.id === already.personId; })[0];
    const project = plan.projects.filter(function (candidate) { return candidate.id === already.projectId; })[0];
    throw new AdoError("Work item " + id + " is already on the plan as " +
      describeAssignment(already, person, project) +
      ". Archive that Assignment first if this really is a second block of the same work.", 409);
  }

  const token = requireToken(options.configPath, options.home, options.runtime);
  const base = trimOrganizationUrl(mapping.organizationUrl);
  const projectName = String(mapping.project || "").trim();
  const get = createGetter(options.fetchImpl);
  const readItem = function (workItemId) {
    return readWorkItem(base, projectName, workItemId, get, token);
  };

  const item = await readWorkItem(base, projectName, id, get, token);
  const fields = item.fields;

  const title = String(fields[ADO_FIELDS.title] || "").trim();
  if (title === "") {
    throw new AdoError("Work item " + id + " has no title, and its title is what the Assignment's Name would be.", 409);
  }

  // The item's own type decides what it becomes, before any person or ancestor
  // is considered: a type in the mapping's project levels becomes a Project and
  // never reads who it is assigned to, a type in its assignment levels becomes
  // an Assignment, and a type in neither is refused, naming both lists.
  const workItemType = String(fields[ADO_FIELDS.type] || "").trim();
  const level = importLevel(mapping, workItemType);
  if (level === "neither") {
    throw new AdoError(importLevelRefusal({
      workItemId: id,
      title: title,
      workItemType: workItemType,
      mapping: mapping
    }), 409);
  }

  // The parents, walked upward for both paths. An Assignment's Project is the
  // nearest ancestor whose type is in the mapping's project levels - never the
  // item itself, because a record cannot be its own container - and an import at
  // the project level walks them only to see what it would nest inside.
  const chain = [];
  const seen = new Set([id]);
  let parentId = parentIdOf(item);
  while (parentId > 0 && chain.length < PARENT_LIMIT && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await readWorkItem(base, projectName, parentId, get, token);
    chain.push({
      id: parent.id,
      type: String(parent.fields[ADO_FIELDS.type] || "").trim(),
      title: String(parent.fields[ADO_FIELDS.title] || "").trim()
    });
    parentId = parentIdOf(parent);
  }

  // Nesting is a warning with a press behind it, not a refusal: with two lists a
  // plan may legitimately hold an item and something inside it, and what has to
  // be said is that the two records' figures overlap. `confirmNesting` is that
  // press, and nothing is written before it.
  if (options.confirmNesting !== true) {
    const nesting = await nestingWarning({
      plan: plan,
      item: item,
      chain: chain,
      id: id,
      workItemType: workItemType,
      readItem: readItem
    });
    if (nesting) {
      const refusal = new AdoError(nesting.message, 409);
      // The panel draws the press from this field, never by parsing the
      // sentence back out of it.
      refusal.offer = nesting;
      throw refusal;
    }
  }

  if (level === "project") {
    return importProjectItem({
      plan: plan,
      store: options.store,
      item: item,
      id: id,
      title: title,
      workItemType: workItemType,
      useExisting: options.useExisting === true,
      copyProject: options.copyProject === true
    });
  }

  const assignee = assignedIdentity(fields);
  if (assignee.kind === "unassigned") {
    throw new AdoError("Work item " + id + " (\"" + title + "\") is not assigned to anybody. " +
      "An import puts work on a Person's row, so give it an owner in ADO and import it again.", 409);
  }
  if (assignee.kind === "group") {
    throw new AdoError("Work item " + id + " (\"" + title + "\") is assigned to '" + assignee.name +
      "', a group or an identity with no email, so PACT cannot match it to a Person. " +
      "Assign it to a person in ADO and import it again.", 409);
  }

  const matchedPerson = personForEmail(plan.people, assignee.email);
  if (!matchedPerson && !options.createPerson) {
    const offer = unmatchedAssigneeOffer(assignee);
    const refusal = new AdoError(offer.message, 409);
    // The panel draws this as its own press, so the offer travels with the
    // refusal rather than being read back out of its wording.
    refusal.offer = offer;
    throw refusal;
  }

  const ancestor = projectFromChain(chain, mapping.projectLevels);
  if (ancestor.refusal) throw new AdoError(ancestor.refusal, 409);
  const project = projectForTitle(plan.projects, ancestor.title);
  if (!project) {
    throw new AdoError("The work item sits under " + (ancestor.type || "a project level") + " \"" +
      ancestor.title + "\", and the plan has no Project of that name. Add that Project first, or " +
      "rename one to match: an import never invents a Project.", 409);
  }

  // Dates: ADO's own when the item's type carries both, the iteration's sprint
  // next, the assumed month last.
  const scheduling = schedulingFields(fields[ADO_FIELDS.type]);
  const adoStart = datePart(fields[scheduling.start]);
  const adoEnd = scheduling.end === "" ? "" : datePart(fields[scheduling.end]);
  const iterationPath = String(fields[ADO_FIELDS.iterationPath] || "").trim();
  let iterationStart = "";
  if (iterationPath !== "" && !(adoStart !== "" && adoEnd !== "")) {
    iterationStart = await readIterationStart(base, projectName, iterationPath, get, token);
  }
  const placement = importPlacement({
    period: plan.range,
    today: todayISO(),
    adoStart: adoStart,
    adoEnd: adoEnd,
    iterationStart: iterationStart,
    sprints: sprintsFor(plan.cadence, plan.sprints, plan.range)
  });

  const link = normalizeLink({
    workItemId: id,
    rev: item.rev,
    workItemType: workItemType,
    datesAssumed: placement.datesAssumed,
    values: {
      title: title,
      personEmail: assignee.email,
      project: ancestor.title,
      start: adoStart === "" ? null : adoStart,
      end: adoEnd === "" ? null : adoEnd,
      iterationPath: iterationPath === "" ? null : iterationPath
    }
  });

  const assignment = {
    projectId: project.id,
    start: placement.start,
    end: placement.end,
    // The Share is PACT's own number and ADO has no equivalent, so an import
    // takes all of the person until one is set here.
    share: IMPORTED_SHARE,
    name: title,
    tags: [],
    note: "",
    link: link
  };
  if (matchedPerson) assignment.personId = matchedPerson.id;

  const saved = options.store.importAssignment({
    person: matchedPerson ? null : { name: assignee.name, email: assignee.email, availability: IMPORTED_AVAILABILITY },
    assignment: assignment
  });

  return {
    kind: "assignment",
    assignment: saved.assignment,
    person: saved.person,
    facts: {
      workItemId: id,
      workItemType: workItemType,
      assignmentName: title,
      person: {
        name: saved.person ? saved.person.name : matchedPerson.name,
        email: assignee.email,
        created: !!saved.person
      },
      projectName: project.name,
      start: placement.start,
      end: placement.end,
      datesAssumed: placement.datesAssumed,
      source: placement.source,
      iterationStart: iterationStart,
      sprint: placement.sprint
    }
  };
}

/* --- writing one Assignment back ------------------------------------------ */

// How deep the iteration tree is read: ADO hierarchies are a handful of levels
// and a sprint sits under the project's Iterations root, so five reaches it with
// room for a team that nests its own.
const ITERATION_DEPTH = 5;

// The comments API is a preview resource and says so: the released api-version
// answers 400 asking for the preview flag, so the flag is part of the address.
const COMMENT_API_VERSION = "7.1-preview.4";

/*
 * The refusal a write of one kind or another earns, each naming its own cause.
 * 412 is the conditional write doing its job: the item is no longer at the
 * revision PACT holds, so somebody else changed it and PACT reports that rather
 * than retrying over their change with the new revision.
 */
function writeRefusal(answer, workItemId) {
  const id = workItemId;
  if (answer.status === 412) {
    return new AdoError("Work item " + id + " changed in Azure DevOps since PACT read it (it answered 412), " +
      "so nothing was written: its iteration and its comment are exactly as they were. PACT will not " +
      "write over somebody else's change with the revision it holds.", 409);
  }
  if (answer.status === 401) {
    return new AdoError("Azure DevOps rejected the token (401) when PACT tried to write work item " + id +
      ": it may be expired or revoked.", 502);
  }
  if (answer.status === 403) {
    return new AdoError("Azure DevOps refused this token the write to work item " + id + " (403). " +
      "The token needs the Work Items (write) scope; add it to the personal access token and write " +
      "back again.", 502);
  }
  if (answer.status === 404) {
    return new AdoError("Azure DevOps has no work item " + id + " (404), so there is nothing to write " +
      "back to. It may have been deleted.", 404);
  }
  return new AdoError("Azure DevOps answered " + answer.status + " for the write to work item " + id + ".", 502);
}

// The project's iterations, as the windows a date can be placed in. A project
// with iterations switched off answers without a tree, which reads as no
// windows - the refusal for a day no sprint covers, rather than a crash.
async function readIterationWindows(base, project, send, token) {
  const url = base + "/" + encodeURIComponent(project) + "/_apis/wit/classificationnodes/iterations" +
    "?$depth=" + ITERATION_DEPTH + "&api-version=" + ADO_API_VERSION;
  const body = answerBody(await send("GET", url, token), "iterations of project '" + project + "'");
  return iterationWindows(body);
}

/*
 * The conditional write, as one JSON Patch: the `test` op is the condition. The
 * `If-Match` header this API documents is silently ignored, so the revision is
 * checked by the patch itself - the item moves or the whole patch does.
 */
function writeIterationPatch(rev, iterationPath) {
  return [
    { op: "test", path: "/rev", value: rev },
    { op: "add", path: "/fields/" + ADO_FIELDS.iterationPath, value: iterationPath }
  ];
}

/*
 * The comment on the item: PACT's own one, edited in place, or a new one posted
 * only when none begins with the marker. A comment somebody else wrote is left
 * alone whether or not it mentions PACT, so the marker being the first thing in
 * the text is what makes a comment PACT's.
 *
 * It returns which of the two happened, because the caller reports both halves
 * of the write and "updated" is not "posted".
 */
async function writeAllocationComment(options) {
  const path = options.base + "/" + encodeURIComponent(options.project) + "/_apis/wit/workItems/" +
    options.id + "/comments";
  const list = await options.send("GET", path + "?api-version=" + COMMENT_API_VERSION, options.token);
  if (!carriedBody(list.status)) throw writeRefusal(list, options.id);
  const body = answerBody(list, "comments of work item " + options.id);
  const comments = Array.isArray(body.comments) ? body.comments : [];
  const mine = comments.filter(function (comment) {
    const text = comment && typeof comment.text === "string" ? comment.text : "";
    return text.trimStart().startsWith(WRITE_BACK_MARKER);
  })[0];
  const url = mine
    ? path + "/" + mine.id + "?api-version=" + COMMENT_API_VERSION
    : path + "?api-version=" + COMMENT_API_VERSION;
  const answer = await options.send(mine ? "PATCH" : "POST", url, options.token, { text: options.text });
  if (!carriedBody(answer.status)) throw writeRefusal(answer, options.id);
  answerBody(answer, "comment on work item " + options.id);
  return mine ? "edited" : "posted";
}

/*
 * Write one Assignment back: its allocation as a comment on its work item, and
 * the iteration of the sprint it starts in. Two calls, and the order between
 * them is the whole of the honesty here - the iteration patch is the one that can
 * fail on somebody else's change, so it goes first and the comment follows only
 * once it has landed. A comment can therefore never claim a state the item is
 * not in, and a comment that fails afterwards says exactly that: the iteration
 * moved and the comment did not.
 *
 * The baseline is recorded from the patch's own answer before the comment is
 * attempted, so the plan holds the revision the item is actually at, and a
 * person's confirmed dates stop being marked assumed - a write only happens once
 * they are a person's.
 *
 * Every refusal happens before the first write, and each says its own cause: an
 * Assignment that is not linked, dates still assumed, a day covered by no
 * iteration or by two, an item that moved, a token that may not write, an item
 * that is gone. Nothing is retried: a 412 is reported, never re-sent with the
 * new revision.
 */
export async function writeBack(options) {
  const plan = options.store.get();
  const mapping = plan.ado;
  if (!mapping) {
    throw new AdoError("The plan has no ADO mapping, so there is nowhere to write back to. " +
      "Give the URL and the two lists of types in the settings under Options, then press Save mapping.", 409);
  }
  const assignment = (plan.assignments || []).filter(function (record) {
    return record && record.id === options.assignmentId;
  })[0];
  if (!assignment) {
    throw new AdoError("The plan has no Assignment '" + options.assignmentId + "'.", 404);
  }
  if (assignment.archived) {
    throw new AdoError("That Assignment is archived, so it is history rather than plan: restore it first " +
      "if its work item should be written to.", 409);
  }
  const state = writeBackState(assignment.link);
  if (!state.enabled) throw new AdoError(state.title, 409);

  const link = assignment.link;
  const id = link.workItemId;
  const person = (plan.people || []).filter(function (record) { return record.id === assignment.personId; })[0];

  const token = requireToken(options.configPath, options.home, options.runtime);
  const base = trimOrganizationUrl(mapping.organizationUrl);
  const projectName = String(mapping.project || "").trim();
  const send = createSender(options.fetchImpl);

  const chosen = iterationForDate(
    await readIterationWindows(base, projectName, send, token),
    assignment.start
  );
  if (chosen.path === "") {
    throw new AdoError(iterationRefusal({ project: projectName, date: chosen.date, covers: chosen.covers }), 409);
  }

  // The conditional patch first: it is the call that can fail on somebody
  // else's change, so the comment must not go out ahead of it.
  const patchUrl = base + "/" + encodeURIComponent(projectName) + "/_apis/wit/workitems/" + id +
    "?api-version=" + ADO_API_VERSION;
  const patchAnswer = await send("PATCH", patchUrl, token, writeIterationPatch(link.rev, chosen.path),
    "application/json-patch+json");
  if (!carriedBody(patchAnswer.status)) throw writeRefusal(patchAnswer, id);
  const patched = answerBody(patchAnswer, "work item " + id);
  // A patch that sets the iteration the item already holds changes nothing, and
  // ADO answers the revision it was already at; a real change answers a higher
  // one. Either is a revision to record, and the test op above means the answer
  // can never be lower - only absent would be unrecordable.
  const rev = Number(patched && patched.rev);
  if (!Number.isInteger(rev) || rev < link.rev) {
    throw new AdoError("Azure DevOps accepted the write to work item " + id + " without answering the " +
      "revision it is at, so PACT cannot record the baseline. Read the item in Azure DevOps before " +
      "writing back again.", 502);
  }

  const baseline = normalizeLink({
    workItemId: link.workItemId,
    rev: rev,
    workItemType: link.workItemType,
    datesAssumed: false,
    values: {
      title: link.values.title,
      personEmail: link.values.personEmail,
      project: link.values.project,
      start: assignment.start,
      end: assignment.end,
      iterationPath: chosen.path
    }
  });
  // One plan write and one Undo step, and it lands before the comment is
  // attempted: the item has moved, and a comment that then failed must not leave
  // the plan claiming the old revision.
  const saved = options.store.updateAssignment(assignment.id, { link: baseline });

  const facts = {
    workItemId: id,
    workItemType: String(link.workItemType || "").trim(),
    iterationPath: chosen.path,
    rev: rev,
    comment: "posted"
  };
  const text = allocationComment({
    personName: person ? person.name : link.values.personEmail,
    share: assignment.share,
    start: assignment.start,
    end: assignment.end,
    fteDays: person ? spanFteDays(plan, person, assignment.start, assignment.end, assignment.share) : 0
  });
  try {
    facts.comment = await writeAllocationComment({
      base: base, project: projectName, id: id, text: text, send: send, token: token
    });
  } catch (err) {
    throw new AdoError("Work item " + id + "'s iteration is now " + chosen.path + ", but its comment was " +
      "not written: " + (err && err.message ? err.message : "Azure DevOps did not answer") +
      " The plan holds the new revision, so writing back again publishes the comment.", 502);
  }

  return { assignment: saved, facts: facts, line: writeBackLine(facts) };
}
