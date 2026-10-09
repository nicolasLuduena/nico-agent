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

**Spec**:
An issue whose sub-issues are the tickets that build it, as `/to-spec` and
`/to-tickets` write them. A Spec is never dispatched itself; an issue outside
any Spec counts as a Spec of its own. A Spec is running from the dispatch of
its first issue until each of its issues has a PR, except while its remaining
issues only wait on another Spec's PRs to merge.
_Avoid_: Epic, feature, parent issue

**Ready**:
An issue labelled `ready-for-agent`, open and not started, unassigned or
assigned only to the user (an issue shared with someone else is theirs too),
whose Blockers are all resolved, and which is not itself a Spec.
_Avoid_: Available, eligible, todo

**Stackable**:
An issue that would be Ready except that each unresolved Blocker already has
an open PR in the same Repo, so work can start on top of that PR.
_Avoid_: Blocked, pending

**Board**:
The view of Ready, Stackable and In-flight issues across all Repos, and of
issues already started outside any Dispatch nico-agent tracks: open, with an
open or merged PR, listed as "PR open" with that PR instead of as Ready.
_Avoid_: Dashboard, list of work (a **Queue** is the user's ordered pick of Specs, not the Board)

**Queue**:
A Repo's ordered list of candidate Specs, picked by the user on the Board or
CLI, or by the Lead within its Standing orders, in the order set (oldest first
until reordered). A queued Spec is approved to start: `advance` starts the head
of the Queue while the Repo has room, and never a Spec that isn't queued. A
started Spec leaves the Queue, and one that is no longer a candidate drops off
quietly. Local state in the config directory; nothing is written to a Source.
_Avoid_: Backlog, wishlist, schedule

### Dispatching

**Dispatch**:
One issue sent to one implementer agent in its own herdr workspace and
worktree, from creation until it is Closed. An issue has at most one live
Dispatch.
_Avoid_: Job, run, task

**Base**:
The branch a Dispatch's worktree starts from and its PR targets, chosen per
Dispatch. A Stacked dispatch's Base is the head branch of the PR it stacks on.
Otherwise it is `--base`, else the Repo's configured `base`, else the last one
used in the Repo, else origin's default branch. A Spec's first issue started by
`advance` uses the Repo's `base`, else origin's default branch.
_Avoid_: Target branch, trunk

**Stack**:
A chain of open PRs in one Repo, each targeting the head branch of the one
below it, the bottom one targeting another branch of the Repo.
_Avoid_: Chain, train

**Stacked dispatch**:
A Dispatch started on the head branch of an open PR in the same Repo, so its
PR joins that PR's Stack. For a Stackable issue, every Blocker's PR must be
the PR it stacks on or below it in that Stack.
_Avoid_: Dependent dispatch

**In flight**:
The state of an issue that has a Dispatch which has not been Closed.
_Avoid_: Active, running, in progress

**Scheduler**:
`nico-agent advance` run every 10 minutes by a systemd user timer, and by
`nico-agent serve` while the Board is up; the timer is the floor that keeps
Specs moving without the user or the Lead. It dispatches each
running Spec's next issue, one Implementer per Spec at a time, and starts the
head of each Repo's Queue while the Repo has room. It makes no judgment, and
the launch comes from the Scheduler defaults in config. It notifies the user of
what needs them, and Nudges the Lead.
_Avoid_: Orchestrator, pilot, autopilot, agent (the Lead is the agent; the Scheduler is a timer)

**Held**:
A Spec `advance` does not dispatch into until the user acts: one of its
Dispatches Failed, or its Stack is built on a PR closed without merging. The
user is notified once when a Spec becomes Held.
_Avoid_: Paused, blocked, stuck

**Implementer**:
The agent a Dispatch starts to implement the issue and open a draft PR.
_Avoid_: Worker, coder

**Asking**:
An Implementer waiting on the user (Agent state `blocked`), with the question
its screen shows. The user is notified once, and answers it in herdr or with
`nico-agent answer`; the Lead answers it when its Standing orders allow, and
otherwise relays the user's words.
_Avoid_: Stuck, blocked (a Blocker is an issue)

**Reviewer**:
The agent launched in the same workspace, once a PR is linked, to review it.
_Avoid_: Checker

**Bot suffix**:
Text appended to the Implementer's prompt when the bot's GitHub App is
installed on the Repo, telling the agent to open its PR with `ghbot` and to
add the bot as commit co-author. Checked afresh each time the prompt is sent.
_Avoid_: Bot mode, attribution prompt

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
Allowed once it has a PR. While it is still Implementing, Close needs
confirmation. `advance` Closes each Dispatch whose PR is ready once its
Implementer neither works nor waits on the user, to free the disk; the
branch and PR stay.
_Avoid_: Cleanup, archive, delete

### The Lead

**Lead**:
The one agent nico-agent keeps running to manage the work with the user: it
holds the conversation, keeps the Intent, chooses which Spec continues, and
acts within its Standing orders, making a Proposal for anything outside them.
It runs in its own herdr workspace on any Harness and talks to nico-agent
through its MCP server (ADR-0010).
_Avoid_: Orchestrator, master agent, pilot, helper, Scheduler (that is `advance`)

**Standing orders**:
What the Lead may do without asking, each on or off in config: start Specs
(the Repo's room still caps it), answer Implementers in its own words, launch
Reviewers, Close Dispatches, write Specs and tickets to a Source. nico-agent
enforces the ones that pass through its tools; the rest are the Lead's skill's
rule.
_Avoid_: Permissions, policy, guardrails

**Proposal**:
An action the Lead wants to take that its Standing orders do not allow, or a
change a Weekly retro suggests, held in nico-agent until the user approves or
declines it on the Board or CLI.
Approving runs it in nico-agent, not in the Lead; except a write Proposal (a
Spec and its tickets drafted while the `write` order is off, or a Weekly
retro's ticket), whose approval lets the Lead write it to the Source itself.
_Avoid_: Suggestion, request

**Intent**:
The shared record of what the user is working toward and why, as Markdown in
the config directory, which both the user and the Lead edit. The Lead reads it
every turn and checks Specs, Dispatches and PRs against it.
_Avoid_: Goals, roadmap, memory, context

**Notes**:
The Lead's record of the user's standing preferences, recurring decisions with
their reasons, and the names the user has for things, as Markdown in the
config directory beside the Intent. The Lead writes it when it learns something
durable and keeps it under a page; the user reads and edits it too.
_Avoid_: Memory, profile, settings

**Conversation**:
What the user and the Lead said to each other, as typed entries with ids and
times appended to a file in the config directory: the user's messages, the
Lead's replies, its questions and their answers. A question stays open until
the user answers it by its id. The user reads it with `nico-agent lead log`;
the Lead reads what is new in it through its Inbox.
_Avoid_: Chat, history, transcript

**Correction**:
A user message that starts "No, I said …", typed or spoken: it supersedes the
user's last message, which stays in the Conversation, struck. The Lead reads it
in its Inbox naming the message it replaces, and acts on the correction only.
_Avoid_: Edit, undo, retraction

**Inbox**:
What the Lead has not seen yet: user messages, decided Proposals, answers to
its questions, Implementers Asking, Specs Held, Dispatches Failed, PRs changed.
Read with a cursor, so nothing is lost while the Lead works, and handed over
with an orient packet (Intent, Notes, open questions and Proposals, the last
exchanges), so a Lead that just started knows where it stands. The Lead's
memory lives here and in those files, never in a Harness's own memory.
_Avoid_: Events, feed, notifications (those go to the user)

**Nudge**:
nico-agent prompting the Lead to read its Inbox: sent when the Lead is idle and
something arrived, and on every Scheduler run. It carries the user's local date
and time, which tells the Lead when the daily brief is due.
_Avoid_: Wake, ping, trigger

**Daily brief**:
The Lead's one `say` on the first Nudge of each local date, in three parts:
what ran since the last brief (Dispatches started, PRs ready and merged,
Dispatches Closed), what needs the user (Asking, Held, Failed, open questions
and Proposals), and what the Lead continues with and why (the Intent).
_Avoid_: Digest, standup, summary

**Weekly retro**:
The Lead's look back, on the first Nudge of each local week, over the PRs
merged across the Repos since the last one. Each change it suggests to the
agents' environment (an automated check, a coding standard, a navigation
pointer), never to the code, becomes a write Proposal of a ticket naming the
PRs that showed the need; a declined one is not proposed again.
_Avoid_: Postmortem, review, report

**Scribe**:
The small fast model that cleans what the user said before the Lead reads it:
disfluencies out, glossary and Board terms spelled right, punctuation in,
meaning untouched. Both the raw transcript and the Scribe's text are kept on
the user's entry. It is an OpenAI-compatible chat endpoint in config, like
transcription and speech; nico-agent runs none of them.
_Avoid_: Cleaner, post-processor, rewriter (it never rewrites the meaning)

**Voice on**:
The user talking to the Lead by voice instead of reading the screen, a flag in
the config directory the Nudge carries. With voice on, the Lead's replies are
spoken and it talks for the ear: short sentences, issues by title, choices as a
numbered list. Talking over it, or a tap, stops it at once (barge-in). Set with
`nico-agent voice on|off` or the app's Voice switch.
_Avoid_: Voice mode, dictation, speech enabled

**Hands-free session**:
A conversation with the Lead by voice that touches nothing between turns: a
tap on Talk, or `nico-agent voice talk` (the key anywhere), starts it, and the
microphone keeps listening after each utterance, through the Lead's reply,
for the next, until a tap or the key while nobody talks ends it. Holding Talk
sends one utterance and is never a session.
_Avoid_: Conversation mode, always listening, open mic

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
