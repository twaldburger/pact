/*
 * PACT server: one local Node process, no dependencies, no build step.
 *
 * It serves public/ and keeps the plan in data/pact.json as the single source
 * of truth behind a small JSON API. Start it with `node server.mjs`; the plan
 * file is created on first run from a seeded plan (convenience data).
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore, todayISO, ValidationError, NotFoundError } from "./lib/plan.mjs";
import { visiblePlan } from "./public/lib/visibility.mjs";

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
    people: visible.people,
    projects: visible.projects,
    assignments: visible.assignments
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
        if (pathname === "/api/plan") {
          if (req.method === "GET") return sendJSON(res, 200, planForClient(store, includeArchived));
          // The extent is the owner's setting; this is the one write that sets
          // both ends together. Everything else leaves the range alone.
          if (req.method === "PATCH") {
            return readBody(req).then((body) => sendJSON(res, 200, store.setRange(body)));
          }
          return sendError(res, 405, "method not allowed");
        }
        const route = matchApi(pathname);
        if (route) return handleApi(req, res, store, route);
        if (pathname.startsWith("/api/")) return sendError(res, 404, "no such endpoint");
        return serveStatic(res, publicDir, pathname);
      })
      .catch((err) => {
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
  const dataFile = process.env.PACT_DATA || path.join(HERE, "data", "pact.json");
  const store = createStore(dataFile);
  const server = createServer(store);
  server.listen(port, () => {
    console.log("PACT serving at http://localhost:" + port + " (plan: " + dataFile + ")");
  });
  return { server: server, store: store };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
