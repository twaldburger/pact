import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { readConfig } from "../lib/config.mjs";
import { VIEW_DEFAULTS } from "../public/lib/view.mjs";

// One server over a temp data directory, with the plan file and its config
// where the real app keeps them - the two settings that share the one file.
function startServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pact-view-api-"));
  const planFile = path.join(dir, "default.pact.json");
  const configFile = path.join(dir, "config.json");
  const store = createStore(planFile);
  const server = createServer(store, { configPath: configFile });
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

async function server() {
  const started = await startServer();
  servers.push(started.server);
  return started;
}

test("with no stored view the API reads the app's defaults", async () => {
  const { base } = await server();
  const res = await api(base, "GET", "/api/view");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, VIEW_DEFAULTS);
});

test("a changed view is stored and read back", async () => {
  const { base, configFile } = await server();
  const sent = {
    zoom: "week",
    rowHeight: 64,
    weekends: true,
    dividers: false,
    minimap: true,
    palette: "set3",
    stackCollapsed: true,
    sort: {
      projects: { key: "fte", direction: "asc" },
      people: { key: "free", direction: "asc" }
    }
  };
  const written = await api(base, "POST", "/api/view", sent);
  assert.equal(written.status, 200);
  assert.deepEqual(written.body, sent);

  const read = await api(base, "GET", "/api/view");
  assert.deepEqual(read.body, sent);
  // It lives in the config file as JSON, so a restart reads the same view.
  assert.deepEqual(JSON.parse(fs.readFileSync(configFile, "utf8")).view, sent);
});

test("a malformed value falls back for that key alone", async () => {
  const { base } = await server();
  await api(base, "POST", "/api/view", { zoom: "week", palette: "set3", minimap: true });

  const written = await api(base, "POST", "/api/view", { zoom: "year", rowHeight: "tall" });
  assert.equal(written.status, 200);
  // The bad keys fall back; the good ones already stored are kept.
  assert.equal(written.body.zoom, "month");
  assert.equal(written.body.rowHeight, 48);
  assert.equal(written.body.palette, "set3");
  assert.equal(written.body.minimap, true);

  const read = await api(base, "GET", "/api/view");
  assert.deepEqual(read.body, written.body);
});

test("a malformed view already in the config does not break the read", async () => {
  const { base, configFile } = await server();
  fs.writeFileSync(configFile, JSON.stringify({
    planFile: "/somewhere/else.pact.json",
    view: { zoom: "year", palette: "set3", weekends: 1 }
  }));
  const read = await api(base, "GET", "/api/view");
  assert.equal(read.status, 200);
  assert.equal(read.body.zoom, "month");
  assert.equal(read.body.weekends, false);
  assert.equal(read.body.palette, "set3");
});

test("Reset view restores every default and leaves the plan path alone", async () => {
  const { base, configFile } = await server();
  // A config that already names a plan file, the way #40 left it.
  const planPath = "/home/tim/plans/work.pact.json";
  fs.writeFileSync(configFile, JSON.stringify({ planFile: planPath }));
  await api(base, "POST", "/api/view", {
    zoom: "day",
    rowHeight: 120,
    weekends: true,
    dividers: false,
    minimap: true,
    palette: "set3",
    stackCollapsed: true,
    sort: { projects: { key: "name", direction: "desc" }, people: { key: "name", direction: "desc" } }
  });

  // The Reset view action: the whole default view in one write.
  const reset = await api(base, "POST", "/api/view", VIEW_DEFAULTS);
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.body, VIEW_DEFAULTS);
  assert.deepEqual((await api(base, "GET", "/api/view")).body, VIEW_DEFAULTS);
  // The plan path is a different setting and is left exactly as it was.
  assert.equal(readConfig(configFile).config.planFile, planPath);
});

test("switching the plan file keeps the view, and a view write keeps the path", async () => {
  const { base, dir, configFile } = await server();
  const other = path.join(dir, "other.pact.json");
  createStore(other).setRange({ start: "2030-01-01", end: "2030-12-31" });

  await api(base, "POST", "/api/view", { zoom: "sprint", palette: "set3" });
  await api(base, "POST", "/api/plan-file/open", { path: other });
  // Opening the file rewrote the config; the view survived it.
  assert.equal((await api(base, "GET", "/api/view")).body.zoom, "sprint");
  assert.equal(readConfig(configFile).config.planFile, other);
  assert.equal(readConfig(configFile).config.view.palette, "set3");

  // And a later view write leaves the path exactly where the switch put it.
  await api(base, "POST", "/api/view", { minimap: true });
  assert.equal(readConfig(configFile).config.planFile, other);
  assert.equal(readConfig(configFile).config.view.minimap, true);
});

test("the view route refuses anything but GET and POST", async () => {
  const { base } = await server();
  const deleted = await api(base, "DELETE", "/api/view");
  assert.equal(deleted.status, 405);
});
