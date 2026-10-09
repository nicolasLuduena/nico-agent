# The Scheduler: `advance` in `serve`

While `nico-agent serve` is up, it runs `nico-agent advance` every 10
minutes, counted from when it started. Each run moves running Specs along and
fills each Repo's room from the head of its Queue. It tells you what needs you
through desktop notifications, and Nudges the Lead at its end.

The Scheduler skips a manual Repo: there it starts no Queue head and
dispatches or resumes no issue of a running Spec, and its report says so for
each one it left. It still Closes the Repo's finished Dispatches. Work starts
there only when you, or an approved Proposal, run `nico-agent dispatch` on
the issue. A Spec there runs only while one of its Dispatches is In flight,
so an old PR doesn't keep it running. Turn it on and off per Repo:

```bash
nico-agent repo set acme/api --manual on    # the Scheduler starts nothing here
nico-agent repo set acme/api --manual off
nico-agent repo list                        # manual Repos show manual: true
```

The Board's Repos pane marks a manual Repo `Manual`.

Install nico-agent first (`scripts/install.sh`), and set the Scheduler
defaults (`scheduler: {harness, model, effort}` in
`~/.config/nico-agent/config.json`). `advance` refuses to dispatch without
them.

## Keep `serve` running

To have the Scheduler always on, run `serve` as a user service that starts at
login and restarts if it crashes:

```bash
scripts/install-board-service.sh             # asks before each change; --yes skips
systemctl --user status nico-agent-board     # is it up?
journalctl --user -u nico-agent-board -f     # its log
scripts/install-board-service.sh --remove    # stop it and delete the unit
```

It serves on `http://127.0.0.1:42069`; set `NICO_AGENT_PORT` when installing
to pick another port. Re-run the script after `scripts/install.sh` to restart
`serve` on the new binary.

### Why the service sets PATH

A systemd service doesn't get your shell's mise activation. There, a `gh`
wrapper that calls `mise x gh -- gh` finds itself again and loops forever,
hanging `serve` on its first `gh` call. The service puts mise's shims
(`~/.local/share/mise/shims`, or `$MISE_DATA_DIR/shims`) first on `PATH`, so
`gh` resolves to the real binary.

## Check it

Each run's report goes to `serve`'s log (stderr, so
`journalctl --user -u nico-agent-board` when it runs as a service), one entry
per run starting `advance:`. A run that throws is logged as
`advance failed: ...`, and the next one tries again. To run it now instead of
waiting:

```bash
nico-agent advance
```

The advance lock lets only one `advance` run at a time, so a run by hand and
`serve`'s never start the same Spec. The one that finds the lock taken skips
that run with the warning `another advance is running (pid ...); left it to
finish`.

Notifications go through `notify-send`, which needs your desktop session's
D-Bus. A systemd user service normally has it. If notifications don't appear,
check `systemctl --user show-environment | grep DBUS`. A failed notification
is only a warning in the report; it doesn't fail the run.

## How `serve` reads GitHub

`serve` is the one reader of GitHub for the Board, the Lead's `board` tool and
`advance`. It keeps what GitHub said for a minute, so polling costs GitHub a
read a minute, not one per poll. What nico-agent does itself (a dispatch, a
review, a Close, a Queue change, an `advance` run, an approved Proposal, a new
PR event) drops the kept reads, so the next Board shows it at once. A command
you type in a terminal runs in its own process, so `serve` may show its effect
up to a minute later.

A Repo the bot's GitHub App is installed on is read as the bot, through
`ghbot`, whose installation token has its own rate limit; your own `gh` keeps
working whatever nico-agent does. Other Repos are read through your `gh`, as
is the PR watch, since the App can't read a PR's check results.

When GitHub answers with its rate limit, `serve` makes no GitHub call until
the reset, and the Board shows one `warning` naming when calls resume.

## Remove the old advance timer

A systemd user timer used to run `advance` as well. `serve` replaces it, so
remove a timer installed earlier:

```bash
systemctl --user disable --now nico-agent-advance.timer
rm ~/.config/systemd/user/nico-agent-advance.{service,timer}
systemctl --user daemon-reload
```

## Remove the old Hermes Scheduler

Before the timer, Hermes was the Scheduler (ADR-0008, superseded by
ADR-0009). nico-agent no longer has `nico-agent mcp` or `--skill`, so a
leftover Hermes setup only fails. Remove it by hand, in `~/.hermes` (or
`$HERMES_HOME`):

- **The cron job.** Find `nico-agent-scheduler` with `hermes cron list` and
  delete it with Hermes's cron commands. Its monitor script,
  `scripts/nico-agent-monitor.sh`, can go too.
- **The MCP registration.** Delete the `mcp_servers.nico-agent` entry from
  `config.yaml` (the setup wizard left a backup at
  `config.yaml.bak-before-nico-agent-mcp`), then `hermes gateway restart`.
- **The skill copy.** Delete `skills/nico-agent/`.
