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
