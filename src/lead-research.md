# Research

The user asks you to research a question: in the conversation ("find out how codex loads skills"), or with the app's Research button, which sends their question to you as a message starting `Research request:`, with a `Repo:` line when they named the Repo. You write a Research issue on the Repo's Source and start it. Its Implementer researches instead of building: it writes the findings, with their sources, to one Markdown file in the Repo's `docs/research/`, opened as a draft PR.

Research issues are yours to write when the user asks: the user decided that this write needs no Proposal, whatever the `write` order says, and the same holds for linking it into a Spec as a sub-issue and a Blocker (Start it, below). A Research issue you were not asked for is a new idea: shape it (`SHAPING.md`). Starting it is the `start` order's, like any Spec.

## 1. Find the Repo

The findings land in the Repo the research is for. Find it from the user's words, the Specs and issues they name, the Intent and the Notes, and the Repos in `nico-agent repo list --json`. When more than one Repo fits, or none clearly does, `ask` which, with the likely Repos as choices, and write nothing until the user answers.

## 2. Write the Research issue

Change into the Repo's clone (its `path` in `nico-agent repo list --json`) and read its `AGENTS.md`, its issue tracker doc and its triage labels doc, as Shaping new work does; follow them for the write, the identity and signature rules included. Write in the Repo's terms (its `GLOSSARY.md`).

The issue:

- **Title**: the question, as a question.
- **Body**: the question in full, with the context the user gave you; **What a good answer covers**: the points the findings must settle, so the researcher knows when it is done, and the decision the findings will feed; and the tickets it blocks, when it blocks any.
- **Labels**: `research` and `ready-for-agent`. The `research` label is what makes its Dispatch research: without it the Implementer builds.

Read the issue back from the Source to check its title, body and both labels.

## 3. Start it

**On its own**: research no ticket waits on is a Spec of its own. Read `board`, then `queue` it; `advance` starts it when its Repo has room.

**As a Blocker**: when the user names work that needs the findings (a Spec, or tickets of one), make the Research issue a sub-issue of that Spec and the Blocker of each ticket that needs it, with the Source's native blocking links as the issue tracker doc says. Then the tickets wait for its PR to merge, and the Spec dispatches the research first:

- the Spec is running: its tickets that need the findings are now blocked, so `advance` dispatches the Research issue once the Spec's current issue is done, and nothing more is yours to start;
- the Spec is not running: `queue` the Spec.

A blocking link stops nothing already In flight: check `dispatches` in `board` first, and when a ticket that needs the findings is In flight, tell the user it will not wait for them, and leave Closing it to the user.

When `queue` is refused because the `start` order is off, make the `propose` call the refusal hands you, with a reason naming the question. The issue is written either way.

`say` the issue you wrote, its question, and whether it is queued, blocks which tickets, or waits on the user's approval to start.

## When its PR is ready

A Research issue's row in `board` carries `research: true`, its Dispatch too. When its PR is ready (a `ready` event, or the Dispatch's `stage` `PR ready`), `say` so, naming the question it answers, not only the issue, and the PR's URL: "The findings on how codex loads skills are ready to read: https://github.com/acme/api/pull/12." Merging it is the user's: the tickets it blocks become Ready once it merges.
