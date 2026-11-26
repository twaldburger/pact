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
 * One URL in, the address pair out.
 *
 * The panel asks for a URL because that is what a person has to hand - the
 * browser bar, or a work item pasted out of a chat - while the plan stores the
 * two things every API call needs. Asking a person to cut their own URL into
 * two fields is where a wrong split fails at the worst moment: after a round
 * trip to ADO, in Test connection, rather than at the paste.
 *
 * The forms, all of them real:
 *
 *   https://dev.azure.com/{org}/{project}
 *   https://dev.azure.com/{org}                         (no project yet)
 *   https://{org}.visualstudio.com/{project}
 *   https://{org}.visualstudio.com/DefaultCollection/{project}
 *   https://dev.azure.com/{org}/{project}/_workitems/edit/{id}
 *
 * and the same deep links under a board. The project is a path segment and
 * never `_workitems` or `_boards`; a query string, a fragment and a trailing
 * slash are dropped; `%20`-style encoding is decoded, so `PACT%20Lab` is the
 * project `PACT Lab`. A host that is neither dev.azure.com nor
 * {org}.visualstudio.com is refused rather than coerced into one.
 *
 * A URL carrying no project is not an error: the organisation is read and the
 * project comes back empty, which `addressFromUrl` refuses - the panel asks for
 * one URL, so the project has to be in it.
 */
export const ADO_URL_SHAPES =
  "Paste https://dev.azure.com/<organisation>, https://dev.azure.com/<organisation>/<project>, " +
  "https://<organisation>.visualstudio.com/<project>, " +
  "https://<organisation>.visualstudio.com/DefaultCollection/<project>, " +
  "or a work item or board link below one of them.";

const DEV_AZURE_HOST = "dev.azure.com";
const VISUAL_STUDIO_SUFFIX = ".visualstudio.com";
const COLLECTION_SEGMENT = "defaultcollection";
// An organisation's name is a DNS label: ADO uses it as one.
const ORGANISATION_NAME = /^[a-z0-9][a-z0-9-]*$/i;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

// What a failed read answers: no address, and the refusal with the shapes it
// would have accepted named, because "invalid URL" alone leaves a reader stuck.
function unreadable(reason) {
  return { organizationUrl: "", organization: "", project: "", refusal: reason + " " + ADO_URL_SHAPES };
}

function readable(organizationUrl, organization, project) {
  return { organizationUrl: organizationUrl, organization: organization, project: project, refusal: "" };
}

// A path as its segments, empty ones dropped, each one decoded: a project's
// name may be percent-encoded, and `PACT%20Lab` is `PACT Lab`.
function pathSegments(pathname) {
  return String(pathname || "")
    .split("/")
    .filter(function (segment) { return segment !== ""; })
    .map(function (segment) {
      try {
        return decodeURIComponent(segment);
      } catch (_) {
        return segment;
      }
    });
}

// The project a path names: the first segment that is not ADO's own page
// address, which is always written with a leading underscore.
function projectFrom(segments) {
  const found = segments.filter(function (segment) { return segment.charAt(0) !== "_"; })[0];
  return found || "";
}

/*
 * The URL as the address pair, or the refusal that says what PACT reads. The
 * scheme may be left off - a URL copied out of a message often has it - and is
 * always stored as https, which is what ADO serves.
 */
export function readAdoUrl(text) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (raw === "") return unreadable("Enter the URL of your Azure DevOps organisation or project.");
  let parsed;
  try {
    parsed = new URL(URL_SCHEME.test(raw) ? raw : "https://" + raw);
  } catch (_) {
    return unreadable("That is not a URL.");
  }
  const host = parsed.hostname.toLowerCase();
  const segments = pathSegments(parsed.pathname);

  // A host is letters, digits, dots and hyphens. Anything else - a sentence
  // with spaces in it, most of all - is prose that happened to parse, and is
  // refused as prose rather than quoted back as if it were a host.
  if (!/^[a-z0-9.-]+$/.test(host)) return unreadable("That is not a URL.");

  if (host === DEV_AZURE_HOST) {
    const organization = segments[0] || "";
    if (!ORGANISATION_NAME.test(organization)) {
      return unreadable("https://dev.azure.com/ needs the organisation's name after it.");
    }
    return readable("https://" + DEV_AZURE_HOST + "/" + organization, organization,
      projectFrom(segments.slice(1)));
  }

  if (host.endsWith(VISUAL_STUDIO_SUFFIX)) {
    const organization = host.slice(0, -VISUAL_STUDIO_SUFFIX.length);
    if (!ORGANISATION_NAME.test(organization)) {
      return unreadable("PACT reads 'dev.azure.com' and '<organisation>.visualstudio.com' " +
        "addresses, and '" + host + "' is neither.");
    }
    const afterCollection = segments[0] && segments[0].toLowerCase() === COLLECTION_SEGMENT
      ? segments.slice(1)
      : segments;
    return readable("https://" + host, organization, projectFrom(afterCollection));
  }

  return unreadable("PACT reads 'dev.azure.com' and '<organisation>.visualstudio.com' " +
    "addresses, and '" + host + "' is neither.");
}

/*
 * The address pair as the URL the panel shows, so a stored mapping reads as one
 * URL and a paste of it reads back to the same pair.
 */
export function adoUrlFor(input) {
  const block = input || {};
  const base = trimOrganizationUrl(block.organizationUrl);
  const project = String(block.project === undefined || block.project === null ? "" : block.project).trim();
  if (base === "") return "";
  return project === "" ? base : base + "/" + encodeURIComponent(project);
}

// What a URL with no project is refused with. The panel's one address field is
// a URL, so an address too short to call anything is said here rather than
// waiting for a round trip to ADO to fail on a missing project.
export const ADO_PROJECT_IN_URL =
  "The URL must name the project as well: https://dev.azure.com/<organisation>/<project>.";

/*
 * The URL read as the address pair every call needs, or the refusal. This is
 * the panel's only address input, so a URL naming no project is refused here.
 * A refusal from the parser is passed through untouched: one set of accepted
 * shapes, worded once.
 */
export function addressFromUrl(text) {
  const reading = readAdoUrl(text);
  if (reading.refusal !== "") return reading;
  if (reading.project === "") {
    return { organizationUrl: reading.organizationUrl, organization: reading.organization, project: "", refusal: ADO_PROJECT_IN_URL };
  }
  return reading;
}

/*
 * What the panel's three mapping rows say on hover, one sentence each. They are
 * titles rather than on-screen lines because the panel's owner asked for the
 * explanation to be on hover and the rows to be named after PACT's own things:
 * each value is already an ADO work-item type name, so the label only has to
 * say which PACT thing it produces.
 */
export const ADO_ROW_TIPS = {
  project: "The ADO work-item type a PACT Project comes from; it must sit at a higher level " +
    "than the assignment's type.",
  assignment: "The ADO work-item type a PACT Assignment comes from - the level that carries a " +
    "person and their time.",
  tag: "The ADO work-item type whose name becomes a tag on the assignment; empty leaves " +
    "nothing tagged."
};
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
 * What the Assignment slot offers once a Project type is chosen: the type
 * already chosen where it sits at a lower level, and otherwise the level
 * immediately below the project's. Nothing is offered before the ranks are
 * known, and nothing is offered that the rank rule would refuse, so the panel
 * never opens - or drifts - into a pair that cannot be saved.
 */
export function assignmentLevelBelow(ranks, projectLevel, current) {
  const list = ranks || [];
  const project = levelRank(list, projectLevel);
  if (project === null) return "";
  const chosen = levelRank(list, current);
  if (chosen !== null && chosen < project) return current;
  const below = list.filter(function (type) { return type && type.rank < project; })[0];
  return below ? below.name : "";
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
