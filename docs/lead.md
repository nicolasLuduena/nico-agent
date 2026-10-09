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

If a step fails, `lead start` says which one; run it again to resume from
there. `lead status` shows the failure in the meantime.

If `serve` listens on another port, pass it to `lead start --port <port>`.

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
| codex     | `-c mcp_servers.nico-agent.url="{mcpUrl}"`                 |
| opencode2 | `mcp.nico-agent` in `OPENCODE_CONFIG_CONTENT`, beside the model |

A Harness you add in config needs `mcpArgs` to run the Lead.

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

The Lead's tools, which check the order they fall under, are still to come;
for now the orders are only stored and shown. Once the tools exist,
nico-agent enforces every order that passes through them. `write` is the
exception: the Lead writes to a Source with its own shell, so that order is a
rule of the Lead's skill rather than something nico-agent can check.
