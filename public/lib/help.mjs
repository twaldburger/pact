/*
 * PACT's in-app help: the documents it can reach, how each one sections, and
 * how a search is ranked.
 *
 * The documents stay where they are, in the repository, because the feature
 * reference, the glossary and the command line guide are documentation first.
 * What lives here is the allowlist - by name, never by a path a client sends -
 * and the reading of those files into the entries a search returns. The server
 * serves the allowlisted document by name with this same list, so the thing the
 * route will serve and the thing the panel will draw cannot disagree.
 *
 * A section is what a search result names: an `##` heading of the feature
 * reference, or a glossary term's own line. A section's anchor is the words of
 * its heading, by the same GitHub rule the documents' own links already use.
 * The opening of each document - its title and the prose before its first
 * heading - is a section too, named by that title, so a phrase from an opening
 * paragraph is findable rather than lost.
 *
 * The ranking is one rule, stated so it can be predicted: a section whose own
 * title contains the query comes before a section whose body does, and within
 * each of those two ranks the results stay in reading order - the feature
 * reference first, then the glossary, then the command line, each top to bottom.
 * One result per section, carrying the line that matched, so a section that
 * mentions the query six times is still one row. A line is searched and quoted
 * as the words it reads as rather than as its Markdown, so a result never shows
 * a reader a code span's backticks or a link's own target.
 *
 * A plain ES module, so the browser (public/app.js), the server (server.mjs)
 * and `node --test` read exactly the same source.
 */
import { plainText, renderMarkdown, slugFor, splitFrontMatter, termOf } from "./markdown.mjs";

/*
 * The documents the help may draw, by name. There are three, and nothing else
 * is reachable: the README, the ADRs, the scope doc and the appearance guide
 * are not in this list, so neither the route nor the panel can reach them.
 * `path` is repository-relative and is the only path the server ever reads for
 * a help request.
 */
export const HELP_DOCUMENTS = Object.freeze([
  Object.freeze({ key: "features", label: "Feature reference", path: "docs/features.md" }),
  Object.freeze({ key: "glossary", label: "Glossary", path: "GLOSSARY.md" }),
  Object.freeze({ key: "agent-tooling", label: "Command line", path: "docs/agent-tooling.md" })
]);

// The document the panel opens on when nobody has chosen one.
export const HELP_DOCUMENT_DEFAULT = HELP_DOCUMENTS[0].key;

// The most results the panel lists at once. The count line states how many
// there were, so nothing is silently withheld.
export const HELP_RESULT_LIMIT = 40;

export function helpDocument(key) {
  const wanted = typeof key === "string" ? key : "";
  return HELP_DOCUMENTS.find(function (entry) { return entry.key === wanted; }) || null;
}

/*
 * One document's entries, in reading order: the opening section named by the
 * document's own `#` title, then a section per `##`/`###` heading and per
 * glossary term. A heading with nothing under it is not an entry - that is what
 * keeps the glossary's `## Language` group heading out of the results - while
 * `lines` keeps the body as its own lines, so a result can quote the line that
 * matched rather than a paragraph a reader has to hunt through.
 */
export function helpSections(markdown) {
  const sections = [];
  let current = null;
  const open = function (title, anchor) {
    current = { title: title, anchor: anchor, lines: [] };
    sections.push(current);
  };
  for (const line of splitFrontMatter(markdown).body.split("\n")) {
    const trimmed = line.trim();
    const title = /^#\s+(.+?)\s*$/.exec(trimmed);
    const subheading = /^#{2,3}\s+(.+?)\s*$/.exec(trimmed);
    const term = termOf(trimmed);
    if (title) {
      open(title[1], slugFor(title[1]));
      continue;
    }
    if (subheading) {
      open(subheading[1], slugFor(subheading[1]));
      continue;
    }
    if (term) {
      open(term, slugFor(term));
      continue;
    }
    if (!current || !trimmed) continue;
    current.lines.push(trimmed);
  }
  return sections.filter(function (section) { return section.lines.length > 0; });
}

// The anchors one document defines, which is what a link between the two is
// checked against before it is drawn as a control.
export function helpAnchors(markdown) {
  return helpSections(markdown).map(function (section) { return section.anchor; });
}

// The line a result shows, trimmed to something a row can hold. A long line is
// cut around the match, so the reason it matched is never the part cut off.
function lineAround(line, needle) {
  const text = line.trim();
  const most = 150;
  if (text.length <= most) return text;
  const at = text.toLowerCase().indexOf(needle);
  const from = Math.max(0, Math.min(at === -1 ? 0 : at - 60, text.length - most));
  const cut = text.slice(from, from + most);
  return (from > 0 ? "..." : "") + cut + (from + most < text.length ? "..." : "");
}

/*
 * A search, ranked, over the documents handed in as `[{ key, markdown }]`.
 * Case-insensitive throughout, and one result per section: `matched` says
 * whether the section's own title or one of its body lines carries the query,
 * and `line` is the line that matched - the section's title for a title match,
 * since that is the line the query was found in. `rank` is 0 for a title match
 * and 1 for a body match, which is the whole of the ordering rule.
 */
export function searchHelp(documents, query) {
  const needle = String(query == null ? "" : query).trim().toLowerCase();
  if (!needle) return [];
  const results = [];
  HELP_DOCUMENTS.forEach(function (entry) {
    const source = (documents || []).find(function (doc) { return doc.key === entry.key; });
    if (!source) return;
    helpSections(source.markdown).forEach(function (section) {
      const titleMatch = section.title.toLowerCase().includes(needle);
      // A line is searched and quoted as the words it reads as, so a code span's
      // backticks or a link's own target never reach the result row.
      const plain = section.lines.map(plainText);
      const found = plain.findIndex(function (line) { return line.toLowerCase().includes(needle); });
      if (!titleMatch && found === -1) return;
      results.push({
        doc: entry.key,
        docLabel: entry.label,
        title: section.title,
        anchor: section.anchor,
        matched: titleMatch ? "title" : "body",
        line: titleMatch ? section.title : lineAround(plain[found], needle),
        rank: titleMatch ? 0 : 1
      });
    });
  });
  // The array is built in reading order and the sort is stable, so the two
  // ranks come out in document order without a second key to compare.
  return results.sort(function (a, b) { return a.rank - b.rank; });
}

/*
 * One document as the panel draws it. The anchors of all three documents are
 * handed in so a link to a heading that no longer exists reads as plain text
 * instead of offering a control that goes nowhere, and `idPrefix` keeps a
 * heading's anchor out of the page's own element ids.
 */
export function renderHelpDocument(doc, markdown, anchors, idPrefix) {
  return renderMarkdown(markdown, {
    doc: doc.key,
    path: doc.path,
    documents: HELP_DOCUMENTS,
    anchors: anchors || {},
    idPrefix: idPrefix || ""
  });
}
