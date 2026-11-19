/*
 * PACT milestone related projects: what the Milestone form offers when a
 * Milestone is linked to Projects, how that choice reads as one summary line,
 * and how a search narrows the list.
 *
 * A Milestone relates to none, one or many Projects, and the stored list of
 * ids is the plan's own shape. The form used to draw every Project as its own
 * checkbox inside the row, which ran a plan with many Projects past the
 * dialog's footer (#210); these rules decide what a bounded, searchable list
 * holds instead. A plain ES module importing only `workdays.mjs` for the
 * absence rule, so the browser (public/app.js) and `node --test` read exactly
 * the same source. Every rule here is pure.
 */
import { absenceProjectIds } from "./workdays.mjs";

// What a chosen id the list does not offer is labelled with. The id is still
// in the Milestone's stored list, so it is listed rather than dropped - an
// unrelated edit must never silently unlink a Milestone - and it can be
// unticked from here.
export const NOT_IN_VIEW = " \u00b7 not in this view";

/*
 * The choices one Milestone's control offers: every Project the plan holds, in
 * plan order, except its absence Projects, followed by any id the Milestone
 * stores that the list does not offer.
 *
 * An absence Project carries time off rather than delivery, so a delivery is
 * not something it relates to. That is `absenceProjectIds` - the rule the
 * working-day count, the Filter and the report already read - rather than a
 * hand test of the flag here.
 *
 * A stored id with no offered Project - one deleted since, or an archived
 * Project while Show archived is off - joins the list under `NOT_IN_VIEW`, so
 * the link stays visible and can be unticked rather than being kept alive by
 * the form with no way to reach it. An absence Project the Milestone already
 * names is listed the same way: not offered, but still there to untick.
 */
export function milestoneProjectChoices(plan, chosenIds) {
  const absence = absenceProjectIds(plan);
  const held = new Map();
  ((plan && Array.isArray(plan.projects) ? plan.projects : [])).forEach(function (project) {
    if (!project || typeof project.id !== "string" || held.has(project.id)) return;
    held.set(project.id, project);
  });

  const choices = [];
  const offered = new Set();
  held.forEach(function (project, id) {
    if (absence.has(id)) return;
    const name = typeof project.name === "string" ? project.name : id;
    offered.add(id);
    choices.push({ id: id, name: name, label: name, offered: true });
  });

  const added = new Set();
  (Array.isArray(chosenIds) ? chosenIds : []).forEach(function (id) {
    if (typeof id !== "string" || offered.has(id) || added.has(id)) return;
    added.add(id);
    const project = held.get(id);
    const name = project && typeof project.name === "string" ? project.name : id;
    choices.push({ id: id, name: name, label: name + NOT_IN_VIEW, offered: false });
  });
  return choices;
}

/*
 * The choices a search keeps: a case-insensitive substring of each Project's
 * name, which for an id the plan no longer holds is the id itself. An empty
 * search keeps everything, so the list is whole when the control opens.
 */
export function filterProjectChoices(choices, query) {
  const list = Array.isArray(choices) ? choices : [];
  const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!needle) return list.slice();
  return list.filter(function (choice) {
    return !!choice && typeof choice.name === "string" && choice.name.toLowerCase().indexOf(needle) !== -1;
  });
}

/*
 * The control's own line in the form: `No projects`, the one Project's name,
 * or the first name and a count of the rest (`Atlas, +2`), read in the order
 * the Milestone stores its ids - the order the edit saves them back in. A name
 * the list does not hold reads as the id, so a stale link is never silent.
 */
export function projectPickerSummary(choices, chosenIds) {
  const byId = new Map();
  (Array.isArray(choices) ? choices : []).forEach(function (choice) {
    if (choice && !byId.has(choice.id)) byId.set(choice.id, choice);
  });
  const names = [];
  const seen = new Set();
  (Array.isArray(chosenIds) ? chosenIds : []).forEach(function (id) {
    if (typeof id !== "string" || seen.has(id)) return;
    seen.add(id);
    const choice = byId.get(id);
    names.push(choice && typeof choice.name === "string" ? choice.name : id);
  });
  if (!names.length) return "No projects";
  if (names.length === 1) return names[0];
  return names[0] + ", +" + (names.length - 1);
}
