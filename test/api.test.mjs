import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";

function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-api-"));
  const store = createStore(path.join(dir, "pact.json"));
  const server = createServer(store);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: "http://127.0.0.1:" + server.address().port,
        server: server,
        store: store
      });
    });
  });
}

function api(base, method, urlPath, body) {
  const options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  return fetch(base + urlPath, options).then(async (res) => {
    let payload = null;
    try {
      payload = await res.json();
    } catch (_) {
      payload = null;
    }
    return { status: res.status, body: payload };
  });
}

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((done) => s.close(done)))));

async function server() {
  const started = await startServer();
  servers.push(started.server);
  return started;
}

test("GET /api/plan returns the whole plan", async () => {
  const { base } = await server();
  const res = await api(base, "GET", "/api/plan");
  assert.equal(res.status, 200);
  assert.equal(res.body.people.length, 3);
  assert.equal(res.body.projects.length, 4);
  assert.ok(Array.isArray(res.body.assignments));
  assert.match(res.body.today, /^\d{4}-\d{2}-\d{2}$/);
});

test("an assignment can be created, read back, changed and archived", async () => {
  const { base, store } = await server();
  const created = await api(base, "POST", "/api/assignments", {
    projectId: "atlas",
    personId: "anna",
    start: "2026-05-04",
    end: "2026-05-08",
    share: 40,
    tags: ["React"],
    note: ""
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.id);

  let plan = (await api(base, "GET", "/api/plan")).body;
  assert.ok(plan.assignments.some((a) => a.id === created.body.id));

  const patched = await api(base, "PATCH", "/api/assignments/" + created.body.id, {
    start: "2026-05-06",
    end: "2026-05-15",
    share: 70
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.share, 70);
  assert.equal(patched.body.start, "2026-05-06");

  const archived = await api(base, "DELETE", "/api/assignments/" + created.body.id);
  assert.equal(archived.status, 200);
  assert.deepEqual(archived.body, { archived: created.body.id });
  plan = (await api(base, "GET", "/api/plan")).body;
  assert.equal(plan.assignments.some((a) => a.id === created.body.id), false);
  // The record stays in the file, marked archived.
  assert.equal(store.get().assignments.find((a) => a.id === created.body.id).archived, true);
});

test("people and projects can be created, changed and archived without losing assignments", async () => {
  const { base, store } = await server();
  const person = await api(base, "POST", "/api/people", { name: "Dana Vo", availability: 90 });
  assert.equal(person.status, 201);
  const project = await api(base, "POST", "/api/projects", { name: "Summit", colour: "plum" });
  assert.equal(project.status, 201);

  const assignment = await api(base, "POST", "/api/assignments", {
    projectId: project.body.id,
    personId: person.body.id,
    start: "2026-05-04",
    end: "2026-05-08",
    share: 40
  });
  assert.equal(assignment.status, 201);

  const personPatch = await api(base, "PATCH", "/api/people/" + person.body.id, { availability: 60 });
  assert.equal(personPatch.body.availability, 60);
  const projectPatch = await api(base, "PATCH", "/api/projects/" + project.body.id, { name: "Summit Two" });
  assert.equal(projectPatch.body.name, "Summit Two");

  const archivedPerson = await api(base, "DELETE", "/api/people/" + person.body.id);
  assert.equal(archivedPerson.status, 200);
  assert.deepEqual(archivedPerson.body, { archived: person.body.id });
  const archivedProject = await api(base, "DELETE", "/api/projects/" + project.body.id);
  assert.equal(archivedProject.status, 200);
  assert.deepEqual(archivedProject.body, { archived: project.body.id });

  // The interface never draws an archived Person or Project, nor their work.
  const plan = (await api(base, "GET", "/api/plan")).body;
  assert.equal(plan.people.some((p) => p.id === person.body.id), false);
  assert.equal(plan.projects.some((p) => p.id === project.body.id), false);
  assert.equal(plan.assignments.some((a) => a.id === assignment.body.id), false);

  // Everything is still in the file and can be restored later.
  const kept = store.get();
  assert.equal(kept.people.find((p) => p.id === person.body.id).archived, true);
  assert.equal(kept.projects.find((p) => p.id === project.body.id).archived, true);
  assert.equal(kept.assignments.some((a) => a.id === assignment.body.id), true);
});

test("archived records appear only on request and can be restored", async () => {
  const { base } = await server();
  const person = await api(base, "POST", "/api/people", { name: "Erin Sol", availability: 70 });
  assert.equal(person.status, 201);
  await api(base, "DELETE", "/api/people/" + person.body.id);

  const live = (await api(base, "GET", "/api/plan")).body;
  assert.equal(live.people.some((p) => p.id === person.body.id), false);

  const withArchived = (await api(base, "GET", "/api/plan?archived=1")).body;
  const found = withArchived.people.find((p) => p.id === person.body.id);
  assert.ok(found);
  assert.equal(found.archived, true);

  const restored = await api(base, "PATCH", "/api/people/" + person.body.id, { archived: false });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.archived, false);
  const after = (await api(base, "GET", "/api/plan")).body;
  assert.ok(after.people.some((p) => p.id === person.body.id));

  const bad = await api(base, "PATCH", "/api/people/" + person.body.id, { archived: "yes" });
  assert.equal(bad.status, 400);
});

test("invalid input is refused with a clear error and nothing is stored", async () => {
  const { base, store } = await server();
  const before = JSON.stringify(store.get());

  const badShare = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: "2026-05-04", end: "2026-05-08", share: 35
  });
  assert.equal(badShare.status, 400);
  assert.match(badShare.body.error, /steps of 10/);

  const badPerson = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "ghost", start: "2026-05-04", end: "2026-05-08", share: 40
  });
  assert.equal(badPerson.status, 400);
  assert.match(badPerson.body.error, /personId/);

  const badBody = await fetch(base + "/api/assignments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{ broken"
  });
  assert.equal(badBody.status, 400);

  const unknown = await api(base, "POST", "/api/people", { name: "Typo", availability: 100, role: "dev" });
  assert.equal(unknown.status, 400);

  assert.equal(JSON.stringify(store.get()), before);
});

test("missing records are a 404", async () => {
  const { base } = await server();
  const res = await api(base, "PATCH", "/api/assignments/not-there", { share: 20 });
  assert.equal(res.status, 404);
});

test("the front end is served and path traversal is refused", async () => {
  const { base } = await server();
  const page = await fetch(base + "/");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /PACT/);

  const traversed = await fetch(base + "/..%2f..%2fserver.mjs");
  assert.equal(traversed.status, 403);
});

test("an unknown API path is a 404 and a wrong method is a 405", async () => {
  const { base } = await server();
  assert.equal((await api(base, "GET", "/api/nope")).status, 404);
  assert.equal((await api(base, "GET", "/api/people")).status, 405);
});
