# Install

A Repo's Install is the command it runs in its clone after a PR merges into its Base, so what it
builds is what the next agent uses. `install = "<command>"` is a Repo's own setting, set on its tab
or with `PATCH /api/repo/<slug>`, never a Project's. `nico-agent install <slug>` refuses a clone off
its Base or with changes to tracked files, else pulls fast-forward and runs the command with `sh -c`,
showing its output on stderr as it runs; it keeps `{at, sha, ok, output}` (the last 20 lines) in
`installs.json`, then runs the Repo's Readiness checks. One runs at a time per Repo: asked while one
runs, it queues one more, which the next tick starts in a herdr workspace `install-<repo>`. A failed
or refused one is an `Install` toast over the page's corner and an errata block in the tab's Install
section, with `nico-agent install <slug>` as its help.

## Sub-features

- `install-set` `PATCH /api/repo/<slug>` with `{"install": "<command>"}` writes `install` to the Repo's table; `null`, or the tab's field emptied, removes it; `status` shows `install: {command, last}` only while it has one.
- `install-refused-settings` an empty command, `install` in `PATCH /api/project/<name>`, and `install` written under `projects.<name>` in `config.toml` are refused (the last at its file line), nothing written.
- `install-run` `nico-agent install <slug>` pulls the clone fast-forward and runs the command, its output shown on stderr as printed; exit `0` with stdout the one JSON object `{installed: "<slug> at <sha>"}`, and `installs.json` holds `last: {at, sha, ok: true, output}` with the last 20 lines.
- `install-refused` a clone off its Base (`<clone> is on <branch>, not its Base <base>`) or with tracked changes (`<clone> has changes to tracked files: M <file>`) is refused before any pull: exit `1`, `sha` null, `ok` false, the reason as `output`.
- `install-failed` a command that exits non-zero: exit `1`, `the Install of <slug> failed: <its last line>`, `ok` false with the sha it pulled.
- `install-checks` the Repo's Readiness checks run after each Install (its `ghbot` call in the outside log).
- `install-one-at-a-time` `install` asked while another runs refuses with `an Install of <slug> is running (pid N)` and `queued: true`; the next tick (a Refresh) starts the queued one in herdr.
- `install-toast-panel` a failed or refused last Install is a `status` toast `Install <slug>: <last line>` in `list "Needs you"` with `Run nico-agent install <slug> once it is fixed` under it, and `region "Install"` on the tab opens by itself, its folded line reading `Failed at <time>`, then the output and the same help; an ok one stays folded, its line reading `Installed <short sha>` and, opened, `Installed <short sha> at <time>`; with no command it reads `None`.

## How to get to it (user POV)

- The tab's `region "Install"`, folded to one line unless its last Install failed: click it open, then its `textbox "Install command"` (change, then Enter or leave the field).
- `PATCH /api/repo/<slug>` with `{"install": ...}`, as the page sends it.
- `nico-agent install <slug>`, by hand or in the pane the loop opens after a merge into the Base.
- The toasts and `nico-agent status --json`'s `repos[].install`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`; `R=${VERIFY_RUN_ROOT:-${TMPDIR:-/tmp}/verify-nico-agent}/$VERIFY_RUN_ID`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `E=.evidence/<issue>/install; mkdir -p "$E"`; `$C state > "$E/state.before.txt"`; `: > "$OUTSIDE_LOG"`.

- **Set.** `$C http --evidence "$E/01-set-install" PATCH /api/repo/verify/fixture '{"install":"seq 1 25"}'`:
  HTTP `200`; `config.toml`'s Repo table gains `install = "seq 1 25"`. `$C run --evidence "$E/02-status" -- status --json`:
  `repos[0].install` is `{"command":"seq 1 25","last":null}`.
- **Run.** `$C run --evidence "$E/03-install" -- install verify/fixture --json`: exit `0`; stderr
  prints `1` to `25` as it runs; stdout is `{"installed":"verify/fixture at <sha>"}` alone, `<sha>` being
  `git -C "$FIXTURE_CLONE" rev-parse HEAD`; `installs.json`'s `last.output` is `6` to `25`, `ok` true.
- **Pulls.** Push a commit to `main` from another clone (as in [checks.md](./checks.md)'s "Fix pushed
  elsewhere", with `HOME=$R/home`); `: > "$OUTSIDE_LOG"`; run `install` again: its `<sha>` is the
  pushed commit, and so is the clone's HEAD; `$OUTSIDE_LOG` holds one `ghbot api
  /installation/repositories ...` line, the Readiness checks run after it.
- **Refused.** `git -C "$FIXTURE_CLONE" checkout -q -b spike`; `install`: exit `1`, `the Install of
  verify/fixture failed: <clone> is on spike, not its Base main`, help `Run nico-agent install
  verify/fixture once it is fixed`; `last.sha` null. Back on `main` with a line appended to
  `README.md`: `... has changes to tracked files: M README.md`.
- **Toast and panel.** `$C page --evidence "$E/07-page-refused" --expect "has changes to tracked files"`:
  `list "Needs you"` has a `status` toast `Install verify/fixture: <clone> has changes ... M README.md` with `Run
  nico-agent install verify/fixture once it is fixed` under it; `region "Install"` is open by itself, its line
  reading `Install Failed at <time>`, with `textbox "Install command"` reading `seq 1 25`, `Failed at <time>`,
  the output and the help.
- **Failed.** Restore `README.md`. `$C page --evidence "$E/08-page-set-command" --click "textbox=Install command" --press Control+a --type "echo compiling; echo boom >&2; exit 4" --press Enter --wait 2`
  (the section is still open, its last Install refused):
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"install":"echo compiling; echo boom >&2; exit 4"} -> 200`.
  `install`: exit `1`, `the Install of verify/fixture failed: boom`; `last.output` is
  `compiling\nboom`, `last.sha` the clone's HEAD. The toast reads `Install verify/fixture: boom`.
- **One at a time.** `PATCH ... '{"install":"sleep 6; echo slow done"}'`; start `install` in the
  background, and within 6 seconds run it again: exit `1`, `an Install of verify/fixture is running
  (pid N)`, help `One more runs once it ends`; `installs.json` has `runner` N and `queued: true`.
  The first ends with exit `0`, `last.output` `slow done`, `queued` still true. `$C page --evidence
  "$E/14-page-installed" --within "region=verify/fixture" --click "region=Install" --expect "Installed <short sha>"`:
  the folded line read `Installed <short sha>`; no `Install` toast.
- **Queued, then a tick.** `: > "$OUTSIDE_LOG"`; `$C run --evidence "$E/15-refresh-queued" -- refresh --json`:
  `actions` holds `could not start the Install of verify/fixture, queued again: \`herdr workspace
  create\` failed: verify_stub: ...`; `$OUTSIDE_LOG` has `herdr workspace create --cwd <clone>
  --label install-fixture --no-focus`; `queued` stays true.
- **Refused settings.** `PATCH /api/repo/verify/fixture '{"install":" "}'`: HTTP `400`, `install is a
  command, not " "`. `PATCH /api/project/verify/fixture '{"install":"make"}'`: HTTP `400`,
  `` `install` is not a setting the page sets ``. Both leave `config.toml` byte for byte. Append
  `[projects.verify]` with `room = 2` and `install = "make"` to `config.toml`: `repo list --json`
  exits `1` with `config.toml line <n>: projects.verify.install: unknown field \`install\`, ...`;
  restore the file.
- **Remove.** `$C page --evidence "$E/19-page-remove" --within "region=verify/fixture" --click "region=Install" --click "textbox=Install command" --press Control+a --press Backspace --press Enter --expect Saved --wait 2`:
  `PATCH ... {"install":null} -> 200`; the section's line reads `None`; `config.toml` has no `install`; `status`'s `repos[0]` has no
  `install`.
- **Proof.** `$C state > "$E/state.after.txt"` and diff: `installs.json` new, `checks.json` changed.
  Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- A merge seen by a tick needs GitHub to say the PR merged, and the pane needs herdr: both are stubs
  in a run, so the pane opening after a merge into the Base (and none after a merge into a stacked
  branch) is `cargo test`'s (`tests/install.rs`). A run reaches the tick's start of a queued Install
  only up to herdr's stub refusing it.
- `page --expect` reads text, not an input's value: wait (`--wait 2`) after typing into `textbox
  "Install command"` and read `.requests.txt` and `config.toml` instead; `Saved` shows beside it for 2 seconds
  only, so `--expect Saved` comes before the wait.
- `region "Install"` is folded unless the last Install failed or was refused: a `--click "textbox=Install
  command"` on a folded one times out. Open it with `--within "region=<slug>" --click "region=Install"`.
- `install` runs the command for real, in the fixture clone: keep it harmless (`seq`, `echo`,
  `sleep`). A command that writes untracked files does not stop the next Install; one that changes a
  tracked file does.
- The pushed commit goes through the scratch `HOME`'s `.gitconfig`; without `HOME=$R/home` the push
  reaches for github.com.
