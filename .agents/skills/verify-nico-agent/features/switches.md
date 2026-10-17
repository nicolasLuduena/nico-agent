# Switches

Each Repo has a switch per automatic step of the loop: dispatch, mine (only issues assigned to the
user, in [mine](./mine.md)), stack, review, restart, flip, answer (faux-nico answers), gardening,
quality_scan. The page shows all nine in the Repo's panel, each
tagged `default` or `from Project` while the Repo does not set it and `set here` once it does, and
writes a toggle to `config.toml` through `PATCH /api/repo/<slug>` with `{"switches": {name: bool}}`,
keeping the rest of the file as written; "Use the default" beside a switch the Repo sets removes it (see settings). Scripts can
send `{name: bool}` to `PATCH /api/repo/<slug>/switches`. The loop obeys the switch from its next
tick on.

## Sub-features

- `switches-patch` `PATCH` with `{name: bool}` writes `switches = { ... }` under the Repo in `config.toml` and answers all nine switches after.
- `switches-casing` the slug in the path matches in any casing; the Repo's own casing is written.
- `switches-bad-name` a name that is not a switch is 400, listing the nine.
- `switches-bad-value` a non-boolean value, a body that is not an object, or not JSON is 400.
- `switches-unknown-repo` a slug that is not a Repo is 409, with the `repo add` to run.
- `switches-toggle` on the page, clicking `switch "Dispatch"` sends `{"switches":{"dispatch":...}}` and the switch shows the answer, a `status` `Saved` for 2 seconds, then `set here` with `button "Use the default Dispatch"` beside it.
- `switches-obeyed` with Dispatch off, a refresh tick dispatches no Ready issue; on again, it does.

## How to get to it (user POV)

- Open the page, pick a Repo's Project in the rail, open `Repos`, and toggle a switch in its `Switches` section: `Faux-nico
  answers`, `Dispatch`, `Flip to ready`, `Gardening`, `Only issues assigned to me`, `Quality-scan`,
  `Restart`, `Review`, `Stack`.
- From a script: `PATCH /api/repo/<owner/name>/switches` with a JSON object of switches.
- By hand: edit `repos."<slug>".switches` in `config.toml` (`repo list` shows them).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`.
- `E=.evidence/<issue>/switches`; `$C state > "$E/state.before.txt"`.

- **Turn Dispatch off.** Run `$C http --evidence "$E/01-off" PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`.
  HTTP `200`, `{"switches":{"answer":false,"dispatch":false,"flip":true,"gardening":false,"mine":false,"quality_scan":false,"restart":true,"review":true,"stack":true}}`.
  `config.toml`'s `[repos."verify/fixture"]` gains `switches = { dispatch = false }`.
- **Any casing.** Run `$C http --evidence "$E/02-casing" PATCH /api/repo/VERIFY/FIXTURE/switches '{"review":false}'`.
  HTTP `200`, `review` false; `config.toml` has `switches = { dispatch = false , review = false }`
  under `[repos."verify/fixture"]`.
- **Refusals.** `'{"frob":true}'` (`03-bad-name`): HTTP `400`, `` `frob` is not a switch ``, `help`
  `Switches: dispatch, mine, stack, review, restart, flip, answer, gardening, quality_scan`.
  `'{"stack":"no"}'` (`04-bad-value`): `400`, `stack is true or false, not "no"`. `'[true]'`
  (`05-not-object`): `400`, `[true] is not an object of switches`. `'not json'` (`06-not-json`):
  `400`, starts `the body is not JSON`. On `/api/repo/other/repo/switches` with
  `'{"dispatch":false}'` (`07-unknown-repo`): `409`, `other/repo is not a configured Repo`.
  `config.toml` is unchanged by each.
- **Second view.** Run `$C run --evidence "$E/08-list" -- repo list --json`: `switches` has
  `dispatch` false, `review` false, the rest as before (`answer`, `gardening`, `mine`, `quality_scan` false).
- **Obeyed.** `: > "$OUTSIDE_LOG"`; run `$C http --evidence "$E/09-refresh-off" POST /api/refresh`.
  HTTP `200`, `actions` only the stubbed `could not read GitHub's rate limit: ...`; `$OUTSIDE_LOG` holds only `gh api user --jq .login`, the rate-limit
  reads `gh api rate_limit` and `ghbot api rate_limit`, and the Readiness checks' `ghbot api /installation/repositories ...`
  and `herdr agent list` (no `gh issue edit`, no `herdr worktree
  create`): nothing was dispatched. Copy it to `$E/outside.off.log`.
- **Toggle on the page.** Run `$C page --evidence "$E/10-toggle" --click "button=Repos" --click "region=Switches" --expect "3 of 9 on" --click "switch=Dispatch" --expect "Saved" --expect "4 of 9 on" --gone "Saved"`.
  `ok` for each step; `.requests.txt` has `PATCH /api/repo/verify/fixture {"switches":{"dispatch":true}} -> 200`; the ARIA
  snapshot has `switch "Dispatch" [checked]` after `set here` and `button "Use the default Dispatch"`,
  `switch "Review"` unchecked after `set here`, and `Faux-nico answers`, `Gardening`, `Only issues
  assigned to me`, `Quality-scan` unchecked after `default`; `config.toml` has `switches = { dispatch = true , review = false }`.
- **Obeyed again.** `: > "$OUTSIDE_LOG"`; run `$C http --evidence "$E/11-refresh-on" POST /api/refresh`.
  HTTP `200`; `actions` has `verify/fixture#1 failed at worktree: ...`, `verify/fixture#5 failed at worktree: ...`
  and `verify/fixture#6 failed at fetch: ...` (the Ready issues, then the Stackable one, room 3);
  `$OUTSIDE_LOG` has a `herdr worktree create` for `#1` and `#5` and a `notify-send` for each failure.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- A Readiness check failing in the run (no implement skill, the stubbed `ghbot`, `herdr`) is a toast over the
  panel's foot (#420), so a `--click` under it times out: `--click "button~Dismiss"` once per toast first.
- `answer`, `gardening`, `mine` and `quality_scan` start off. Turning `answer`, `gardening`
  or `quality_scan` on in a run starts nothing visible (no Asking from herdr, no gardening issue, no
  scan hour), so prove those through `cargo test`, and here only that the PATCH writes them; `mine`
  on narrows what is Ready, driven in [mine](./mine.md).
- A switch acts on the next tick, and in a run ticks happen only on refresh: prove it through a
  refresh, not by waiting.
- The PATCH writes an inline table with toml_edit's spacing (`{ dispatch = true , review = false }`):
  assert on the values, not the spacing.
- The switches are folded to `<n> of 9 on`: `--click "region=Switches"` opens them first, or a
  `switch` is hidden and its click times out.
- For 2 seconds after a save the chip's place reads `Saved`, so `set here` and its `Use the default
  ...` button are not in a snapshot taken at once: wait out `Saved` (`--gone "Saved"`) first.
- `--click "switch=Dispatch"` (role switch) is the toggle; `button "Dispatch"` is the Dispatch form's.
- A refresh with Dispatch on dispatches every Ready and Stackable issue up to the room; each fails
  in the run and stays Failed. Relaunch before driving another feature.
