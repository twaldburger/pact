import test from "node:test";
import assert from "node:assert/strict";
import { milestoneProjects } from "../public/lib/milestones.mjs";

const projects = [
  { id: "atlas", name: "Atlas" },
  { id: "borealis", name: "Borealis" },
  { id: "atlas-archived", name: "Atlas archive", archived: true }
];

test("a milestone resolves the projects it relates to, in the order it names them", () => {
  const milestone = { id: "launch", projectIds: ["borealis", "atlas"] };
  assert.deepEqual(milestoneProjects(milestone, projects).map((p) => p.name), ["Borealis", "Atlas"]);
});

test("a milestone relating to no project resolves to none", () => {
  assert.deepEqual(milestoneProjects({ id: "launch", projectIds: [] }, projects), []);
  assert.deepEqual(milestoneProjects({ id: "launch" }, projects), []);
  assert.deepEqual(milestoneProjects(null, projects), []);
  assert.deepEqual(milestoneProjects({ projectIds: ["atlas"] }, undefined), []);
});

test("an id that no longer names a project resolves to nothing, and the others still resolve", () => {
  // A deleted project's id is kept in the plan; it is not a link here.
  const stale = { id: "launch", projectIds: ["atlas", "deleted-project"] };
  assert.deepEqual(milestoneProjects(stale, projects).map((p) => p.id), ["atlas"]);
  // A milestone naming only gone projects reads as one that relates to none.
  const gone = { id: "launch", projectIds: ["deleted-project"] };
  assert.deepEqual(milestoneProjects(gone, projects), []);
});

test("a repeated id is one link, and an archived project still resolves", () => {
  // An archived project is still in the plan; whether it is drawn is the
  // visibility rule's question, not this one's.
  const milestone = { id: "launch", projectIds: ["atlas", "atlas", "atlas-archived"] };
  assert.deepEqual(milestoneProjects(milestone, projects).map((p) => p.id), ["atlas", "atlas-archived"]);
});
