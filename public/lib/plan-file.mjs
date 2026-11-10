/*
 * PACT plan-file rules: how a typed path is read, where a new plan's name is
 * offered, and how the Options menu and its panel describe the active file.
 * Pure and browser-safe, so the server (server.mjs) and the interface
 * (public/app.js) resolve a path the same way, and `node --test` reads the same
 * source without a browser.
 */

// The suffix a plan is offered under. A plain .json may still be opened, but a
// new plan is created with this.
export const PLAN_SUFFIX = ".pact.json";

/*
 * Expand a leading `~` to the given home directory. Only `~` and `~/...` are
 * expanded; anything else is returned trimmed and untouched.
 */
export function expandHome(value, home) {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return home + raw.slice(1);
  return raw;
}

/*
 * Collapse an absolute path to a canonical form: one separator between names,
 * no trailing separator, and no `.` or `..` segments. A `..` above the root is
 * dropped rather than escaping it.
 */
export function normalizeAbsolute(value) {
  const out = [];
  String(value).split("/").forEach((part) => {
    if (part === "" || part === ".") return;
    if (part === "..") {
      out.pop();
      return;
    }
    out.push(part);
  });
  return "/" + out.join("/");
}

/*
 * Resolve the path typed in the panel. A plan is stored absolute and resolved:
 * `~` is accepted and expanded, and nothing is looked up relative to a working
 * directory. Returns `{ path }` on success or `{ error }` with the plain reason.
 */
export function resolvePlanPath(value, home) {
  const expanded = expandHome(value, home);
  if (expanded === "") return { error: "Enter the path to a plan file." };
  if (!expanded.startsWith("/")) {
    return { error: "Enter an absolute path; PACT does not resolve paths relative to anything." };
  }
  return { path: normalizeAbsolute(expanded) };
}

/*
 * The name a new plan is offered under: `foo` and `foo.json` both become
 * `foo.pact.json`, and a name already ending in `.pact.json` is left as it is.
 */
export function withPlanSuffix(value) {
  const raw = String(value === undefined || value === null ? "" : value);
  if (raw.endsWith(PLAN_SUFFIX)) return raw;
  if (raw.endsWith(".json")) return raw.slice(0, -".json".length) + PLAN_SUFFIX;
  return raw + PLAN_SUFFIX;
}

export function planFileName(value) {
  const raw = String(value === undefined || value === null ? "" : value);
  const slash = raw.lastIndexOf("/");
  return slash === -1 ? raw : raw.slice(slash + 1);
}

/*
 * The Plan file entry in the Options menu. Like Sprints it is an action, not a
 * checked toggle; its detail names the file, or says PACT_DATA fixes it.
 */
export function planFileItem(state) {
  const st = state || {};
  return {
    key: "plan-file",
    label: "Plan file...",
    detail: st.locked ? "PACT_DATA" : planFileName(st.path)
  };
}

/*
 * What the panel shows for a loaded plan-file state. `locked` states that
 * PACT_DATA is in force, so the choice belongs to the run and not to the panel,
 * and `notice` is a one-time report such as the default file's move.
 */
export function planFileView(state) {
  const st = state || {};
  const locked = st.locked === true;
  return {
    path: st.path || "",
    locked: locked,
    notice: st.notice || "",
    lockMessage: locked
      ? "PACT_DATA is set, so this plan file is fixed for this run. Unset PACT_DATA and restart PACT to choose another."
      : ""
  };
}
