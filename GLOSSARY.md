# Glossary

The words nico-agent uses, in the UI, the CLI, the docs and the skills. Use
these, not the synonyms under _Avoid_.

## Work

**Source**: an issue tracker nico-agent reads issues from: GitHub Issues or a
Linear team. _Avoid_: provider, tracker integration.

**Repo**: a GitHub repository nico-agent dispatches into, by slug and local
clone path, with its Switches and launch defaults. _Avoid_: project.

**Blocker**: an issue that must be resolved before another can start, as the
Source's native dependency relation records it. _Avoid_: dependency.

**Ready**: an open, unstarted issue labelled `ready-for-agent`, unassigned or
assigned only to the user, whose Blockers are all resolved. _Avoid_:
available, todo.

**Stackable**: an issue that would be Ready except that each unresolved
Blocker has an open PR in the same Repo, so work can start on top of that PR.
_Avoid_: blocked, pending.

**Research issue**: an issue labelled `research` beside `ready-for-agent`.
Its Implementer writes findings to one Markdown file and opens it as a PR.
_Avoid_: spike.

**Gardening issue**: an issue labelled `gardening` beside `ready-for-agent`,
filed by quality-scan in a category the Repo pre-approved. The only work
faux-nico starts. _Avoid_: chore, cleanup task.

## Running

**Loop**: what `serve` does every 10 minutes and on every PR event: fill each
Repo's room, start Reviewers, restart what broke. It makes no judgment.
_Avoid_: scheduler, orchestrator, Lead.

**Room**: how many Implementers a Repo may run at once; 3 unless set.
_Avoid_: concurrency, slots.

**Dispatch**: one issue sent to one Implementer in its own herdr workspace
and worktree, from start until Closed. An issue has at most one live
Dispatch. _Avoid_: job, task, run.

**Base**: the branch a Dispatch's worktree starts from and its PR targets.
For a Stacked dispatch, the Blocker's PR head branch. _Avoid_: target branch.

**Stacked dispatch**: a Dispatch started on the head branch of a Blocker's
open PR, so its PR targets that PR's branch. _Avoid_: dependent dispatch.

**In flight**: an issue with a Dispatch that is not Closed. _Avoid_: active,
in progress.

**Implementer**: the agent a Dispatch starts to implement the issue and open
a draft PR with Evidence. _Avoid_: worker.

**Reviewer**: the agent started in the same workspace once a PR exists, on a
different Harness by default, to re-run the verification and record a
Verdict. _Avoid_: checker.

**Asking**: an Implementer waiting on a human, with the question its screen
shows. faux-nico answers it when the Repo's docs settle it; otherwise the
user is notified. _Avoid_: stuck, blocked.

**Restart**: the one recovery action: start a fresh agent in the issue's
existing worktree with a note of what happened. _Avoid_: resume, repair,
garden.

**Needs you**: the strip across Repos listing what only the user can act on:
Asking, failed twice, Verified PRs to merge. _Avoid_: inbox, alerts.

**Harness**: the coding agent CLI a Dispatch runs on: claude, codex,
opencode. Each has launch modes, models and Effort values. _Avoid_: tool,
provider.

**Effort**: the Harness's reasoning level for a launch. _Avoid_: thinking
budget.

**Switch**: a per-Repo on/off for one automatic step: dispatch, stack,
review, restart, flip to ready, faux-nico answers, gardening, quality-scan.
_Avoid_: standing order, manual mode.

**Close**: end a Dispatch, removing its worktree and workspace; the branch
and PR stay. _Avoid_: finish, archive.

## Verifying

**Stage**: where a Dispatch stands, derived from the Source and GitHub, never
from the agent: Implementing, PR draft, Verified, Merged, Failed. _Avoid_:
status.

**Verification skill**: the Repo's own skill that launches the app, drives a
feature, and captures Evidence. _Avoid_: test plan.

**Evidence**: what a verification run captured: output, screenshots,
transcripts. Summarised in the PR body, stored in the Bucket. _Avoid_:
proof, test results.

**Verdict**: the Reviewer's pass or fail on one commit of a PR, with
findings, recorded locally by a typed command. A new push invalidates it.
_Avoid_: approval, review.

**Verified**: a PR whose latest commit has a passing Verdict; nico-agent
flips it from draft to ready. _Avoid_: approved, green.

**Bucket**: the git repo at `/mnt/agents-land/nico-agent-bucket` holding
Evidence, one commit per Verdict, served with the Board through the tunnel.
_Avoid_: artifact store.

## Away

**faux-nico**: the agent that stands in for the user: fresh per trigger,
reads the Repo's `PRODUCT.md`, answers what is settled, starts gardening
when the loop is dry. _Avoid_: Lead, proxy, assistant.

**quality-scan**: the weekly skill that audits a Repo for bloat and
deepening opportunities and files issues. _Avoid_: linter, retro.

**Morning summary**: `morning.md`, written once a day: what to merge in which
order, what needs an answer, what failed, what gardening landed, what ideas
were filed. Rendered first on the Board. _Avoid_: report, digest.

**Action log**: the file nico-agent appends to for every action the loop or
faux-nico took, which the Morning summary reads. _Avoid_: history,
conversation.
