/*
 * The rules behind importing one Azure DevOps work item: what a paste may be,
 * which date field a work-item type carries, who an AssignedTo is, which parent
 * is the Project, where a block goes when ADO has no dates, and the shape of the
 * baseline the link stores.
 *
 * No network call is made here: these are the pure rules the server, the browser
 * and this file read from one source. The calls themselves, against stubbed ADO
 * responses, are in ado-import-api.test.mjs. What is pinned here is the part the
 * suites downstream cannot check for themselves - that the dates rule really is
 * per type, that an iteration is matched by containment and not by name, and
 * that a link can never carry a secret into a plan people share.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createStore, seedPlan, validatePlan } from "../lib/plan.mjs";
import { sprintsFor } from "../public/lib/sprints.mjs";
import { leastUsedSlot } from "../public/lib/palette.mjs";
import {
  ADO_FIELDS,
  assignedIdentity,
  assumedWindow,
  datePart,
  existingProjectOffer,
  importLevel,
  importLevelRefusal,
  importLine,
  importPlacement,
  iterationStartFor,
  linkFacts,
  linkLabel,
  linkRefusals,
  linkRow,
  linkType,
  normalizeLink,
  parentIdOf,
  personForEmail,
  projectFromChain,
  projectForTitle,
  projectImportLine,
  readWorkItemId,
  schedulingFields,
  sprintForDate,
  unmatchedAssigneeOffer,
  workItemUrl
} from "../public/lib/ado.mjs";
import { scratch } from "../test-support/scratch.mjs";

const tempDir = scratch("ado-import");

// A date a number of days on, so a case that needs dates inside the plan's own
// period does not drift as the seed's period follows the real today.
function isoPlus(iso, days) {
  return new Date(Date.parse(iso + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}

/* --- what a paste may be -------------------------------------------------- */

test("a bare id, with or without the hash, is a work item", () => {
  assert.deepEqual(readWorkItemId("12345"), { id: 12345, refusal: "" });
  assert.deepEqual(readWorkItemId("#12345"), { id: 12345, refusal: "" });
  assert.deepEqual(readWorkItemId("  12345  "), { id: 12345, refusal: "" });
});

test("a work-item link is read from every shape ADO writes it in", () => {
  const shapes = [
    "https://dev.azure.com/example/PACT/_workitems/edit/12345",
    "https://dev.azure.com/example/PACT/_workitems/edit/12345/",
    "https://dev.azure.com/example/PACT/_workitems/edit/12345?comment=hello",
    "https://dev.azure.com/example/PACT/_workitems/edit/12345#discussion",
    "https://example.visualstudio.com/PACT/_workitems/edit/12345",
    "https://example.visualstudio.com/DefaultCollection/PACT/_workitems/edit/12345",
    // The older link shape keeps the id in the query string.
    "https://example.visualstudio.com/PACT/_workitems?workitem=12345",
    // A link pasted without its scheme is still a link.
    "dev.azure.com/example/PACT/_workitems/edit/12345"
  ];
  shapes.forEach((shape) => {
    assert.deepEqual(readWorkItemId(shape), { id: 12345, refusal: "" }, shape);
  });
});

test("a paste that names no work item is refused with the shapes it could have been", () => {
  const refused = [
    "",
    "   ",
    "the PDF export one",
    "0",
    "#0",
    "https://dev.azure.com/example/PACT/_boards/board/t/PACT%20Team/Stories",
    "https://dev.azure.com/example/PACT/_queries/query/abc",
    "https://example.atlassian.net/browse/PACT-1",
    "https://dev.azure.com/example/PACT/_workitems/edit/twelve"
  ];
  refused.forEach((paste) => {
    const reading = readWorkItemId(paste);
    assert.equal(reading.id, 0, JSON.stringify(paste) + " was read as " + reading.id);
    assert.notEqual(reading.refusal, "", JSON.stringify(paste) + " was accepted with no refusal");
  });
  // The refusal names both accepted forms, because a reader who pasted the
  // wrong thing needs to know what the right thing looks like.
  assert.match(readWorkItemId("the PDF export one").refusal, /12345/);
  assert.match(readWorkItemId("the PDF export one").refusal, /_workitems\/edit/);
  // A host PACT does not read is refused as a host, not as prose.
  assert.match(readWorkItemId("https://example.atlassian.net/browse/PACT-1").refusal,
    /dev\.azure\.com.*visualstudio\.com/);
});

/* --- the date fields, per type ------------------------------------------- */

test("the end-date field is resolved per work-item type, and a Bug carries none", () => {
  assert.equal(schedulingFields("Epic").end, "Microsoft.VSTS.Scheduling.TargetDate");
  assert.equal(schedulingFields("Feature").end, "Microsoft.VSTS.Scheduling.TargetDate");
  assert.equal(schedulingFields("User Story").end, "Microsoft.VSTS.Scheduling.FinishDate");
  assert.equal(schedulingFields("Task").end, "Microsoft.VSTS.Scheduling.FinishDate");
  // A type with no end field is an item with no dates, not a broken read.
  assert.equal(schedulingFields("Bug").end, "");
  assert.equal(schedulingFields("").end, "");
  // The start date is one reference name on every type.
  ["Epic", "Feature", "User Story", "Task", "Bug"].forEach((type) => {
    assert.equal(schedulingFields(type).start, ADO_FIELDS.startDate);
  });
});

test("a date field's instant is read as its date part, in UTC", () => {
  assert.equal(datePart("2026-03-02T00:00:00Z"), "2026-03-02");
  assert.equal(datePart("2026-03-02T23:59:59.999Z"), "2026-03-02");
  assert.equal(datePart("2026-03-02"), "2026-03-02");
  assert.equal(datePart("2026-02-30T00:00:00Z"), "");
  assert.equal(datePart(""), "");
  assert.equal(datePart(null), "");
  assert.equal(datePart("soon"), "");
});

/* --- who the item is assigned to ----------------------------------------- */

const assignedTo = (value) => assignedIdentity({ [ADO_FIELDS.assignedTo]: value });

test("an AssignedTo is a person only when it carries an email", () => {
  assert.deepEqual(assignedTo({ displayName: "Anna Meier", uniqueName: "anna@example.com" }),
    { kind: "person", name: "Anna Meier", email: "anna@example.com" });
  // No AssignedTo at all is work nobody owns.
  assert.equal(assignedTo(undefined).kind, "unassigned");
  assert.equal(assignedTo(null).kind, "unassigned");
  assert.equal(assignedTo("").kind, "unassigned");
  // A group has a display name and no mailbox, which is what makes it a group.
  assert.deepEqual(assignedTo({ displayName: "PACT Team" }), { kind: "group", name: "PACT Team", email: "" });
  assert.deepEqual(assignedTo({ displayName: "PACT Team", uniqueName: "  " }), { kind: "group", name: "PACT Team", email: "" });
  assert.deepEqual(assignedTo("PACT Team"), { kind: "group", name: "PACT Team", email: "" });
});

test("a Person is matched by email, never by name, and archived People are not matched", () => {
  const people = [
    { id: "anna", name: "Anna Meier", email: "Anna@Example.com" },
    { id: "cara", name: "Cara Nowak" },
    { id: "gone", name: "Anna Meier", email: "anna@example.com", archived: true }
  ];
  assert.equal(personForEmail(people, "anna@example.com").id, "anna");
  assert.equal(personForEmail(people, " ANNA@example.COM ").id, "anna");
  assert.equal(personForEmail(people, "meiert, anna (ext)@example.com"), null);
  assert.equal(personForEmail(people, ""), null);
  assert.equal(personForEmail([], "anna@example.com"), null);
  // An archived Person's email does not pull work back onto them.
  assert.equal(personForEmail([{ id: "gone", email: "anna@example.com", archived: true }], "anna@example.com"), null);
});

test("the offer names the Person it would add, and says what the other way out is", () => {
  const offer = unmatchedAssigneeOffer({ name: "Anna Meier", email: "anna@example.com" });
  assert.equal(offer.kind, "create-person");
  assert.equal(offer.name, "Anna Meier");
  assert.equal(offer.email, "anna@example.com");
  assert.equal(offer.label, "Create Anna Meier and import");
  assert.match(offer.message, /anna@example\.com/);
  assert.match(offer.message, /can edit them afterwards/);
});

/* --- the parent chain, and the Project ----------------------------------- */

const epic = { id: 1000, type: "Epic", title: "Invoices" };
const feature = { id: 1001, type: "Feature", title: "PDF export" };
const story = { id: 1002, type: "User Story", title: "Export one invoice" };

test("the Project is the first ancestor at the mapped project level, and never the item", () => {
  assert.deepEqual(projectFromChain([feature, epic], "Epic"),
    { title: "Invoices", id: 1000, refusal: "" });
  // Deeper chains still find the level: the order walked is nearest-parent
  // first, so a Feature under an Epic under anything else answers the Epic.
  assert.equal(projectFromChain([story, feature, epic], "Epic").title, "Invoices");
  // At an assignment level of User Story, the Feature is the Project.
  assert.equal(projectFromChain([story, feature, epic], "Feature").title, "PDF export");
});

test("a chain that reaches no project level refuses, naming every level it walked", () => {
  const refusal = projectFromChain([story, feature], "Epic").refusal;
  assert.match(refusal, /User Story 'Export one invoice'/);
  assert.match(refusal, /Feature 'PDF export'/);
  assert.match(refusal, /none is a 'Epic'/);
  // An item with no parent at all says that instead of listing nothing.
  const parentless = projectFromChain([], "Epic").refusal;
  assert.match(parentless, /no parent/);
  assert.match(parentless, /'Epic'/);
});

test("a Project is matched by name, without case or surrounding spaces", () => {
  const projects = [
    { id: "invoices", name: "Invoices" },
    { id: "atlas", name: "Atlas" },
    { id: "old", name: "Invoices", archived: true }
  ];
  assert.equal(projectForTitle(projects, "Invoices").id, "invoices");
  assert.equal(projectForTitle(projects, "  invoices ").id, "invoices");
  assert.equal(projectForTitle(projects, "Billing"), null);
  assert.equal(projectForTitle([{ id: "old", name: "Invoices", archived: true }], "Invoices"), null);
});

test("the parent is read from the field, or from the relation when the template has none", () => {
  assert.equal(parentIdOf({ fields: { [ADO_FIELDS.parent]: 1000 } }), 1000);
  assert.equal(parentIdOf({ fields: {}, relations: [
    { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://ado/1" },
    { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/x/_apis/wit/workItems/4242" }
  ] }), 4242);
  assert.equal(parentIdOf({ fields: {} }), 0);
  assert.equal(parentIdOf(null), 0);
});

/* --- the sprint an iteration starts in ----------------------------------- */

test("an iteration's start date is found by its path, and its dates read in UTC", () => {
  const iterations = [
    { path: "PACT\\Sprint 01", attributes: { startDate: "2026-01-05T00:00:00Z", finishDate: "2026-01-18T00:00:00Z" } },
    { path: "PACT\\Sprint 02", attributes: { startDate: "2026-01-19T00:00:00Z", finishDate: "2026-02-01T00:00:00Z" } }
  ];
  assert.equal(iterationStartFor(iterations, "PACT\\Sprint 02"), "2026-01-19");
  assert.equal(iterationStartFor(iterations, "PACT\\Sprint 09"), "");
  assert.equal(iterationStartFor(iterations, ""), "");
});

test("a PACT sprint is found by containment, with both ends inclusive", () => {
  const sprints = [
    { index: 1, name: "Sprint 1", start: "2026-01-05", end: "2026-01-18" },
    { index: 2, name: "Sprint 2", start: "2026-01-19", end: "2026-02-01" }
  ];
  assert.equal(sprintForDate("2026-01-05", sprints).name, "Sprint 1");
  assert.equal(sprintForDate("2026-01-18", sprints).name, "Sprint 1");
  assert.equal(sprintForDate("2026-01-19", sprints).name, "Sprint 2");
  assert.equal(sprintForDate("2026-02-01", sprints).name, "Sprint 2");
  assert.equal(sprintForDate("2026-02-02", sprints), null);
  assert.equal(sprintForDate("2026-01-04", sprints), null);
  assert.equal(sprintForDate("", sprints), null);
});

/* --- where a block goes when ADO has no dates ---------------------------- */

const PERIOD = { start: "2026-01-01", end: "2026-12-31" };

test("the assumed month is one month from today, inside the plan period", () => {
  assert.deepEqual(assumedWindow("2026-03-15", PERIOD), { start: "2026-03-15", end: "2026-04-14" });
  // Today before the period: the block starts at the period's start and still
  // runs a month, rather than landing off-screen.
  assert.deepEqual(assumedWindow("2025-11-20", PERIOD), { start: "2026-01-01", end: "2026-01-31" });
  // Today after the period: the block ends at the period's end and reaches a
  // month back, rather than being clamped to a single day.
  assert.deepEqual(assumedWindow("2027-03-20", PERIOD), { start: "2026-12-01", end: "2026-12-31" });
  // A period too short to hold a month keeps what is left of it from today.
  assert.deepEqual(assumedWindow("2026-01-07", { start: "2026-01-05", end: "2026-01-10" }),
    { start: "2026-01-07", end: "2026-01-10" });
  // A month crossing a year end is still a month.
  assert.deepEqual(assumedWindow("2026-12-20", PERIOD), { start: "2026-12-20", end: "2026-12-31" });
});

test("ADO's own dates win, and are recorded as not assumed", () => {
  const placement = importPlacement({
    period: PERIOD,
    today: "2026-03-15",
    adoStart: "2026-02-02T00:00:00Z",
    adoEnd: "2026-02-27T00:00:00Z",
    iterationStart: "2026-01-19",
    sprints: [{ index: 2, name: "Sprint 2", start: "2026-01-19", end: "2026-02-01" }]
  });
  assert.deepEqual(placement, {
    start: "2026-02-02", end: "2026-02-27", datesAssumed: false, source: "ado", sprint: null, iterationStart: ""
  });
});

test("one date alone is not a span, so it falls through to the assumed rules", () => {
  const placement = importPlacement({
    period: PERIOD, today: "2026-03-15", adoStart: "2026-02-02T00:00:00Z", adoEnd: ""
  });
  assert.equal(placement.datesAssumed, true);
  assert.equal(placement.source, "assumed");
  assert.deepEqual({ start: placement.start, end: placement.end }, { start: "2026-03-15", end: "2026-04-14" });
});

test("an iteration inside a PACT sprint puts the block on that sprint, still assumed", () => {
  const sprints = [
    { index: 1, name: "Sprint 1", start: "2026-01-05", end: "2026-01-18" },
    { index: 2, name: "Sprint 2", start: "2026-01-19", end: "2026-02-01" }
  ];
  const placement = importPlacement({
    period: PERIOD, today: "2026-03-15", iterationStart: "2026-01-20", sprints: sprints
  });
  assert.equal(placement.source, "sprint");
  assert.equal(placement.datesAssumed, true);
  assert.deepEqual({ start: placement.start, end: placement.end }, { start: "2026-01-19", end: "2026-02-01" });
  assert.equal(placement.sprint.name, "Sprint 2");
});

test("a sprint running past the period's edge is clamped into the period", () => {
  const placement = importPlacement({
    period: { start: "2026-01-12", end: "2026-01-25" },
    today: "2026-01-13",
    iterationStart: "2026-01-10",
    sprints: [{ index: 1, name: "Sprint 1", start: "2026-01-05", end: "2026-01-18" }]
  });
  assert.equal(placement.source, "sprint");
  assert.deepEqual({ start: placement.start, end: placement.end }, { start: "2026-01-12", end: "2026-01-18" });
});

test("an iteration in no PACT sprint falls back to the assumed month and says which", () => {
  const sprints = [{ index: 1, name: "Sprint 1", start: "2026-01-05", end: "2026-01-18" }];
  const outside = importPlacement({
    period: PERIOD, today: "2026-03-15", iterationStart: "2026-02-20", sprints: sprints
  });
  assert.equal(outside.source, "assumed");
  assert.equal(outside.iterationStart, "2026-02-20");
  assert.equal(outside.sprint, null);
  // An item with no iteration at all carries no iteration date to report.
  const backlog = importPlacement({ period: PERIOD, today: "2026-03-15", sprints: sprints });
  assert.equal(backlog.source, "assumed");
  assert.equal(backlog.iterationStart, "");
  // A plan with no cadence has no chain at all, and the same fallback applies.
  const noSprints = importPlacement({ period: PERIOD, today: "2026-03-15", iterationStart: "2026-02-20" });
  assert.equal(noSprints.source, "assumed");
});

test("the sprint chain a plan derives is what the placement is matched against", () => {
  // The chain is contiguous and derived, so the placement and the grid read the
  // same sprints: a sprint that exists only in the derivation still places a
  // block.
  const cadence = { start: "2026-01-05", length: 14, namePrefix: "Sprint ", nameNumber: 1 };
  const chain = sprintsFor(cadence, null, PERIOD);
  assert.equal(chain.length > 20, true);
  const placement = importPlacement({
    period: PERIOD, today: "2026-03-15", iterationStart: "2026-01-20", sprints: chain
  });
  assert.equal(placement.source, "sprint");
  assert.deepEqual({ start: placement.start, end: placement.end },
    { start: chain[1].start, end: chain[1].end });
});

/* --- the link and its baseline ------------------------------------------- */

// The connection a row's address is built from: the same pair the settings
// store, and the same shape a plan carries in its `ado` block.
const MAPPING = {
  organizationUrl: "https://dev.azure.com/example",
  project: "PACT",
  projectLevel: "Epic",
  assignmentLevel: "Feature"
};

const LINK = {
  workItemId: 1234,
  rev: 7,
  workItemType: "Feature",
  datesAssumed: true,
  values: { title: "PDF export", personEmail: "anna@example.com", project: "Invoices", start: null, end: null, iterationPath: "PACT\\Sprint 02" }
};

test("a baseline round-trips through the plan unchanged", () => {
  const stored = normalizeLink(LINK);
  assert.deepEqual(stored, LINK);
  const plan = seedPlan();
  plan.assignments[0].link = stored;
  assert.deepEqual(validatePlan(plan), []);
  // And through a plan file and back.
  const dir = tempDir();
  const file = path.join(dir, "plan.json");
  const store = createStore(file);
  store.updateAssignment(plan.assignments[0].id, { link: stored });
  const read = createStore(file).get().assignments[0].link;
  assert.deepEqual(read, LINK);
});

test("a link refuses a credential-shaped key, in the link or inside its values", () => {
  ["token", "pat", "password", "personalAccessToken"].forEach((key) => {
    const onLink = Object.assign({}, LINK, { [key]: "a-secret" });
    assert.notDeepEqual(linkRefusals(onLink), [], "link." + key + " was stored");
    const inValues = Object.assign({}, LINK, { values: Object.assign({}, LINK.values, { [key]: "a-secret" }) });
    assert.notDeepEqual(linkRefusals(inValues), [], "link.values." + key + " was stored");
    // The refusal is the plan's, so a plan carrying one cannot load.
    const plan = seedPlan();
    plan.assignments[0].link = onLink;
    assert.notDeepEqual(validatePlan(plan), []);
  });
});

test("a malformed link is refused field by field", () => {
  const broken = [
    Object.assign({}, LINK, { workItemId: 0 }),
    Object.assign({}, LINK, { workItemId: "1234" }),
    Object.assign({}, LINK, { rev: -1 }),
    Object.assign({}, LINK, { datesAssumed: "yes" }),
    Object.assign({}, LINK, { unknownKey: "x" }),
    Object.assign({}, LINK, { values: null }),
    Object.assign({}, LINK, { values: Object.assign({}, LINK.values, { title: "" }) }),
    Object.assign({}, LINK, { values: Object.assign({}, LINK.values, { start: "next week" }) }),
    Object.assign({}, LINK, { values: Object.assign({}, LINK.values, { iterationPath: 4 }) })
  ];
  broken.forEach((link, index) => {
    assert.notDeepEqual(linkRefusals(link), [], "case " + index + " was accepted");
  });
});

test("a plan without any link, and a Person without an email, stay valid", () => {
  const plan = seedPlan();
  assert.deepEqual(validatePlan(plan), []);
  assert.equal("link" in plan.assignments[0], false);
  assert.equal("email" in plan.people[0], false);
  // An email that is not a string is refused; any string at all is fine.
  const bad = seedPlan();
  bad.people[0].email = 4;
  assert.notDeepEqual(validatePlan(bad), []);
  const good = seedPlan();
  good.people[0].email = "anna@example.com";
  assert.deepEqual(validatePlan(good), []);
});

test("the link row names the type and the id, on either kind of record", () => {
  // The row is the type and the id, and the id is the link's own text. A
  // Project's link carries no owner's email, so nothing in the row may read one.
  const assignment = linkRow(LINK, MAPPING);
  assert.equal(assignment.type, "Feature");
  assert.equal(assignment.text, "1234");
  assert.equal(linkRow(PROJECT_LINK, MAPPING).type, "Epic");
  assert.equal(linkRow(PROJECT_LINK, MAPPING).text, "2000");
  // The type is the link's own recorded name, with no lookup: a link that
  // recorded none shows the id alone rather than being called a work item.
  assert.equal(linkLabel(LINK), "1234");
  assert.equal(linkType({ workItemId: 5, rev: 1, workItemType: "  Bug " }), "Bug");
  assert.equal(linkType({ workItemId: 5, rev: 1 }), "");
  const untyped = linkRow({ workItemId: 12, rev: 1, datesAssumed: false }, MAPPING);
  assert.equal(untyped.type, "");
  assert.equal(untyped.text, "12");
});

test("the facts the row used to spell out are its hover title", () => {
  const assignment = linkRow(LINK, MAPPING);
  assert.match(assignment.title, /Feature #1234, revision 7/);
  assert.match(assignment.title, /its dates are assumed/);
  assert.match(assignment.title, /an import establishes the link/);
  assert.match(assignment.title, /does not write to ADO/);
  // A Project's link carries the type and revision it has and no assumed
  // marker, because a Project has no dates to assume.
  const project = linkRow(PROJECT_LINK, MAPPING);
  assert.match(project.title, /Epic #2000, revision 4/);
  assert.doesNotMatch(project.title, /assumed/);
  // An untyped link is a work item rather than nothing.
  assert.equal(linkFacts({ workItemId: 12, rev: 1, datesAssumed: false }), "Work item #12, revision 1.");
});

test("the row's address comes from the mapping, and is the work item's own page", () => {
  assert.equal(workItemUrl(LINK, MAPPING), "https://dev.azure.com/example/PACT/_workitems/edit/1234");
  assert.equal(workItemUrl(PROJECT_LINK, MAPPING), "https://dev.azure.com/example/PACT/_workitems/edit/2000");
  assert.equal(linkRow(LINK, MAPPING).href, "https://dev.azure.com/example/PACT/_workitems/edit/1234");
  // It is a work-item address, read back as the id it names - the same rule the
  // import's own field reads, so a link the app draws is a link it accepts.
  assert.deepEqual(readWorkItemId(linkRow(LINK, MAPPING).href), { id: 1234, refusal: "" });
  // A visualstudio.com connection keeps its own host.
  assert.equal(workItemUrl(LINK, Object.assign({}, MAPPING, {
    organizationUrl: "https://example.visualstudio.com"
  })), "https://example.visualstudio.com/PACT/_workitems/edit/1234");
  // A project name with a space in it is encoded as the mapping's URL is.
  assert.equal(workItemUrl(LINK, Object.assign({}, MAPPING, { project: "PACT Lab" })),
    "https://dev.azure.com/example/PACT%20Lab/_workitems/edit/1234");
});

test("no mapping, no address: the row reads `not linked` rather than inventing one", () => {
  const unlinked = linkRow(LINK, null);
  assert.equal(unlinked.linked, false);
  assert.equal(unlinked.href, "");
  assert.equal(unlinked.text, "not linked");
  assert.equal(unlinked.type, "");
  assert.match(unlinked.title, /an import creates the link/);
  assert.equal(workItemUrl(LINK, undefined), "");
  assert.equal(workItemUrl(LINK, {}), "");
  // A record with no link at all is the same row, whatever the mapping says.
  const none = linkRow(undefined, MAPPING);
  assert.equal(none.linked, false);
  assert.equal(none.text, "not linked");
  assert.equal(linkRow(null, MAPPING).text, "not linked");
});

/* --- one write, one undo -------------------------------------------------- */

test("importing an Assignment and its Person lands as one write and one undo", () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "plan.json"));
  const plan = store.get();
  const peopleBefore = plan.people.length;
  const assignmentsBefore = plan.assignments.length;
  assert.equal(store.canUndo(), false);

  const start = isoPlus(plan.range.start, 30);
  const saved = store.importAssignment({
    person: { name: "Dana Voss", email: "dana@example.com", availability: 100 },
    assignment: {
      projectId: "atlas",
      start: start,
      end: isoPlus(start, 25),
      share: 10,
      name: "PDF export",
      tags: [],
      note: "",
      link: LINK
    }
  });
  assert.ok(saved.person && saved.person.id);
  assert.equal(saved.assignment.personId, saved.person.id);
  assert.equal(store.get().people.length, peopleBefore + 1);
  assert.equal(store.get().assignments.length, assignmentsBefore + 1);
  // One step: the Person and the Assignment are one change, so one Undo takes
  // both away and leaves nothing of the import behind.
  assert.equal(store.historyDepth().undo, 1);
  store.undo();
  assert.equal(store.get().people.length, peopleBefore);
  assert.equal(store.get().assignments.length, assignmentsBefore);
});

test("a refused import writes nothing at all, and records no history", () => {
  const dir = tempDir();
  const file = path.join(dir, "plan.json");
  const store = createStore(file);
  const before = store.get();
  const textBefore = String(fs.readFileSync(file, "utf8"));
  assert.throws(() => store.importAssignment({
    person: { name: "Dana Voss", email: "dana@example.com", availability: 100 },
    // A Project that does not exist: the whole commit is refused, so the Person
    // it would have created is not left on the plan either.
    assignment: {
      projectId: "no-such-project",
      start: isoPlus(before.range.start, 30),
      end: isoPlus(before.range.start, 55),
      share: 10,
      link: LINK
    }
  }));
  assert.deepEqual(store.get(), before);
  assert.equal(String(fs.readFileSync(file, "utf8")), textBefore);
  assert.equal(store.canUndo(), false);
});

/* --- what a finished import says ----------------------------------------- */

const FACTS = {
  workItemId: 1234,
  workItemType: "Feature",
  assignmentName: "PDF export",
  person: { name: "Anna Meier", email: "anna@example.com", created: false },
  projectName: "Invoices",
  start: "2026-02-02",
  end: "2026-02-27",
  datesAssumed: false,
  source: "ado",
  iterationStart: "",
  sprint: null
};

test("the import's line states what it made and which date rule placed it", () => {
  const ado = importLine(FACTS);
  assert.match(ado, /Imported Feature #1234 as "PDF export": Anna Meier on Invoices, 2026-02-02 to 2026-02-27\./);
  assert.match(ado, /The dates are the work item's own\./);
  assert.doesNotMatch(ado, /assumed/);

  const sprint = importLine(Object.assign({}, FACTS, {
    datesAssumed: true,
    source: "sprint",
    sprint: { index: 2, name: "Sprint 2", start: "2026-01-19", end: "2026-02-01" },
    start: "2026-01-19",
    end: "2026-02-01"
  }));
  assert.match(sprint, /dates are assumed/);
  assert.match(sprint, /sits at Sprint 2 \(2026-01-19 to 2026-02-01\)/);

  const outside = importLine(Object.assign({}, FACTS, {
    datesAssumed: true, source: "assumed", iterationStart: "2026-02-20"
  }));
  assert.match(outside, /its iteration starts on 2026-02-20, which is in no PACT sprint/);

  const backlog = importLine(Object.assign({}, FACTS, { datesAssumed: true, source: "assumed" }));
  assert.match(backlog, /one month long/);

  const created = importLine(Object.assign({}, FACTS, {
    person: { name: "Dana Voss", email: "dana@example.com", created: true }
  }));
  assert.match(created, /Dana Voss was added as a Person with dana@example\.com/);
});

/* --- which level the item is -------------------------------------------- */

const RANKS = [
  { name: "Epic", rank: 4 },
  { name: "Feature", rank: 3 },
  { name: "User Story", rank: 2 },
  { name: "Task", rank: 1 }
];
const LEVELS = { projectLevel: "Epic", assignmentLevel: "Feature" };

test("the item's own level against the mapping decides what it becomes", () => {
  // The type the mapping draws Projects from is the item's own type at the
  // project level - no parent walk, and no owner.
  assert.equal(importLevel(RANKS, LEVELS, "Epic"), "project");
  // The type mapping as the assignment level, and a level between it and the
  // project's, keep the assignment path.
  assert.equal(importLevel(RANKS, LEVELS, "Feature"), "assignment");
  assert.equal(importLevel(RANKS, Object.assign({}, LEVELS, { assignmentLevel: "User Story" }), "Feature"),
    "assignment");
  // Below the assignment level is a refusal, decided by the ranks.
  assert.equal(importLevel(RANKS, Object.assign({}, LEVELS, { assignmentLevel: "User Story" }), "Task"),
    "below");
  // The tag slot's own type is a refusal whatever its rank.
  assert.equal(importLevel(RANKS, Object.assign({}, LEVELS, { tagLevel: "Task" }), "Task"), "tag");
  // Ranks the instance never answered leave an unnamed type where it has always
  // been: an import must not refuse work for want of a rank.
  assert.equal(importLevel([], LEVELS, "Task"), "assignment");
  assert.equal(importLevel(null, LEVELS, "Bug"), "assignment");
  // A type with no name at all is not a level.
  assert.equal(importLevel(RANKS, LEVELS, ""), "assignment");
});

test("a tag-level and a below-assignment refusal each name what that level is for", () => {
  const facts = {
    workItemId: 2000,
    title: "Login is slow",
    workItemType: "Bug",
    mapping: LEVELS
  };
  const tag = importLevelRefusal("tag", facts);
  assert.match(tag, /Work item 2000 \("Login is slow"\) is Bug/);
  assert.match(tag, /a tag has no record of its own/);
  assert.match(tag, /Epic/);
  assert.match(tag, /Feature/);

  const below = importLevelRefusal("below", Object.assign({}, facts, { workItemType: "Task" }));
  assert.match(below, /is Task/);
  assert.match(below, /below the level that carries a person's time/);
  assert.match(below, /Feature/);
  // Neither blames the owner: there is no owner to blame at these levels.
  [tag, below].forEach((text) => assert.doesNotMatch(text, /assigned to anybody|owner/));
});

/* --- the offer a matching name makes ------------------------------------ */

test("a matching name offers the existing Project and a copy, both named in full", () => {
  const offer = existingProjectOffer({ id: "invoices", name: "Invoices" }, "Invoices (copy)");
  assert.equal(offer.kind, "use-project");
  assert.equal(offer.projectId, "invoices");
  assert.equal(offer.name, "Invoices");
  assert.equal(offer.label, "Use \"Invoices\"");
  assert.equal(offer.altLabel, "Import as a copy");
  assert.equal(offer.copyName, "Invoices (copy)");
  assert.match(offer.message, /already has a live Project named "Invoices"/);
  assert.match(offer.message, /Using it stores the item's link on that Project and creates nothing/);
  assert.match(offer.message, /"Invoices \(copy\)"/);
});

test("the project import's line says whether a Project was created or linked, and names no person", () => {
  const created = projectImportLine({
    created: true, workItemId: 2000, workItemType: "Epic", projectName: "Super Epic Project"
  });
  assert.match(created, /Imported Epic #2000 as the new Project "Super Epic Project"/);
  assert.match(created, /its link and baseline are stored on the Project/);

  const linked = projectImportLine({
    created: false, workItemId: 2000, workItemType: "Epic", projectName: "Super Epic Project"
  });
  assert.equal(linked, "Linked Epic #2000 to the existing Project \"Super Epic Project\": nothing was created.");

  [created, linked].forEach((text) => {
    assert.doesNotMatch(text, /[Pp]erson|owner|assigned/);
  });
});

/* --- the link's second home --------------------------------------------- */

const PROJECT_LINK = {
  workItemId: 2000,
  rev: 4,
  workItemType: "Epic",
  datesAssumed: false,
  values: { title: "Super Epic Project", project: "Super Epic Project", start: null, end: null, iterationPath: null }
};

test("a Project's link is the same rule as an Assignment's, without an owner's email", () => {
  assert.deepEqual(linkRefusals(PROJECT_LINK, "project"), []);
  // Normalised, it stays exactly that: no empty email field is invented.
  assert.deepEqual(normalizeLink(PROJECT_LINK, "project"), PROJECT_LINK);
  // An Assignment's link still needs the email; a Project's may carry one but
  // never a blank one.
  assert.notDeepEqual(linkRefusals(PROJECT_LINK), []);
  assert.notDeepEqual(linkRefusals({
    workItemId: 1, rev: 1, datesAssumed: false,
    values: { title: "X", project: "X", personEmail: "  ", start: null, end: null, iterationPath: null }
  }, "project"), []);
  // The credential refusal is the same one, in the link and inside its values.
  ["token", "pat", "password"].forEach((key) => {
    assert.notDeepEqual(linkRefusals(Object.assign({}, PROJECT_LINK, { [key]: "a-secret" }), "project"), []);
    assert.notDeepEqual(linkRefusals(Object.assign({}, PROJECT_LINK, {
      values: Object.assign({}, PROJECT_LINK.values, { [key]: "a-secret" })
    }), "project"), []);
  });
});

test("validatePlan accepts a link on a Project, and refuses one on a Person or a Milestone", () => {
  const plan = seedPlan();
  assert.deepEqual(validatePlan(plan), []);
  plan.projects[0].link = PROJECT_LINK;
  assert.deepEqual(validatePlan(plan), []);

  const broken = seedPlan();
  broken.projects[0].link = Object.assign({}, PROJECT_LINK, { token: "a-secret" });
  assert.notDeepEqual(validatePlan(broken), []);

  const onPerson = seedPlan();
  onPerson.people[0].link = PROJECT_LINK;
  assert.notDeepEqual(validatePlan(onPerson), []);

  const onMilestone = seedPlan();
  onMilestone.milestones = [{ id: "m1", name: "Release", date: "2026-06-01", colour: 1, tags: [] }];
  assert.deepEqual(validatePlan(onMilestone), []);
  onMilestone.milestones[0].link = PROJECT_LINK;
  assert.notDeepEqual(validatePlan(onMilestone), []);
});

/* --- the project-level writes ------------------------------------------- */

test("a Project created by an import and its link are one write and one undo", () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "plan.json"));
  const before = store.get();
  const created = store.importProject({
    project: { name: "Super Epic Project", notes: "", tags: [] },
    link: PROJECT_LINK
  });
  // The least-used colour, as any new Project takes when nobody names one.
  assert.equal(created.colour, leastUsedSlot(before.projects));
  assert.deepEqual(created.link, PROJECT_LINK);
  assert.equal(store.get().projects.length, before.projects.length + 1);
  assert.equal(store.historyDepth().undo, 1);
  store.undo();
  assert.deepEqual(store.get(), before);
});

test("using an existing Project stores the link on it as its own write", () => {
  const dir = tempDir();
  const store = createStore(path.join(dir, "plan.json"));
  const target = store.get().projects[0];
  const countBefore = store.get().projects.length;
  const linked = store.linkProject({ projectId: target.id, link: PROJECT_LINK });
  assert.equal(linked.id, target.id);
  assert.deepEqual(linked.link, PROJECT_LINK);
  assert.equal(store.get().projects.length, countBefore, "linking created a Project");
  assert.deepEqual(store.get().projects.filter((project) => project.id === target.id)[0], linked);
  assert.equal(store.historyDepth().undo, 1);
  store.undo();
  assert.equal("link" in store.get().projects.filter((project) => project.id === target.id)[0], false);
});

test("a Project write carrying a credential-shaped link is refused and writes nothing", () => {
  const dir = tempDir();
  const file = path.join(dir, "plan.json");
  const store = createStore(file);
  const before = store.get();
  const textBefore = String(fs.readFileSync(file, "utf8"));
  assert.throws(() => store.importProject({
    project: { name: "Super Epic Project", notes: "", tags: [] },
    link: Object.assign({}, PROJECT_LINK, { token: "a-secret" })
  }));
  assert.throws(() => store.linkProject({
    projectId: before.projects[0].id,
    link: Object.assign({}, PROJECT_LINK, { token: "a-secret" })
  }));
  assert.deepEqual(store.get(), before);
  assert.equal(String(fs.readFileSync(file, "utf8")), textBefore);
  assert.equal(store.canUndo(), false);
});
