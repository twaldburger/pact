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
/*
 * A pasted ADO address, read once: the host, the decoded path segments and the
 * query, or the refusal that says why PACT cannot read it. One definition of
 * what an ADO address is, shared by the mapping's URL reader and the work-item
 * reader, so a host the panel accepts for an organisation is a host it accepts
 * for a work item.
 */
function adoAddress(raw) {
  let parsed;
  try {
    parsed = new URL(URL_SCHEME.test(raw) ? raw : "https://" + raw);
  } catch (_) {
    return { refusal: "That is not a URL." };
  }
  const host = parsed.hostname.toLowerCase();
  // A host is letters, digits, dots and hyphens. Anything else - a sentence
  // with spaces in it, most of all - is prose that happened to parse, and is
  // refused as prose rather than quoted back as if it were a host.
  if (!/^[a-z0-9.-]+$/.test(host)) return { refusal: "That is not a URL." };
  return {
    host: host,
    segments: pathSegments(parsed.pathname),
    params: parsed.searchParams,
    refusal: ""
  };
}

export function readAdoUrl(text) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (raw === "") return unreadable("Enter the URL of your Azure DevOps organisation or project.");
  const address = adoAddress(raw);
  if (address.refusal) return unreadable(address.refusal);
  const host = address.host;
  const segments = address.segments;

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
  return "No token is set. Save a personal access token in the Azure DevOps settings, under " +
    "Options; PACT writes it to " + (state.path || "~/.config/pact/ado-pat") + " with mode 600.";
}

/* --- the two doors -------------------------------------------------------
 *
 * The connection has two surfaces, and each holds one kind of thing: the
 * settings - the URL, the mapping's three rows and the token - live under
 * Options, and the operations - the import now, the sync later - open from a
 * button in the top bar. The button is always in the bar, so it is always
 * found, and it is withheld until an operation could actually work: a mapping
 * in the plan and a token on this machine. An operation needs both halves, and
 * a press that cannot work is worse than a door that says why it is shut.
 *
 * The words are here rather than in the browser because a reason is a rule:
 * the whole connection when neither half is set, and the half that is missing
 * when one of them is. A plan with a mapping and no token does not repeat the
 * sentence for a plan with no mapping at all.
 */
export const ADO_CONNECT_FIRST =
  "Connect PACT to Azure DevOps first: Options then Azure DevOps\u2026";

// A mapping is in the plan when the store would accept it: the address pair
// and the two levels an Assignment is drawn from. The tag level is optional
// there, so it is optional here too.
export function adoMappingInPlan(mapping) {
  return !!mapping && adoRefusals(mapping).length === 0;
}

/*
 * The operation surface's state: whether it may be opened, and what the bar's
 * button says about it. `missing` names the half that is absent - `mapping`,
 * `token`, `both` or nothing - so a caller can say it without parsing a
 * sentence, and `title` is the whole of that sentence: what opening it offers
 * when it may be opened, and why it may not when it may not.
 */
export function adoOperationState(mapping, tokenPresent) {
  const mapped = adoMappingInPlan(mapping);
  const tokened = tokenPresent === true;
  if (mapped && tokened) {
    return { enabled: true, missing: "", title: "Import a work item from Azure DevOps" };
  }
  if (!mapped && !tokened) return { enabled: false, missing: "both", title: ADO_CONNECT_FIRST };
  if (!tokened) {
    return {
      enabled: false,
      missing: "token",
      title: "The plan's mapping is set, but no token is. Add one in Options then Azure DevOps\u2026"
    };
  }
  return {
    enabled: false,
    missing: "mapping",
    title: "A token is set, but the plan has no mapping. Add one in Options then Azure DevOps\u2026"
  };
}

/* --- the panel's two status lines ---------------------------------------
 *
 * The panel draws two lines under its form: the token's state, always, and the
 * connection's, once a test has run. They are the same paragraph in the same
 * style, told apart only by a tone: a good one reads in --ok and a failed one
 * in --signal. Both the words and the class that colours them are worded here,
 * so a test holds each state to the line and the class it draws, and no
 * component names either colour.
 */
const LINE_CLASS = "panel__sub ado__line";

function line(kind, text, title, tone) {
  return {
    text: text,
    title: title || "",
    className: LINE_CLASS + " " + kind + (tone ? " is-" + tone : "")
  };
}

// The token's line: green while a token is set, neutral while none is.
export function tokenLine(token) {
  const state = token || {};
  return line("ado__tokenstate", tokenNotice(state), "", state.present ? "ok" : "");
}

/*
 * The connection's line: nothing until a test has run, the outcome when it has.
 * `test` is `null` before the first press, `{ ok: true, project, team, types,
 * status }` after a success and `{ ok: false, message }` after a failure. A
 * success states the project, its team and each backlog type with its rank -
 * what the mapping rows are chosen from, and why the line is worded that way
 * rather than as a bare "connected". The status code is the line's `title`
 * and never its words.
 */
export function connectionLine(test) {
  if (!test) return null;
  if (test.ok) {
    const ranks = (test.types || []).map((type) => type.name + " " + type.rank);
    return line(
      "ado__connection",
      "Connected to " + test.project + " (" + test.team + "): " + ranks.join(", ") + ".",
      test.status ? "Azure DevOps answered " + test.status + "." : "",
      "ok"
    );
  }
  return line("ado__connection", test.message || "Could not connect to Azure DevOps.", "", "failed");
}

/*
 * --- importing one work item ---------------------------------------------
 *
 * An import reads one work item and puts it on the grid: a Person's row from
 * the item's AssignedTo, a Project from its parents through the mapping, an
 * Assignment's dates from ADO's own or from the plan's rules, and a Link
 * carrying the baseline that a later sync compares against.
 *
 * The rules live here rather than in the server so the same source decides
 * them for the browser, the server and `node --test`: what a work-item link
 * looks like, which date field a type carries, who an AssignedTo is, which
 * ancestor is the Project, where a block goes when ADO has no dates, and the
 * shape of the baseline. Nothing here makes a network call.
 */

/*
 * The work-item fields an import reads, by their reference names rather than
 * their captions: a process template may relabel a field, and the reference
 * name is what survives that.
 */
export const ADO_FIELDS = Object.freeze({
  title: "System.Title",
  type: "System.WorkItemType",
  state: "System.State",
  assignedTo: "System.AssignedTo",
  parent: "System.Parent",
  iterationPath: "System.IterationPath",
  rev: "System.Rev",
  startDate: "Microsoft.VSTS.Scheduling.StartDate"
});

/*
 * The end date is two different reference names on one instance, which is the
 * spike's finding and the reason this is resolved per type rather than held as
 * one constant: Epic and Feature end in a TargetDate, User Story and Task in a
 * FinishDate, and a Bug carries neither. A type with no end field is not an
 * error - it is an item with no dates, which the assumed rule already covers.
 */
export const END_DATE_FIELDS = Object.freeze({
  Epic: "Microsoft.VSTS.Scheduling.TargetDate",
  Feature: "Microsoft.VSTS.Scheduling.TargetDate",
  "User Story": "Microsoft.VSTS.Scheduling.FinishDate",
  Task: "Microsoft.VSTS.Scheduling.FinishDate"
});

// The two scheduling fields a work-item type carries: the start date every
// type shares, and the end date its own type decides.
export function schedulingFields(type) {
  const name = String(type === undefined || type === null ? "" : type).trim();
  return {
    start: ADO_FIELDS.startDate,
    end: Object.prototype.hasOwnProperty.call(END_DATE_FIELDS, name) ? END_DATE_FIELDS[name] : ""
  };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function isDateText(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(Date.UTC(+value.slice(0, 4), +value.slice(5, 7) - 1, +value.slice(8, 10)));
  return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate()) === value;
}

function dateFromISO(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
}

function isoFromDate(date) {
  return date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
}

function addDays(iso, n) {
  return isoFromDate(new Date(dateFromISO(iso).getTime() + n * 86400000));
}

// A month added or taken with the day clamped to the target month's length, so
// moving a month back from the 31st lands on the 30th rather than sliding into
// the month after it.
function addMonths(iso, n) {
  const date = dateFromISO(iso);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + n;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoFromDate(new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), last))));
}

/*
 * The date part of a value ADO gave, read in UTC.
 *
 * ADO answers a date field as an instant, not as a day - `2026-01-05T00:00:00Z`,
 * or whatever local midnight was sent - so PACT takes the date part in a stated
 * zone rather than pretending the instant is a date. UTC is that zone, and it is
 * the same rule the iteration dates are read by: formatting the instant in this
 * machine's local time would move the day for any offset west of Greenwich and
 * place the block in the wrong sprint.
 */
export function datePart(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(text);
  if (!match || !isDateText(match[1])) return "";
  return match[1];
}

/*
 * The work item a paste means: its id, or the refusal that says what a paste
 * may be. Two forms are read, because those are the two forms a person has to
 * hand - the bare id from a chat message, and the browser's own work-item link.
 *
 *   ​12345
 *   #12345
 *   https://dev.azure.com/{org}/{project}/_workitems/edit/12345
 *   https://{org}.visualstudio.com/DefaultCollection/{project}/_workitems/edit/12345
 *   https://{org}.visualstudio.com/{project}/_workitems?workitem=12345
 *
 * The host rule is the address reader's own, so a link from a host PACT does
 * not read is refused with the same sentence it would get for an organisation
 * address. `_workitems` is ADO's own page name, always written with a leading
 * underscore, so no project name is ever mistaken for it.
 */
export const ADO_WORK_ITEM_SHAPES =
  "Paste a work-item id such as 12345, or a work-item link such as " +
  "https://dev.azure.com/<organisation>/<project>/_workitems/edit/12345.";

function workItemRefusal(reason) {
  return { id: 0, refusal: reason + " " + ADO_WORK_ITEM_SHAPES };
}

export function readWorkItemId(text) {
  const raw = String(text === undefined || text === null ? "" : text).trim();
  if (raw === "") return workItemRefusal("Enter a work item id or link.");
  const bare = /^#?(\d{1,9})$/.exec(raw);
  if (bare) {
    const id = Number(bare[1]);
    // Zero is no id at all, and ADO numbers its work items from one.
    return id > 0 ? { id: id, refusal: "" } : workItemRefusal("A work item id starts at 1.");
  }
  const address = adoAddress(raw);
  if (address.refusal) return workItemRefusal("That is not a work item id or link.");
  if (address.host !== DEV_AZURE_HOST && !address.host.endsWith(VISUAL_STUDIO_SUFFIX)) {
    return {
      id: 0,
      refusal: "PACT reads 'dev.azure.com' and '<organisation>.visualstudio.com' work-item links, and '" +
        address.host + "' is neither."
    };
  }
  const at = address.segments.findIndex(function (segment) {
    return segment.toLowerCase().indexOf("_workitems") === 0;
  });
  if (at !== -1) {
    // Below `_workitems`, the id is the one number-segment there is: the page
    // name `edit` sits between them on a work-item link and not on the query
    // form, so a segment of digits is looked for rather than a fixed offset.
    const digits = address.segments.slice(at + 1).filter(function (segment) {
      return segment.toLowerCase() !== "edit";
    }).filter(function (segment) {
      return /^\d{1,9}$/.test(segment);
    })[0];
    if (digits) return { id: Number(digits), refusal: "" };
  }
  // The older link shape keeps the id in the query string.
  const fromQuery = address.params ? (address.params.get("workitem") || address.params.get("id") || "").trim() : "";
  if (/^\d{1,9}$/.test(fromQuery) && Number(fromQuery) > 0) return { id: Number(fromQuery), refusal: "" };
  return workItemRefusal("That link names no work item.");
}

/*
 * Who the item is assigned to, as the three answers PACT can act on.
 *
 * A Person is matched by email - ADO's `uniqueName` - and never by display
 * name: "Anna Meier" and "Meier, Anna (EXT)" are one person and no string
 * comparison can know that, while the email is the instance's own identifier
 * for them. An identity with no email is a group (or an answer too old to carry
 * the mailbox), and there is nothing to match; an absent one is work nobody
 * owns, which also cannot be placed.
 */
export function assignedIdentity(fields) {
  const value = (fields || {})[ADO_FIELDS.assignedTo];
  if (value === undefined || value === null || value === "") {
    return { kind: "unassigned", name: "", email: "" };
  }
  if (typeof value === "string") {
    return { kind: "group", name: value.trim(), email: "" };
  }
  const name = typeof value.displayName === "string" ? value.displayName.trim() : "";
  const email = typeof value.uniqueName === "string" ? value.uniqueName.trim() : "";
  if (email === "") return { kind: "group", name: name, email: "" };
  return { kind: "person", name: name, email: email };
}

// The live Person carrying an email, or null. Archived People are not matched:
// work does not land on somebody the plan has put away. Email is compared
// without case, because a mailbox is not case-sensitive.
export function personForEmail(people, email) {
  const wanted = String(email === undefined || email === null ? "" : email).trim().toLowerCase();
  if (wanted === "") return null;
  return (people || []).filter(function (person) {
    return person && !person.archived && typeof person.email === "string" &&
      person.email.trim().toLowerCase() === wanted;
  })[0] || null;
}

// The live Project with a name, matched without case and without surrounding
// spaces: the ADO title is copied as it reads, and a trailing space in a title
// is no reason to refuse an import.
export function projectForTitle(projects, title) {
  const wanted = String(title === undefined || title === null ? "" : title).trim().toLowerCase();
  if (wanted === "") return null;
  return (projects || []).filter(function (project) {
    return project && !project.archived && String(project.name || "").trim().toLowerCase() === wanted;
  })[0] || null;
}

// The parent a work item points at: the `System.Parent` field, or, where the
// template does not carry it, the hierarchy-reverse relation ADO also answers
// with. Zero means the item sits at the top of its tree.
export function parentIdOf(item) {
  const fields = (item && item.fields) || {};
  const direct = Number(fields[ADO_FIELDS.parent]);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const relations = Array.isArray(item && item.relations) ? item.relations : [];
  const up = relations.filter(function (relation) {
    return relation && relation.rel === "System.LinkTypes.Hierarchy-Reverse" &&
      typeof relation.url === "string";
  })[0];
  if (!up) return 0;
  const match = /\/(\d+)\/?$/.exec(up.url);
  return match ? Number(match[1]) : 0;
}

function chainSummary(chain) {
  return chain.map(function (entry) {
    return String(entry.type || "").trim() + " '" + String(entry.title || "").trim() + "'";
  }).join(", ");
}

/*
 * The Project's name, from the chain of ancestors above the item.
 *
 * The mapping says which work-item type a PACT Project comes from, and the
 * position of a type in the hierarchy is its level, so the Project is the first
 * ancestor whose type is that level - never the item itself, because a record
 * cannot be its own container. An item whose own type is the project level does
 * not reach here at all: `importLevel` sends it down the path that makes it a
 * Project of its own. A chain that reaches no such ancestor refuses, naming
 * every level it walked and the level it was looking for: an import that
 * guessed a Project would put real work in the wrong place.
 */
export function projectFromChain(chain, projectLevel) {
  const level = String(projectLevel === undefined || projectLevel === null ? "" : projectLevel).trim();
  const walked = (Array.isArray(chain) ? chain : []).filter(function (entry) {
    return entry && typeof entry === "object";
  });
  const found = walked.filter(function (entry) {
    return String(entry.type || "").trim() === level && String(entry.title || "").trim() !== "";
  })[0];
  if (found) return { title: String(found.title).trim(), id: found.id || 0, refusal: "" };
  if (walked.length === 0) {
    return {
      title: "",
      id: 0,
      refusal: "The work item has no parent, so nothing above it is a '" + level +
        "', the project level the mapping names: an import needs one there to give the Assignment a Project."
    };
  }
  return {
    title: "",
    id: 0,
    refusal: "The work item's parents are " + chainSummary(walked) + "; none is a '" + level +
      "', the project level the mapping names, so the import has no Project to place the work under."
  };
}

/*
 * Which record an item's type becomes, decided before any Person is
 * considered: the level its type sits at against the mapping's own three
 * slots, and then, for a type the mapping does not name, its rank against the
 * assignment level.
 *
 *   "project"    - the type the mapping draws Projects from
 *   "tag"       - the type the mapping names as the tag level
 *   "below"     - a ranked type lower than the assignment level
 *   "assignment" - the existing path: the assignment level itself, a level
 *                  between it and the project level, or a type whose rank the
 *                  instance did not answer for (an import must not refuse work
 *                  it cannot place for want of a rank)
 *
 * An item is never its own container, so a project-level type is the item's
 * own type here and nowhere else: `projectFromChain` still refuses to read the
 * item itself as the Project it sits under.
 */
export function importLevel(ranks, mapping, type) {
  const block = mapping || {};
  const name = String(type === undefined || type === null ? "" : type).trim();
  const named = (value) => String(value === undefined || value === null ? "" : value).trim();
  if (name !== "" && name === named(block.projectLevel)) return "project";
  if (name !== "" && name === named(block.tagLevel)) return "tag";
  if (name !== "" && name === named(block.assignmentLevel)) return "assignment";
  const assignment = levelRank(ranks, named(block.assignmentLevel));
  const rank = levelRank(ranks, name);
  if (assignment !== null && rank !== null && rank < assignment) return "below";
  return "assignment";
}

/*
 * The refusal a tag-level or below-the-assignment-level item gets. Each names
 * what that level is for rather than what the item lacks, so an owner reading
 * it is not told to go and assign an owner to work that needs none.
 */
export function importLevelRefusal(level, facts) {
  const result = facts || {};
  const mapping = result.mapping || {};
  const type = String(result.workItemType || "").trim();
  const id = result.workItemId;
  const title = String(result.title || "").trim();
  const item = "Work item " + id + " (\"" + title + "\") is " + (type === "" ? "of a type" : type);
  const projectLevel = String(mapping.projectLevel || "").trim();
  const assignmentLevel = String(mapping.assignmentLevel || "").trim();
  if (level === "tag") {
    return item + ", the type the mapping names as the tag level: a tag has no record of its own, " +
      "so an import of one would put nothing on the plan. Import an item at the project level (" +
      projectLevel + ") or at the level that carries a person's time (" + assignmentLevel + ").";
  }
  return item + ", which sits below " + assignmentLevel + ", the assignment level the mapping names: " +
    "this is below the level that carries a person's time, so an import of it has no record to become. " +
    "Import the " + assignmentLevel + " that carries the time, or the " + projectLevel + " above it.";
}

/*
 * The offer a project-level item gets when a live Project already carries its
 * title. It carries both ways out: using the existing Project, which stores the
 * link on it and creates nothing, and importing as a copy under the app's own
 * `X (copy)` naming rule. `copyName` is that rule's answer, computed by the
 * caller that holds the plan's live Project names.
 */
export function existingProjectOffer(project, copyName) {
  const name = String(project && project.name || "").trim();
  const copy = String(copyName === undefined || copyName === null ? "" : copyName).trim();
  return {
    kind: "use-project",
    projectId: project && project.id ? project.id : "",
    name: name,
    label: "Use \"" + name + "\"",
    altLabel: "Import as a copy",
    copyName: copy,
    message: "The plan already has a live Project named \"" + name + "\", which is this work item's title. " +
      "Using it stores the item's link on that Project and creates nothing" +
      (copy === "" ? "." : ", or PACT can import the item as a second Project named \"" + copy + "\".")
  };
}

/*
 * What a finished project-level import reads as in the panel's line: the item
 * and the Project it became, and whether a Project was created or an existing
 * one took the link. It never names a Person, because an import at this level
 * makes none and reads no owner.
 */
export function projectImportLine(facts) {
  const result = facts || {};
  const type = String(result.workItemType || "").trim();
  const item = (type === "" ? "work item" : type) + " #" + result.workItemId;
  const name = "\"" + String(result.projectName || "").trim() + "\"";
  if (result.created) {
    return "Imported " + item + " as the new Project " + name +
      ": its link and baseline are stored on the Project, so a later sync can keep its name current.";
  }
  return "Linked " + item + " to the existing Project " + name + ": nothing was created.";
}

// The start date of the iteration a path names, as a date, or empty when the
// instance reports no such iteration - an item in the backlog has no path at
// all, and a path the team settings do not list has no dates either way.
export function iterationStartFor(iterations, path) {
  const wanted = String(path === undefined || path === null ? "" : path).trim();
  if (wanted === "") return "";
  const found = (iterations || []).filter(function (iteration) {
    return iteration && String(iteration.path || "").trim() === wanted;
  })[0];
  if (!found) return "";
  return datePart(found.attributes && found.attributes.startDate);
}

// The PACT sprint whose dates contain a day, or null. String comparison on ISO
// dates is date order, and both ends are inclusive: a sprint ending on the 14th
// contains the 14th.
export function sprintForDate(date, sprints) {
  const iso = isDateText(date) ? date : datePart(date);
  if (iso === "") return null;
  return (sprints || []).filter(function (sprint) {
    return sprint && typeof sprint.start === "string" && typeof sprint.end === "string" &&
      sprint.start <= iso && iso <= sprint.end;
  })[0] || null;
}

/*
 * The block an item with no dates gets: one month, kept inside the plan period
 * rather than landing off-screen.
 *
 * Today is where it wants to be. When today falls before the period the block
 * starts at the period's start and still runs a month; when it falls after the
 * period the block ends at the period's end and reaches a month back. A period
 * shorter than a month holds what it can: the block is clamped to the period and
 * never refused for being longer than it.
 */
export function assumedWindow(today, period) {
  const start = String(period && period.start || "").trim();
  const end = String(period && period.end || "").trim();
  if (!isDateText(start) || !isDateText(end)) return { start: "", end: "" };
  let from = isDateText(today) ? today : start;
  if (from < start) from = start;
  let to = addDays(addMonths(from, 1), -1);
  if (from > end) {
    to = end;
    from = addDays(addMonths(end, -1), 1);
  }
  if (from < start) from = start;
  if (to > end) to = end;
  if (to < from) { from = start; to = end; }
  return { start: from, end: to };
}

/*
 * Where an imported block goes, and whether its dates are ADO's or PACT's.
 *
 * 1. ADO's own dates win whenever it has both, and are recorded as not assumed.
 *    One date alone is not a span, so a item carrying only a start is treated
 *    as having no dates rather than given an invented end.
 * 2. Otherwise the item's iteration decides: an iteration whose start date falls
 *    in a PACT sprint places the block on that sprint's dates - the sprint's
 *    start where the sprint began before the plan period, its end where it runs
 *    past it.
 * 3. Otherwise the block is the assumed month, and `source` says which of the
 *    two fallbacks it was so the panel can say so: an iteration outside every
 *    sprint reads differently from an item with no iteration at all.
 *
 * Every date that is not ADO's is assumed, and an assumed date is never written
 * back to ADO until a person confirms it.
 */
export function importPlacement(input) {
  const settings = input || {};
  const period = settings.period || {};
  const adoStart = datePart(settings.adoStart);
  const adoEnd = datePart(settings.adoEnd);
  if (adoStart !== "" && adoEnd !== "") {
    return { start: adoStart, end: adoEnd, datesAssumed: false, source: "ado", sprint: null, iterationStart: "" };
  }
  const iterationStart = datePart(settings.iterationStart);
  const sprint = sprintForDate(iterationStart, settings.sprints);
  if (sprint) {
    const start = isDateText(period.start) && sprint.start < period.start ? period.start : sprint.start;
    const end = isDateText(period.end) && sprint.end > period.end ? period.end : sprint.end;
    return {
      start: start,
      end: end,
      datesAssumed: true,
      source: "sprint",
      sprint: { index: sprint.index, name: sprint.name, start: sprint.start, end: sprint.end },
      iterationStart: iterationStart
    };
  }
  const window = assumedWindow(datePart(settings.today), period);
  return {
    start: window.start,
    end: window.end,
    datesAssumed: true,
    source: "assumed",
    sprint: null,
    iterationStart: iterationStart
  };
}

/*
 * The Link: what an imported Assignment carries so a later sync knows what both
 * sides agreed, in which field, at which revision.
 *
 * It sits in the plan beside the Assignment, because the plan is what travels.
 * The four facts are the work item's id, the revision both sides last agreed,
 * the values both sides agreed (`values`), and whether the dates are PACT's own
 * guess rather than ADO's answer (`datesAssumed`). A type name may appear beside
 * them - it is what resolves the date field on the next read - and an address
 * may not, nor anything shaped like a credential: a plan is a file people share,
 * and a key shaped like a secret is refused here exactly as it is inside the
 * mapping.
 */
export const LINK_KEYS = Object.freeze(["workItemId", "rev", "workItemType", "values", "datesAssumed"]);
export const LINK_VALUE_KEYS = Object.freeze(["title", "personEmail", "project", "start", "end", "iterationPath"]);

/*
 * `place` is where the link sits: `"project"` for a Project's own link, and
 * nothing for an Assignment's. Both homes are checked by this one rule, so a
 * Project's link can never be shaped differently from an Assignment's. The one
 * thing a Project's link does not carry is an owner's email: an import at the
 * project level never reads `AssignedTo`, so there is no person to record.
 */
export function linkRefusals(link, place) {
  if (!link || typeof link !== "object" || Array.isArray(link)) return ["link must be an object"];
  const errors = [];
  const onProject = place === "project";
  Object.keys(link).forEach(function (key) {
    if (isCredentialKey(key)) {
      errors.push("the link must never carry a credential: remove link." + key);
    } else if (!LINK_KEYS.includes(key)) {
      errors.push("link has an unknown field '" + key + "'");
    }
  });
  if (!Number.isInteger(link.workItemId) || link.workItemId <= 0) {
    errors.push("link.workItemId must be a work item id");
  }
  if (!Number.isInteger(link.rev) || link.rev < 0) {
    errors.push("link.rev must be the work item's revision, a whole number from 0");
  }
  if (typeof link.datesAssumed !== "boolean") errors.push("link.datesAssumed must be a boolean");
  if (link.workItemType !== undefined && !isNonEmptyText(link.workItemType)) {
    errors.push("link.workItemType must be a work-item type name when it is given");
  }
  const values = link.values;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    errors.push("link.values must be an object");
    return errors;
  }
  Object.keys(values).forEach(function (key) {
    if (isCredentialKey(key)) {
      errors.push("the link must never carry a credential: remove link.values." + key);
    } else if (!LINK_VALUE_KEYS.includes(key)) {
      errors.push("link.values has an unknown field '" + key + "'");
    }
  });
  ["title", "project"].forEach(function (key) {
    if (!isNonEmptyText(values[key])) errors.push("link.values." + key + " must be a non-empty string");
  });
  // An Assignment's link is what ties a person's time to the item, so the email
  // is required there. A Project's link may carry one, but never a blank one.
  if (!onProject) {
    if (!isNonEmptyText(values.personEmail)) errors.push("link.values.personEmail must be a non-empty string");
  } else if (values.personEmail !== undefined && !isNonEmptyText(values.personEmail)) {
    errors.push("link.values.personEmail must be a non-empty string when it is given");
  }
  ["start", "end"].forEach(function (key) {
    if (values[key] !== null && !isDateText(values[key])) {
      errors.push("link.values." + key + " must be a YYYY-MM-DD date or null");
    }
  });
  if (values.iterationPath !== null && typeof values.iterationPath !== "string") {
    errors.push("link.values.iterationPath must be an iteration path or null");
  }
  return errors;
}

// The link as it is stored: the texts trimmed, an absent date kept as null
// rather than left out, and an unset type name or iteration path left out
// rather than stored as an empty string.
export function normalizeLink(link, place) {
  const onProject = place === "project";
  const values = (link && link.values) || {};
  const start = values.start === undefined || values.start === null || values.start === "" ? null : String(values.start);
  const end = values.end === undefined || values.end === null || values.end === "" ? null : String(values.end);
  const path = values.iterationPath === undefined || values.iterationPath === null
    ? ""
    : String(values.iterationPath).trim();
  const normalized = {
    workItemId: Number(link.workItemId),
    rev: Number(link.rev),
    values: {
      title: String(values.title === undefined || values.title === null ? "" : values.title).trim(),
      personEmail: String(values.personEmail === undefined || values.personEmail === null ? "" : values.personEmail).trim(),
      project: String(values.project === undefined || values.project === null ? "" : values.project).trim(),
      start: start,
      end: end,
      iterationPath: path === "" ? null : path
    },
    datesAssumed: !!link.datesAssumed
  };
  // A Project's link has no owner, so an empty email is left out of its values
  // rather than stored as a blank field a sync would have to read as one.
  if (onProject && normalized.values.personEmail === "") delete normalized.values.personEmail;
  const type = link.workItemType === undefined || link.workItemType === null
    ? ""
    : String(link.workItemType).trim();
  if (type !== "") normalized.workItemType = type;
  return normalized;
}

/*
 * The offer an assignee PACT cannot match comes with, and the refusal it is
 * worded as. Creating a Person is never silent: the panel draws this as its own
 * press, naming the person it would add, and the import happens only when that
 * press is made. The ADO display name is taken verbatim and the email as
 * stored, because the email is what matches next time.
 */
export function unmatchedAssigneeOffer(identity) {
  const name = String(identity && identity.name || "").trim();
  const email = String(identity && identity.email || "").trim();
  return {
    kind: "create-person",
    name: name,
    email: email,
    label: "Create " + (name === "" ? email : name) + " and import",
    message: "No live Person carries the email " + email + ", which is what this work item is assigned to. " +
      "PACT can add a Person named \"" + name + "\" with that email, and you can edit them afterwards - " +
      "or set another Person's email in their panel to match this item."
  };
}

/*
 * What a finished import reads as, in the panel's own line: the item, the
 * Assignment's name, the Person, the Project and the dates, then which of the
 * date rules placed the block. A created Person is named too, because an import
 * that added one should not leave it to be discovered on the grid.
 */
export function importLine(facts) {
  const result = facts || {};
  const person = result.person || {};
  const type = String(result.workItemType || "").trim();
  let text = "Imported " + (type === "" ? "" : type + " ") + "#" + result.workItemId + " as \"" +
    result.assignmentName + "\": " + person.name + " on " + result.projectName + ", " +
    result.start + " to " + result.end + ".";
  if (person.created) {
    text += " " + person.name + " was added as a Person with " + person.email +
      " and can be edited afterwards.";
  }
  if (!result.datesAssumed) {
    text += " The dates are the work item's own.";
  } else if (result.source === "sprint") {
    const sprint = result.sprint || {};
    text += " The dates are assumed: the work item has none, and the block sits at " + sprint.name +
      " (" + sprint.start + " to " + sprint.end + ").";
  } else if (result.iterationStart) {
    text += " The dates are assumed: the work item has none, and its iteration starts on " +
      result.iterationStart + ", which is in no PACT sprint, so the block is one month long, " +
      "placed inside the plan period.";
  } else {
    text += " The dates are assumed: the work item has none, so the block is one month long, " +
      "placed inside the plan period.";
  }
  return text;
}

/*
 * The work item's own page: `https://dev.azure.com/{org}/{project}/_workitems/
 * edit/{id}`, or the same page under `{org}.visualstudio.com`. The address is
 * the mapping's, not the link's, because a plan carries one connection and a
 * link stores the item rather than where it was read from.
 *
 * No mapping means no address: a plan whose mapping was removed still holds its
 * links, and an address invented for it would point somewhere real and wrong.
 * So an empty string here is the row's `not linked`, and it is never guessed at.
 */
export function workItemUrl(link, mapping) {
  const id = Number(link && link.workItemId);
  const base = adoUrlFor(mapping);
  if (!(id > 0) || base === "") return "";
  return base + "/_workitems/edit/" + id;
}

/*
 * The id the row links: the work item's own number and nothing else, because
 * that is what a reader recognises the item by now that it can be clicked.
 */
export function linkLabel(link) {
  const id = Number(link && link.workItemId);
  return id > 0 ? String(id) : "";
}

/*
 * The type the row names beside the id, as the link stores it - no lookup, and
 * no fallback: a link that recorded no type shows the id alone rather than being
 * called a "work item", which is what its absence would be read as.
 */
export function linkType(link) {
  const type = link && link.workItemType;
  return typeof type === "string" ? type.trim() : "";
}

/*
 * What the row used to spell out, kept where this app explains things: the
 * work item's type, the revision both sides last agreed, and the assumed marker
 * when its dates are PACT's own guess rather than ADO's answer. The marker is
 * there because an assumed date is never written back to ADO until a person
 * confirms it, so a reader should be able to see which kind of date a block
 * carries.
 */
export function linkFacts(link) {
  const facts = link || {};
  const type = String(facts.workItemType === undefined || facts.workItemType === null ? "" : facts.workItemType).trim();
  let text = (type === "" ? "Work item " : type + " ") + "#" + facts.workItemId +
    ", revision " + facts.rev;
  if (facts.datesAssumed) text += " - its dates are assumed";
  return text + ".";
}

// The two explanations the row's hover title ends with. The link's own facts
// lead it; these say what the row is not, which is the part a reader cannot
// tell by looking at it.
const LINK_READ_ONLY_TIP =
  "It is read-only here: an import establishes the link, and PACT does not write to ADO yet.";
const LINK_NOT_LINKED_TIP =
  "No Azure DevOps work item behind this record: an import creates the link, and PACT does not " +
  "write to ADO yet.";

/*
 * The ADO row of a panel, as one rule, so an Assignment's row and a Project's
 * cannot drift apart: what it reads, where it points and what it says on hover.
 *
 * The row names the work item's type and links its id - `Feature 1234` with the
 * number clickable - because the type is what tells a reader which kind of thing
 * they are looking at, and the id is what they came to follow.
 *
 * It is drawn for a Project as well as an Assignment, and always: with a link it
 * reads the type and the id and points at the work item, and without one it
 * reads `not linked`, which is information rather than an error - seeing that no
 * work item is behind a record is worth the row. A record is linked only when
 * the plan's mapping can build its address, so a plan with no mapping reads `not
 * linked` rather than any invented one.
 *
 * Nothing here reads `values.personEmail`: a Project's link carries no owner, so
 * a row that assumed one would break on the half of the plan that has no owner.
 */
export function linkRow(link, mapping) {
  const url = workItemUrl(link, mapping);
  if (url === "") {
    return { linked: false, type: "", text: "not linked", href: "", title: LINK_NOT_LINKED_TIP };
  }
  return {
    linked: true,
    type: linkType(link),
    text: linkLabel(link),
    href: url,
    title: linkFacts(link) + " " + LINK_READ_ONLY_TIP
  };
}
