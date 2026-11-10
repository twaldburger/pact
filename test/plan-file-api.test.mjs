import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { readConfig } from "../lib/config.mjs";

// One server over a temp data directory, with the plan file and its config
// where the real app keeps them.
function startServer(serverOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-pf-api-"));
  const planFile = path.join(dir, "default.pact.json");
  const configFile = path.join(dir, "config.json");
  const store = createStore(planFile);
  const options = Object.assign({ configPath: configFile }, serverOptions || {});
  const server = createServer(store, options);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        dir: dir,
        planFile: planFile,
        configFile: configFile,
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

async function server(options) {
  const started = await startServer(options);
  servers.push(started.server);
  return started;
}

test("the active plan file can be read back over the API", async () => {
  const { base, planFile } = await server();
  const res = await api(base, "GET", "/api/plan-file");
  assert.equal(res.status, 200);
  assert.equal(res.body.path, planFile);
  assert.equal(res.body.locked, false);
  assert.equal(res.body.source, "default");
});

test("opening an existing file reloads the plan, and the choice is remembered", async () => {
  const { base, dir, configFile, store } = await server();
  const other = path.join(dir, "other.pact.json");
  const otherStore = createStore(other);
  otherStore.setRange({ start: "2030-01-01", end: "2030-12-31" });

  const opened = await api(base, "POST", "/api/plan-file/open", { path: other });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.path, other);
  // The running plan is the file that was asked for.
  const plan = await api(base, "GET", "/api/plan");
  assert.deepEqual(plan.body.range, { start: "2030-01-01", end: "2030-12-31" });
  assert.equal(store.planFilePath(), other);
  // The config now names it, so a restart would choose it again.
  assert.deepEqual(readConfig(configFile).config, { planFile: other });
});

test("a missing file is refused and not created, and the plan stays loaded", async () => {
  const { base, dir, planFile, store } = await server();
  const before = store.get();
  const missing = path.join(dir, "not-there.pact.json");

  const refused = await api(base, "POST", "/api/plan-file/open", { path: missing });
  assert.equal(refused.status, 404);
  assert.match(refused.body.error, /no plan file at/);
  assert.equal(fs.existsSync(missing), false);
  assert.deepEqual(store.get(), before);
  assert.equal(store.planFilePath(), planFile);
});

test("a relative path is refused with a plain reason", async () => {
  const { base } = await server();
  const refused = await api(base, "POST", "/api/plan-file/open", { path: "plans/x.pact.json" });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error, /absolute path/);
});

test("a new plan is created empty, under the .pact.json suffix", async () => {
  const { base, dir } = await server();
  const typed = path.join(dir, "fresh");
  const created = await api(base, "POST", "/api/plan-file/new", { path: typed });
  assert.equal(created.status, 200);
  assert.equal(created.body.path, typed + ".pact.json");
  assert.equal(fs.existsSync(typed + ".pact.json"), true);

  const plan = await api(base, "GET", "/api/plan");
  assert.deepEqual(plan.body.people, []);
  assert.deepEqual(plan.body.projects, []);
  assert.deepEqual(plan.body.assignments, []);
});

test("creating over an existing file is refused and leaves it alone", async () => {
  const { base, planFile } = await server();
  const refused = await api(base, "POST", "/api/plan-file/new", { path: planFile });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /already exists/);
  // The default plan is still the one loaded, whole.
  const plan = await api(base, "GET", "/api/plan");
  assert.equal(plan.body.people.length, 3);
});

test("PACT_DATA fixes the plan file and the API says so", async () => {
  const { base } = await server({ envLocked: true, source: "env" });
  const state = await api(base, "GET", "/api/plan-file");
  assert.equal(state.body.locked, true);
  assert.equal(state.body.source, "env");

  const refused = await api(base, "POST", "/api/plan-file/open", { path: "/tmp/whatever.pact.json" });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /PACT_DATA/);
});

test("a plan file changed underneath refuses the next write over the API", async () => {
  const { base, planFile, store } = await server();
  // Something else rewrites the file between PACT's read and its write.
  fs.writeFileSync(planFile, JSON.stringify({
    range: store.get().range, people: [], projects: [], assignments: []
  }, null, 2) + "\n");

  const refused = await api(base, "POST", "/api/people", { name: "Dana Vo", availability: 90 });
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /changed on disk/);
  // The running plan is untouched and the file still holds what the other
  // writer put there.
  assert.equal(store.get().people.length, 3);
  assert.equal(JSON.parse(fs.readFileSync(planFile, "utf8")).people.length, 0);
});
