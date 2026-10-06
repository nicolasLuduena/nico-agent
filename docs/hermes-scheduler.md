# Hermes as the Scheduler

Hermes runs the Scheduler routine from `nico-agent --skill` every 10 minutes
and messages your chat. Its reach is enforced in Hermes's own config
(ADR-0008): no shell, and from nico-agent only the `board` and `advance` tools
of `nico-agent mcp`.

Set it up with the wizard, from this checkout:

```bash
scripts/hermes/setup.sh
```

It installs nico-agent, sets the Scheduler defaults, registers the MCP server,
installs the skill and the monitor script, creates the cron job, and walks you
through a run on a small real Spec. Each step asks before it changes anything
and is safe to run again.

## What the wizard sets up

- **Scheduler defaults**: `scheduler: {harness, model, effort}` in
  `~/.config/nico-agent/config.json`. `advance` refuses to dispatch without
  them.
- **MCP server**: in `~/.hermes/config.yaml`:

  ```yaml
  mcp_servers:
    nico-agent:
      command: /home/<you>/.local/bin/nico-agent
      args: [mcp]
      tools:
        include: [board, advance]
        resources: false
        prompts: false
  ```

- **Skill**: `nico-agent --skill` written to `~/.hermes/skills/nico-agent/SKILL.md`.
- **Monitor script**: `scripts/hermes/nico-agent-monitor.sh` copied to
  `~/.hermes/scripts/`. Hermes runs only scripts that live in that directory,
  and it cannot edit them because its file and terminal toolsets are off.
- **Cron job** `nico-agent-scheduler`: `10m`, `--skill nico-agent`,
  `--monitor-script nico-agent-monitor.sh`, `--deliver telegram`.

## What Hermes enforces, and what it doesn't

Hermes filters tools at two levels, and both are enforced rather than
requested:

- **Toolsets.** `agent.disabled_toolsets` is subtracted last from every agent
  (gateway, CLI and cron), so a per-job `enabled_toolsets` can't put a denied
  toolset back. Cron agents also lose `cronjob`, `messaging` and `clarify`.
  The denylist in `~/.hermes/config.yaml` covers `terminal`, `file`,
  `code_execution`, `browser`, `web`, `computer_use`, `delegation` and
  `cronjob`, among others, so Hermes has no way to run a command. The wizard
  checks that those eight are still denied.
- **MCP tools.** `tools.include` registers only the listed tools of a server.
  `resources: false` and `prompts: false` drop the four utility wrappers.
  `nico-agent mcp` serves only `board` and `advance` anyway.

What stays is not limited to the two tools. Hermes keeps `memory`,
`session_search` and `skills`. The routine needs `memory`, because the
Present / Postponed / Away state (defined in the skill) lives there, shared
between the cron session and the chat session that gets your replies. `skills` includes `skill_manage`,
so Hermes could rewrite its own copy of the skill. That gives it no new reach,
since the copy can only call the same tools. Re-run the wizard's skill stage to
restore it.

## How a tick runs

The monitor script runs `nico-agent advance` and prints the advance rows, each
Repo's room and candidates, and the Held Specs. Hermes hashes that output and
wakes its agent only when it changes. When it wakes, the agent gets the diff
and runs the rest of the routine: read the Board, report changes, fill the
room. A tick with nothing to say ends with `[SILENT]`, which Hermes does not
deliver.

The timers make one exception. While some Repo has room and candidates, the
script adds the current 10-minute tick to its output, so the agent wakes every
tick. Otherwise an unanswered proposal could never turn into Away, and a
"later" could never expire. The saving is in the ticks where no Repo has room:
running Specs advance, and the LLM doesn't run.

Because the agent wakes every tick while there is room, the cron prompt tells
it to report a failed row once, and again only when its reason changes.

## Operating it

- `hermes cron list` shows the job and its id. `hermes cron run <id>` runs it
  on the next tick, and `hermes cron pause <id>` stops it.
- `hermes pause` stops all cron jobs and new gateway turns.
- After upgrading nico-agent, run the wizard's skill stage again so Hermes
  gets the new skill.
- Any Repo with room is open to an Away pick. To keep Hermes off a Repo,
  remove it (`nico-agent repo rm`) or lower its `maxRunningSpecs`.
