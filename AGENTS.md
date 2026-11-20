# PACT: a map for agents

PACT - People Allocation & Capacity Tracker - is a local plan of who works on
what, for how long, and how much of their time it takes. One row is one Person,
and the height of a block is how much of that person a Project takes. It is a
dependency-free Node server over one JSON file, with a hand-written front end
and no build step: `node server.mjs` runs it, `node --test` tests it.

**This file is a map, not a manual.** It says where the answer is and how to
behave while finding it, and answers nothing itself.

## Where the answers live

| Question | Read |
| --- | --- |
| What is PACT, and how do I run it? | [README.md](README.md) |
| What does this word mean? | [GLOSSARY.md](GLOSSARY.md) |
| Can it do X, and where is the control? | [docs/features.md](docs/features.md) |
| What documentation is there at all? | [docs/index.md](docs/index.md) |
| What did the first version promise, and what was left out? | [docs/scope.md](docs/scope.md) |
| Why is it built this way? | [docs/adr/](docs/adr/) |
| Where is that in the code? | `server.mjs`, `lib/` (the plan store, its validation and its atomic write), `public/` (the app, and the pure rules it shares with the tests), `test/` (one file per set of rules) |
| Do the documents still match the code? | `test/docs.test.mjs` |

The glossary is the language: look the term up and quote the entry, and treat
its `_Avoid_` line as the list of words that are wrong. The feature reference is
the territory: one section per capability, each ending in where its controls
live. Both are more current than any summary of them, including this one.

## Rules for answering

1. **Quote the glossary.** Use its words, not the ones its `_Avoid_` lines rule
   out.
2. **Never edit the plan JSON directly.** A hand edit skips the validation, the
   atomic write and the guard that refuses a write when the file changed
   underneath, so it can leave a plan the app will not load. Change the plan
   through the app or its HTTP API, where every write goes through the store.
3. **Never turn "I wrote a value" into "it looks right".** A visual outcome is
   verified only if it was measured or somebody looked at it. If neither
   happened, say what changed and ask.
4. **When the documents are silent, say so** and point at them. Do not fill the
   gap with a guess.
5. **Do not invent figures.** Nothing computes the plan's numbers for you yet:
   the report draws them for a person at the screen. If an answer needs a
   figure, say so and point at the report rather than adding one up yourself.
6. **A question with no home gets a home, not a line here.** If a user's
   question is answered by neither the glossary nor the feature reference, fix
   *that* document. Never add the answer to this file.

## Keeping this file

Roughly 120 lines is the budget. Past it, something was answered here that
belongs in the glossary or the feature reference: move it there and leave a
pointer.

There is deliberately no `CLAUDE.md` and no `.github/copilot-instructions.md`.
Claude Code reads `AGENTS.md` only when no `CLAUDE.md` sits beside it, and a
second pointer file drifts from the first.
