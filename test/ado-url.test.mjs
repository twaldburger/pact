/*
 * The one URL field in the ADO panel: what a pasted URL is read as, and what
 * the panel does with the reading.
 *
 * The reading itself is a pure function, so every accepted shape, the dropped
 * tail and the refusals are asserted here directly. What the panel does with
 * the result - fill both stored values and say what it read - is a DOM question
 * this suite has no DOM to answer, so what is checked is the wiring the script
 * hands the browser: one URL field, the paste that reads it, the line that
 * states the reading, and the refusal that comes from the parser rather than
 * from a second copy of the rules. Whether the panel really shows that line
 * after a paste was measured against the running app.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ADO_URL_SHAPES,
  adoReadingLine,
  adoUrlFor,
  readAdoUrl
} from "../public/lib/ado.mjs";

const APP = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

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

/* --- the line that states the reading ------------------------------------ */

test("the reading is stated as the organisation and the project", () => {
  assert.equal(adoReadingLine(readAdoUrl("https://dev.azure.com/timwaldburger/PACT")),
    "organisation: timwaldburger \u00b7 project: PACT");
  assert.equal(adoReadingLine(readAdoUrl("https://dev.azure.com/timwaldburger")),
    "organisation: timwaldburger \u00b7 project: not in this URL - type it");
});

test("nothing is stated about a reading that failed or did not happen", () => {
  assert.equal(adoReadingLine(readAdoUrl("prose")), "");
  assert.equal(adoReadingLine(), "");
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

// The ADO panel's source, from its opening function to the helper that follows
// it, read the way the other panel tests read one.
const PANEL = (() => {
  const start = APP.indexOf("function openAdoPanel(");
  assert.ok(start >= 0, "the ADO panel is not in the script");
  const end = APP.indexOf("\n// A type slot's select, empty until the instance answers.", start);
  assert.ok(end > start, "the ADO panel does not end where its helper begins");
  return APP.slice(start, end);
})();

const APPLY = (() => {
  const start = PANEL.indexOf("function applyUrl(");
  assert.ok(start >= 0, "the URL reading is not in the panel");
  const end = PANEL.indexOf("\n    urlInput.addEventListener", start);
  assert.ok(end > start, "the reading does not end where its listeners begin");
  return PANEL.slice(start, end);
})();

test("the panel asks for one URL and keeps both stored values editable", () => {
  assert.match(PANEL, /urlInput\.id = "ado-url";/);
  assert.match(PANEL, /form\.appendChild\(formRow\("URL", urlInput\)\);/);
  // One URL entry field, and the two values the plan stores still there, both
  // as plain inputs - nothing disabled, so a wrong reading can be corrected.
  const ids = [...PANEL.matchAll(/\.id = "(ado-[a-z-]+)";/g)].map((m) => m[1]);
  assert.deepEqual(ids.filter((id) => /^ado-(url|org|project)$/.test(id)),
    ["ado-url", "ado-org", "ado-project"]);
  assert.doesNotMatch(PANEL, /orgInput\.disabled|projectInput\.disabled/);
});

test("a paste reads the URL, fills both values and states what it read", () => {
  assert.match(PANEL, /urlInput\.addEventListener\("paste"/);
  assert.match(PANEL, /urlInput\.addEventListener\("change", function \(\) \{ applyUrl\(false\); \}\)/);
  assert.match(APPLY, /var reading = readAdoUrl\(url\);/);
  assert.match(APPLY, /orgInput\.value = reading\.organizationUrl;/);
  assert.match(APPLY, /projectInput\.value = reading\.project;/);
  assert.match(APPLY, /readLine\.textContent = adoReadingLine\(reading\);/);
  assert.match(APPLY, /readLine\.hidden = false;/);
});

test("an unparseable paste refuses with the parser's own words, and keeps both values", () => {
  assert.match(APPLY, /if \(reading\.refusal\) \{[\s\S]*?error\.set\(reading\.refusal\);[\s\S]*?return;/);
  // The refusal comes from the parser, so the panel cannot word a second set of
  // accepted shapes that drifts from the ones the reading accepts.
  assert.doesNotMatch(APPLY, /dev\.azure\.com/);
});

test("a URL with no project fills the organisation and asks for the project", () => {
  assert.match(APPLY, /if \(reading\.project !== ""\) projectInput\.value = reading\.project;/);
  assert.match(APPLY, /if \(pasted && reading\.project === ""\) projectInput\.focus\(\);/);
});

test("a stored mapping opens as the URL it is", () => {
  assert.match(PANEL, /var urlInput = input\(adoUrlFor\(mapping\)\);/);
  assert.match(PANEL, /if \(urlInput\.value\.trim\(\) !== ""\) applyUrl\(false\);/);
});
