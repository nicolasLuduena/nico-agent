# Where each PR's review stands

Every live Dispatch whose PR is PR draft or Verified shows where its review stands for the PR's
head: off for the Repo, a Verdict passed or failed, a Reviewer working or stopped without a
Verdict, its start failing and tried again, given up on, or waiting for the next tick. `status`
and `/api/status`, `/api/map/<project>` and `/api/node/<issue>` carry it as `review`; the map's PR
draft node shows it as a short line under its Stage, the node's panel as the **Review** section,
and a review given up on or stopped is a row of the needs-you strip with the command that records
a Verdict by hand.

## Sub-features

- `review-status` each such Dispatch has `review` `{state, sha, harness, attempts, cap}`: `sha` the PR's head, `harness` its latest Reviewer's (null before one), `attempts` its starts for the head that failed or whose Reviewer left herdr, `cap` `max_restarts_per_reason`; any other Dispatch has `review` null.
- `review-retrying` a Reviewer whose start failed or that left herdr before a Verdict, at most `cap` times for the head, is `retrying`: the node reads `review retrying`, the panel `Reviewer failed to start or left herdr (<n> of <cap>); trying again next tick`.
- `review-gave-up` past `cap` it is `gave_up`: the node reads `review gave up` and needs you, the panel and a strip row `Review <repo> #<n>` read `Reviewer gave up on <sha7>: review it by hand with nico-agent verdict <issue> pass|fail --sha <head>`.
- `review-passed` a pass Verdict on the head is `passed`: the panel's Review section shows the Verdict row `pass <sha7> <time>`.
- `review-off` with the Repo's `review` switch off it is `off`, Verdict or not: the node reads `review off`, the panel `Review is off for this Repo`, and the strip drops its Review row.

## How to get to it (user POV)

- Run `nico-agent status --json` and read each Dispatch's `review`.
- Open `http://127.0.0.1:<port>/` (the run's `$URL`): a PR draft node's last line, the strip, and a node's panel.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/review`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, `$C seed issues`,
  `$C seed dispatch 10 pr > "$E/seed10.json"` and `$C seed dispatch 11 pr > "$E/seed11.json"`.

- **Passed.** Run `$C run --evidence "$E/01-pass-11" -- verdict verify/fixture#11 pass --sha "$(jq -r .head "$E/seed11.json")" --json`.
  `$C state > "$E/state.before.txt"`.
- **Retrying.** Run `$C run --evidence "$E/02-refresh" -- refresh --json`: `actions` has `could not
  start the Reviewer of verify/fixture#10: ...`. Run `$C run --evidence "$E/03-status" -- status --json`:
  `#10`'s `review` is `{"state":"retrying","sha":"<head of 10>","harness":"codex","attempts":1,"cap":2}`,
  `#11`'s is `passed` with `harness` null, `#1`'s (Failed) null.
- **Retrying on the page.** Run `$C page --evidence "$E/04-retrying" --click "button~#10, Verify: seeded Dispatch 10" --expect "Reviewer failed to start or left herdr (1 of 2); trying again next tick"`.
  The node button is `#10, Verify: seeded Dispatch 10, PR draft, PR 110 draft, review retrying`;
  the panel has `heading "Review"` then that paragraph.
- **Passed on the page.** Run `$C page --evidence "$E/05-passed" --click "button~#11, Verify: seeded Dispatch 11" --expect "Evidence"`:
  under `heading "Review"` the paragraph `pass <first 7 of 11's head> <time>`.
- **Gave up.** Run `refresh --json` twice more (`06-refresh`, `07-refresh`): the second's `actions`
  has `its Reviewer for <head> failed to start or left herdr before a Verdict 3 times`. `status --json`
  (`08-status`) and `$C http --evidence "$E/09-api-status" GET /api/status` give `#10` `review`
  `state` `gave_up`, `attempts` `3`.
- **Gave up on the page.** Run `$C page --evidence "$E/10-gave-up" --click "button~Review verify/fixture #10" --expect "Reviewer gave up on <sha7>"`.
  `region "Needs you"` has `button "Review verify/fixture #10 Reviewer gave up on <sha7>: review it by hand with nico-agent verdict verify/fixture#10 pass|fail --sha <head>"`,
  the command a `code`; `.requests.txt` has `GET /api/node/verify%2Ffixture%2310 -> 200`; the node
  button ends `review gave up, needs you`. At `--width 390` (`11-phone`) the row wraps and nothing
  is wider than the screen.
- **Off.** Run `$C page --evidence "$E/12-review-off" --click "region=Switches" --click "switch=Review" --click "button~#10, Verify: seeded Dispatch 10" --expect "Review is off for this Repo"`:
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"switches":{"review":false}} -> 200`. Run
  `status --json` (`13-status-off`): `#10` and `#11` `review.state` `off`. Run `$C page --evidence "$E/14-off-settled" --click "button~#10, Verify: seeded Dispatch 10" --expect "Review is off for this Repo"`:
  no Review row in the strip, the node button ends `review off` without `needs you`.
- **Proof.** `$C state > "$E/state.after.txt"`, its diff from `state.before.txt` into `$E/state.diff`
  (`dispatches.json`'s and `config.toml`'s hashes, `switches = { review = false }`, three `herdr tab
  create ... --label reviewer` and one `notify-send ... verify/fixture#10 Reviewer stopped`); copy
  `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- herdr is a stub, so a Reviewer never starts: `reviewing`, `stopped` and `waiting` need a live
  herdr, and `cargo test` covers them through the fake World.
- The strip and the map refetch on the next `changed` event, up to 10 seconds after a switch is
  set; a page opened right after the switch may still show the old state there while the panel,
  fetched on opening, shows the new one. Open the page again for the settled view.
- Every `refresh` also dispatches the Ready `#1`, which fails at worktree: a `Failed` strip row
  beside the Review one.
