# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A developer who works through coding agents. Today that is the author, using
their own GitHub and Linear identity on their own machine. Other developers
will install it on their own machines later. Each install still serves one
person on localhost. Shared, multi-user boards are not planned.

The Board stays open all day in a tab or on a second screen. The user mostly
glances at it to see which Dispatches changed Stage or Agent state and which
issues have become Ready. They then dispatch, launch reviews, and Close
finished work in short bursts before going back to herdr or the editor.

## Product Purpose

nico-agent is a localhost web app and CLI that sends coding agents onto
`ready-for-agent` issues. The user picks the issue, Harness, model, Effort, and
Base. nico-agent opens a herdr worktree workspace, starts the Implementer, and
later the Reviewer, in named tabs, and sends the skill call for that Harness.

Success means the user always knows what is Ready, what is In flight, and
where each Dispatch stands, and can act on any of them without opening a
terminal to work it out.

## Positioning

nico-agent decides what to run, where, and with which prompt. It does not run
anything itself. herdr owns every agent process, so the agents stay in the
terminal multiplexer the user already watches, and the user can take over any
pane by hand. nico-agent can crash or restart without affecting work in
progress (ADR 0001). Assigning an issue to the user (Claim) is the only change
it makes to a Source (ADR 0007). The Board brings GitHub Issues and Linear
together, including Stackable issues that can start on top of a Blocker's
open PR.

## Operating Context

- herdr workspaces and tabs, where agents actually run and are observed.
- Sources are GitHub Issues and Linear teams. Repos claim Linear issues through
  Linear selectors.
- Harnesses: claude, codex, opencode2, each with its own launch mode, sigil,
  models, and Effort values.
- GitHub PRs, which drive Stage (Implementing, PR ready, Review launched,
  Failed). The `ghbot` App identity is used when installed on a Repo.
- The CLI, which humans and agents drive just as much as the web app.

## Capabilities and Constraints

- **One agent with reach:** the Lead (ADR-0010) is the only agent that acts on
  the Board, within Standing orders the user sets; everything else it wants is
  a Proposal the user approves.
- **CLI parity:** every Board action must also be possible from the CLI, which
  follows AXI (ADR 0006). Mutations are idempotent, and the CLI never prompts
  interactively.
- **Domain vocabulary:** UI copy uses the `GLOSSARY.md` terms exactly (Source,
  Repo, Ready, Stackable, Board, Dispatch, Base, In flight, Stage, Agent state,
  Claim, Close, Harness, Effort). Use those terms, not the listed "Avoid"
  synonyms.
- **Light and dark:** the UI follows the system color scheme and must work in
  both.
- Stage comes from the Source and GitHub (ADR 0003). Agent state is shown but
  never used to decide Stage.
- Close is allowed once a Dispatch has a PR. While it is still Implementing,
  Close needs confirmation.
- Currently built as server-rendered HTML from `src/web.ts` with htmx on Bun.
  This is how it is built today, not a binding commitment.

## Evidence on Hand

- Domain glossary: `GLOSSARY.md`. Decisions: `docs/adr/`. Linear notes:
  `docs/linear.md`.
- No screenshots, testimonials, or usage data exist. Do not invent them.

## Product Principles

1. **Glanceable first.** The Board is a monitor. The current state of every
   Dispatch should be readable at a glance from across a desk, before anyone
   interacts with it.
2. **Never pretend to own the work.** herdr runs the agents, and the Source and
   GitHub hold the truth. The UI reflects them and does not invent its own
   state.
3. **One vocabulary everywhere.** The web app, the CLI, and the docs say the
   same thing in the same words.
4. **Cheap to act, safe to undo.** Dispatching, reviewing, and closing are
   quick. The only friction is on actions that would throw away unfinished
   work.
5. **Ready for a second user.** Nothing should assume the author's own repos,
   names, or setup, so another developer can install it and run it.
