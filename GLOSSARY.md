# Glossary

The words nico-agent uses, in the UI, the CLI, the docs and the skills. Use
these, not the synonyms under _Avoid_.

## Work

**Source**: an issue tracker nico-agent reads issues from: GitHub Issues or a
Linear team. _Avoid_: provider, tracker integration.

**Repo**: a GitHub repository nico-agent dispatches into, by slug and local
clone path, with its Switches and launch defaults.

**Project**: Repos that work together: one tab and map, defaults its Repos
inherit, Blockers honoured across them. A Repo belongs to at most one; one
that names none is a Project of its own, named by its slug. _Avoid_:
workspace (herdr's), group; Linear's is always written "Linear project".

**Blocker**: an issue that must be resolved before another can start, as the
Source's native dependency relation records it. One in another Repo of the
Project is resolved once closed and, when that Repo has an Install, installed
since; it is never stacked on. _Avoid_: dependency.

**Ready**: an open, unstarted issue labelled `ready-for-agent`, assigned only
to the user, or also unassigned when its Repo's `mine` Switch is off, whose
Blockers are all resolved. _Avoid_: available, todo.

**Stackable**: an issue that would be Ready except that each unresolved
Blocker has an open PR in the same Repo, so work can start on top of that PR.
_Avoid_: blocked, pending.

**Research issue**: an issue labelled `research` beside `ready-for-agent`.
Its Implementer writes findings to one Markdown file and opens it as a PR.
_Avoid_: spike.

**Gardening issue**: an issue labelled `gardening` beside `ready-for-agent`,
filed by quality-scan in a category the Repo pre-approved. The Loop starts a
Ready one only while nothing else in its Repo is Ready or Stackable and the
Repo's gardening Switch is on; it is never stacked. _Avoid_: chore, cleanup
task.

## Running

**Loop**: what `serve` does every 10 minutes and on every PR event: fill each
Repo's room, start Reviewers, restart what broke. It makes no judgment.
_Avoid_: scheduler, orchestrator, Lead.

**Room**: how many Dispatches a Repo may have In flight at once, a draft PR's included; 3 unless set.
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

**Reviewer**: the agent started in the same workspace once a PR exists, or
by hand from the Board, on a different Harness by default, in its own
worktree at the PR's pushed head, to re-run the verification and record a
Verdict. _Avoid_: checker.

**Asking**: an Implementer waiting on a human, with the question its screen
shows. faux-nico answers it when the Repo's docs settle it; otherwise the
user is notified. _Avoid_: stuck, blocked.

**Answer**: what the user or faux-nico sends an Asking Implementer, in words
(typed and submitted) or keys (pressed in its pane, as a choice dialog takes
them), kept on its Dispatch with the question it answers. _Avoid_: reply,
response.

**Restart**: the one recovery action: start a fresh agent in the issue's
existing worktree with a note of what happened. _Avoid_: resume, repair,
garden.

**Needs you**: the strip across Repos listing what only the user can act on:
Asking, failed twice, a review given up on or stopped, Verified PRs to merge, a
Run whose agent herdr reports blocked, a failed or refused Install, a failing
Readiness check. _Avoid_: inbox, alerts.

**Readiness check**: one of the things a Repo needs before the Loop works it,
checked when `serve` starts, on Refresh, after a write to its or its
Project's settings and after its Install: its clone, a fetch that asks
nothing, `.evidence/` ignored and, while it reviews, a Verification skill
on its Base, the skills its steps' prompts name for their Harness (and
the skills each of those calls, one level deep; claude's plugins count for
claude), whether the GitHub App is on it (without it, its PRs are opened as the
user, which passes), and whether herdr's server answers its client. A failing one is in needs-you with its help, and
stops nothing. _Avoid_:
health, doctor.

**Install**: the command a Repo runs in its clone after a PR merges into its
Base, so what it builds (the skills, the nico-agent binary) is what the next
agent uses: `nico-agent install <owner/name>` in a herdr pane, refused unless
the clone is on its Base with no changes to tracked files, then a
fast-forward pull and the command. One at a time per Repo; a merge while one
runs queues one more. _Avoid_: deploy, release.

**Harness**: the coding agent CLI a Dispatch runs on: claude, codex,
opencode. Each has launch modes, models and Effort values. _Avoid_: tool,
provider.

**Effort**: the Harness's reasoning level for a launch. _Avoid_: thinking
budget.

**Switch**: a Repo's on/off, or its Project's default, for one automatic
step: dispatch, mine (only issues assigned to the user), stack, review,
restart, flip to ready, faux-nico answers, gardening, quality-scan, wiki.
_Avoid_: standing order, manual mode.

**Close**: end a Dispatch, removing its worktrees and workspace; the branch
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
Findings, recorded locally by a typed command. A new push invalidates it.
_Avoid_: approval, review.

**Finding**: one numbered item of a failing Verdict: what the Reviewer
observed against what a feature file or the PR's Evidence says. _Avoid_:
issue, comment.

**Ruling**: the Implementer's fixed (with its commit) or dismissed (with
why) on one Finding, kept in `rulings.md` in the Evidence. _Avoid_:
response, reply, triage.

**Verified**: a PR whose latest commit has a passing Verdict; nico-agent
flips it from draft to ready. _Avoid_: approved, green.

**Bucket**: the git repo at `/mnt/agents-land/nico-agent-bucket` holding
Evidence, one commit per PR head, Verdict and Close (the Reviewer's under
the head's `review/`), and each Repo's Wiki,
one commit per regeneration, served with the Board through the tunnel.
_Avoid_: artifact store.

## Away

**faux-nico**: the agent that stands in for the user on an Asking: fresh per
Asking, in a worktree of the Repo, it answers only what the Repo's
`PRODUCT.md`, the issue and its parent settle, and otherwise ends so the
user is notified. It starts no work. _Avoid_: Lead, proxy, assistant.

**quality-scan**: the weekly skill that audits a Repo for bloat and
deepening opportunities and files issues. _Avoid_: linter, retro.

**Morning summary**: `morning.md`, written once a day by the morning agent
from what `status` shows since the last one: what to merge in which order,
what needs an answer, what failed, what gardening landed, what ideas were
filed. Rendered first on the Board. _Avoid_: report, digest.

**Wiki**: what a Repo's or a Library's code does as of one commit, as a tree
of Components, each claim citing the lines it rests on, written by a wiki
build and kept in the Bucket. The user and the agents read it to find their
way around. It records what the code does, never what was decided: faux-nico
reads it to understand a question, never as grounds for its answer.
_Avoid_: DeepWiki, docs, documentation.

**Library**: a GitHub repository nico-agent keeps Wikis for and never
dispatches into, one Wiki per version asked for, so an agent asks about the
version a Repo uses instead of reading the whole library. _Avoid_:
dependency, package, external repo.

**Component**: a named part of a Wiki's code, with an overview, its files,
its Terms, its Interpretations and its sub-Components. One page of the Wiki.
_Avoid_: module, section, page.

**Interpretation**: a one-sentence claim about a Component, of one kind
(invariant, precondition, postcondition, effect, role), citing at least one
Anchor. _Avoid_: note, insight, fact.

**Term**: a name a Component's text uses that its code declares or gives its
own sense (a field, a type, a parameter, a word like "header"), with one
sentence of what it stands for, citing the lines that declare it. _Avoid_:
definition, glossary entry, field.

**Anchor**: a path and a line range at the Wiki's commit, the lines an
Interpretation or a Term cites. _Avoid_: evidence (that is a verification run's),
reference, citation.

**Relationship**: one Component using, calling, reading or writing another.
_Avoid_: dependency, edge, link.

**Gap**: a part of the code a Wiki never reached, with why. _Avoid_:
missing, TODO.

**Explainer**: a Component's walkthrough of how something in it works, as
numbered steps in order, each a one-sentence caption citing Anchors. At
most one per Component. _Avoid_: diagram,
illustration, figure.

**Stale**: an Interpretation or a Term of a Repo's Wiki whose anchored file changed on
the base since it was written; shown as such, never hidden, until a wiki
build asks about its part again. _Avoid_: outdated, invalid.

**Update**: a wiki build of a Repo's Wiki from the one before it, asking
again only about the parts whose files changed and copying the rest; a
parent whose parts changed keeps its Interpretations and Terms, Stale
where they are. _Avoid_: refresh, incremental build.

**Rebuild**: a wiki build of a Wiki from nothing, as its first one is,
asked for by the user. _Avoid_: reset, regenerate.

**Continue**: a wiki build asking again only the parts of a Wiki its
budget left Gaps, with a fresh budget, at the commit the Wiki describes.
_Avoid_: resume, retry.

**Run**: one start of a trigger's agent: a quality-scan, a faux-nico, the
morning agent or a wiki build, recorded with when it started and when it
ended, so a missed scan or morning shows in `status`. One whose agent herdr reports waiting on
a human is blocked, herdr's word: it stays open and the user is told once a
spell. An Implementer so is Asking, never blocked. A Dispatch is never a
Run, nor called one. _Avoid_: job, session.
