/*
 * PACT archive visibility: what the interface may draw for a given state of
 * the Show archived toggle. A pure rule with no imports, so the server (which
 * filters /api/plan), the browser (public/app.js) and `node --test` all read
 * exactly the same source.
 *
 * The rule for the whole plan: with the toggle off, an archived record of any
 * kind - Person, Project or Assignment - is never drawn; with it on, archived
 * records appear alongside the live ones, marked, so they can be restored.
 * Either way an Assignment is only drawn when its Person and its Project are
 * themselves drawn, so archiving a Person takes their work off the grid with
 * them rather than leaving blocks behind.
 */

export function planQuery(showArchived) {
  return "/api/plan" + (showArchived ? "?archived=1" : "");
}

export function visiblePeople(plan, showArchived) {
  return plan.people.filter(function (person) {
    return showArchived || !person.archived;
  });
}

export function visibleProjects(plan, showArchived) {
  return plan.projects.filter(function (project) {
    return showArchived || !project.archived;
  });
}

export function visibleAssignments(plan, people, projects, showArchived) {
  var personIds = new Set(people.map(function (p) { return p.id; }));
  var projectIds = new Set(projects.map(function (p) { return p.id; }));
  return plan.assignments.filter(function (assignment) {
    if (!showArchived && assignment.archived) return false;
    return personIds.has(assignment.personId) && projectIds.has(assignment.projectId);
  });
}

export function visiblePlan(plan, showArchived) {
  var people = visiblePeople(plan, showArchived);
  var projects = visibleProjects(plan, showArchived);
  return {
    people: people,
    projects: projects,
    assignments: visibleAssignments(plan, people, projects, showArchived)
  };
}
