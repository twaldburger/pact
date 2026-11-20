---
type: Index
title: PACT documentation
description: Every page under docs/, with what it is for.
---

# PACT documentation

The documentation outside [`README.md`](../README.md), which is the front door,
[`GLOSSARY.md`](../GLOSSARY.md), which is the language, and
[`AGENTS.md`](../AGENTS.md), which is the map an agent reads. Every page under
`docs/` is listed here with one line saying what it is for, and the map that
sits outside it is listed first.

- [AGENTS.md](../AGENTS.md) - the map for a new agent: what to read, and the
  rules for answering.
- [features.md](features.md) - the feature reference: what each capability does,
  how it behaves and where its controls live.
- [scope.md](scope.md) - what the first version covers, and what is deliberately
  left out of it.
- [adr/0001](adr/0001-no-dependency-node-server-with-a-json-file.md) - run PACT
  as a dependency-free Node server over a single JSON file.
- [adr/0002](adr/0002-no-framework-and-no-build-step.md) - hand-write the front
  end: no framework and no bundler.
- [adr/0003](adr/0003-assignment-is-the-timeline-item.md) - the Timeline item is
  an Assignment, not a Project on a row.
- [adr/0004](adr/0004-rows-are-scaled-to-availability.md) - a row's full height
  was that Person's Availability; superseded by 0006.
- [adr/0005](adr/0005-archive-rather-than-delete.md) - removing a Person or a
  Project archives it.
- [adr/0006](adr/0006-allocations-are-absolute-so-rows-are-a-full-fte.md) -
  Allocations are absolute, so every row is a full FTE.
- [adr/0007](adr/0007-deletion-beside-archiving.md) - deletion exists beside
  archiving.
- [index.md](index.md) - this page: the list of documentation pages.

The ADRs are numbered in the order the decisions were made, and a later one may
amend an earlier one in place; read the one a page links to, not the oldest on
the subject.
