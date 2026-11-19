/*
 * PACT milestones: the dated points a plan marks - a delivery, a deployment, a
 * deadline - each with a name, one date, a palette slot, its own tags, notes
 * and the Projects it relates to.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` read exactly the same source. Every rule here is pure.
 */

/*
 * The Projects a Milestone relates to, as the plan's own objects, in the order
 * the Milestone names them and with repeats dropped.
 *
 * An id that no longer matches a Project resolves to nothing here rather than
 * refusing the plan: deleting a Project leaves its id behind, and a Milestone
 * is annotation, not a reference, so a stale link must never stop a plan from
 * loading. The id stays in the plan file, which is what lets undoing that
 * delete bring the link back with the Project; the panel shows it by its id so
 * it can be unticked rather than dropped by an unrelated edit. A Milestone
 * left with no resolvable link reads as one that relates to no Project.
 */
export function milestoneProjects(milestone, projects) {
  const byId = new Map();
  (Array.isArray(projects) ? projects : []).forEach(function (project) {
    if (project && typeof project.id === "string") byId.set(project.id, project);
  });
  const ids = milestone && Array.isArray(milestone.projectIds) ? milestone.projectIds : [];
  const seen = new Set();
  const out = [];
  ids.forEach(function (id) {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    out.push(byId.get(id));
  });
  return out;
}
