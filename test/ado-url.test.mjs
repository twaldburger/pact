/*
 * The one URL field in the Azure DevOps settings: what a pasted URL is read as,
 * and what the panel does with the reading.
 *
 * The reading itself is a pure function, so every accepted shape, the dropped
 * tail and the refusals are asserted here directly. So is the pair a press
 * sends, and what the three mapping rows offer by default - neither is a DOM
 * question, so neither needs one. What the panel draws - one URL and no other
 * address field, the three rows named after PACT's things, each explaining
 * itself as a title - is checked by reading the script the browser is handed,
 * the way the other panel tests read one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADO_PROJECT_IN_URL,
  ADO_ROW_TIPS,
  ADO_URL_SHAPES,
  addressFromUrl,
  adoUrlFor,
  assignmentLevelBelow,
  readAdoUrl,
  typeRanks
} from "../public/lib/ado.mjs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const FEATURES = readFileSync(new URL("../docs/features.md", import.meta.url), "utf8");

/* --- every shape the issue lists ------------------------------------------ */

// The five forms, each read to the same pair: an organisation address and a
// project name, whichever way round the URL spells them.
const SAME_PAIR = [
  ["the project on dev.azure.com", "https://dev.azure.com/timwaldburger/PACT"],
  ["a work item deep link", "https://dev.azure.com/timwaldburger/PACT/_workitems/edit/12345"],
  ["a board link", "https://dev.azure.com/timwaldburger/PACT/_boards/board/t/PACT Team/Boards"],
  ["the project on visualstudio.com", "https://timwaldburger.visualstudio.com/PACT"],
  ["the project under DefaultCollection",
    "https://timwaldburger.visualstudio.com/DefaultCollection/PACT"],
  ["a work item under DefaultCollection",
    "https://timwaldburger.visualstudio.com/DefaultCollection/PACT/_workitems/edit/7"]
];

SAME_PAIR.forEach(([what, url]) => {
  test(what + " reads the same organisation and project", () => {
    assert.deepEqual(readAdoUrl(url), {
      organizationUrl: url.includes("visualstudio.com")
        ? "https://timwaldburger.visualstudio.com"
        : "https://dev.azure.com/timwaldburger",
      organization: "timwaldburger",
      project: "PACT",
      refusal: ""
    });
  });
});

/* --- what is dropped, and what is decoded -------------------------------- */

test("a trailing slash is dropped", () => {
  assert.equal(readAdoUrl("https://dev.azure.com/timwaldburger/PACT/").organizationUrl,
    "https://dev.azure.com/timwaldburger");
  assert.equal(readAdoUrl("https://dev.azure.com/timwaldburger/PACT/").project, "PACT");
  assert.equal(readAdoUrl("https://dev.azure.com/timwaldburger/").organization, "timwaldburger");
});

test("a query string and a fragment are dropped", () => {
  const reading = readAdoUrl("https://dev.azure.com/timwaldburger/PACT?foo=bar&baz=1#anchor");
  assert.equal(reading.organizationUrl, "https://dev.azure.com/timwaldburger");
  assert.equal(reading.project, "PACT");
});

test("percent-encoded names are decoded", () => {
  assert.equal(readAdoUrl("https://dev.azure.com/timwaldburger/PACT%20Lab").project, "PACT Lab");
  assert.equal(readAdoUrl("https://dev.azure.com/timwaldburger/PACT%2BLab").project, "PACT+Lab");
});

test("the scheme may be left off, and is stored as https", () => {
  assert.deepEqual(readAdoUrl("dev.azure.com/timwaldburger/PACT"), readAdoUrl("http://dev.azure.com/timwaldburger/PACT"));
  assert.equal(readAdoUrl("http://dev.azure.com/timwaldburger/PACT").organizationUrl,
    "https://dev.azure.com/timwaldburger");
});

/* --- a URL with no project is not an error ------------------------------- */

test("a bare organisation URL reads the organisation and leaves the project empty", () => {
  assert.deepEqual(readAdoUrl("https://dev.azure.com/timwaldburger"), {
    organizationUrl: "https://dev.azure.com/timwaldburger",
    organization: "timwaldburger",
    project: "",
    refusal: ""
  });
  assert.deepEqual(readAdoUrl("https://timwaldburger.visualstudio.com/DefaultCollection"), {
    organizationUrl: "https://timwaldburger.visualstudio.com",
    organization: "timwaldburger",
    project: "",
    refusal: ""
  });
});

/* --- refusals ------------------------------------------------------------ */

test("a host that is neither dev.azure.com nor visualstudio.com is refused, not coerced", () => {
  [
    "https://example.com/timwaldburger/PACT",
    "https://dev.azure.com.example.com/timwaldburger/PACT",
    "https://timwaldburger.visualstudio.example.com/PACT",
    "https://x.y.visualstudio.com/PACT"
  ].forEach((url) => {
    const reading = readAdoUrl(url);
    assert.equal(reading.organizationUrl, "", url);
    assert.equal(reading.project, "", url);
    assert.match(reading.refusal, /dev\.azure\.com/, url);
    assert.match(reading.refusal, /visualstudio\.com/, url);
  });
});

test("prose that is not a URL at all is refused", () => {
  ["my project is called PACT", "PACT Lab", "not a url at all.", "https://"].forEach((text) => {
    const reading = readAdoUrl(text);
    assert.equal(reading.organizationUrl, "", text);
    assert.match(reading.refusal, /^That is not a URL\./, text);
  });
});

test("an empty field is refused with what to paste", () => {
  assert.match(readAdoUrl("").refusal, /Enter the URL/);
  assert.ok(readAdoUrl("").refusal.includes(ADO_URL_SHAPES));
  assert.ok(readAdoUrl("   ").refusal.includes(ADO_URL_SHAPES));
});

test("a dev.azure.com address with no organisation is refused", () => {
  ["https://dev.azure.com", "https://dev.azure.com/", "https://dev.azure.com/_apis/projects"].forEach((url) => {
    const reading = readAdoUrl(url);
    assert.equal(reading.organizationUrl, "", url);
    assert.ok(reading.refusal.includes(ADO_URL_SHAPES), url);
  });
});

test("every refusal names the shapes it accepts", () => {
  ["https://example.com/x/y", "prose", "", "https://dev.azure.com"].forEach((url) => {
    assert.ok(readAdoUrl(url).refusal.includes(ADO_URL_SHAPES), url);
  });
});

/* --- the pair a press sends ---------------------------------------------- */

test("a URL naming the project is the whole address a press needs", () => {
  assert.deepEqual(addressFromUrl("https://dev.azure.com/timwaldburger/PACT"), {
    organizationUrl: "https://dev.azure.com/timwaldburger",
    organization: "timwaldburger",
    project: "PACT",
    refusal: ""
  });
  assert.deepEqual(addressFromUrl("https://timwaldburger.visualstudio.com/DefaultCollection/PACT"), {
    organizationUrl: "https://timwaldburger.visualstudio.com",
    organization: "timwaldburger",
    project: "PACT",
    refusal: ""
  });
});

test("a URL naming no project is refused rather than sent without one", () => {
  const reading = addressFromUrl("https://dev.azure.com/timwaldburger");
  assert.equal(reading.organizationUrl, "https://dev.azure.com/timwaldburger");
  assert.equal(reading.project, "");
  assert.equal(reading.refusal, ADO_PROJECT_IN_URL);
  assert.match(reading.refusal, /https:\/\/dev\.azure\.com\/<organisation>\/<project>/);
});

test("the parser's refusal is passed through, worded once", () => {
  assert.equal(addressFromUrl("prose").refusal, readAdoUrl("prose").refusal);
  assert.equal(addressFromUrl("https://example.com/x/y").refusal,
    readAdoUrl("https://example.com/x/y").refusal);
  assert.equal(addressFromUrl("").refusal, readAdoUrl("").refusal);
});

/* --- the assignment default: the level below, never an invalid pair ------ */

const RANKS = typeRanks({
  value: [
    { rank: 3, workItemTypes: [{ name: "Epic" }] },
    { rank: 2, workItemTypes: [{ name: "Feature" }] },
    { rank: 1, workItemTypes: [{ name: "User Story" }] }
  ]
});

test("the assignment slot is offered the level below the chosen project", () => {
  assert.equal(assignmentLevelBelow(RANKS, "Epic", ""), "Feature");
  assert.equal(assignmentLevelBelow(RANKS, "Feature", ""), "User Story");
});

test("an assignment choice already below the project is kept as it is", () => {
  assert.equal(assignmentLevelBelow(RANKS, "Epic", "User Story"), "User Story");
  assert.equal(assignmentLevelBelow(RANKS, "Feature", "User Story"), "User Story");
});

test("a pair the rank rule refuses is never the one offered", () => {
  // Equal: Epic over Epic, which the issue names as the panel's old default.
  assert.equal(assignmentLevelBelow(RANKS, "Epic", "Epic"), "Feature");
  // Inverted: Epic under Feature.
  assert.equal(assignmentLevelBelow(RANKS, "Feature", "Epic"), "User Story");
});

test("nothing is offered with no project chosen, no ranks, or nothing below", () => {
  assert.equal(assignmentLevelBelow(RANKS, "", "Feature"), "");
  assert.equal(assignmentLevelBelow(RANKS, "User Story", ""), "");
  assert.equal(assignmentLevelBelow([], "Epic", ""), "");
  assert.equal(assignmentLevelBelow(undefined, "Epic", ""), "");
});

/* --- the pair as one URL -------------------------------------------------- */

test("a stored pair reads back as the URL whose reading is that pair", () => {
  [
    { organizationUrl: "https://dev.azure.com/timwaldburger", project: "PACT" },
    { organizationUrl: "https://dev.azure.com/timwaldburger", project: "PACT Lab" },
    { organizationUrl: "https://timwaldburger.visualstudio.com", project: "Atlas/Platform" }
  ].forEach((mapping) => {
    const url = adoUrlFor(mapping);
    const reading = readAdoUrl(url);
    assert.equal(reading.organizationUrl, mapping.organizationUrl, url);
    assert.equal(reading.project, mapping.project, url);
  });
});

test("a pair with no address is no URL", () => {
  assert.equal(adoUrlFor({ project: "PACT" }), "");
  assert.equal(adoUrlFor({ organizationUrl: "https://dev.azure.com/timwaldburger" }),
    "https://dev.azure.com/timwaldburger");
});

/* --- the panel ------------------------------------------------------------ */

// The settings panel's source, from its opening function to the operations
// panel that follows it, read the way the other panel tests read one.
const PANEL = (() => {
  const start = APP.indexOf("function openAdoSettingsPanel(");
  assert.ok(start >= 0, "the Azure DevOps settings panel is not in the script");
  const end = APP.indexOf("\n/* --- the Azure DevOps operations panel", start);
  assert.ok(end > start, "the settings panel does not end where the operations panel begins");
  return APP.slice(start, end);
})();

// The form row the panel's labels are built from, where a label's explanation
// is attached.
const FORM_ROW = (() => {
  const start = APP.indexOf("function formRow(");
  assert.ok(start >= 0, "the form row is not in the script");
  const end = APP.indexOf("\nfunction input(", start);
  assert.ok(end > start, "the form row does not end where the next helper begins");
  return APP.slice(start, end);
})();

// The type slot's filler, where the empty choice lives.
const FILL = (() => {
  const start = APP.indexOf("function fillTypeSelect(");
  assert.ok(start >= 0, "the type slot's filler is not in the script");
  const end = APP.indexOf("\n/* --- the help panel", start);
  assert.ok(end > start, "the filler does not end where the help panel begins");
  return APP.slice(start, end);
})();

test("the panel asks for the URL and for nothing else about the address", () => {
  assert.match(PANEL, /var urlInput = input\(adoUrlFor\(mapping\)\);/);
  assert.match(PANEL, /form\.appendChild\(formRow\("URL", urlInput\)\);/);
  // One address field: no organisation input, no project input, and no line
  // saying what the URL was read as.
  const ids = [...PANEL.matchAll(/\.id = "(ado-[a-z-]+)";/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id) => /^ado-(url|org|project)$/.test(id)), ["ado-url"]);
  assert.doesNotMatch(PANEL, /ado-org|ado-project"|orgInput|projectInput/);
  assert.doesNotMatch(PANEL, /readLine|adoReadingLine|ado__read/);
});

test("the pair a press sends is read from that URL, by the shared rules", () => {
  assert.match(PANEL, /function address\(\) \{\s*return addressFromUrl\(urlInput\.value\);\s*\}/);
  assert.match(PANEL, /api\("POST", "\/api\/ado\/test", \{\s*organizationUrl: reading\.organizationUrl,\s*project: reading\.project\s*\}\)/);
  assert.match(PANEL, /organizationUrl: reading\.organizationUrl,\s*project: reading\.project,\s*projectLevel:/);
  // The refusal is the shared rules' own, so the panel cannot word a second set
  // of accepted shapes that drifts from the ones the reading accepts.
  assert.match(PANEL, /var reading = address\(\);\s*if \(reading\.refusal\) \{/);
  assert.doesNotMatch(PANEL, /dev\.azure\.com\/ needs|visualstudio\.com' addresses/);
});

test("the three rows are named after PACT's things, with no lead-in and no 'type'", () => {
  assert.match(PANEL, /form\.appendChild\(formRow\("Project", projectLevel, ADO_ROW_TIPS\.project\)\);/);
  assert.match(PANEL, /form\.appendChild\(formRow\("Assignment", assignmentLevel, ADO_ROW_TIPS\.assignment\)\);/);
  assert.match(PANEL, /form\.appendChild\(formRow\("Tag", tagLevel, ADO_ROW_TIPS\.tag\)\);/);
  assert.doesNotMatch(PANEL, /formRow\("(Project|Assignment|Tag) type/);
  assert.doesNotMatch(PANEL, /type"\s*,/);
});

test("each row's explanation rides on the row's label, not only on the select", () => {
  assert.match(FORM_ROW, /if \(tip\) span\.setAttribute\("title", tip\);/);
  assert.match(FORM_ROW, /span\.textContent = label;/);
  assert.match(FORM_ROW, /row\.appendChild\(span\);/);
  // The native title is the app's existing way: a block's own explanation is
  // set the same way, and nothing new is drawn for it.
  assert.match(APP, /b\.setAttribute\("title", full\);/);
});

test("the three explanations are one sentence each, in the app's voice", () => {
  assert.equal(Object.keys(ADO_ROW_TIPS).join(","), "project,assignment,tag");
  assert.match(ADO_ROW_TIPS.project, /^The ADO work-item type a PACT Project comes from/);
  assert.match(ADO_ROW_TIPS.assignment, /^The ADO work-item type a PACT Assignment comes from/);
  assert.match(ADO_ROW_TIPS.tag, /^The ADO work-item type whose name becomes a tag on the assignment/);
  Object.values(ADO_ROW_TIPS).forEach((tip) => {
    assert.ok(tip.trim() !== "");
    assert.match(tip, /\.$/, tip);
    // One sentence: the only full stop is the one that ends it.
    assert.equal(tip.split(". ").length, 1, tip);
  });
});

test("nothing opens on a pair the rank rule would refuse", () => {
  // Before a test connection each slot offers only its empty choice, and a slot
  // with nothing stored stays empty rather than taking the first type offered.
  assert.match(PANEL, /fillTypeSelect\(projectLevel, \[\], mapping\.projectLevel, \{ blank: CHOOSE_TYPE \}\);/);
  assert.match(PANEL, /fillTypeSelect\(assignmentLevel, \[\], mapping\.assignmentLevel, \{ blank: CHOOSE_TYPE \}\);/);
  assert.match(PANEL, /fillTypeSelect\(tagLevel, \[\], mapping\.tagLevel \|\| "", \{ blank: "None" \}\);/);
  assert.match(PANEL, /fillTypeSelect\(projectLevel, ranked, currentOr\(projectLevel, mapping\.projectLevel\), \{ blank: CHOOSE_TYPE \}\);/);
  assert.match(FILL, /: \(blank \? "" : list\[0\]\)/);
  // Once the ranks are known, the assignment is held to the level below the
  // chosen project, so a chosen project never leaves an unsavable pair.
  assert.match(PANEL, /function syncAssignment\(\) \{[\s\S]*?assignmentLevelBelow\(instance\.types \|\| \[\], projectLevel\.value, assignmentLevel\.value\)/);
  assert.match(PANEL, /projectLevel\.addEventListener\("change", syncAssignment\);/);
  assert.match(PANEL, /syncAssignment\(\);\s*saveButtonEl\.disabled = false;/);
});

test("a stored mapping opens as the one URL it is", () => {
  assert.match(PANEL, /var urlInput = input\(adoUrlFor\(mapping\)\);/);
});

/* --- the feature reference ------------------------------------------------ */

function adoSection() {
  const start = FEATURES.indexOf("## The Azure DevOps settings");
  assert.ok(start >= 0, "the Azure DevOps settings have no section in the feature reference");
  const end = FEATURES.indexOf("\n## ", start + 1);
  return FEATURES.slice(start, end === -1 ? FEATURES.length : end);
}

test("the reference describes the simpler panel, not the reading line", () => {
  const section = adoSection();
  assert.doesNotMatch(section, /organisation: timwaldburger/);
  assert.doesNotMatch(section, /states what it read/);
  assert.match(section, /`Project`, `Assignment` and `Tag`/);
  assert.match(section, /title/);
  assert.match(section, /Test connection/, "a mis-paste is caught at Test connection");
});

test("the settings section says where its controls are, and that no import is among them", () => {
  const section = adoSection();
  assert.match(section, /Where the controls are/);
  assert.match(section, /`Options` then `Azure DevOps\.\.\.`/);
  assert.match(section, /`Test connection` and `Save mapping`/);
  assert.match(section, /no import control/);
});
