# The Lead

The Lead is the one agent nico-agent keeps running to manage the work with
you (ADR-0010). It runs as the herdr agent `lead` in its own herdr workspace,
on any Harness, and talks to nico-agent through the MCP server that
`nico-agent serve` exposes at `/mcp`. You can watch it and take it over in
herdr like any other agent.

## Setup

1. **Keep `serve` running.** The Lead reaches nico-agent only through it.
   `scripts/install-board-service.sh` keeps it running as a systemd user
   service on port 42069; `nico-agent serve` runs it in a terminal.

2. **Set the Lead's defaults** in `~/.config/nico-agent/config.json`, so
   `lead start` needs no flags:

   ```json
   {
     "lead": { "harness": "claude", "model": "opus", "effort": "high" }
   }
   ```

   Any of the three can be passed instead as `--harness`, `--model` or
   `--effort`; a flag wins over the default. Without a default and without its
   flag, `lead start` is refused and names the missing `lead.*` keys.

3. **Add the nico-agent checkout as a Repo** to give the Lead the shaping
   skills (`grilling`, `to-spec`, `to-tickets`, `triage`, `retro`):

   ```sh
   nico-agent repo add nicolasLuduena/nico-agent --path ~/src/nico-agent
   ```

   Without it the Lead starts all the same, with a warning that they are left
   out.

## Daily use

```sh
nico-agent lead start     # start the Lead; a no-op while it runs
nico-agent lead status    # running?, workspace, Harness, model, Effort, Agent state
nico-agent lead stop      # close its workspace; the conversation is kept
```

`lead start` on another Harness, model or Effort than the running Lead's
stops the old one and starts the new one. The conversation lives in the config
directory, not in the agent, so the new Lead picks it up where the old one
left off. The same happens when the Lead's agent is gone from herdr (its
workspace was closed by hand, say).

The app at `serve`'s URL does the same: the header's Lead button shows the
Lead's Agent state and opens its launch, Start, Restart on another Harness,
model or Effort, and Stop; the Lead panel beside the Repos holds the conversation, live, with a composer that posts
`nico-agent say`; the Lead's questions as cards with their choices as buttons
and a free-text answer (`say --answer`); and its Proposals as cards with
Approve and Decline (`proposals approve|decline`), showing what approving did.

If a step fails, `lead start` says which one; run it again to resume from
there. `lead status` shows the failure in the meantime.

If `serve` listens on another port, pass it to `lead start --port <port>`.

## The Lead's context

The Lead's work slips as its context fills. The Lead panel shows how full it
is beside the Lead's name ("Context 62%"), and `lead status` reports it as
`context` (`tokens`, `window`, `percent`, `warning`, `session`). Past the
warning threshold the meter turns orange and the panel's warnings say a
restart is safe. It is: the conversation, Notes, Intent and Board live in
nico-agent, so Stop and Start the Lead from Lead in the header.

The count comes from Claude Code's transcript of the Lead's current session:
the newest `~/.claude/projects/<the Lead's home, path-escaped>/<session>.jsonl`
written since the Lead started (`$CLAUDE_CONFIG_DIR` in place of `~/.claude`
when set). It is the newest assistant entry's `input_tokens`,
`cache_creation_input_tokens` and `cache_read_input_tokens`. A restarted Lead
shows nothing until its first answer, then its new session's count. A Lead
on another Harness, or one with no transcript yet, shows nothing. It is read
whenever the Lead's status is, which the app refetches when the Lead's Agent
state changes (as its turn ends), and it costs no GitHub request.

Claude Code records no context window, so the window is
`lead.contextWindow` in config when set. Otherwise it is 1,000,000 tokens for
a model ending in `[1m]` (such as `opus[1m]`) and 200,000 for any other. The
threshold is `lead.contextWarning`, in percent, 80 unless set:

```json
{
  "lead": { "harness": "claude", "model": "opus", "effort": "high", "contextWindow": 200000, "contextWarning": 80 }
}
```

## Nudges

When something arrives for the Lead (your `say`, your `say --answer`, a PR
event, the end of an `advance` run), nico-agent Nudges it: it prompts the Lead with "Read your
Inbox (local time: Wed 2026-09-30 23:30)" if herdr reports it idle (or `done` with its turn). While the Lead is working, one pending Nudge
is kept in `nudge.json` in the config directory, and `serve` sends it within
about 10 seconds of seeing the Lead idle, so three messages sent while it
works bring one Nudge. A Lead that isn't running gets none; your messages
wait in its Inbox and it reads them when it starts. A Nudge that can't be
sent is a warning in the command's output, and `serve` tries it again.

The local time is your clock, so the Lead can tell a new day began: on the
first Nudge of each date it posts its daily brief, one `say` starting
"Daily brief, <date>" with what ran since the last brief, what needs you, and
what it continues with and why. Find past briefs with
`nico-agent lead recall "Daily brief"`.

On the first Nudge of each week (Monday to Sunday) it also runs the weekly
retro (`RETRO.md` in its skill): it reads the PRs merged in each Repo since
the last retro, with `gh` in the Repo's clone, through the `retro` skill's
categories, and proposes each change to the agents' environment (a check, a
coding standard, a navigation pointer; never the code) as a write Proposal:
the ticket it would file on the Repo's Source, naming the PRs that showed
the need. It always proposes, whatever the `write` order says. Approving one
has the Lead file the ticket, labelled `ready-for-agent`, so the change lands
through an Implementer's PR; declining files nothing. Each decision is in the
conversation with the Lead's reason, so before the next retro the Lead
recalls your declines and does not propose them again. Its summary is a
`say` starting "Weekly retro, week of <Monday>".

When the Lead asks you something (`ask`), you get one desktop notification
with its question, as for a Proposal.

## The Lead's home

`lead start` writes the Lead's home, `~/.config/nico-agent/lead/`, before
launching it there:

- the `lead` skill, embedded in the nico-agent binary, where the Harness looks
  for a project's skills: `.claude/skills/` for claude, `.agents/skills/` for
  codex, `.opencode/skills/` for opencode2 (a Harness's `skillsDir` setting),
  with `SHAPING.md` beside it, the Lead's procedure for new work (below),
  `RETRO.md`, its procedure for the weekly retro (Nudges, below), and
  `RESEARCH.md`, its procedure for research you ask for
  (`docs/research-issues.md`);
- `mcp.json`, naming `serve`'s MCP server for claude's `--mcp-config`;
- links to the shaping skills of the nico-agent checkout.

The home is rewritten on every start, so a new nico-agent brings its new
skill. `lead stop` leaves it in place.

## How each Harness reaches the MCP server

Each Harness has an `mcpArgs` setting beside `modelArgs`, used only for the
Lead, with `{mcpUrl}` for the server's URL and `{mcpConfig}` for the path of
`mcp.json`:

| Harness   | MCP wiring                                                 |
| --------- | ---------------------------------------------------------- |
| claude    | `--mcp-config {mcpConfig}`                                 |
| codex     | `-c mcp_servers.nico-agent.url="{mcpUrl}" -c project_root_markers=[]` |
| opencode2 | `mcp.nico-agent` in `OPENCODE_CONFIG_CONTENT`, beside the model |

A Harness you add in config needs `mcpArgs` to run the Lead.

codex finds a project's skills only at its root, which it takes from `.git`;
the Lead's home is no git repo, so `project_root_markers=[]` makes the home
itself the root.

codex asks you to approve each call the Lead makes to a nico-agent tool. Until
you allow them (in the Lead's pane in herdr, or in your codex config), a codex
Lead stops at its first `inbox` and waits on you.

## Standing orders

Standing orders say what the Lead may do unasked. Each is on or off:

| Order    | Lets the Lead                                              | Default |
| -------- | ---------------------------------------------------------- | ------- |
| `start`  | queue and start Specs (the Repo's room still caps it)      | off     |
| `answer` | answer an Asking Implementer in its own words              | off     |
| `review` | launch Reviewers                                           | on      |
| `close`  | Close Dispatches whose PR is ready                         | on      |
| `write`  | write Specs and tickets to a Source                        | off     |

By default the Lead does only the safe housekeeping: reviewing and Closing
finished work. Anything an order does not allow, it proposes instead.

See and change them from the CLI:

```bash
nico-agent orders                 # each order, what it lets the Lead do, on or off
nico-agent orders --json          # {"orders": {"start": false, ...}}
nico-agent orders set start on
nico-agent orders set close off
```

They live in `~/.config/nico-agent/config.json` under `orders`, holding only
the ones you set; the rest keep their default:

```json
{
  "repos": [],
  "orders": { "start": true, "close": false }
}
```

The app's Lead panel shows them as switches in its drawer (**Intent &
orders**, then **Standing orders**); each switch runs `orders set`.

Orders are read from config every time they are used, never cached. A change,
from `orders set` or by hand, applies to the next read without
restarting `nico-agent serve`.

`write` is the one order nico-agent cannot check: the Lead writes to a Source
with its own shell, so that order is a rule of the Lead's skill.

## New work from the conversation

Tell the Lead an idea and it shapes it with you (`SHAPING.md` in its skill):

1. It grills you with the `grilling` skill, one question card per question,
   each with its recommended answer, until you confirm you share an
   understanding.
2. In the Repo's clone (`nico-agent repo list`), it runs `to-spec` and
   `to-tickets` as you would, following the Repo's `AGENTS.md`, issue tracker
   doc, glossary and ADRs: the Spec and its tickets land on the Source,
   labelled `ready-for-agent`, the tickets as sub-issues with native blocking
   links.
3. It queues the Spec under `start`, or proposes queuing it.

With `write` off it stops before step 2 writes anything and proposes the whole
draft instead: a write Proposal, whose card shows the Spec and its tickets.
Approving it hands the draft back to the Lead, which writes exactly that
through step 2; declining writes nothing, and your reason goes to the Lead.

## What the Lead does with them

The `lead` skill (`src/lead-skill.md`) sets the Lead's judgment within its
orders: which candidate Spec takes a Repo's room (the Intent, then the Queue
head, then the smallest that unblocks the most), when it acts and when it
proposes, what it answers an Asking Implementer itself, when it Closes, and
that Held Specs are yours to clear.

## The Lead's tools

The Lead acts through MCP tools on `nico-agent serve`'s `/mcp`. Each runs the
CLI command of the same name with `--json`, in-process, so it does exactly
what you would; before running, it reads its Standing order fresh:

| Tool       | Runs                  | Order    |
| ---------- | --------------------- | -------- |
| `dispatch` | `nico-agent dispatch` | `start`  |
| `queue`    | `nico-agent queue`    | `start`  |
| `unqueue`  | `nico-agent unqueue`  | `start`  |
| `advance`  | `nico-agent advance`  | `start`  |
| `review`   | `nico-agent review`   | `review` |
| `close`    | `nico-agent close`    | `close`  |
| `answer`   | `nico-agent answer`   | `answer` |

A tool whose order is off runs nothing. It returns a tool error whose `help`
names the order and gives the `propose` call to make instead, with the exact
command a Proposal would run:

```json
{
  "error": "the `start` Standing order is off, so queue needs the user's approval",
  "help": [
    "The `start` order lets the Lead queue and start Specs (the Repo's room still caps it); the user has not turned it on",
    "Propose it instead: call `propose` with {\"action\":[\"queue\",\"--repo\",\"acme/api\",\"--\",\"acme/api#10\"],\"reason\":\"<why, in a sentence the user can decide on>\"}"
  ]
}
```

`answer` has a second mode that needs no order: relaying your own words. Pass
`relay` instead of `text`, and the Lead may send it whatever the `answer`
order says, as long as it is a whole message of yours in the conversation (one
you wrote with `nico-agent say`, or an answer to one of its questions), exactly
as you wrote it. Anything else passed as `relay` is refused, with a `propose`
call to send it once you approve.

## Peek and PR events

The Lead's `peek` tool, like `nico-agent peek`, shows what an agent's pane
has on screen right now, through `herdr agent read`:

```bash
nico-agent peek acme/api#7              # the issue's Implementer
nico-agent peek acme/api#7 --reviewer   # its Reviewer, once one was launched
nico-agent peek                         # the Lead's own screen
```

An issue that is not In flight, or `--reviewer` before a review, is refused
with help.

While `serve` runs, it asks GitHub every minute what changed on each In-flight
issue's open PR: new review comments and reviews, check results, a merge
conflict with its base (once each time it turns conflicting), ready for
review, merged and closed. Each change is written once into the conversation
as an `event` entry (the PR's URL, the issue, the kind of change and a
one-line summary), and the Lead is Nudged to read it in its Inbox. A PR stays
watched after its Dispatch is Closed, until it is merged or closed; what was
last seen of each is kept in `pr-watch.json` in the config directory.
`nico-agent lead log` shows the events with the rest of the conversation;
the app's Lead panel leaves them out and shows what the Lead says about
them.

From the same answers, `serve` starts a Repo's Gardener by itself: on a
`merged` event of a PR that other watched open PRs were stacked on, naming
those, and on a `conflict` event, naming that PR. While a Gardener runs in the
Repo, the PRs that come up wait in `garden-waiting.json` in the config
directory, and the next tick after it is done starts the next Gardener with
them. The Lead reports what a Gardener fixed (its comments on the PRs reach
the Inbox as events) and relays its questions, listed under the Board's
`asking` by Repo, with `nico-agent answer <repo> <text>`.

## The Intent and the Notes

Two Markdown files in the config directory that you and the Lead both edit:

- **The Intent**, `intent.md`: what you are working toward and why. The Lead
  reads it every turn, names the item it follows when it picks what
  continues, and asks you before changing it, for instance when a running
  Spec or a new PR serves nothing in it.
- **The Notes**, `notes.md`: your standing preferences, recurring decisions
  with their reasons, and your names for things. The Lead writes them
  without asking when it learns something durable, rewriting them so they
  stay under a page.

```sh
nico-agent intent                      # show it (a hint when there is none)
nico-agent intent --json               # {"intent": "...", "version": "...", "path": "..."}
nico-agent intent set --file intent.md # replace it whole; or --text <markdown>, or pipe it in on stdin
nico-agent notes                       # the same for the Notes
nico-agent notes set --file notes.md
```

Editing the files by hand works too. The Lead reads and replaces them with
its `intent` and `notes` tools, and every `inbox` carries both in its orient
packet.

A replace may carry the version it read (`--version`, from `--json`); the
Lead's always does. If the file changed since that version, by hand or by the
other editor, the replace is refused with the current text and version, to
merge into and replace again.

The app's Lead panel edits both in its drawer (**Intent & orders**), saving
with the version it read, as `set --version` does. While you are not editing,
a tab follows the file, so the Lead's latest edit shows. If the file changes
while you edit, the tab shows its text beside your edit, and saves nothing
until you keep your edit (saving it over the change) or use the new text.

## Proposals

When an order is off, the Lead calls `propose` with the command a refusal
handed it and a reason. The Proposal waits in `~/.config/nico-agent/proposals.json`
until you decide, and you get one desktop notification for it.

```bash
nico-agent proposals                       # open ones: id, what each would run, why
nico-agent proposals approve 3             # run it now and print what it did
nico-agent proposals decline 3 Finish billing first
nico-agent proposals --all                 # decided ones too, with status and outcome
```

Approving runs the command through the CLI in nico-agent, exactly as if you
typed it; the Lead runs nothing. If the command fails, or finds nothing left
to do (the issue is already In flight, the Implementer is no longer Asking),
the approval is refused with the reason and the Proposal is closed as
`failed`. A command on several issues counts as run if any of them ran. A Proposal is decided once: approving or declining it again, or an
id that names none, is refused.

Each decision becomes a `decision` entry in the conversation, with the
command, the Lead's reason, its outcome and yours (`lead recall` finds it by
either reason), and the Lead is Nudged to read it in
its Inbox. Open
Proposals are also in the orient packet every `inbox` returns.

A Proposal can only run an action tool's command: `dispatch`, `review`,
`close`, `answer`, `queue`, `unqueue` or `advance`. `propose` refuses any other
command, and any command line the CLI would reject, before recording it.

A write Proposal runs no command. It holds Markdown for a configured Repo's
Source, a Spec and its tickets or a weekly retro's ticket (`lead propose
--write <repo>` with `--file`, `--text` or standard input; the tool's
`write`), which `proposals` shows whole. Approving it runs
nothing in nico-agent: the decision, carrying the text, goes to the Lead's
Inbox, and the Lead writes it.

## The Queue from the CLI

The CLI edits the Queue the way the web Board's Queue controls do:

```bash
nico-agent queue BLE-20 --repo bleentr/pdf-diff        # last in the Queue; a candidate Spec only
nico-agent move BLE-20 up --repo bleentr/pdf-diff      # one place toward the head (down: toward the tail)
nico-agent unqueue BLE-20 --repo bleentr/pdf-diff
```

Each is idempotent: queuing a queued Spec, unqueuing one that isn't queued, or
moving one past either end says `(no-op)` and changes nothing.
