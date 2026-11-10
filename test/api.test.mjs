import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore, fromISO, toISO, todayISO } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";

// A day offset from today, inside the seeded period whatever the run date is.
function day(n) {
  const d = fromISO(todayISO());
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

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

test("the period can be read and set over the API", async () => {
  const { base, store } = await server();
  const set = await api(base, "PATCH", "/api/plan", { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body, { start: "2026-01-01", end: "2026-12-31" });
  assert.deepEqual(store.get().range, { start: "2026-01-01", end: "2026-12-31" });

  const read = await api(base, "GET", "/api/plan");
  assert.deepEqual(read.body.range, { start: "2026-01-01", end: "2026-12-31" });

  const reversed = await api(base, "PATCH", "/api/plan", { start: "2026-12-31", end: "2026-01-01" });
  assert.equal(reversed.status, 400);
  assert.match(reversed.body.error, /must not be after/);

  const invalid = await api(base, "PATCH", "/api/plan", { start: "nope", end: "2026-01-01" });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /valid YYYY-MM-DD/);
  // The refusals left the stored period as it was.
  assert.deepEqual(store.get().range, { start: "2026-01-01", end: "2026-12-31" });
});

test("the step can be read and set over the same plan route", async () => {
  const { base, store } = await server();
  // An absent step reads as the default 10 on the plan the client loads.
  const fresh = await api(base, "GET", "/api/plan");
  assert.equal(fresh.body.step, 10);

  const set = await api(base, "PATCH", "/api/plan", { step: 5 });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body, { step: 5 });
  assert.equal(store.get().step, 5);

  const read = await api(base, "GET", "/api/plan");
  assert.equal(read.body.step, 5);

  const high = await api(base, "PATCH", "/api/plan", { step: 101 });
  assert.equal(high.status, 400);
  assert.match(high.body.error, /whole number from 1 to 100/);
  const fractional = await api(base, "PATCH", "/api/plan", { step: 2.5 });
  assert.equal(fractional.status, 400);
  // A refusal left the stored step as it was.
  assert.equal(store.get().step, 5);
});

test("the server accepts an off-step whole value over the API", async () => {
  const { base } = await server();
  const created = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 35
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.share, 35);
  const person = await api(base, "POST", "/api/people", { name: "Dana Vo", availability: 55 });
  assert.equal(person.status, 201);
  assert.equal(person.body.availability, 55);
});

test("an assignment outside the set period is refused over the API", async () => {
  const { base, store } = await server();
  const range = store.get().range;
  const refused = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: "2000-01-01", end: "2000-01-05", share: 40
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, new RegExp(range.start + " to " + range.end + " inclusive"));

  const made = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 40
  });
  assert.equal(made.status, 201);

  const moved = await api(base, "PATCH", "/api/assignments/" + made.body.id, { start: "2000-01-01" });
  assert.equal(moved.status, 400);
  assert.match(moved.body.error, /inside the plan's period/);
});

test("an assignment can be created, read back, changed and archived", async () => {
  const { base, store } = await server();
  const created = await api(base, "POST", "/api/assignments", {
    projectId: "atlas",
    personId: "anna",
    start: day(0),
    end: day(4),
    share: 40,
    tags: ["React"],
    note: ""
  });
  assert.equal(created.status, 201);
  assert.ok(created.body.id);

  let plan = (await api(base, "GET", "/api/plan")).body;
  assert.ok(plan.assignments.some((a) => a.id === created.body.id));

  const patched = await api(base, "PATCH", "/api/assignments/" + created.body.id, {
    start: day(2),
    end: day(11),
    share: 70
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.share, 70);
  assert.equal(patched.body.start, day(2));

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
    start: day(0),
    end: day(4),
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

test("an archived assignment appears with the archive view and can be restored", async () => {
  const { base, store } = await server();
  const created = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 40
  });
  assert.equal(created.status, 201);
  await api(base, "DELETE", "/api/assignments/" + created.body.id);

  const live = (await api(base, "GET", "/api/plan")).body;
  assert.equal(live.assignments.some((a) => a.id === created.body.id), false);

  const withArchived = (await api(base, "GET", "/api/plan?archived=1")).body;
  const found = withArchived.assignments.find((a) => a.id === created.body.id);
  assert.ok(found, "the archived assignment should be drawn on request");
  assert.equal(found.archived, true);

  const restored = await api(base, "PATCH", "/api/assignments/" + created.body.id, { archived: false });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.archived, false);
  const after = (await api(base, "GET", "/api/plan")).body;
  assert.ok(after.assignments.some((a) => a.id === created.body.id));
  // The record was never destroyed at any point.
  assert.ok(store.get().assignments.some((a) => a.id === created.body.id));
});

test("destroying a person removes them and every assignment, archived ones included", async () => {
  const { base, store } = await server();
  const person = await api(base, "POST", "/api/people", { name: "Dana Vo", availability: 90 });
  const one = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: person.body.id, start: day(0), end: day(4), share: 40
  });
  const two = await api(base, "POST", "/api/assignments", {
    projectId: "borealis", personId: person.body.id, start: day(30), end: day(34), share: 30
  });
  await api(base, "DELETE", "/api/assignments/" + two.body.id);

  const destroyed = await api(base, "DELETE", "/api/people/" + person.body.id + "/destroy");
  assert.equal(destroyed.status, 200);
  assert.deepEqual(destroyed.body, { deleted: person.body.id, assignments: 2 });

  // The plan the API returns no longer carries the Person or either Assignment,
  // and the live and archived views agree because the records are gone.
  const plan = (await api(base, "GET", "/api/plan?archived=1")).body;
  assert.equal(plan.people.some((p) => p.id === person.body.id), false);
  assert.equal(plan.assignments.some((a) => a.id === one.body.id), false);
  assert.equal(plan.assignments.some((a) => a.id === two.body.id), false);
  const kept = store.get();
  assert.equal(kept.people.some((p) => p.id === person.body.id), false);
  assert.equal(kept.assignments.some((a) => a.personId === person.body.id), false);
});

test("destroying a project removes its assignments and leaves other work alone", async () => {
  const { base, store } = await server();
  const project = await api(base, "POST", "/api/projects", { name: "Summit", colour: "plum" });
  const mine = await api(base, "POST", "/api/assignments", {
    projectId: project.body.id, personId: "anna", start: day(0), end: day(4), share: 40
  });
  const other = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 40
  });

  const destroyed = await api(base, "DELETE", "/api/projects/" + project.body.id + "/destroy");
  assert.equal(destroyed.status, 200);
  assert.deepEqual(destroyed.body, { deleted: project.body.id, assignments: 1 });

  const kept = store.get();
  assert.equal(kept.projects.some((p) => p.id === project.body.id), false);
  assert.equal(kept.assignments.some((a) => a.id === mine.body.id), false);
  // A different Project's Assignment is untouched, and so is its Person.
  assert.equal(kept.assignments.some((a) => a.id === other.body.id), true);
  assert.equal(kept.people.some((p) => p.id === "anna"), true);
});

test("destroying an assignment removes only that one", async () => {
  const { base, store } = await server();
  const one = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 40
  });
  const two = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(7), end: day(11), share: 60
  });

  const destroyed = await api(base, "DELETE", "/api/assignments/" + one.body.id + "/destroy");
  assert.equal(destroyed.status, 200);
  assert.deepEqual(destroyed.body, { deleted: one.body.id, assignments: 1 });

  const kept = store.get();
  assert.equal(kept.assignments.some((a) => a.id === one.body.id), false);
  assert.equal(kept.assignments.some((a) => a.id === two.body.id), true);
  assert.equal(kept.people.some((p) => p.id === "anna"), true);
  assert.equal(kept.projects.some((p) => p.id === "atlas"), true);
});

test("an archived person and project can be destroyed without being restored first", async () => {
  const { base } = await server();
  const person = await api(base, "POST", "/api/people", { name: "Erin Sol", availability: 70 });
  const project = await api(base, "POST", "/api/projects", { name: "Summit", colour: "plum" });
  await api(base, "DELETE", "/api/people/" + person.body.id);
  await api(base, "DELETE", "/api/projects/" + project.body.id);

  const gonePerson = await api(base, "DELETE", "/api/people/" + person.body.id + "/destroy");
  assert.equal(gonePerson.status, 200);
  assert.equal(gonePerson.body.deleted, person.body.id);
  const goneProject = await api(base, "DELETE", "/api/projects/" + project.body.id + "/destroy");
  assert.equal(goneProject.status, 200);
  assert.equal(goneProject.body.deleted, project.body.id);

  const withArchived = (await api(base, "GET", "/api/plan?archived=1")).body;
  assert.equal(withArchived.people.some((p) => p.id === person.body.id), false);
  assert.equal(withArchived.projects.some((p) => p.id === project.body.id), false);
});

test("invalid input is refused with a clear error and nothing is stored", async () => {
  const { base, store } = await server();
  const before = JSON.stringify(store.get());

  const badShare = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: "anna", start: day(0), end: day(4), share: 0
  });
  assert.equal(badShare.status, 400);
  assert.match(badShare.body.error, /whole number from 1 to 100/);

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

/* --- history -------------------------------------------------------------- */

test("POST /api/undo and POST /api/redo step the plan's history", async () => {
  const { base, store } = await server();
  const before = store.get();

  // A fresh server has nothing to step back over.
  const emptyUndo = await api(base, "POST", "/api/undo");
  assert.equal(emptyUndo.status, 400);
  assert.match(emptyUndo.body.error, /nothing to undo/);

  const created = await api(base, "POST", "/api/people", { name: "Dana Vo", availability: 90 });
  assert.equal(created.status, 201);
  let plan = (await api(base, "GET", "/api/plan")).body;
  assert.equal(plan.canUndo, true);
  assert.equal(plan.canRedo, false);

  const undone = await api(base, "POST", "/api/undo");
  assert.equal(undone.status, 200);
  assert.deepEqual(undone.body, { undone: true });
  plan = (await api(base, "GET", "/api/plan")).body;
  assert.equal(plan.people.some((p) => p.id === created.body.id), false);
  assert.equal(plan.canUndo, false);
  assert.equal(plan.canRedo, true);
  // The restored plan is what the store holds and what the file holds.
  assert.deepEqual(store.get(), before);

  const redone = await api(base, "POST", "/api/redo");
  assert.equal(redone.status, 200);
  assert.deepEqual(redone.body, { redone: true });
  plan = (await api(base, "GET", "/api/plan")).body;
  assert.equal(plan.people.some((p) => p.id === created.body.id), true);
  assert.equal(plan.canUndo, true);
  assert.equal(plan.canRedo, false);

  const emptyRedo = await api(base, "POST", "/api/redo");
  assert.equal(emptyRedo.status, 400);
  assert.match(emptyRedo.body.error, /nothing to redo/);
});

test("undo over the API brings back a deleted Person and their Assignments", async () => {
  const { base } = await server();
  const person = await api(base, "POST", "/api/people", { name: "Nina Roth", availability: 100 });
  const assignment = await api(base, "POST", "/api/assignments", {
    projectId: "atlas", personId: person.body.id, start: day(0), end: day(4), share: 50
  });
  assert.equal(assignment.status, 201);

  const destroyed = await api(base, "DELETE", "/api/people/" + person.body.id + "/destroy");
  assert.equal(destroyed.status, 200);
  let plan = (await api(base, "GET", "/api/plan?archived=1")).body;
  assert.equal(plan.people.some((p) => p.id === person.body.id), false);
  assert.equal(plan.assignments.some((a) => a.id === assignment.body.id), false);

  assert.equal((await api(base, "POST", "/api/undo")).status, 200);
  plan = (await api(base, "GET", "/api/plan")).body;
  assert.equal(plan.people.some((p) => p.id === person.body.id), true);
  assert.equal(plan.assignments.some((a) => a.id === assignment.body.id), true);
});

test("the history routes answer only POST", async () => {
  const { base } = await server();
  assert.equal((await api(base, "GET", "/api/undo")).status, 405);
  assert.equal((await api(base, "GET", "/api/redo")).status, 405);
});

/* --- sprints ------------------------------------------------------------- */

test("the cadence and adjustments travel over the same plan route", async () => {
  const { base, store } = await server();
  const cadence = { start: day(0), length: 14, namePrefix: "26-", nameNumber: "01" };
  const set = await api(base, "PATCH", "/api/plan", { cadence: cadence, sprints: [{ index: 2, length: 21 }] });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body.cadence, cadence);
  assert.deepEqual(set.body.sprints, [{ index: 2, length: 21 }]);

  const read = await api(base, "GET", "/api/plan");
  assert.deepEqual(read.body.cadence, cadence);
  assert.deepEqual(read.body.sprints, [{ index: 2, length: 21 }]);

  const cleared = await api(base, "PATCH", "/api/plan", { cadence: null, sprints: null });
  assert.equal(cleared.status, 200);
  const after = await api(base, "GET", "/api/plan");
  assert.equal(after.body.cadence, undefined);
  assert.equal(after.body.sprints, undefined);
  assert.equal(store.get().cadence, undefined);
});

test("a malformed cadence is refused by name over the API", async () => {
  const { base, store } = await server();
  const before = store.get();
  const refused = await api(base, "PATCH", "/api/plan", {
    cadence: { start: "not-a-date", length: 14, namePrefix: "Sprint", nameNumber: 1 },
    sprints: []
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /cadence.start/);
  const badAdjustment = await api(base, "PATCH", "/api/plan", { sprints: [{ index: 0 }] });
  assert.equal(badAdjustment.status, 400);
  assert.match(badAdjustment.body.error, /sprints\[0\]\.index/);
  assert.deepEqual(store.get(), before);
});
