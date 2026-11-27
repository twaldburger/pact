/*
 * Importing one Azure DevOps work item, end to end: the HTTP route, the reads it
 * makes with the configured token, the plan write it lands, and every way it can
 * refuse.
 *
 * Every case runs a real server over a scratch plan with Azure DevOps stubbed,
 * so the suite never calls the owner's instance: the stub answers the work-item
 * read, the parents it walks and the team's iterations, and records what was
 * asked for. What is asserted is what a person would see in the plan afterwards
 * - the Assignment's name, Person, Project, dates and link - plus the refusals,
 * which must leave the plan exactly as it was.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStore, seedPlan, todayISO } from "../lib/plan.mjs";
import { createServer } from "../server.mjs";
import { importLine, projectImportLine } from "../public/lib/ado.mjs";
import { leastUsedSlot } from "../public/lib/palette.mjs";
import { sprintsFor } from "../public/lib/sprints.mjs";
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("ado-import-api");
const TOKEN = "pact-test-token-0123456789abcdefghijKL";

const MAPPING = {
  organizationUrl: "https://dev.azure.com/example",
  project: "PACT",
  projectLevel: "Epic",
  assignmentLevel: "Feature"
};

/* --- the plan the import lands in ---------------------------------------- */

function stagingPlan() {
  const plan = seedPlan();
  plan.ado = MAPPING;
  // The Person the work item's AssignedTo matches, and one Project named after
  // the Epic a work item sits under.
  plan.people[0].email = "anna@example.com";
  plan.projects.push({ id: "invoices", name: "Invoices", colour: 4, notes: "", tags: [] });
  return plan;
}

/* --- Azure DevOps, stubbed ----------------------------------------------- */

const itemsFor = (items) => {
  const map = new Map(Object.entries(items || {}).map(([id, entry]) => [Number(id), entry]));
  return map;
};

function adoStub(settings) {
  const fixture = settings || {};
  const items = itemsFor(fixture.items);
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
  const fetchImpl = async (url) => {
    calls.push(url);
    if (fixture.status && fixture.status !== 200) return reply(fixture.status, {});
    const pathname = new URL(url).pathname.replace(/^\/example/, "");
    const item = /^\/[^/]+\/_apis\/wit\/workitems\/(\d+)$/.exec(pathname);
    if (item) {
      const entry = items.get(Number(item[1]));
      if (!entry) return reply(404, { message: "The work item does not exist" });
      return reply(200, {
        id: Number(item[1]),
        rev: entry.rev,
        fields: entry.fields,
        relations: entry.relations || []
      });
    }
    if (/^\/_apis\/projects\/[^/]+$/.test(pathname)) return reply(200, { id: "proj-1", name: "PACT" });
    if (pathname === "/_apis/projects/proj-1/teams") {
      return reply(200, { count: 1, value: [{ id: "team-1", name: "PACT Team" }] });
    }
    if (/^\/PACT\/PACT%20Team\/_apis\/work\/teamsettings\/iterations$/.test(pathname)) {
      return reply(200, { count: (fixture.iterations || []).length, value: fixture.iterations || [] });
    }
    // The backlog levels, which only an import of a type the mapping does not
    // name asks for: its rank decides whether the item sits below the level
    // that carries a person's time.
    if (/^\/PACT\/PACT%20Team\/_apis\/work\/backlogs$/.test(pathname)) {
      return reply(200, { count: (fixture.backlogs || []).length, value: fixture.backlogs || [] });
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
  // A case that needs the plan to hold something besides a mapping - a sprint
  // cadence, most of all - says so before the file is written, because the store
  // reads the file once and the plan under test is the one on disk.
  const plan = stagingPlan();
  if (fixture.plan) fixture.plan(plan);
  fs.writeFileSync(planFile, JSON.stringify(plan, null, 2) + "\n");
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
  // The token the server reads, written where the panel would have written it.
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

const importOf = (app, body) => call(app.base, "POST", "/api/ado/import", body);

function stored(app) {
  return JSON.parse(fs.readFileSync(app.planFile, "utf8"));
}

// The item's dates and iteration are built relative to today, because the plan's
// period follows the real today and an import must land inside it.
function day(offset) {
  return new Date(Date.parse(todayISO() + "T00:00:00Z") + offset * 86400000).toISOString().slice(0, 10);
}

// The assumed month, counted the way a calendar counts it: the day before the
// same day next month, with the day clamped to that month's length.
function monthAfter(today) {
  const date = new Date(today + "T00:00:00Z");
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0)).getUTCDate();
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, Math.min(date.getUTCDate(), last)));
  return new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
}

const EPIC = {
  rev: 3,
  fields: {
    "System.Title": "Invoices",
    "System.WorkItemType": "Epic",
    "System.State": "Doing",
    "System.AssignedTo": { displayName: "Ben Falk", uniqueName: "ben@example.com" }
  }
};

function feature(overrides) {
  return {
    rev: 7,
    fields: Object.assign({
      "System.Title": "PDF export",
      "System.WorkItemType": "Feature",
      "System.State": "Active",
      "System.AssignedTo": { displayName: "Anna Meier", uniqueName: "anna@example.com" },
      "System.Parent": 1000
    }, overrides || {})
  };
}

/* --- the item with dates ------------------------------------------------- */

test("an item with dates lands as an Assignment carrying them, its Person, its Project and its link", async () => {
  const app = await start({
    items: {
      1000: EPIC,
      1001: feature({
        "Microsoft.VSTS.Scheduling.StartDate": day(5) + "T00:00:00Z",
        "Microsoft.VSTS.Scheduling.TargetDate": day(20) + "T00:00:00Z",
        "System.IterationPath": "PACT\\Sprint 01"
      })
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: "1001" });
  assert.equal(res.status, 200, res.text);

  const plan = app.store.get();
  assert.equal(plan.assignments.length, before.assignments.length + 1);
  const created = plan.assignments[plan.assignments.length - 1];
  assert.equal(created.name, "PDF export");
  assert.equal(created.personId, "anna");
  assert.equal(created.projectId, "invoices");
  assert.equal(created.start, day(5));
  assert.equal(created.end, day(20));
  // The Share is PACT's own number: one step of the plan's granularity.
  assert.equal(created.share, 10);
  assert.deepEqual(created.link, {
    workItemId: 1001,
    rev: 7,
    workItemType: "Feature",
    datesAssumed: false,
    values: {
      title: "PDF export",
      personEmail: "anna@example.com",
      project: "Invoices",
      start: day(5),
      end: day(20),
      iterationPath: "PACT\\Sprint 01"
    }
  });

  // The baseline reached the file, not only the memory: the plan is what
  // travels, so the link and its values are what a colleague would read.
  const file = stored(app);
  const onDisk = file.assignments[file.assignments.length - 1];
  assert.deepEqual(onDisk.link, created.link);

  // No Person was created: the email matched one that was already on the plan.
  assert.equal(plan.people.length, before.people.length);
  assert.equal(res.json.person, null);
  // The line the panel draws says what was made, and that the dates are ADO's.
  const line = importLine(res.json.facts);
  assert.match(line, /Imported Feature #1001 as "PDF export": Anna Meier on Invoices/);
  assert.match(line, /The dates are the work item's own\./);
  // One write, one undo step.
  assert.equal(app.store.historyDepth().undo, 1);
});

test("a work-item link is read the same as the bare id", async () => {
  const app = await start({
    items: { 1000: EPIC, 1001: feature({ "System.Parent": 1000 }) }
  });
  const res = await importOf(app, { id: "https://dev.azure.com/example/PACT/_workitems/edit/1001" });
  assert.equal(res.status, 200, res.text);
  assert.equal(app.store.get().assignments.filter((a) => a.link && a.link.workItemId === 1001).length, 1);
  // Every call was addressed inside the mapped project, with the token in a
  // header and never in a URL.
  assert.equal(app.stub.calls.every((url) => url.includes("/PACT/") || url.includes("/_apis/projects/")), true);
  assert.equal(app.stub.calls.every((url) => !url.includes(TOKEN)), true);
});

/* --- the item with no dates ---------------------------------------------- */

test("an item with no dates is one month long from today, marked assumed", async () => {
  const app = await start({ items: { 1000: EPIC, 1001: feature() } });
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 200, res.text);

  const created = app.store.get().assignments.slice(-1)[0];
  assert.equal(created.start, todayISO());
  assert.equal(created.end, monthAfter(todayISO()));
  assert.equal(created.link.datesAssumed, true);
  // ADO holds no dates, so its side of the baseline is null on both - a sync
  // reads that as "PACT has moved" rather than as an agreed value.
  assert.equal(created.link.values.start, null);
  assert.equal(created.link.values.end, null);
  assert.equal(created.link.values.iterationPath, null);

  const line = importLine(res.json.facts);
  assert.match(line, /The dates are assumed: the work item has none, so the block is one month long/);
});

test("one date alone is not a span: the block takes the assumed month", async () => {
  const app = await start({
    items: {
      1000: EPIC,
      1001: feature({ "Microsoft.VSTS.Scheduling.TargetDate": day(20) + "T00:00:00Z" })
    }
  });
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 200, res.text);
  const created = app.store.get().assignments.slice(-1)[0];
  assert.equal(created.link.datesAssumed, true);
  assert.equal(created.start, todayISO());
  // The end ADO does hold is still recorded, so a later sync sees it.
  assert.equal(created.link.values.end, day(20));
  assert.equal(created.link.values.start, null);
});

/* --- the sprint by date -------------------------------------------------- */

test("an iteration whose start falls in a PACT sprint puts the block on that sprint", async () => {
  // A cadence whose first sprint began well before today, so today sits in the
  // chain and the iteration's start falls inside a sprint of its own. The
  // iteration's name is deliberately the same as a PACT sprint's, because the
  // rule is containment by date and never a match on the name.
  const cadence = { start: day(-20), length: 14, namePrefix: "PACT\\Sprint ", nameNumber: "01" };
  const app = await start({
    plan: (plan) => { plan.cadence = cadence; },
    items: {
      1000: EPIC,
      1001: feature({ "System.IterationPath": "PACT\\Sprint 02" })
    },
    iterations: [
      { path: "PACT\\Sprint 01", attributes: { startDate: day(-20) + "T00:00:00Z", finishDate: day(-7) + "T00:00:00Z" } },
      { path: "PACT\\Sprint 02", attributes: { startDate: day(-3) + "T00:00:00Z", finishDate: day(10) + "T00:00:00Z" } }
    ]
  });
  const chain = sprintsFor(cadence, null, app.store.get().range);
  // The iteration's start (today - 3) falls in the chain's second sprint, whose
  // dates are where the block must land - by containment, never by name.
  const sprint = chain.filter((entry) => entry.start <= day(-3) && day(-3) <= entry.end)[0];
  assert.ok(sprint, "the fixture no longer lands the iteration inside a sprint");

  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 200, res.text);
  const created = app.store.get().assignments.slice(-1)[0];
  assert.equal(created.start, sprint.start);
  assert.equal(created.end, sprint.end);
  assert.equal(created.link.datesAssumed, true);
  // ADO has no dates, so its side of the baseline stays empty even though the
  // block's dates came from the plan's own sprint chain.
  assert.equal(created.link.values.start, null);
  assert.match(importLine(res.json.facts), /the block sits at PACT\\Sprint 02 \(/);
});

test("an iteration in no PACT sprint falls back to the assumed month and says so", async () => {
  const app = await start({
    items: { 1000: EPIC, 1001: feature({ "System.IterationPath": "PACT\\Sprint 09" }) },
    iterations: [
      { path: "PACT\\Sprint 09", attributes: { startDate: "2020-01-06T00:00:00Z", finishDate: "2020-01-17T00:00:00Z" } }
    ]
  });
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 200, res.text);
  const created = app.store.get().assignments.slice(-1)[0];
  assert.equal(created.start, todayISO());
  assert.match(importLine(res.json.facts), /which is in no PACT sprint/);
});

/* --- the Person --------------------------------------------------------- */

test("an unassigned item is refused, and nothing is imported", async () => {
  const app = await start({
    items: { 1000: EPIC, 1001: feature({ "System.AssignedTo": undefined }) }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /not assigned to anybody/);
  assert.match(res.json.error, /PDF export/);
  assert.deepEqual(app.store.get(), before);
  assert.equal(app.store.canUndo(), false);
});

test("an item assigned to a group is refused, naming the group", async () => {
  const app = await start({
    items: { 1000: EPIC, 1001: feature({ "System.AssignedTo": { displayName: "PACT Team" } }) }
  });
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /PACT Team/);
  assert.match(res.json.error, /no email/);
  assert.equal(app.store.get().assignments.length, seedPlan().assignments.length);
});

test("an email matching nobody offers to create the Person, and creates nothing until the offer is taken", async () => {
  const app = await start({
    items: {
      1000: EPIC,
      1001: feature({ "System.AssignedTo": { displayName: "Dana Voss", uniqueName: "dana@example.com" } })
    }
  });
  const before = app.store.get();

  const refused = await importOf(app, { id: 1001 });
  assert.equal(refused.status, 409);
  // The refusal carries the offer as a field, so the panel draws a choice rather
  // than parsing it back out of a sentence.
  assert.deepEqual(refused.json.offer, {
    kind: "create-person",
    name: "Dana Voss",
    email: "dana@example.com",
    label: "Create Dana Voss and import",
    message: refused.json.offer.message
  });
  assert.match(refused.json.error, /dana@example\.com/);
  assert.deepEqual(app.store.get(), before);
  assert.equal(app.store.canUndo(), false);

  const accepted = await importOf(app, { id: 1001, createPerson: true });
  assert.equal(accepted.status, 200, accepted.text);
  const plan = app.store.get();
  const dana = plan.people.filter((person) => person.email === "dana@example.com")[0];
  assert.ok(dana, "the Person the offer named was not created");
  // The ADO display name verbatim, full availability, and editable afterwards.
  assert.equal(dana.name, "Dana Voss");
  assert.equal(dana.availability, 100);
  const created = plan.assignments.slice(-1)[0];
  assert.equal(created.personId, dana.id);
  assert.equal(created.link.values.personEmail, "dana@example.com");
  assert.match(importLine(accepted.json.facts), /Dana Voss was added as a Person with dana@example\.com/);

  // One step back takes away the Assignment and the Person the import created.
  app.store.undo();
  assert.deepEqual(app.store.get(), before);
});

test("an email matching a Person uses them, and creates nobody", async () => {
  const app = await start({ items: { 1000: EPIC, 1001: feature() } });
  const before = app.store.get();
  const res = await importOf(app, { id: 1001, createPerson: true });
  assert.equal(res.status, 200, res.text);
  const plan = app.store.get();
  assert.equal(plan.people.length, before.people.length);
  assert.equal(plan.assignments.slice(-1)[0].personId, "anna");
});

/* --- the Project -------------------------------------------------------- */

test("a parent chain that reaches no project level refuses, naming the levels it walked", async () => {
  const app = await start({
    items: {
      1000: { rev: 2, fields: { "System.Title": "Billing", "System.WorkItemType": "Initiative" } },
      1001: feature({ "System.Parent": 1000 })
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Initiative 'Billing'/);
  assert.match(res.json.error, /none is a 'Epic'/);
  assert.deepEqual(app.store.get(), before);
});

test("an item with no parent at all refuses, naming the missing project level", async () => {
  const app = await start({ items: { 1001: feature({ "System.Parent": undefined }) } });
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /no parent/);
  assert.match(res.json.error, /'Epic'/);
});

test("a project level the plan has no Project for refuses rather than inventing one", async () => {
  const app = await start({
    items: {
      1000: { rev: 2, fields: { "System.Title": "Billing", "System.WorkItemType": "Epic" } },
      1001: feature({ "System.Parent": 1000 })
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Billing/);
  assert.match(res.json.error, /never invents a Project/);
  assert.deepEqual(app.store.get(), before);
});

/* --- the item at the project level -------------------------------------- */

// An item whose own type is the mapping's project level: an Epic, with no
// owner at all in the cases that matter - which is what the owner's import hit.
function projectItem(overrides) {
  return {
    rev: 4,
    fields: Object.assign({
      "System.Title": "Super Epic Project",
      "System.WorkItemType": "Epic",
      "System.State": "Doing"
    }, overrides || {})
  };
}

const PROJECT_LINK = {
  workItemId: 2000,
  rev: 4,
  workItemType: "Epic",
  datesAssumed: false,
  values: {
    title: "Super Epic Project",
    project: "Super Epic Project",
    start: null,
    end: null,
    iterationPath: null
  }
};

test("a project-level item with no owner becomes one Project carrying its link, and no Assignment", async () => {
  const app = await start({ items: { 2000: projectItem() } });
  const before = app.store.get();
  const res = await importOf(app, { id: 2000 });
  assert.equal(res.status, 200, res.text);

  const plan = app.store.get();
  assert.equal(plan.assignments.length, before.assignments.length, "a project-level import created an Assignment");
  assert.equal(plan.projects.length, before.projects.length + 1);
  const created = plan.projects.slice(-1)[0];
  assert.equal(created.name, "Super Epic Project");
  // The least-used colour, as any new Project takes, and no notes.
  assert.equal(created.colour, leastUsedSlot(before.projects));
  assert.equal(created.notes, "");
  assert.deepEqual(created.tags, []);
  // The link and the baseline sit on the Project, and carry no owner's email:
  // an import at this level never reads AssignedTo.
  assert.deepEqual(created.link, PROJECT_LINK);
  assert.equal("personEmail" in created.link.values, false);

  // It reached the file, not only the memory.
  const file = stored(app);
  assert.deepEqual(file.projects[file.projects.length - 1].link, PROJECT_LINK);
  // One write, one undo step.
  assert.equal(app.store.historyDepth().undo, 1);

  assert.equal(res.json.kind, "project");
  const line = projectImportLine(res.json.facts);
  assert.match(line, /Imported Epic #2000 as the new Project "Super Epic Project"/);
  assert.doesNotMatch(line, /[Pp]erson|owner/);
});

test("a project-level item's AssignedTo is not read at all", async () => {
  // The email matches nobody on the plan. At the assignment level that is an
  // offer to create a Person; here it must not even be looked at.
  const app = await start({
    items: {
      2000: projectItem({ "System.AssignedTo": { displayName: "Dana Voss", uniqueName: "dana@example.com" } })
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 2000 });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.offer, undefined);
  assert.equal(app.store.get().people.length, before.people.length);
  assert.equal(stored(app).people.some((person) => person.email === "dana@example.com"), false);
});

test("the same project-level import twice offers the Project, then links rather than creating a second", async () => {
  const app = await start({ items: { 2000: projectItem() } });
  const first = await importOf(app, { id: 2000 });
  assert.equal(first.status, 200, first.text);
  const created = app.store.get().projects.slice(-1)[0];
  const afterFirst = app.store.get();

  const second = await importOf(app, { id: 2000 });
  assert.equal(second.status, 409);
  // The offer travels as a field, so the panel draws two presses rather than
  // parsing them back out of a sentence.
  assert.equal(second.json.offer.kind, "use-project");
  assert.equal(second.json.offer.projectId, created.id);
  assert.equal(second.json.offer.name, "Super Epic Project");
  assert.equal(second.json.offer.label, "Use \"Super Epic Project\"");
  assert.equal(second.json.offer.altLabel, "Import as a copy");
  assert.equal(second.json.offer.copyName, "Super Epic Project (copy)");
  assert.match(second.json.error, /already has a live Project named "Super Epic Project"/);
  assert.deepEqual(app.store.get(), afterFirst, "the offer wrote something");
  assert.equal(app.store.historyDepth().undo, 1);

  const used = await importOf(app, { id: 2000, useProject: true });
  assert.equal(used.status, 200, used.text);
  const plan = app.store.get();
  assert.equal(plan.projects.length, afterFirst.projects.length, "using the Project created another");
  assert.deepEqual(plan.projects.filter((project) => project.name === "Super Epic Project"),
    [created], "the link did not land on the existing Project unchanged");
  assert.equal(plan.assignments.length, afterFirst.assignments.length);
  assert.equal(used.json.facts.created, false);
  assert.equal(projectImportLine(used.json.facts),
    "Linked Epic #2000 to the existing Project \"Super Epic Project\": nothing was created.");
  // The link is its own single commit, one step back.
  assert.equal(app.store.historyDepth().undo, 2);
});

test("Import as a copy names the new Project X (copy), numbered by the app's own rule", async () => {
  const app = await start({ items: { 2000: projectItem() } });
  assert.equal((await importOf(app, { id: 2000 })).status, 200);
  const copy = await importOf(app, { id: 2000, copyProject: true });
  assert.equal(copy.status, 200, copy.text);
  assert.equal(copy.json.facts.created, true);
  assert.equal(copy.json.facts.projectName, "Super Epic Project (copy)");
  const names = app.store.get().projects.map((project) => project.name);
  assert.equal(names.filter((name) => name === "Super Epic Project").length, 1);
  assert.equal(names.includes("Super Epic Project (copy)"), true);
  // The copy already exists, so the next one is numbered on rather than
  // stacking a second suffix.
  const second = await importOf(app, { id: 2000, copyProject: true });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.json.facts.projectName, "Super Epic Project (copy 2)");
  const copyProject = app.store.get().projects.filter((project) => project.name === "Super Epic Project (copy)")[0];
  assert.equal(copyProject.link.values.title, "Super Epic Project");
  assert.equal(copyProject.link.workItemId, 2000);
});

test("an archived Project is not offered, and the import creates a live one", async () => {
  const app = await start({
    plan: (plan) => {
      plan.projects.push({
        id: "old-epic", name: "Super Epic Project", colour: 2, notes: "", tags: [], archived: true
      });
    },
    items: { 2000: projectItem() }
  });
  const res = await importOf(app, { id: 2000 });
  assert.equal(res.status, 200, res.text);
  const plan = app.store.get();
  const live = plan.projects.filter((project) => project.name === "Super Epic Project" && !project.archived);
  assert.equal(live.length, 1, "an archived Project was offered or a new one was not created");
  assert.equal(plan.projects.filter((project) => project.archived).length, 1);
  assert.equal("link" in plan.projects.filter((project) => project.id === "old-epic")[0], false);
});

/* --- the tag level, and below the level that carries time --------------- */

const BACKLOGS = [
  { rank: 4, name: "Epics", workItemTypes: [{ name: "Epic" }] },
  { rank: 3, name: "Features", workItemTypes: [{ name: "Feature" }] },
  { rank: 2, name: "Stories", workItemTypes: [{ name: "User Story" }] },
  { rank: 1, name: "Tasks", workItemTypes: [{ name: "Task" }] }
];

test("a tag-level item is refused for what a tag is for, and blames nobody", async () => {
  const app = await start({
    plan: (plan) => { plan.ado = Object.assign({}, plan.ado, { tagLevel: "Bug" }); },
    items: {
      2000: {
        rev: 1,
        fields: {
          "System.Title": "Login is slow",
          "System.WorkItemType": "Bug",
          "System.AssignedTo": { displayName: "Anna Meier", uniqueName: "anna@example.com" }
        }
      }
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 2000 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Work item 2000 \("Login is slow"\) is Bug/);
  assert.match(res.json.error, /a tag has no record of its own/);
  assert.doesNotMatch(res.json.error, /assigned to anybody|no owner|give it an owner/);
  assert.deepEqual(app.store.get(), before);
  assert.equal(app.store.canUndo(), false);
});

test("an item below the assignment level is refused for its level, not for its owner", async () => {
  const app = await start({
    backlogs: BACKLOGS,
    items: {
      2000: {
        rev: 2,
        fields: {
          "System.Title": "Wire the export",
          "System.WorkItemType": "Task",
          "System.AssignedTo": { displayName: "Anna Meier", uniqueName: "anna@example.com" }
        }
      }
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 2000 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /Work item 2000 \("Wire the export"\) is Task/);
  assert.match(res.json.error, /below the level that carries a person's time/);
  // The mapping's own names, so the refusal says which level to import instead.
  assert.match(res.json.error, /Feature/);
  assert.doesNotMatch(res.json.error, /assigned to anybody|give it an owner/);
  assert.deepEqual(app.store.get(), before);
});

test("an unnamed type whose rank the instance does not answer keeps the assignment path", async () => {
  // No backlog fixture, so the ranks read answers 404: an import must not
  // refuse work for want of a rank it never needed before.
  const app = await start({
    items: { 1000: EPIC, 1001: feature({ "System.WorkItemType": "User Story" }) }
  });
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 200, res.text);
  const created = app.store.get().assignments.slice(-1)[0];
  assert.equal(created.name, "PDF export");
  assert.equal(created.link.workItemType, "User Story");
});

/* --- the ways ADO says no ----------------------------------------------- */
test("a work item that does not exist answers 404, and nothing is written", async () => {
  const app = await start({ items: { 1000: EPIC } });
  const before = app.store.get();
  const res = await importOf(app, { id: 9999 });
  assert.equal(res.status, 404);
  assert.match(res.json.error, /no work item 9999/);
  assert.deepEqual(app.store.get(), before);
});

test("a rejected token is reported as such, and nothing is written", async () => {
  const app = await start({ status: 401, items: {} });
  const before = app.store.get();
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 502);
  assert.match(res.json.error, /rejected the token/);
  assert.deepEqual(app.store.get(), before);
});

test("a paste that is neither an id nor a work-item link is refused before any call", async () => {
  const app = await start({ items: { 1000: EPIC, 1001: feature() } });
  const res = await importOf(app, { id: "the PDF export one" });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /12345/);
  assert.equal(app.stub.calls.length, 0);
});

test("a plan with no ADO mapping says so instead of importing", async () => {
  const app = await start({ items: { 1000: EPIC, 1001: feature() } });
  // A mapping is plan data, so an Undo that removes it is enough to test the
  // refusal without a second scratch plan.
  const plan = stagingPlan();
  delete plan.ado;
  fs.writeFileSync(app.planFile, JSON.stringify(plan, null, 2) + "\n");
  app.store.openPlan(app.planFile);
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 409);
  assert.match(res.json.error, /no ADO mapping/);
  assert.equal(app.stub.calls.length, 0);
});

test("a second import of the same item is refused, naming the Assignment it duplicates", async () => {
  const app = await start({ items: { 1000: EPIC, 1001: feature() } });
  const first = await importOf(app, { id: 1001 });
  assert.equal(first.status, 200, first.text);
  const before = app.store.get();
  const second = await importOf(app, { id: 1001 });
  assert.equal(second.status, 409);
  assert.match(second.json.error, /already on the plan as "PDF export"/);
  assert.match(second.json.error, /Anna Meier on Invoices/);
  assert.deepEqual(app.store.get(), before);
  // Archiving the first one leaves the item importable again.
  app.store.archiveAssignment(before.assignments.slice(-1)[0].id);
  const third = await importOf(app, { id: 1001 });
  assert.equal(third.status, 200, third.text);
});

test("ADO's dates outside the plan period are refused by the plan's own rule", async () => {
  const app = await start({
    items: {
      1000: EPIC,
      1001: feature({
        "Microsoft.VSTS.Scheduling.StartDate": "2035-01-01T00:00:00Z",
        "Microsoft.VSTS.Scheduling.TargetDate": "2035-02-01T00:00:00Z"
      })
    }
  });
  const before = app.store.get();
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /fall inside the plan's period/);
  assert.deepEqual(app.store.get(), before);
  assert.equal(app.store.canUndo(), false);
});

/* --- the plan's own refusals, at the API -------------------------------- */

test("the API refuses a link carrying a credential-shaped key", async () => {
  const app = await start({ items: {} });
  const res = await call(app.base, "POST", "/api/assignments", {
    projectId: "atlas",
    personId: "anna",
    start: day(1),
    end: day(5),
    share: 10,
    link: {
      workItemId: 1234,
      rev: 1,
      datesAssumed: false,
      values: { title: "PDF export", personEmail: "anna@example.com", project: "Invoices", start: null, end: null, iterationPath: null },
      token: "a-secret"
    }
  });
  assert.equal(res.status, 400);
  assert.match(res.json.error, /credential/);
  assert.equal(stored(app).assignments.some((assignment) => assignment.link), false);
});

/* --- a plan that never had a link --------------------------------------- */

test("an existing plan without links validates, loads and imports into", async () => {
  const app = await start({ items: { 1000: EPIC, 1001: feature() } });
  // The staging plan is the seed plus a mapping: nothing in it carries a link,
  // and it loaded, which is half the assertion.
  assert.equal(stored(app).assignments.some((assignment) => assignment.link), false);
  const res = await importOf(app, { id: 1001 });
  assert.equal(res.status, 200, res.text);
  assert.equal(stored(app).assignments.some((assignment) => assignment.link), true);
});
