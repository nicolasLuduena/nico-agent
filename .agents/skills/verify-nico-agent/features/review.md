# Where each PR's review stands

Every live Dispatch whose PR is PR draft or Verified shows where its review stands for the PR's
head: off for the Repo, a Verdict passed or failed, a Reviewer working or stopped without a
Verdict, its start failing and tried again, given up on, or waiting for the next tick. `status`
and `/api/status`, `/api/map/<project>` and `/api/node/<issue>` carry it as `review`; the map's PR
draft node shows it as a short line under its Stage, the node's panel as the **Review** section,
and a review given up on or stopped is a row of the needs-you strip with the command that records
a Verdict by hand. While the review is off, stopped or given up on, the panel's **Review now**
starts a Reviewer on the PR's head at once, whatever the Repo's `review` switch says.

## Sub-features

- `review-status` each such Dispatch has `review` `{state, sha, harness, attempts, cap}`: `sha` the PR's head, `harness` its latest Reviewer's (null before one), `attempts` its starts for the head that failed or whose Reviewer left herdr, `cap` `max_restarts_per_reason`; any other Dispatch has `review` null.
- `review-retrying` a Reviewer whose start failed or that left herdr before a Verdict, at most `cap` times for the head, is `retrying`: the node reads `review retrying`, the panel `Reviewer failed to start or left herdr (<n> of <cap>); trying again next tick`.
- `review-gave-up` past `cap` it is `gave_up`: the node reads `review gave up` and needs you, the panel and a strip row `Review <repo> #<n>` read `Reviewer gave up on <sha7>: review it by hand with nico-agent verdict <issue> pass|fail --sha <head>`.
- `review-passed` a pass Verdict on the head is `passed`: the panel's Review section shows the Verdict row `pass <sha7> <time>`.
- `review-off` with the Repo's `review` switch off it is `off`, Verdict or not, unless a Reviewer was started on the head by hand (`review-now-off`): the node reads `review off`, the panel `Review is off for this Repo`, and the strip drops its Review row.
- `review-now` `button "Review now"` at the right of the panel's review line while it is `off` (with no Verdict on the head), `stopped` or `gave_up`, and at no other time: it reads `Starting…` while `POST /api/review {issue}` runs, then the panel reads `Reviewing <sha7> on <harness>` without a Refresh; the head's failed starts are cleared, so `attempts` is `0` again. A refusal shows inline under it (`role=alert`): one before the start changes nothing; a start that fails is counted against the head, and its refusal stays while the review is `retrying`.
- `review-now-off` with `review` off it starts one all the same, which shows as with review on (`reviewing`, then its Verdict), and the tick still starts none by itself.

## How to get to it (user POV)

- Run `nico-agent status --json` and read each Dispatch's `review`.
- Open `http://127.0.0.1:<port>/` (the run's `$URL`): a PR draft node's last line, the strip, and a node's panel.
- In a PR draft node's panel, press `Review now` beside the review line; or `POST /api/review {"issue": "<issue>"}`.

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
- **Review now.** A fresh run; `repo add` and `seed issues` as above, then `$C seed dispatch 10 pr > "$E/now-seed10.json"`
  alone (its `head`, `<sha7>` its first 7). Run `refresh --json` three times (`20-refresh`,
  `21-refresh`, `22-refresh`): the third's `actions` has `failed to start or left herdr before a
  Verdict 3 times`. `$C state > "$E/state.now-gave-up.txt"`.
- **Review now, refused.** herdr's `agent list` still fails (the stub). Run `$C page --evidence "$E/23-review-now-refused" --click "button~#10, Verify: seeded Dispatch 10" --expect "Reviewer gave up on <sha7>" --click "button=Review now" --expect "could not list herdr's agents"`:
  `.requests.txt` has `POST /api/review {"issue":"verify/fixture#10"} -> 409`; the `alert` under
  `button "Review now"` reads that error and `Try again once herdr answers`. `$C state > "$E/state.now-refused.txt"`:
  its diff from `state.now-gave-up.txt` is only `herdr agent list` calls.
- **Review now, started.** Run `$C seed reviewer 10`, then `$C page --evidence "$E/24-review-now" --click "button~#10, Verify: seeded Dispatch 10" --click "button=Review now" --expect "Reviewing <sha7> on codex"`:
  `.requests.txt` has `POST /api/review ... -> 200` then `GET /api/node/... -> 200`, and the ARIA
  snapshot no `button "Review now"`. `$C run --evidence "$E/25-status" -- status --json`: `#10`'s
  `review` `{"state":"reviewing",...,"attempts":0,"cap":2}`, `reviewer.tab` `verify:t-rev`.
- **Review now, Verdict.** Run `$C run --evidence "$E/26-verdict" -- verdict verify/fixture#10 pass --sha <head> --json`,
  the Reviewer's own call: `{"stage":"Verified",...}`. Run `$C page --evidence "$E/27-passed" --click "button~#10, Verify: seeded Dispatch 10" --expect "pass <sha7>"`:
  under `heading "Review"` the paragraph `pass <sha7> <time>`, no `button "Review now"`.
  `$C state > "$E/state.now-after.txt"`, its diff from `state.now-gave-up.txt` into `$E/state.now.diff`;
  copy `$OUTSIDE_LOG` to `$E/outside.now.log`: one `herdr agent start rev-fixture-10` and its prompt.
- **Review now, review off.** A fresh run; `repo add`, `seed issues`, `$C seed dispatch 10 pr > "$E/off-seed10.json"`,
  `$C http --evidence "$E/30-review-off" PATCH /api/repo/verify/fixture/switches '{"review":false}'`
  and `$C seed reviewer 10`. Run `$C run --evidence "$E/31-refresh" -- refresh --json`: no
  `herdr tab create ... --label reviewer` in `$OUTSIDE_LOG`. Run `$C page --evidence "$E/32-review-now-off" --click "button~#10, Verify: seeded Dispatch 10" --expect "Review is off for this Repo" --click "button=Review now" --expect "Reviewing <sha7> on codex"`.
  Run `$C run --evidence "$E/33-refresh" -- refresh --json`: still one `--label reviewer` in
  `$OUTSIDE_LOG`. Run `$C run --evidence "$E/34-verdict" -- verdict verify/fixture#10 pass --sha <head> --json`
  and `$C run --evidence "$E/35-status" -- status --json`: `#10`'s `stage` `Verified`, `review.state`
  `passed`. Copy `$OUTSIDE_LOG` to `$E/outside.off.log`.

## Gotchas

- herdr is a stub, so a Reviewer never starts until `seed reviewer <n>` makes herdr answer its
  start; `stopped` and `waiting` still need a live herdr, and `cargo test` covers them through the
  fake World. `seed reviewer` lists `impl-fixture-<n>` idle beside it: any other live Dispatch's
  Implementer is then missing from herdr, and a tick restarts it (and fails, at its tab).
- The seeded head differs per run: read `head` from `seed dispatch`'s JSON for each `--expect`.
- The strip and the map refetch on the next `changed` event, up to 10 seconds after a switch is
  set; a page opened right after the switch may still show the old state there while the panel,
  fetched on opening, shows the new one. Open the page again for the settled view.
- Every `refresh` also dispatches the Ready `#1`, which fails at worktree: a `Failed` strip row
  beside the Review one.
