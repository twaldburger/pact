/*
 * PACT's Markdown subset: the little of Markdown the in-app help can draw.
 *
 * The help panel reads `docs/features.md` and `GLOSSARY.md` out of the
 * repository, so it must draw whatever those two documents actually contain -
 * and nothing more than it needs. This is a deliberate subset, not a Markdown
 * implementation: headings, paragraphs, unordered and ordered lists, tables,
 * links, inline emphasis and code spans, a rule, and the front matter block a
 * page opens with (which is metadata, so it is stripped rather than drawn).
 * `MARKDOWN_CONSTRUCTS` names the subset, and `test/help.test.mjs` fails when a
 * document starts using a construct the subset does not list, so the two cannot
 * silently drift apart.
 *
 * The subset is also where the help's two reading rules live, because both are
 * about what a line means rather than about the panel:
 *
 * - An anchor is derived from the words of a heading or a glossary term, by the
 *   GitHub rule the documents' own links already assume (`The report's time
 *   buckets` is `#the-reports-time-buckets`).
 * - A glossary entry is a line that is one bold term and a colon, and nothing
 *   else - `**Person**:` - while the `_Avoid_:` line under it begins its own
 *   paragraph, so the ruled-out words read as a line of their own rather than
 *   running into the definition.
 *
 * Links are resolved against the documents the caller allows. A link between
 * those documents becomes a real control; anything else - the README, an ADR,
 * the web - becomes plain text, so the panel never grows a dead or an escaping
 * link. Where the caller also names the anchors that exist, a link to a heading
 * that is not there is plain text too.
 *
 * A plain ES module with no imports, so the browser (public/app.js) and
 * `node --test` read exactly the same source.
 */

// Everything this subset can draw. Kept as a list so a document that starts
// using something else is caught against it rather than drawn as a run of
// asterisks.
export const MARKDOWN_CONSTRUCTS = Object.freeze([
  "frontmatter",
  "heading",
  "paragraph",
  "unordered-list",
  "ordered-list",
  "table",
  "link",
  "emphasis",
  "code",
  "rule"
]);

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

// The page's metadata block, and the text that follows it. A page without one
// is returned whole, so a document that never gains front matter reads the same.
export function splitFrontMatter(markdown) {
  const text = String(markdown == null ? "" : markdown);
  const block = FRONT_MATTER.exec(text);
  if (!block) return { fields: {}, body: text };
  const fields = {};
  for (const line of block[1].split("\n")) {
    const field = /^([A-Za-z-]+):\s*(.*)$/.exec(line.trim());
    if (field) fields[field[1]] = field[2].trim();
  }
  return { fields: fields, body: text.slice(block[0].length) };
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(text) {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

// A glossary entry's own line: one bold term and a colon. `**Where the
// controls are.**` is prose, not an entry, so the colon has to end the line.
export function termOf(line) {
  const match = /^\*\*([^*\n]+)\*\*:\s*$/.exec(String(line).trim());
  return match ? match[1].trim() : null;
}

// Inline markup as the words it produces: what a heading's anchor is built
// from, and what a reader would see.
export function plainText(markdown) {
  return String(markdown)
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\[([^\]\n]*)\]\([^)\s]+\)/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1");
}

// The GitHub rule the documents' own links were written against: the words,
// lowercased, with everything that is not a letter, a digit, a space or a
// hyphen dropped, and the spaces turned into hyphens. `The report's time
// buckets` is `the-reports-time-buckets`; `FTE-day` is `fte-day`.
export function slugFor(text) {
  return plainText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .trim()
    .replace(/ +/g, "-");
}

function directoryOf(filePath) {
  const cut = filePath.lastIndexOf("/");
  return cut === -1 ? "" : filePath.slice(0, cut);
}

// A path inside the repository, with `.` and `..` resolved against the
// document's own directory. Kept here rather than in `node:path` because this
// module runs in the browser too.
function resolveRelative(fromPath, target) {
  const stack = directoryOf(fromPath) ? directoryOf(fromPath).split("/") : [];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/*
 * Where a link points, or null when it points somewhere the help cannot go.
 * `context` is the document being drawn: its key and its repository path, and
 * the documents the caller allows. An anchor-only target stays in the same
 * document, which is how the reference links its own sections.
 */
export function resolveHelpTarget(target, context) {
  const documents = (context && context.documents) || [];
  const fromPath = context && context.path;
  const text = String(target == null ? "" : target).trim();
  // A scheme or a protocol-relative address is not one of our documents.
  if (!text || /^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//")) return null;
  const cut = text.indexOf("#");
  const pathPart = cut === -1 ? text : text.slice(0, cut);
  const anchor = cut === -1 ? "" : text.slice(cut + 1);
  const resolved = pathPart === "" ? fromPath : resolveRelative(fromPath, pathPart);
  const document = documents.find(function (entry) { return entry.path === resolved; });
  if (!document) return null;
  return { doc: document.key, label: document.label, anchor: anchor };
}

const INLINE = /`[^`\n]+`|\[[^\]\n]*\]\([^)\s]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*|_[^_\n]+_/g;

function renderLink(token, context) {
  const parts = /^\[([^\]\n]*)\]\(([^)\s]+)\)$/.exec(token);
  const label = renderInline(parts[1], context);
  const target = resolveHelpTarget(parts[2], context);
  // A target the help cannot reach, or a heading that is not where the document
  // says it is: plain text, never a dead control.
  if (!target) return '<span class="md-plainlink">' + label + "</span>";
  const known = context.anchors && context.anchors[target.doc];
  if (target.anchor && known && !known.includes(target.anchor)) {
    return '<span class="md-plainlink">' + label + "</span>";
  }
  const anchor = target.anchor ? ' data-help-anchor="' + escapeAttribute(target.anchor) + '"' : "";
  return '<a class="md-link" href="#" data-help-doc="' + escapeAttribute(target.doc) + '"' + anchor + ">" +
    label + "</a>";
}

function renderInline(text, context) {
  let out = "";
  let last = 0;
  for (const match of String(text).matchAll(INLINE)) {
    out += escapeHtml(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      out += '<code class="md-code">' + escapeHtml(token.slice(1, -1)) + "</code>";
    } else if (token.startsWith("[")) {
      out += renderLink(token, context);
    } else if (token.startsWith("**")) {
      out += "<strong>" + renderInline(token.slice(2, -2), context) + "</strong>";
    } else {
      out += "<em>" + renderInline(token.slice(1, -1), context) + "</em>";
    }
    last = match.index + token.length;
  }
  return out + escapeHtml(String(text).slice(last));
}

function isRule(line) {
  return /^\s*([-*_])\1{2,}\s*$/.test(line);
}

function headingOf(line) {
  const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  return match ? { level: match[1].length, text: match[2] } : null;
}

function unorderedItemOf(line) {
  const match = /^\s*[-*+]\s+(.+)$/.exec(line);
  return match ? match[1] : null;
}

function orderedItemOf(line) {
  const match = /^\s*\d+[.)]\s+(.+)$/.exec(line);
  return match ? match[1] : null;
}

// A table's own shape: a row of cells and, under it, the row of dashes and
// colons that says it is a table rather than a paragraph beginning with a bar.
function isTableStart(lines, index) {
  const line = lines[index] || "";
  const next = lines[index + 1] || "";
  if (!/^\s*\|/.test(line)) return false;
  return /^\s*\|?[\s:|-]*-[\s:|-]*$/.test(next) && next.includes("|");
}

function isBlockStart(lines, index) {
  const line = lines[index];
  return Boolean(headingOf(line)) || isRule(line) || unorderedItemOf(line) !== null ||
    orderedItemOf(line) !== null || isTableStart(lines, index);
}

// One list: its items, with a wrapped line joined onto the item it continues.
// The documents hard-wrap their prose, so an item is very often two lines - and
// often enough a code span spans the join.
function readList(lines, start, kind) {
  const itemOf = kind === "ol" ? orderedItemOf : unorderedItemOf;
  const items = [];
  let index = start;
  while (index < lines.length) {
    const item = itemOf(lines[index]);
    if (item !== null) {
      items.push(item.trim());
      index += 1;
      continue;
    }
    if (!lines[index].trim()) {
      // A blank line ends the list unless the next line is another item.
      if (itemOf(lines[index + 1] || "") !== null) { index += 1; continue; }
      break;
    }
    if (!items.length || !/^\s+\S/.test(lines[index])) break;
    items[items.length - 1] += " " + lines[index].trim();
    index += 1;
  }
  return { items: items, next: index };
}

function renderList(items, kind, context) {
  const tag = kind === "ol" ? "ol" : "ul";
  const body = items.map(function (item) {
    return "<li>" + renderInline(item, context) + "</li>";
  }).join("");
  return '<' + tag + ' class="md-list md-list-' + tag + '">' + body + "</" + tag + ">";
}

function cellsOf(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (cell) {
    return cell.trim();
  });
}

function readTable(lines, start, context) {
  const head = cellsOf(lines[start]);
  const rows = [];
  let index = start + 1;
  while (index < lines.length) {
    const line = lines[index];
    if (!/^\s*\|/.test(line)) break;
    // The delimiter row carries the alignment, which this subset does not draw.
    if (!/^[\s:|-]*-[\s:|-]*$/.test(line.trim())) rows.push(cellsOf(line));
    index += 1;
  }
  const cells = function (tag, values) {
    return "<tr>" + values.map(function (value) {
      return "<" + tag + ">" + renderInline(value, context) + "</" + tag + ">";
    }).join("") + "</tr>";
  };
  const body = rows.map(function (row) { return cells("td", row); }).join("");
  return {
    html: '<table class="md-table"><thead>' + cells("th", head) + "</thead><tbody>" + body + "</tbody></table>",
    next: index
  };
}

function readParagraph(lines, start, context, prefix) {
  const collected = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) break;
    if (collected.length && (isBlockStart(lines, index) || /^_Avoid_:/.test(line.trim()))) break;
    collected.push(line.trim());
    index += 1;
  }
  // Hard-wrapped prose joins back into one paragraph, which is also what puts a
  // code span that spans a line break back together.
  const text = collected.join(" ");
  const term = termOf(collected[0]);
  const attributes = term
    ? ' class="md-term" id="' + escapeAttribute(prefix + slugFor(term)) + '"'
    : (/^_Avoid_:/.test(text) ? ' class="md-avoid"' : "");
  return { html: "<p" + attributes + ">" + renderInline(text, context) + "</p>", next: index };
}

/*
 * A document as HTML. `options` carries the document being drawn - `doc` and
 * its repository `path` - the `documents` a link may name, and optionally the
 * `anchors` that exist per document, so a link to a heading that is not there
 * becomes plain text instead of a control that goes nowhere. `idPrefix` keeps
 * the anchors a heading carries out of the page's own element ids - a glossary
 * term called `Filter` or `Minimap` would otherwise claim the grid's id.
 */
export function renderMarkdown(markdown, options) {
  const context = options || {};
  const prefix = context.idPrefix || "";
  const lines = splitFrontMatter(markdown).body.split("\n");
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (isRule(line)) {
      out.push('<hr class="md-rule">');
      index += 1;
      continue;
    }
    const heading = headingOf(line);
    if (heading) {
      const id = escapeAttribute(prefix + slugFor(heading.text));
      out.push("<h" + heading.level + ' class="md-h md-h' + heading.level + '" id="' + id + '">' +
        renderInline(heading.text, context) + "</h" + heading.level + ">");
      index += 1;
      continue;
    }
    if (unorderedItemOf(line) !== null || orderedItemOf(line) !== null) {
      const kind = unorderedItemOf(line) !== null ? "ul" : "ol";
      const list = readList(lines, index, kind);
      out.push(renderList(list.items, kind, context));
      index = list.next;
      continue;
    }
    if (isTableStart(lines, index)) {
      const table = readTable(lines, index, context);
      out.push(table.html);
      index = table.next;
      continue;
    }
    const paragraph = readParagraph(lines, index, context, prefix);
    out.push(paragraph.html);
    index = paragraph.next;
  }
  return out.join("\n");
}
