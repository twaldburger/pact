/*
 * PACT's Azure DevOps connection: the mapping a plan carries, and the rules
 * around the token that never leaves the server. Plain rules and no imports,
 * so the store's validation, the server's ADO calls and the panel word the
 * same refusal the same way - and `node --test` reads the same source the
 * browser does.
 *
 * Nothing here makes a network call or reads a secret. The plan's block holds
 * two addresses and three type names, and a credential is refused rather than
 * stored; the token itself lives in the app's own config directory and is only
 * ever handled by lib/ado.mjs on the server.
 */

// What a token file holds before a real token is pasted into it. A file still
// holding this reads as no token at all, rather than as one ADO will reject.
export const ADO_PLACEHOLDER = "PASTE_YOUR_AZURE_DEVOPS_PAT_HERE";

// The block the plan carries, exactly these keys. The first two are the
// address, the rest are ADO work-item type names.
export const ADO_ADDRESS_KEYS = ["organizationUrl", "project"];
export const ADO_LEVEL_SLOTS = ["projectLevel", "assignmentLevel", "tagLevel"];
export const ADO_KEYS = ADO_ADDRESS_KEYS.concat(ADO_LEVEL_SLOTS);

// A key shaped like a secret. A plan is a file people share, so one of these
// inside the block is refused by name rather than quietly stored.
const CREDENTIAL_KEYS = [
  "token",
  "pat",
  "password",
  "passwd",
  "secret",
  "credential",
  "credentials",
  "accesstoken",
  "apitoken",
  "personalaccesstoken",
  "clientsecret"
];

export function isCredentialKey(key) {
  return CREDENTIAL_KEYS.includes(String(key).trim().toLowerCase());
}

// An organisation's address as it is stored: trimmed, with no trailing slash,
// so one address has one spelling in a file people compare.
export function trimOrganizationUrl(value) {
  return String(value === undefined || value === null ? "" : value).trim().replace(/\/+$/, "");
}

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/*
 * The address pair: what the panel's two text fields hold and what a test
 * connection needs before it can call anything. Returns the refusals as plain
 * sentences, or an empty array when the addresses may be used.
 */
export function addressRefusals(input) {
  const block = input || {};
  const errors = [];
  if (!isNonEmptyText(block.organizationUrl)) {
    errors.push("The organisation address is required, as https://dev.azure.com/<organisation>.");
  } else if (!/^https?:\/\/[^\s/]+/i.test(trimOrganizationUrl(block.organizationUrl))) {
    errors.push("The organisation address must start http:// or https://.");
  }
  if (!isNonEmptyText(block.project)) errors.push("The ADO project name is required.");
  return errors;
}

/*
 * The plan's `ado` block, checked for shape. Optional in a plan: a plan without
 * one is a plan without a connection. What this cannot check is the type names'
 * ranks, which only the instance knows - `mappingRefusal` does that against
 * what a test connection read.
 */
export function adoRefusals(block) {
  if (!block || typeof block !== "object" || Array.isArray(block)) return ["ado must be an object"];
  const errors = [];
  Object.keys(block).forEach(function (key) {
    if (isCredentialKey(key)) {
      errors.push("ado must never carry a credential: remove ado." + key +
        " - the token belongs in the app's own config, never in the plan");
    } else if (!ADO_KEYS.includes(key)) {
      errors.push("ado has an unknown field '" + key + "'");
    }
  });
  addressRefusals(block).forEach(function (message) { errors.push(message); });
  ["projectLevel", "assignmentLevel"].forEach(function (slot) {
    if (!isNonEmptyText(block[slot])) errors.push("ado." + slot + " must be a work-item type name");
  });
  if (block.tagLevel !== undefined && block.tagLevel !== null && !isNonEmptyText(block.tagLevel)) {
    errors.push("ado.tagLevel must be a work-item type name when it is given");
  }
  return errors;
}

// The block as it is stored: the address trimmed, the type names trimmed, and
// an unset tag level left out rather than stored as null.
export function normalizeAdo(block) {
  const mapping = {
    organizationUrl: trimOrganizationUrl(block.organizationUrl),
    project: String(block.project).trim(),
    projectLevel: String(block.projectLevel).trim(),
    assignmentLevel: String(block.assignmentLevel).trim()
  };
  const tag = block.tagLevel === undefined || block.tagLevel === null ? "" : String(block.tagLevel).trim();
  if (tag !== "") mapping.tagLevel = tag;
  return mapping;
}

/*
 * The instance's own backlog levels, from `GET .../_apis/work/backlogs`: one
 * number per work-item type, higher meaning a higher level, which is the whole
 * rule the mapping's slots are checked by. A type listed on two levels keeps
 * its highest rank, and a level without a usable rank adds none.
 */
export function typeRanks(backlogs) {
  const levels = Array.isArray(backlogs && backlogs.value) ? backlogs.value : [];
  const found = new Map();
  levels.forEach(function (level) {
    const rank = Number(level && level.rank);
    if (!Number.isFinite(rank)) return;
    const types = Array.isArray(level.workItemTypes) ? level.workItemTypes : [];
    types.forEach(function (type) {
      const name = type && isNonEmptyText(type.name) ? type.name.trim() : "";
      if (!name) return;
      if (!found.has(name) || found.get(name) < rank) found.set(name, rank);
    });
  });
  return Array.from(found, function (entry) { return { name: entry[0], rank: entry[1] }; })
    .sort(function (a, b) { return b.rank - a.rank || a.name.localeCompare(b.name); });
}

// The type names `GET .../_apis/wit/workitemtypes` reports, in the order it
// reports them. The tag slot may be any of these, ranked or not.
export function reportedTypes(types) {
  const list = Array.isArray(types && types.value) ? types.value : [];
  return list
    .map(function (type) { return isNonEmptyText(type && type.name) ? type.name.trim() : ""; })
    .filter(function (name) { return name !== ""; });
}

export function levelRank(ranks, name) {
  const found = (ranks || []).filter(function (type) { return type && type.name === name; })[0];
  return found ? found.rank : null;
}

/*
 * The one rule the slots are checked by, against what the instance reported:
 * the Project slot must sit on a higher backlog level than the Assignment
 * slot, and the Tag slot, when it is set, must be a type the instance reports.
 * The refusal names both ranks, because "not allowed" alone leaves a reader
 * guessing which of the two to change.
 */
export function mappingRefusal(mapping, instance) {
  const ranks = (instance && instance.ranks) || [];
  const reported = (instance && instance.reported) || [];
  const projectRank = levelRank(ranks, mapping.projectLevel);
  if (projectRank === null) {
    return "This instance gives no backlog level to the project type '" + mapping.projectLevel +
      "'; choose a type the instance ranks.";
  }
  const assignmentRank = levelRank(ranks, mapping.assignmentLevel);
  if (assignmentRank === null) {
    return "This instance gives no backlog level to the assignment type '" + mapping.assignmentLevel +
      "'; choose a type the instance ranks.";
  }
  if (projectRank <= assignmentRank) {
    return "The project type '" + mapping.projectLevel + "' (rank " + projectRank +
      ") must be a higher level than the assignment type '" + mapping.assignmentLevel +
      "' (rank " + assignmentRank + ").";
  }
  if (mapping.tagLevel && !reported.includes(mapping.tagLevel)) {
    return "This instance does not report a type called '" + mapping.tagLevel + "' for the tag slot.";
  }
  return null;
}

/*
 * Where the token file lives when the config names no other path. PACT runs on
 * Windows as well as on Linux and macOS, so this is a platform branch rather
 * than one literal: the per-user config directory on POSIX, the local
 * application data directory on Windows. It is never %APPDATA% - roaming
 * follows a person onto other machines and a domain server, and a personal
 * access token must not travel that way.
 *
 * Platform and environment are arguments so the Windows branch can be tested
 * from Linux by stubbing them; `process.platform` and `process.env` are only
 * the defaults.
 */
export function defaultTokenFile(platform, env, home) {
  const environment = env || {};
  const windows = String(platform || "").toLowerCase().startsWith("win");
  if (windows) {
    const local = environment.LOCALAPPDATA || environment.localappdata || "";
    const base = local.trim() !== ""
      ? local.trim()
      : String(home || environment.USERPROFILE || "") + "\\AppData\\Local";
    return trimWindows(base) + "\\pact\\ado-pat";
  }
  const xdg = environment.XDG_CONFIG_HOME || environment.xdg_config_home || "";
  const base = xdg.trim() !== "" ? xdg.trim() : String(home || environment.HOME || "") + "/.config";
  return trimPosix(base) + "/pact/ado-pat";
}

function trimPosix(base) {
  return String(base).replace(/\/+$/, "");
}

function trimWindows(base) {
  return String(base).replace(/[\\/]+$/, "");
}

/*
 * What a set or unset token reads as, in the panel and in a refusal. The path
 * is the server's resolved one; the token itself is never part of a sentence.
 */
export function tokenNotice(token) {
  const state = token || {};
  const where = state.path || "~/.config/pact/ado-pat";
  if (state.present) return "A personal access token is set at " + where + ".";
  if (state.placeholder) {
    return "No token is set: the file at " + where + " still holds the placeholder text. " +
      "Type a real token below and save it.";
  }
  return "No token is set. Type a personal access token below and save it; PACT writes it to " +
    where + " with mode 600.";
}

// The refusal a call gets when it needs a token and there is none.
export function noTokenMessage(token) {
  const state = token || {};
  return "No token is set. Save a personal access token in the ADO panel; PACT writes it to " +
    (state.path || "~/.config/pact/ado-pat") + " with mode 600.";
}
