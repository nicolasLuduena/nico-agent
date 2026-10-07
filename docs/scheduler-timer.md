# The Scheduler: `advance` on a systemd timer

A systemd user timer runs `nico-agent advance` every 10 minutes. Each run
moves running Specs along and fills each Repo's room from the head of its
Queue. It tells you what needs you through desktop notifications.

## Install

Install nico-agent first (`scripts/install.sh`), and set the Scheduler
defaults (`scheduler: {harness, model, effort}` in
`~/.config/nico-agent/config.json`). `advance` refuses to dispatch without
them. Then, from this checkout:

```bash
scripts/install-timer.sh
```

The script shows the two units it will write and asks before writing them,
then asks before enabling the timer. `--yes` skips the questions. It's safe to
run again, for example after moving the binary: the units have fixed names,
so a re-run rewrites the same two files (only if they changed) and leaves one
timer.

It writes, under `~/.config/systemd/user/`:

- `nico-agent-advance.service`: a oneshot that runs `nico-agent advance`,
  with a 9-minute timeout so a stuck run can't block the next one.
- `nico-agent-advance.timer`: fires every 10 minutes on the clock
  (`OnCalendar=*:0/10`), enabled under `timers.target`.

The script runs whichever `nico-agent` is on your `PATH` (or
`~/.local/bin/nico-agent`); set `NICO_AGENT_BIN` to pick another.

### Why the service sets PATH

A systemd service doesn't get your shell's mise activation. There, a `gh`
wrapper that calls `mise x gh -- gh` finds itself again and loops forever,
hanging `advance` on its first `gh` call. The service puts mise's shims
(`~/.local/share/mise/shims`, or `$MISE_DATA_DIR/shims`) first on `PATH`, so
`gh` resolves to the real binary.

## Check it

```bash
systemctl --user list-timers nico-agent-advance.timer   # last and next run
systemctl --user status nico-agent-advance.service      # last run's result
journalctl --user -u nico-agent-advance.service -n 100  # recent output
journalctl --user -u nico-agent-advance.service -f      # follow live
```

`advance` prints its report to stdout, so each run's rows land in the journal.
To run it now instead of waiting for the next tick:

```bash
systemctl --user start nico-agent-advance.service
```

Notifications go through `notify-send`, which needs your desktop session's
D-Bus. A systemd user service normally has it. If notifications don't appear,
check `systemctl --user show-environment | grep DBUS`. A failed notification
is only a warning in the report; it doesn't fail the run.

## Pause or remove it

```bash
systemctl --user stop nico-agent-advance.timer           # pause until the next reboot
systemctl --user disable --now nico-agent-advance.timer  # pause until re-enabled
scripts/install-timer.sh --remove                        # disable and delete the units
```

## Remove the old Hermes Scheduler

Before this timer, Hermes was the Scheduler (ADR-0008, superseded by
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

Remove the cron job before installing the timer, so the two don't both run
`advance`.
