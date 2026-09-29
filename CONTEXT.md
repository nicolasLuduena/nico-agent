# nico-agent

A localhost web app and CLI for dispatching coding agents onto issues and
launching their reviews. herdr runs and monitors the agents; nico-agent picks
what to run, where, and with which prompt.

## Language

### Work

**Source**:
An issue tracker nico-agent reads issues from: GitHub Issues or a Linear team.
_Avoid_: Provider, backend, tracker integration

**Repo**:
A GitHub repository nico-agent can dispatch into, known by its slug and the
path of a local clone. A Repo may claim Linear issues through a Linear selector.
_Avoid_: Project (that is a Linear concept)

**Linear selector**:
The rule a Repo uses to claim Linear issues: a team, narrowed by a project
and/or a label. One issue may match several Repos.
_Avoid_: Mapping, routing

**Blocker**:
An issue that must be resolved before another can start, as recorded by the
Source's native dependency relation.
_Avoid_: Dependency, prerequisite

**Ready**:
An issue labelled `ready-for-agent`, open and not started, unassigned or
assigned to the user, whose Blockers are all resolved.
_Avoid_: Available, eligible, todo

**Stackable**:
An issue that would be Ready except that each unresolved Blocker already has
an open PR in the same Repo, so work can start on top of that PR.
_Avoid_: Blocked, pending

**Board**:
The view of Ready, Stackable and In-flight issues across all Repos.
_Avoid_: Dashboard, queue

### Dispatching

**Dispatch**:
One issue sent to one implementer agent in its own herdr workspace and
worktree, from creation until it is Closed. An issue has at most one live
Dispatch.
_Avoid_: Job, run, task

**Stacked dispatch**:
A Dispatch of a Stackable issue, started on the head branch of its Blocker's
PR so its PR joins that stack.
_Avoid_: Dependent dispatch

**In flight**:
The state of an issue that has a Dispatch which has not been Closed.
_Avoid_: Active, running, in progress

**Implementer**:
The agent a Dispatch starts to implement the issue and open a draft PR.
_Avoid_: Worker, coder

**Reviewer**:
The agent launched in the same workspace, once a PR is linked, to review it.
_Avoid_: Checker

**Stage**:
Where a Dispatch stands, taken from the Source and GitHub: Implementing, PR
ready, Review launched. Also Failed, naming the step that failed.
_Avoid_: Status (ambiguous with Agent state)

**Agent state**:
What herdr reports about an agent right now: idle, working, blocked, done, or
unknown. It is shown, never used to decide the Stage.
_Avoid_: Status

**Claim**:
Assigning the issue to the user when it is dispatched, so nobody else picks it.
The only change nico-agent makes to a Source.
_Avoid_: Lock, reserve

**Close**:
Ending a Dispatch: removing its worktree and workspace and forgetting it.
Allowed once its PR is merged or closed, otherwise only with confirmation.
_Avoid_: Cleanup, archive, delete

### Harnesses

**Harness**:
A coding-agent CLI nico-agent can launch: claude, codex, or opencode2.
_Avoid_: Agent (that is the running instance), tool, provider

**Launch mode**:
How a Harness is started in a herdr pane: through herdr's native agent kind,
or by running its command in the pane and letting herdr detect it.
_Avoid_: Launcher, runner

**Sigil**:
The character that invokes a skill in a Harness's prompt, such as `/` or `@`.
_Avoid_: Prefix

**Effort**:
The reasoning level a Harness runs a model at. Valid values depend on the
Harness and, for some, on the model.
_Avoid_: Thinking, variant, reasoning
