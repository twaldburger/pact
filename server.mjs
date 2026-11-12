/*
 * PACT server: one local Node process, no dependencies, no build step.
 *
 * It serves public/ and keeps the active plan, by default in
 * data/default.pact.json, as the single source of truth behind a small JSON
 * API. The active file is chosen at start from PACT_DATA, then from
 * data/config.json, then the default; the running server can switch it through
 * the plan-file API. Start it with `node server.mjs`; the plan file is created
 * on first run from a seeded plan (convenience data).
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore, todayISO, ValidationError, NotFoundError, PlanFileError } from "./lib/plan.mjs";
import { resolvePlanFile, readView, writeView, writePlanFile } from "./lib/config.mjs";
import { resolvePlanPath, withPlanSuffix } from "./public/lib/plan-file.mjs";
import { visiblePlan } from "./public/lib/visibility.mjs";
import { normalizeStep } from "./public/lib/panels.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

const COLLECTIONS = {
  people: { create: "createPerson", update: "updatePerson", archive: "archivePerson", destroy: "destroyPerson" },
  projects: { create: "createProject", update: "updateProject", archive: "archiveProject", destroy: "destroyProject" },
  assignments: { create: "createAssignment", update: "updateAssignment", archive: "archiveAssignment", destroy: "destroyAssignment" }
};

function sendJSON(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store"
  });
  res.end(text);
}

function sendError(res, status, message) {
  sendJSON(res, status, { error: message });
}

function planForClient(store, includeArchived) {
  const plan = store.get();
  // Archived records stay in the file. By default the interface only ever sees
  // the live plan, so an archived Person or Project takes its Assignments off
  // the screen with it without anything being lost. The archive view asks for
  // them back with ?archived=1, marked as archived, so they can be restored.
  // What a given toggle state draws is the shared rule in
  // public/lib/visibility.mjs, so the server and the interface cannot drift.
  const visible = visiblePlan(plan, includeArchived);
  return {
    today: todayISO(),
    range: plan.range,
    // The step is the interface's rule; an absent one reads as the default 10.
    step: normalizeStep(plan.step),
    // The sprint cadence and its per-sprint adjustments, passed through as
    // stored. Both are absent until sprints are defined, so a plan without a
    // cadence reaches the client exactly as it always has.
    cadence: plan.cadence,
    sprints: plan.sprints,
    // The Locations and dates configured as holidays, passed through as stored.
    // Absent until holidays are configured, so a plan without them reaches the
    // client exactly as it always has.
    holidays: plan.holidays,
    people: visible.people,
    projects: visible.projects,
    assignments: visible.assignments,
    // Whether the running server's in-memory history can step either way, so
    // the two top-bar controls can state their own availability.
    canUndo: store.canUndo(),
    canRedo: store.canRedo()
  };
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1000000) throw new ValidationError("request body is too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new ValidationError("request body is not valid JSON");
  }
}

function matchApi(pathname) {
  const match = /^\/api\/(people|projects|assignments)(?:\/([^/]+))?(\/destroy)?$/.exec(pathname);
  if (!match) return null;
  return { collection: match[1], id: match[2] || null, destroy: match[3] === "/destroy" };
}

async function handleApi(req, res, store, route) {
  const ops = COLLECTIONS[route.collection];
  // Deletion is its own path, not the meaning of DELETE on the collection: the
  // bare DELETE stays the archive it has always been.
  if (route.destroy) {
    if (req.method !== "DELETE" || !route.id) return sendError(res, 405, "method not allowed");
    return sendJSON(res, 200, store[ops.destroy](route.id));
  }
  if (!route.id) {
    if (req.method !== "POST") return sendError(res, 405, "method not allowed");
    return sendJSON(res, 201, store[ops.create](await readBody(req)));
  }
  if (req.method === "PATCH") return sendJSON(res, 200, store[ops.update](route.id, await readBody(req)));
  if (req.method === "DELETE") return sendJSON(res, 200, store[ops.archive](route.id));
  return sendError(res, 405, "method not allowed");
}

function serveStatic(res, publicDir, pathname) {
  const relative = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, relative));
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    return sendError(res, 403, "forbidden");
  }
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_) {
    return sendError(res, 404, "not found");
  }
  if (stat.isDirectory()) return sendError(res, 404, "not found");
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "content-type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
    "content-length": body.length,
    "cache-control": "no-store"
  });
  res.end(body);
}

export function createServer(store, options) {
  const publicDir = (options && options.publicDir) || path.join(HERE, "public");
  const configPath = options && options.configPath;
  const home = (options && options.home) || os.homedir();
  const envLocked = !!(options && options.envLocked);
  // What the plan-file panel reads: the active file, where that choice came
  // from, whether PACT_DATA fixes it, and any one-time report such as a move.
  const state = {
    source: (options && options.source) || "default",
    notice: (options && options.notice) || ""
  };

  function planFileState() {
    return {
      path: store.planFilePath(),
      source: state.source,
      locked: envLocked,
      notice: state.notice
    };
  }

  // The config is the app's own settings store, beside the plan. Its view
  // settings and the plan path share the one file, so this write must keep the
  // view. A failed config write never fails the plan-file switch that just
  // succeeded; it is reported and the choice simply does not survive a restart.
  function persistConfig() {
    if (!configPath) return;
    try {
      writePlanFile(configPath, store.planFilePath());
    } catch (err) {
      console.error("PACT: could not write " + configPath + ": " + err.message);
    }
  }

  return http.createServer((req, res) => {
    let pathname;
    let includeArchived = false;
    try {
      const url = new URL(req.url, "http://localhost");
      pathname = decodeURIComponent(url.pathname);
      includeArchived = url.searchParams.get("archived") === "1";
    } catch (_) {
      return sendError(res, 400, "bad request");
    }
    Promise.resolve()
      .then(() => {
        // The plan-file endpoints: read the active file and switch it. Switching
        // reloads the named file, and the choice is remembered in the config so
        // it survives a restart.
        if (pathname === "/api/plan-file") {
          if (req.method === "GET") return sendJSON(res, 200, planFileState());
          return sendError(res, 405, "method not allowed");
        }
        if (pathname === "/api/plan-file/open" || pathname === "/api/plan-file/new") {
          if (req.method !== "POST") return sendError(res, 405, "method not allowed");
          // PACT_DATA is the deliberate per-run choice: the panel says so and
          // the switch is refused rather than silently ignored.
          if (envLocked) {
            return sendError(res, 409, "PACT_DATA is set, so the plan file is fixed for this run");
          }
          return readBody(req).then((body) => {
            const resolved = resolvePlanPath(body && body.path, home);
            if (resolved.error) return sendError(res, 400, resolved.error);
            // A new plan is always offered under the .pact.json suffix.
            const target = pathname === "/api/plan-file/new" ? withPlanSuffix(resolved.path) : resolved.path;
            if (pathname === "/api/plan-file/new") store.newPlan(target);
            else store.openPlan(target);
            persistConfig();
            state.source = "config";
            state.notice = "";
            return sendJSON(res, 200, planFileState());
          });
        }
        // The view settings: the app's own display state, kept in the config
        // beside the plan file. Reading falls back per key, so a malformed
        // value never breaks a view. Writing stores the sent keys over the
        // stored view - one write per change - and never touches the plan path;
        // the reply is the view as it now stands.
        if (pathname === "/api/view") {
          if (req.method === "GET") return sendJSON(res, 200, readView(configPath));
          if (req.method !== "POST") return sendError(res, 405, "method not allowed");
          if (!configPath) return sendError(res, 409, "no settings file to write");
          return readBody(req).then((body) => sendJSON(res, 200, writeView(configPath, body)));
        }
        if (pathname === "/api/plan") {
          if (req.method === "GET") return sendJSON(res, 200, planForClient(store, includeArchived));
          // The plan's settings: the period, set with both ends together, the
          // percentage step, and the sprint cadence with its adjustments. Each
          // is its own write and its own body.
          if (req.method === "PATCH") {
            return readBody(req).then((body) => {
              if (body && Object.prototype.hasOwnProperty.call(body, "step")) {
                return sendJSON(res, 200, store.setStep(body));
              }
              if (body && (Object.prototype.hasOwnProperty.call(body, "cadence") ||
                  Object.prototype.hasOwnProperty.call(body, "sprints"))) {
                return sendJSON(res, 200, store.setSprints(body));
              }
              if (body && Object.prototype.hasOwnProperty.call(body, "holidays")) {
                return sendJSON(res, 200, store.setHolidays(body));
              }
              return sendJSON(res, 200, store.setRange(body));
            });
          }
          return sendError(res, 405, "method not allowed");
        }
        // One step through the in-memory history. The client refreshes from
        // the plan as it does after any other change, so the reply is only an
        // acknowledgement.
        if (pathname === "/api/undo" || pathname === "/api/redo") {
          if (req.method !== "POST") return sendError(res, 405, "method not allowed");
          if (pathname === "/api/undo") {
            store.undo();
            return sendJSON(res, 200, { undone: true });
          }
          store.redo();
          return sendJSON(res, 200, { redone: true });
        }
        const route = matchApi(pathname);
        if (route) return handleApi(req, res, store, route);
        if (pathname.startsWith("/api/")) return sendError(res, 404, "no such endpoint");
        return serveStatic(res, publicDir, pathname);
      })
      .catch((err) => {
        if (err instanceof PlanFileError) return sendError(res, err.status || 400, err.message);
        if (err instanceof ValidationError) return sendError(res, 400, err.message);
        if (err instanceof NotFoundError) return sendError(res, 404, err.message);
        console.error(err);
        if (!res.headersSent) return sendError(res, 500, "internal error");
        res.end();
      });
  });
}

export function main() {
  const port = Number(process.env.PORT || 4173);
  const dataDir = path.join(HERE, "data");
  const configFile = path.join(dataDir, "config.json");
  // PACT_DATA wins, then the config, then the default - moving the old default
  // name to the new one when that is what sits there.
  const resolved = resolvePlanFile({
    dataDir: dataDir,
    configFile: configFile,
    env: process.env.PACT_DATA
  });
  if (resolved.notice) console.log("PACT: " + resolved.notice);
  const store = createStore(resolved.path);
  const server = createServer(store, {
    configPath: configFile,
    home: os.homedir(),
    envLocked: resolved.source === "env",
    source: resolved.source,
    notice: resolved.notice
  });
  server.listen(port, () => {
    console.log("PACT serving at http://localhost:" + port + " (plan: " + store.planFilePath() + ")");
  });
  return { server: server, store: store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
