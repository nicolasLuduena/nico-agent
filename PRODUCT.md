# nico-agent

<!-- impeccable:product-schema 1 -->

A localhost loop that works through `ready-for-agent` issues overnight on
herdr, on any Harness, and shows you in the morning what it did, what is
ready to merge, and what needs you.

## Users

One developer, on their own machine, with their own GitHub and Linear
identity. Other developers may install it later; each install still serves
one person. The user is asleep or away for most of the loop's work and reads
the result in the morning, from the desk or the phone.

## Platform

web

## Operating Context

Read desk first: a large monitor in the morning, GitHub open beside it,
where the review and the merging happen. The phone is a check-in, not a
lighter version of the page. Main's Board look is reference only; nothing of
it binds the rebuild.

## What it is

- **A loop**, in `serve`, every 10 minutes and on every PR event. Per Repo:
  fill the room (3 Dispatches In flight at most) with the oldest Ready issues; stack
  a Stackable issue on its Blocker's open PR; start a Reviewer when a PR
  appears; restart whatever broke. No judgment anywhere in it.
- **herdr as the runtime.** One workspace and worktree per issue. nico-agent
  owns no process; you can watch and take over any pane.
- **Any Harness.** claude, codex, opencode, each with its launch mode. The
  Reviewer runs on a different Harness than the Implementer by default,
  chosen per Repo.
- **A map per Project.** A node per issue of its Repos with its kind (code
  or research), state (Ready, Implementing, PR draft, Verified, Merged) and,
  when the Project has more than one, its Repo; edges for Blockers, across
  its Repos too; a stacked PR drawn to the PR it targets. A needs-you strip across
  Repos on top: Asking, failed twice, Verified PRs to merge, a failing
  Readiness check (what will break a Repo before it does). The morning
  summary renders first each day. A Refresh button is the one way to ask
  GitHub again.
- **A Wiki per Repo and per Library version.** What the code does, as a
  tree of Components whose every claim cites its lines, built overnight by
  a cheap model through headless Harness calls that code checks, kept in
  the Bucket, read on the Project's tab and by agents through `nico-agent
  mcp`: the Implementer, Reviewer and quality-scan ask about the Libraries
  their Repo uses, faux-nico and morning about the Repo itself, and the
  user's own Claude Code about all of them once added with `claude mcp add
  wiki -- nico-agent mcp` (`-s user` for every project).
- **Local first.** What GitHub or Linear said is kept locally and shown from
  there. A PR is asked about again only while it can still change; merged and
  closed are kept forever. Refresh re-asks on purpose. Rate limits and
  outages leave the Board readable and the loop running on what it knows.
- **Every setting a Repo or Project has, editable from its tab**, each
  shown with where it comes from (default, Project, Repo) and undone back to
  it: the Implementer and Reviewer launches, room, Base, its Project, and the
  switches: dispatch, stack, review, restart, flip to ready, faux-nico
  answers, gardening, quality-scan, wiki. All switches off is a Repo that only
  shows. Defaults: all on except faux-nico answers, gardening and wiki. A Repo is
  added, removed and moved into or out of a Project from the page too.

## How work is verified

- The Implementer follows the Repo's verification skill, captures Evidence,
  and writes the Evidence summary into the PR body.
- The Reviewer reads the diff from the worktree, never GitHub, re-runs the
  verification, and records a Verdict with a typed command: pass or fail,
  pinned to the commit, with findings. A new push invalidates it.
- On fail, the Implementer is restarted with the findings. On pass,
  nico-agent flips the PR from draft to ready. Nothing merges by itself;
  merging is the user's, in the morning, in dependency order.
- Evidence artifacts live in the Bucket, a git repo at
  `/mnt/agents-land/nico-agent-bucket`, one commit per PR head, Verdict and
  Close, served with the Board through a cloudflared tunnel behind
  Cloudflare Access for the user only. PR bodies link there.

## How it recovers

One verb: **restart**. Start a fresh agent in the issue's existing worktree
and tell it what happened: the machine rebooted, the agent stalled (idle with
no PR for 20 minutes), the PR conflicts with its base, the PR below it
merged, the Reviewer failed it. Same reason twice on one issue, or the PR
below closed unmerged: stop and put it in the needs-you strip. State is files
in the config directory, written atomically; herdr and the Sources stay the
truth. `serve` runs as a user service with lingering, restarts the loop on
boot, and writes one entry saying which Dispatches lost their agents.

## When the user is away

- **faux-nico**, a fresh agent per trigger in a worktree of the Repo. When an
  Implementer asks, it answers only what the Repo's `PRODUCT.md` settles, in
  the user's voice, and otherwise sends one live notification and waits.
  When the loop runs dry, it dispatches existing gardening issues.
- **quality-scan**, weekly per Repo: a bloat audit and a deepening scan,
  filed as issues. Pre-approved categories get `ready-for-agent` and
  `gardening`; the rest get `needs-triage` for the user.
- **morning**, once a day: reads the action log and PRs and writes
  `morning.md`: merge these in this order, these need an answer, these
  failed, this gardening landed, these ideas were filed.

One of these herdr reports blocked, most likely on a permission prompt, is
kept open with whatever it holds, an answer ready or half its filing: one
notification names the agent to take over, and for a faux-nico the question,
to answer by hand.

## Gardening

Pre-approved for quality-scan to file as `gardening`:

- Dead code: unused functions, options, flags or config, found by grep.
- Test gaps: risky logic with no test through `run` that fails when it breaks.
- Lint debt: `#[allow]`s and clippy findings that can be fixed instead of
  silenced.
- Single-implementation abstractions: a trait, wrapper or factory with one
  implementation that only passes calls through.

## What it writes to a Source

Three things only: the Claim (assigning the issue to the user), the Evidence
summary in the PR body, and the draft-to-ready flip on a passing Verdict.
Findings, retries and Verdicts stay local.

## Principles

1. **Trust first, then parallel.** Lock a Repo (lint, CI, verification)
   before raising its room.
2. **Mechanical in code, judgment in the user.** The loop counts; the user
   decides what to build. faux-nico answers only what is already decided.
3. **Local first.** Nothing of the internal flow depends on GitHub being
   reachable or on anyone else seeing it.
4. **Restart, never repair.** Every failure is a fresh agent with a note.
5. **Evidence over reading.** A PR carries proof it works; the user reads
   for shape, not for bugs.
6. **Necessary for the goal, or not here.** A command exists only when
   someone outside the process must call it. A feature exists only when the
   night or the morning needs it.

## Built as

One Rust binary, `nico-agent`, for speed, a small footprint, and types that
hold: `serve` runs the loop and the web app; `repo`, `dispatch`, `answer`
and `verdict` are the commands outsiders call. Everything outside the process
(herdr, git, `gh`, Linear, notifications, the clock) is reached through one
boundary with a real and a fake implementation, so every test runs without
herdr or the network. The web app is Svelte, built with Vite and embedded in
the binary, designed and checked with the impeccable skill against
`DESIGN.md`, light and dark, phone width first.

## Where this is going

1. The loop runs a night on `txpipe-shop/audit-notes` and `Bleentr/prototype`
   and the morning summary is read, not the panes.
2. The Verdict gate holds for two weeks without a bad PR reaching the user.
3. faux-nico answers and gardening are switched on, Repo by Repo.
4. Later, not now: auto-merge for labelled tickets; the merge-conflict flow.

## History

The previous build (branch `main`, TypeScript on Bun) had a Lead agent, a
Queue, a Scheduler, voice, and Partner tabs. It is kept as reference: its
herdr, `gh` and Linear call shapes, its dispatch steps and stacking rules
were proven and are the ones to port. Nothing from it is reused as code.
