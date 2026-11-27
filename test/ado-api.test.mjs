/*
 * The Azure DevOps connection as the server answers it: the state the panel
 * reads, the token written and cleared, Test connection, and the mapping
 * written as a plan write.
 *
 * Every case runs a real server over a scratch plan, with Azure DevOps stubbed:
 * the suite never calls the owner's instance, and the token here is a made-up
 * string. The one property this file exists to hold is that the token never
 * leaves the server - no response body, no response header, no log line - which
 * is asserted against the actual handlers, refusal paths included.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStore } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { ADO_PLACEHOLDER } from "../public/lib/ado.mjs";
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("ado-api");
const TOKEN = "pact-test-token-0123456789abcdefghijKL";
const TOKEN_PARTS = [TOKEN, TOKEN.slice(0, 16), TOKEN.slice(16), Buffer.from(":" + TOKEN, "utf8").toString("base64")];

const MAPPING = {
  organizationUrl: "https://dev.azure.com/example",
  project: "PACT",
  projectLevels: ["Initiative", "Epic"],
  assignmentLevels: ["Feature", "User Story"]
};

const BACKLOGS = {
  count: 5,
  value: [
    { id: "Microsoft.TaskCategory", name: "Tasks", rank: 1, workItemTypes: [{ name: "Task" }, { name: "Bug" }] },
    { id: "Microsoft.RequirementCategory", name: "Stories", rank: 2, workItemTypes: [{ name: "User Story" }] },
    { id: "Microsoft.FeatureCategory", name: "Features", rank: 3, workItemTypes: [{ name: "Feature" }] },
    { id: "Microsoft.EpicCategory", name: "Epics", rank: 4, workItemTypes: [{ name: "Epic" }] },
    { id: "Microsoft.PortfolioEpicCategory", name: "Initiatives", rank: 5, workItemTypes: [{ name: "Initiative" }] }
  ]
};

const TYPES = {
  count: 7,
  value: [{ name: "Bug" }, { name: "Epic" }, { name: "Feature" }, { name: "Initiative" }, { name: "Task" }, { name: "User Story" }, { name: "Test Case" }]
};

// The sign-in page Azure DevOps redirects an unaccepted request to: a 2xx whose
// body is HTML, not the project.
const SIGN_IN_HTML = "<html><head><title>Sign in to your account</title></head>" +
  "<body><form action=\"/_signin\">Sign in</form></body></html>";

// Azure DevOps, stubbed: the four reads this slice makes, and the ways a real
// instance can say no - an unreachable host, a refused token, a redirect to its
// sign-in page, an answer carrying no body, and a 2xx that is not 200.
// `calls` records what the server sent, so the test can see the credential
// travel in a header and never in a URL.
function adoStub(mode) {
  const calls = [];
  const reply = (status, body, headers) => {
    const sent = headers || {};
    return {
      status: status,
      headers: { get: (name) => sent[String(name).toLowerCase()] || null },
      text: async () => (body === undefined || body === null ? "" : typeof body === "string" ? body : JSON.stringify(body))
    };
  };
  const route = (url, status) => {
    const pathname = new URL(url).pathname.replace(/^\/example/, "");
    if (pathname === "/_apis/projects/PACT") return reply(status, { id: "proj-1", name: "PACT" });
    if (pathname === "/_apis/projects/proj-1/teams") {
      return reply(status, { count: 1, value: [{ id: "team-1", name: "PACT Team" }] });
    }
    if (pathname === "/PACT/PACT%20Team/_apis/work/backlogs") return reply(status, BACKLOGS);
    if (pathname === "/PACT/_apis/wit/workitemtypes") return reply(status, TYPES);
    return reply(404, {});
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url: url, init: init || {} });
    if (mode === "unreachable") throw new TypeError("fetch failed");
    // The sign-in page the redirect lands on: a 2xx full of HTML.
    if (mode === "signin") return reply(203, SIGN_IN_HTML, { "content-type": "text/html; charset=utf-8" });
    // The redirect itself, seen with a fetch that does not follow it.
    if (mode === "redirect") return reply(302, "", { location: "https://login.microsoftonline.com/_signin?x=1" });
    if (mode === "empty") return reply(204, null, { "content-type": "application/json" });
    // A named or numeric status: a 2xx answers with the four bodies, anything
    // else refuses at the first call.
    const status = /^\d{3}$/.test(mode || "") ? Number(mode) : 200;
    if (status < 200 || status >= 300) return reply(status, {});
    return route(url, status);
  };
  return { fetchImpl: fetchImpl, calls: calls };
}

const servers = [];
after(() => Promise.all(servers.map((server) => new Promise((done) => server.close(done)))));

async function start(mode) {
  const dir = tempDir();
  const store = createStore(path.join(dir, "plan.json"));
  const stub = adoStub(mode);
  const server = createServer(store, {
    configPath: path.join(dir, "config.json"),
    home: dir,
    platform: "linux",
    env: {},
    fetchImpl: stub.fetchImpl
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return {
    base: "http://127.0.0.1:" + server.address().port,
    dir: dir,
    store: store,
    stub: stub,
    planFile: path.join(dir, "plan.json")
  };
}

// One request, with everything a reader of the response could see: the status,
// the body as text, and the headers.
async function call(base, method, urlPath, body) {
  const options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(base + urlPath, options);
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = null;
  }
  return {
    status: res.status,
    text: text,
    json: parsed,
    headers: Array.from(res.headers, ([name, value]) => name + ": " + value).join("\n")
  };
}

// Nothing the browser can see may hold the token, in whole or in pieces.
function assertNoToken(res, where) {
  TOKEN_PARTS.forEach((part) => {
    assert.equal(res.text.includes(part), false, where + ": the body carries the token");
    assert.equal(res.headers.includes(part), false, where + ": a header carries the token");
  });
}

// The server's console, held for the duration of one case: a log line is a
// place a secret must not be, and it is not a response, so it is checked apart.
async function withConsole(run) {
  const written = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => written.push(args.map(String).join(" "));
  console.log = (...args) => written.push(args.map(String).join(" "));
  let result;
  try {
    result = await run();
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  TOKEN_PARTS.forEach((part) => {
    assert.equal(written.join("\n").includes(part), false, "a log line carries the token");
  });
  return result;
}

function tokenPath(dir) {
  return path.join(dir, ".config", "pact", "ado-pat");
}

/* --- the state the panel reads ------------------------------------------- */

test("with nothing configured the connection reads as no mapping and no token", async () => {
  const app = await start();
  const res = await call(app.base, "GET", "/api/ado");
  assert.equal(res.status, 200);
  assert.equal(res.json.mapping, null);
  assert.equal(res.json.token.present, false);
  assert.equal(res.json.token.path, tokenPath(app.dir));
  assert.equal(res.json.token.overridden, false);
  assertNoToken(res, "GET /api/ado");
});

test("a placeholder in the token file reads as no token, not as a bad one", async () => {
  const app = await start();
  fs.mkdirSync(path.dirname(tokenPath(app.dir)), { recursive: true });
  fs.writeFileSync(tokenPath(app.dir), ADO_PLACEHOLDER + "\n");

  const state = await call(app.base, "GET", "/api/ado");
  assert.equal(state.json.token.present, false);
  assert.equal(state.json.token.placeholder, true);

  const test = await call(app.base, "POST", "/api/ado/test", { organizationUrl: MAPPING.organizationUrl, project: "PACT" });
  assert.equal(test.status, 409);
  assert.match(test.json.error, /No token is set/);
  assert.match(test.json.error, /ado-pat/);
  assertNoToken(test, "test with a placeholder");
});

/* --- the token ----------------------------------------------------------- */

test("the panel's token is written with mode 600, and never comes back", async () => {
  const app = await start();
  const saved = await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.token.present, true);
  assert.equal(saved.json.token.path, tokenPath(app.dir));
  assertNoToken(saved, "POST /api/ado/token");

  // Written where the panel said, readable only by its owner, and the plan the
  // app holds carries no trace of it.
  assert.equal(fs.readFileSync(tokenPath(app.dir), "utf8").trim(), TOKEN);
  assert.equal(fs.statSync(tokenPath(app.dir)).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(app.planFile, "utf8").includes(TOKEN), false);

  // A read back of the state is "set", and says nothing more.
  const state = await call(app.base, "GET", "/api/ado");
  assert.equal(state.json.token.present, true);
  assertNoToken(state, "GET /api/ado after a token write");
});

test("a placeholder, an empty token or one with spaces is refused and nothing is written", async () => {
  const app = await start();
  for (const value of ["", "   ", ADO_PLACEHOLDER, "two words"]) {
    const refused = await call(app.base, "POST", "/api/ado/token", { token: value });
    assert.equal(refused.status, 400, JSON.stringify(value) + " was accepted");
    assertNoToken(refused, "refused token " + JSON.stringify(value));
  }
  assert.equal(fs.existsSync(tokenPath(app.dir)), false);
});

test("clearing the token deletes the file and the state says not set again", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const cleared = await call(app.base, "DELETE", "/api/ado/token");
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.token.present, false);
  assert.equal(fs.existsSync(tokenPath(app.dir)), false);
  assertNoToken(cleared, "DELETE /api/ado/token");
});

test("a path in the app's config decides where the token is written", async () => {
  const app = await start();
  const elsewhere = path.join(app.dir, "secrets", "pat");
  fs.writeFileSync(path.join(app.dir, "config.json"), JSON.stringify({ ado: { tokenFile: elsewhere } }));
  const saved = await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.token.path, elsewhere);
  assert.equal(saved.json.token.overridden, true);
  assert.equal(fs.readFileSync(elsewhere, "utf8").trim(), TOKEN);
  assert.equal(fs.existsSync(tokenPath(app.dir)), false);
});

/* --- test connection ----------------------------------------------------- */

test("test connection reports the project, the types and their ranks from the instance", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });

  const res = await withConsole(async () => {
    const answer = await call(app.base, "POST", "/api/ado/test", {
      organizationUrl: MAPPING.organizationUrl,
      project: "PACT"
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.json.project.name, "PACT");
    assert.equal(answer.json.team, "PACT Team");
    assert.deepEqual(answer.json.types, [
      { name: "Initiative", rank: 5 },
      { name: "Epic", rank: 4 },
      { name: "Feature", rank: 3 },
      { name: "User Story", rank: 2 },
      { name: "Bug", rank: 1 },
      { name: "Task", rank: 1 }
    ]);
    assert.ok(answer.json.reported.includes("Test Case"));
    assertNoToken(answer, "POST /api/ado/test");
    return answer;
  });

  // The credential travelled in an Authorization header, never in a URL.
  assert.equal(app.stub.calls.length, 4);
  app.stub.calls.forEach((sent) => {
    assert.equal(sent.url.includes(TOKEN), false, "the token was put in a URL");
    assert.equal(
      sent.init.headers.authorization,
      "Basic " + Buffer.from(":" + TOKEN, "utf8").toString("base64")
    );
  });
  assert.ok(res.json);
});

test("a 203 whose body is JSON is the instance answering, and the connection is connected", async () => {
  // A proxy between this machine and ADO can rewrite a response and answer 203
  // Non-Authoritative Information. It carried the project, so it is a success.
  const app = await start("203");
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const res = await withConsole(() => call(app.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  }));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.project.name, "PACT");
  assert.equal(res.json.team, "PACT Team");
  assert.deepEqual(res.json.types.map((type) => type.name), ["Initiative", "Epic", "Feature", "User Story", "Bug", "Task"]);
  // The status travels for the panel's title; it is not the line's words.
  assert.equal(res.json.status, 203);
  assertNoToken(res, "POST /api/ado/test on a 203");
});

test("a 2xx that is the sign-in page is a token refusal, never a connection", async () => {
  // The request ADO did not accept is redirected to its sign-in page, which
  // answers 203 with an HTML login form. Reading that as the project would
  // report a connection over a form.
  const app = await start("signin");
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const res = await withConsole(() => call(app.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  }));
  assert.equal(res.status, 502);
  assert.match(res.json.error, /did not accept the token/);
  assert.match(res.json.error, /sign-in page/);
  // Both causes and both scopes: the owner's failing token had Work Items but
  // no Project and Team, so blaming the token alone would miss the actual fix.
  assert.match(res.json.error, /wrong for this organisation, expired or revoked, or missing a scope/);
  assert.match(res.json.error, /Work Items \(read\)/);
  assert.match(res.json.error, /Project and Team \(read\)/);
  assert.doesNotMatch(res.json.error, /answered 203/);
  assert.doesNotMatch(res.text, /PACT Team/);
  assertNoToken(res, "a sign-in page");
});

test("a redirect toward the sign-in page is the same refusal, not a status report", async () => {
  const app = await start("redirect");
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const res = await withConsole(() => call(app.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  }));
  assert.equal(res.status, 502);
  assert.match(res.json.error, /did not accept the token/);
  assert.match(res.json.error, /sign-in page/);
  assert.doesNotMatch(res.json.error, /answered 302/);
  assertNoToken(res, "a redirect to the sign-in page");
});

test("a 204 reads as an answer with no content, not as a connection", async () => {
  const app = await start("empty");
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const res = await withConsole(() => call(app.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  }));
  assert.equal(res.status, 502);
  assert.match(res.json.error, /answered 204 for the project 'PACT' .* with no content/);
  assertNoToken(res, "a 204");
});

// Everything that is not 2xx keeps the sentence it had, 401 included - the one
// above covers that one, and these are the rest.
[
  [403, 502, /refused this token the project 'PACT' at https:\/\/dev.azure.com\/example \(403\).*Work Items \(read\) scope/],
  [404, 404, /has no project 'PACT' at https:\/\/dev.azure.com\/example \(404\)/],
  [500, 502, /answered 500 for the project 'PACT' at https:\/\/dev.azure.com\/example/]
].forEach(([status, expected, pattern]) => {
  test("a " + status + " keeps its own sentence", async () => {
    const app = await start(String(status));
    await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
    const res = await withConsole(() => call(app.base, "POST", "/api/ado/test", {
      organizationUrl: MAPPING.organizationUrl,
      project: "PACT"
    }));
    assert.equal(res.status, expected, res.text);
    assert.match(res.json.error, pattern);
    assertNoToken(res, "a " + status);
  });
});

test("an unreachable instance and a rejected token are sentences, with the token in neither", async () => {
  const unreachable = await start("unreachable");
  await call(unreachable.base, "POST", "/api/ado/token", { token: TOKEN });
  const noAnswer = await withConsole(() => call(unreachable.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  }));
  assert.equal(noAnswer.status, 502);
  assert.match(noAnswer.json.error, /could not reach Azure DevOps/);
  assertNoToken(noAnswer, "unreachable instance");

  const rejected = await start("401");
  await call(rejected.base, "POST", "/api/ado/token", { token: TOKEN });
  const refused = await withConsole(() => call(rejected.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  }));
  assert.equal(refused.status, 502);
  assert.match(refused.json.error, /rejected the token \(401\)/);
  assertNoToken(refused, "rejected token");
});

test("testing without a token says where the file goes rather than failing at ADO", async () => {
  const app = await start();
  const res = await call(app.base, "POST", "/api/ado/test", {
    organizationUrl: MAPPING.organizationUrl,
    project: "PACT"
  });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /No token is set/);
  assert.ok(res.json.error.includes(tokenPath(app.dir)));
  assert.equal(app.stub.calls.length, 0);
});

/* --- the mapping, as a plan write ---------------------------------------- */

test("a valid mapping is written into the plan, and Undo takes it back", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });

  const saved = await withConsole(() => call(app.base, "POST", "/api/ado/mapping", MAPPING));
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.mapping, MAPPING);
  assertNoToken(saved, "POST /api/ado/mapping");

  // It is plan data: the store holds it, the file on disk holds it, and a
  // reload reads it back - without any trace of the token.
  assert.deepEqual(app.store.get().ado, MAPPING);
  assert.equal(app.store.canUndo(), true);
  const onDisk = fs.readFileSync(app.planFile, "utf8");
  assert.ok(onDisk.includes('"projectLevels": ['));
  assert.ok(onDisk.includes('"assignmentLevels": ['));
  TOKEN_PARTS.forEach((part) => assert.equal(onDisk.includes(part), false));

  const state = await call(app.base, "GET", "/api/ado");
  assert.deepEqual(state.json.mapping, MAPPING);
  assert.equal(state.json.token.present, true);

  // One write is one undo step, and the mapping goes with it.
  const undone = await call(app.base, "POST", "/api/undo");
  assert.equal(undone.status, 200);
  assert.equal(app.store.get().ado, undefined);
  assert.equal((await call(app.base, "GET", "/api/ado")).json.mapping, null);
  await call(app.base, "POST", "/api/redo");
  assert.deepEqual(app.store.get().ado, MAPPING);
});

test("a mapping with one type in each list is stored as exactly that", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const single = { organizationUrl: MAPPING.organizationUrl, project: "PACT", projectLevels: ["Epic"], assignmentLevels: ["Feature"] };
  const saved = await call(app.base, "POST", "/api/ado/mapping", single);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.mapping, single);
});

test("an empty list is refused with the sentence saying what the list is for", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });

  const noProjects = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, { projectLevels: [] }));
  assert.equal(noProjects.status, 400);
  assert.match(noProjects.json.error, /projectLevels must name at least one work-item type/);
  assert.match(noProjects.json.error, /become PACT Projects/);

  const noAssignments = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, { assignmentLevels: [] }));
  assert.equal(noAssignments.status, 400);
  assert.match(noAssignments.json.error, /assignmentLevels must name at least one work-item type/);
  assert.match(noAssignments.json.error, /become PACT Assignments/);

  assert.equal(app.store.get().ado, undefined);
  assert.equal(app.store.canUndo(), false);
});

test("an equal or inverted pair is refused, and the message names both ranks", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });

  const equal = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, {
    projectLevels: ["Feature"],
    assignmentLevels: ["Feature"]
  }));
  assert.equal(equal.status, 400);
  assert.match(equal.json.error, /project type 'Feature' \(rank 3\)/);
  assert.equal((equal.json.error.match(/rank 3/g) || []).length, 2);
  assertNoToken(equal, "equal ranks");

  const inverted = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, {
    projectLevels: ["Feature"],
    assignmentLevels: ["Epic"]
  }));
  assert.equal(inverted.status, 400);
  assert.match(inverted.json.error, /'Feature' \(rank 3\)/);
  assert.match(inverted.json.error, /'Epic' \(rank 4\)/);

  // One list is only as good as its worst pair: a User Story on the project
  // side sits below the Feature on the assignment side.
  const overlapping = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, {
    projectLevels: ["Epic", "User Story"],
    assignmentLevels: ["Feature", "User Story"]
  }));
  assert.equal(overlapping.status, 400);
  assert.match(overlapping.json.error, /project type 'User Story' \(rank 2\)/);
  assert.match(overlapping.json.error, /assignment type 'Feature' \(rank 3\)/);

  // A refused mapping writes nothing, and records no undo step.
  assert.equal(app.store.get().ado, undefined);
  assert.equal(app.store.canUndo(), false);
});

test("a tag level is no longer part of the mapping: it is accepted and not stored", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const saved = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, { tagLevel: "Imaginary" }));
  assert.equal(saved.status, 200, saved.text);
  assert.equal("tagLevel" in saved.json.mapping, false);
  assert.equal("tagLevel" in app.store.get().ado, false);
});

test("a credential-shaped key inside the mapping is refused, and never reaches the file", async () => {
  const app = await start();
  await call(app.base, "POST", "/api/ado/token", { token: TOKEN });
  const refused = await call(app.base, "POST", "/api/ado/mapping", Object.assign({}, MAPPING, { token: TOKEN }));
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /must never carry a credential/);
  assertNoToken(refused, "credential key in the mapping");
  assert.equal(app.store.get().ado, undefined);
  assert.equal(fs.readFileSync(app.planFile, "utf8").includes(TOKEN), false);
});

test("a mapping cannot be saved without a token or past a rejected one", async () => {
  const app = await start();
  const noToken = await call(app.base, "POST", "/api/ado/mapping", MAPPING);
  assert.equal(noToken.status, 409);
  assert.match(noToken.json.error, /No token is set/);
  assert.equal(app.store.get().ado, undefined);

  const rejected = await start("401");
  await call(rejected.base, "POST", "/api/ado/token", { token: TOKEN });
  const refused = await withConsole(() => call(rejected.base, "POST", "/api/ado/mapping", MAPPING));
  assert.equal(refused.status, 502);
  assert.match(refused.json.error, /rejected the token \(401\)/);
  assert.equal(rejected.store.get().ado, undefined);
  assertNoToken(refused, "mapping past a rejected token");
});

/* --- the whole surface --------------------------------------------------- */

test("no response the server sends carries the token, refusal paths included", async () => {
  const app = await start();
  const seen = [];
  const record = async (label, method, urlPath, body) => {
    const res = await call(app.base, method, urlPath, body);
    seen.push([label, res]);
    assertNoToken(res, label);
    return res;
  };

  await withConsole(async () => {
    await record("state before", "GET", "/api/ado");
    await record("token write", "POST", "/api/ado/token", { token: TOKEN });
    await record("state after", "GET", "/api/ado");
    await record("test", "POST", "/api/ado/test", { organizationUrl: MAPPING.organizationUrl, project: "PACT" });
    await record("mapping", "POST", "/api/ado/mapping", MAPPING);
    await record("mapping refused", "POST", "/api/ado/mapping", Object.assign({}, MAPPING, { assignmentLevel: "Epic" }));
    await record("bad address", "POST", "/api/ado/test", { organizationUrl: "not a url", project: "PACT" });
    await record("no project", "POST", "/api/ado/test", { organizationUrl: MAPPING.organizationUrl, project: "" });
    await record("bad body", "POST", "/api/ado/mapping", { organizationUrl: MAPPING.organizationUrl });
    await record("unknown route", "POST", "/api/ado/nothing", {});
    await record("plan", "GET", "/api/plan");
    await record("view", "GET", "/api/view");
    await record("plan file", "GET", "/api/plan-file");
    await record("help", "GET", "/api/help/features");
    await record("token clear", "DELETE", "/api/ado/token");
    await record("state cleared", "GET", "/api/ado");
  });

  assert.equal(seen.length, 16);
});
