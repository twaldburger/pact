/*
 * Writing one Assignment back, end to end: the HTTP route, the three calls it
 * makes, the plan write it lands, and every way it refuses.
 *
 * Every case runs a real server over a scratch plan with Azure DevOps stubbed,
 * so the suite never calls the owner's instance. What is asserted is what a
 * person would see afterwards - the item's patch, the comment on it, and the
 * baseline the plan holds - plus the refusals, which must leave both sides
 * exactly as they were. The order of the calls is asserted as well as their
 * content, because the whole honesty of the write rests on the conditional patch
 * going first and the comment only once it has landed.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStore, seedPlan, todayISO } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { WRITE_BACK_MARKER, allocationComment } from "../public/lib/ado.mjs";
import { spanFteDays } from "../public/lib/workdays.mjs";
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("ado-write-back-api");
const TOKEN = "pact-test-token-0123456789abcdefghijKL";

const MAPPING = {
  organizationUrl: "https://dev.azure.com/example",
  project: "PACT",
  projectLevels: ["Epic"],
  assignmentLevels: ["Feature", "User Story"]
};

// Today and a day, relative to the real today, because the plan's period follows
// it: a case's dates sit inside the plan and inside the iteration the stub
// answers with.
function day(offset) {
  return new Date(Date.parse(todayISO() + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}

function basePlan(datesAssumed) {
  const plan = seedPlan();
  plan.ado = MAPPING;
  plan.people[0].email = "anna@example.com";
  const assignment = plan.assignments[0];
  assignment.link = {
    workItemId: 4,
    rev: 7,
    workItemType: "User Story",
    datesAssumed: datesAssumed === true,
    values: {
      title: "My first Story",
      personEmail: "anna@example.com",
      project: "Super Epic Project",
      start: null,
      end: null,
      iterationPath: null
    }
  };
  return plan;
}

// The iterations the stub answers with: one window around today, which is what
// the assignment's dates sit in.
function iterationsFixture() {
  return {
    name: "PACT",
    path: "\\PACT\\Iteration",
    children: [
      {
        name: "Sprint 01",
        attributes: { startDate: day(-10) + "T00:00:00Z", finishDate: day(10) + "T00:00:00Z" }
      },
      {
        name: "Sprint 02",
        attributes: { startDate: day(20) + "T00:00:00Z", finishDate: day(40) + "T00:00:00Z" }
      }
    ]
  };
}

/* --- Azure DevOps, stubbed ----------------------------------------------- */

function adoStub(settings) {
  const fixture = settings || {};
  const calls = [];
  const reply = (status, body, headers) => {
    const sent = headers || {};
    return {
      status: status,
      headers: { get: (name) => sent[String(name).toLowerCase()] || null },
      text: async () => (body === undefined || body === null ? ""
        : typeof body === "string" ? body : JSON.stringify(body))
    };
  };
  const fetchImpl = async (url, init) => {
    const options = init || {};
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/example/, "");
    const method = String(options.method || "GET");
    calls.push({ method: method, url: url, path: pathname, body: options.body, headers: options.headers || {} });
    const wanted = fixture.status || {};
    if (wanted[method]) return reply(wanted[method], {});
    if (pathname === "/PACT/_apis/wit/classificationnodes/iterations") {
      return reply(200, fixture.iterations || iterationsFixture());
    }
    if (/^\/PACT\/_apis\/wit\/workitems\/\d+$/.test(pathname)) {
      return reply(200, { id: 4, rev: fixture.patchRev || 8, fields: {} });
    }
    if (/^\/PACT\/_apis\/wit\/workItems\/\d+\/comments(\/\d+)?$/.test(pathname)) {
      const comments = fixture.comments || [];
      if (method === "GET") {
        return reply(200, { totalCount: comments.length, count: comments.length, comments: comments });
      }
      if (method === "POST") return reply(200, { id: 21, text: "posted" });
      const edited = /\/comments\/(\d+)$/.exec(pathname);
      return reply(200, { id: Number(edited[1]), text: "edited" });
    }
    return reply(404, {});
  };
  return { fetchImpl: fetchImpl, calls: calls };
}

const servers = [];
after(() => Promise.all(servers.map((server) => new Promise((done) => server.close(done)))));

async function start(settings) {
  const fixture = settings || {};
  const dir = tempDir();
  const planFile = path.join(dir, "plan.json");
  fs.writeFileSync(planFile, JSON.stringify(fixture.plan || basePlan(fixture.datesAssumed), null, 2) + "\n");
  const store = createStore(planFile);
  const stub = adoStub(fixture);
  const server = createServer(store, {
    configPath: path.join(dir, "config.json"),
    home: dir,
    platform: "linux",
    env: {},
    fetchImpl: stub.fetchImpl
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const tokenFile = path.join(dir, ".config", "pact", "ado-pat");
  fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
  fs.writeFileSync(tokenFile, TOKEN + "\n");
  return {
    base: "http://127.0.0.1:" + server.address().port,
    dir: dir,
    store: store,
    stub: stub,
    planFile: planFile
  };
}

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
  assert.equal(text.includes(TOKEN), false, "a response carried the token");
  return { status: res.status, text: text, json: parsed };
}

const writeBackOf = (app, assignmentId) =>
  call(app.base, "POST", "/api/ado/write-back", { assignmentId: assignmentId === undefined ? "a-atlas-anna" : assignmentId });

function stored(app) {
  return JSON.parse(fs.readFileSync(app.planFile, "utf8"));
}

const callsTo = (app, pattern) => app.stub.calls.filter((entry) => pattern.test(entry.path));
const commentCalls = (app) => callsTo(app, /\/comments/);

/* --- the write, in order -------------------------------------------------- */

test("the iteration is written as one JSON Patch whose test op is the baseline revision", async () => {
  const app = await start();
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);

  // The iteration is read first, so the path written is the instance's own.
  assert.equal(app.stub.calls[0].method, "GET");
  assert.match(app.stub.calls[0].path, /\/_apis\/wit\/classificationnodes\/iterations$/);

  const patch = app.stub.calls.filter((entry) => entry.method === "PATCH" && !/\/comments/.test(entry.path))[0];
  assert.ok(patch, "no work item patch was made");
  // The patch is the condition and the one field, in that order, and nothing
  // else: If-Match is silently ignored by this API, so the revision is checked
  // by the patch body itself.
  assert.deepEqual(JSON.parse(patch.body), [
    { op: "test", path: "/rev", value: 7 },
    { op: "add", path: "/fields/System.IterationPath", value: "PACT\\Sprint 01" }
  ]);
  assert.equal(patch.headers["content-type"], "application/json-patch+json");
  assert.match(patch.headers.authorization, /^Basic /);
  assert.doesNotMatch(patch.url, new RegExp(TOKEN));

  // And the patch is the first write: the comment comes after it.
  const writes = app.stub.calls.filter((entry) => entry.method !== "GET").map((entry) => entry.path);
  assert.deepEqual(writes, [
    "/PACT/_apis/wit/workitems/4",
    "/PACT/_apis/wit/workItems/4/comments"
  ]);
});

test("what a finished write back reports names the item, the comment and the iteration", async () => {
  const app = await start();
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.json.facts.comment, "posted");
  assert.equal(answer.json.facts.iterationPath, "PACT\\Sprint 01");
  assert.equal(answer.json.facts.rev, 8);
  assert.match(answer.json.line, /Wrote back to User Story #4/);
  assert.match(answer.json.line, /its comment was posted/);
});

test("the comment is the plan's own table, with the person, share, dates and FTE-days", async () => {
  const app = await start();
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);
  const posted = commentCalls(app).filter((entry) => entry.method === "POST")[0];
  assert.ok(posted, "no comment was posted");
  const plan = app.store.get();
  const person = plan.people.filter((entry) => entry.id === "anna")[0];
  const assignment = plan.assignments.filter((entry) => entry.id === "a-atlas-anna")[0];
  const expected = allocationComment({
    personName: "Anna Meier",
    share: assignment.share,
    start: assignment.start,
    end: assignment.end,
    fteDays: spanFteDays(plan, person, assignment.start, assignment.end, assignment.share)
  });
  assert.equal(JSON.parse(posted.body).text, expected);
  assert.match(expected, new RegExp("^" + WRITE_BACK_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

/* --- the baseline -------------------------------------------------------- */

test("the baseline takes the new revision, the agreed dates and stops being assumed", async () => {
  const app = await start();
  const before = stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0];
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);
  const link = stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link;
  assert.equal(link.rev, 8);
  assert.equal(link.datesAssumed, false);
  assert.equal(link.values.start, before.start);
  assert.equal(link.values.end, before.end);
  assert.equal(link.values.iterationPath, "PACT\\Sprint 01");
  // The rest of the baseline is what both sides already agreed, unchanged: a
  // write back publishes the allocation, not a rewritten record.
  assert.equal(link.values.title, "My first Story");
  assert.equal(link.values.personEmail, "anna@example.com");
  assert.equal(link.values.project, "Super Epic Project");
  // One plan write, so one Undo step back to what it was.
  assert.equal(app.store.canUndo(), true);
  app.store.undo();
  assert.equal(stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link.rev, 7);
});

test("a patch that changes nothing keeps the revision the item was already at", async () => {
  // Setting the iteration the item already holds is not a change, so ADO answers
  // the revision it was at rather than a higher one. That is still the item's
  // revision, and the write back proceeds to the comment.
  const app = await start({ patchRev: 7 });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.json.facts.rev, 7);
  const link = stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link;
  assert.equal(link.rev, 7);
  assert.equal(link.values.iterationPath, "PACT\\Sprint 01");
});

test("a write that never landed changes neither the revision nor the marker", async () => {
  const app = await start({ status: { PATCH: 412 } });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 409);
  const link = stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link;
  assert.equal(link.rev, 7);
  assert.equal(link.datesAssumed, false);
  assert.deepEqual(commentCalls(app), [], "a comment was written after the item moved");
});

/* --- the comment: one per item, updated in place ------------------------- */

test("a comment that begins with the marker is edited rather than posted again", async () => {
  const app = await start({
    comments: [
      { id: 11, text: WRITE_BACK_MARKER + " _(maintained automatically)_\n\nold table" },
      { id: 12, text: "Thanks, I will pick this up next week." }
    ]
  });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.json.facts.comment, "edited");
  const writes = commentCalls(app).filter((entry) => entry.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.equal(writes[0].path, "/PACT/_apis/wit/workItems/4/comments/11");
  // Somebody else's comment is untouched: one PACT comment, and theirs as it was.
  assert.equal(writes.some((entry) => entry.path.endsWith("/12")), false);
});

test("a comment that only mentions the marker is somebody else's and a new one is posted", async () => {
  const app = await start({
    comments: [{ id: 12, text: "See " + WRITE_BACK_MARKER + " above for the allocation." }]
  });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 200, answer.text);
  assert.equal(answer.json.facts.comment, "posted");
  const writes = commentCalls(app).filter((entry) => entry.method !== "GET");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "POST");
  assert.equal(writes[0].path, "/PACT/_apis/wit/workItems/4/comments");
});

/* --- the refusals, each naming its own cause ----------------------------- */

test("412 is the item having moved, and is reported rather than retried", async () => {
  const app = await start({ status: { PATCH: 412 } });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, /changed in Azure DevOps since PACT read it/);
  assert.match(answer.json.error, /412/);
  assert.match(answer.json.error, /nothing was written/);
  // No retry with the newest revision, and no comment claiming an iteration the
  // item does not have.
  const patches = app.stub.calls.filter((entry) => entry.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.deepEqual(commentCalls(app), []);
});

test("403 names the write scope the token is missing", async () => {
  const app = await start({ status: { PATCH: 403 } });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 502);
  assert.match(answer.json.error, /Work Items \(write\)/);
  assert.match(answer.json.error, /403/);
  assert.deepEqual(commentCalls(app), []);
});

test("404 is a work item that is no longer there", async () => {
  const app = await start({ status: { PATCH: 404 } });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 404);
  assert.match(answer.json.error, /no work item 4/);
});

test("a day no iteration covers refuses without writing, and names the day", async () => {
  // Iterations that sit far from the assignment's dates: nothing covers the day
  // it starts, and PACT must not fall back to the project root.
  const app = await start({
    iterations: {
      name: "PACT",
      path: "\\PACT\\Iteration",
      children: [
        {
          name: "Sprint 09",
          attributes: { startDate: day(200) + "T00:00:00Z", finishDate: day(220) + "T00:00:00Z" }
        }
      ]
    }
  });
  const assignment = stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0];
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 409);
  assert.match(answer.json.error, new RegExp(assignment.start));
  assert.match(answer.json.error, /No Azure DevOps iteration/);
  // Only the iteration read was made: nothing was written anywhere.
  assert.deepEqual(app.stub.calls.map((entry) => entry.method), ["GET"]);
  assert.equal(stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link.rev, 7);
});

test("an Assignment with no link, and one whose dates are assumed, are refused before any call", async () => {
  const unlinked = await start();
  const noLink = await writeBackOf(unlinked, "a-atlas-ben");
  assert.equal(noLink.status, 409);
  assert.match(noLink.json.error, /no Azure DevOps work item behind it/);
  assert.deepEqual(unlinked.stub.calls, []);

  const assumed = await start({ datesAssumed: true });
  const refused = await writeBackOf(assumed);
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /never publishes a guess/);
  assert.deepEqual(assumed.stub.calls, []);
  const link = stored(assumed).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link;
  assert.equal(link.datesAssumed, true);
});

test("a comment that fails after the iteration landed says both halves", async () => {
  const app = await start({ status: { POST: 500 } });
  const answer = await writeBackOf(app);
  assert.equal(answer.status, 502);
  assert.match(answer.json.error, /iteration is now PACT\\Sprint 01/);
  assert.match(answer.json.error, /comment was not written/);
  assert.match(answer.json.error, /The plan holds the new revision/);
  // The half that landed is recorded rather than rolled back: the plan holds the
  // revision the item is at, which is what a later write diffs against.
  const link = stored(app).assignments.filter((entry) => entry.id === "a-atlas-anna")[0].link;
  assert.equal(link.rev, 8);
  assert.equal(link.values.iterationPath, "PACT\\Sprint 01");
});

test("a plan with no mapping, and an unknown Assignment, are refused", async () => {
  const plan = basePlan(false);
  delete plan.ado;
  const app = await start({ plan: plan });
  const unmapped = await writeBackOf(app);
  assert.equal(unmapped.status, 409);
  assert.match(unmapped.json.error, /no ADO mapping/);
  assert.deepEqual(app.stub.calls, []);

  const mapped = await start();
  const missing = await writeBackOf(mapped, "no-such-assignment");
  assert.equal(missing.status, 404);
  assert.deepEqual(mapped.stub.calls, []);
});
