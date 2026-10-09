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

The app at `serve`'s URL does the same from its Lead panel, beside the
Board: the Lead's Agent state and launch, Start, Restart on another Harness,
model or Effort, and Stop; the conversation, live, with a composer that posts
`nico-agent say`; the Lead's questions as cards with their choices as buttons
and a free-text answer (`say --answer`); and its Proposals as cards with
Approve and Decline (`proposals approve|decline`), showing what approving did.

If a step fails, `lead start` says which one; run it again to resume from
there. `lead status` shows the failure in the meantime.

If `serve` listens on another port, pass it to `lead start --port <port>`.

## Nudges

When something arrives for the Lead (your `say`, your `say --answer`, the end
of an `advance` run), nico-agent Nudges it: it prompts the Lead with "Read your
Inbox" if herdr reports it idle (or `done` with its turn). While the Lead is working, one pending Nudge
is kept in `nudge.json` in the config directory, and `serve` sends it within
about 10 seconds of seeing the Lead idle, so three messages sent while it
works bring one Nudge. A Lead that isn't running gets none; your messages
wait in its Inbox and it reads them when it starts. A Nudge that can't be
sent is a warning in the command's output, and `serve` tries it again.

## The Lead's home

`lead start` writes the Lead's home, `~/.config/nico-agent/lead/`, before
launching it there:

- the `lead` skill, embedded in the nico-agent binary, where the Harness looks
  for a project's skills: `.claude/skills/` for claude, `.agents/skills/` for
  codex, `.opencode/skills/` for opencode2 (a Harness's `skillsDir` setting);
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

Orders are read from config every time they are used, never cached. A change,
from `orders set` or by hand, applies to the next read without
restarting `nico-agent serve`.

`write` is the one order nico-agent cannot check: the Lead writes to a Source
with its own shell, so that order is a rule of the Lead's skill.

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
command, its outcome and your reason, and the Lead is Nudged to read it in
its Inbox. Open
Proposals are also in the orient packet every `inbox` returns.

A Proposal can only run an action tool's command: `dispatch`, `review`,
`close`, `answer`, `queue`, `unqueue` or `advance`. `propose` refuses any other
command, and any command line the CLI would reject, before recording it.

## The Queue from the CLI

The CLI edits the Queue the way the web Board's Queue controls do:

```bash
nico-agent queue BLE-20 --repo bleentr/pdf-diff        # last in the Queue; a candidate Spec only
nico-agent move BLE-20 up --repo bleentr/pdf-diff      # one place toward the head (down: toward the tail)
nico-agent unqueue BLE-20 --repo bleentr/pdf-diff
```

Each is idempotent: queuing a queued Spec, unqueuing one that isn't queued, or
moving one past either end says `(no-op)` and changes nothing.
