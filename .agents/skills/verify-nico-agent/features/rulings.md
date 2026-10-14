# A Dispatch the Reviewer kept failing

After a failing Verdict the restarted Implementer rules on each Finding in `rulings.md` in its
Evidence, which reaches the Bucket with each PR head as the rest of the Evidence does. Once its
`verdict` restarts are used up, the next failing Verdict marks the Dispatch Failed on `verdict`:
`status` and `/api/status` say so in its `failure`, and the needs-you strip and the node's panel say
"The Reviewer failed it N rounds running; the Findings and Rulings are in its Evidence", with what
ends it under that. A Dispatch Failed for any other reason, a `verdict` restart that failed at a
step included, reads as before.

## Sub-features

- `rulings-bucket` `.evidence/<n>/rulings.md` in the worktree is kept in the Bucket at the PR's next head, served at `/bucket/<owner>/<repo>/<n>/<sha>/rulings.md`.
- `failed-verdict-status` a failing Verdict on a Dispatch whose `verdict` restarts are used up: the refresh says `<issue> Failed: verdict again after 2 restarts for it`, and `/api/status` has its `failure` `{step: "restart", error, reason: "verdict"}`.
- `failed-verdict-strip` its strip row is `Failed <repo> #<n> The Reviewer failed it N rounds running; the Findings and Rulings are in its Evidence Merge its PR or close it on GitHub, and the loop Closes the Dispatch <updated>`, N being its `verdict` restarts plus one.
- `failed-verdict-panel` its panel's Failure section says the same line in `strong` and the help under it; its Evidence holds `findings.md` and `rulings.md` at the failing head.
- `failed-other` a `verdict` restart that failed at its tab is a row `Failed <repo> #<n> <title> <updated>`, its panel's Failure the error and `At the tab step.`

## How to get to it (user POV)

- The loop's tick, or the user's Refresh, after the Reviewer's `nico-agent verdict <issue> fail`.
- The user opens the page (`$URL`), reads the strip, and clicks the row for the node's panel.
- The user opens `/bucket/<owner>/<repo>/<n>/` (the PR body's `## Findings` link) for the Rulings.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/rulings`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C seed dispatch 11 pr > "$E/seed11.json"` and `$C seed dispatch 10 restarted > "$E/seed10.json"`
  (#10's Implementer restarted twice for failing Verdicts an hour ago);
  `HEAD=$(jq -r .head "$E/seed10.json")`, `WT=$(jq -r .worktree "$E/seed10.json")`.
- `$C state > "$E/state.before.txt"`.

- **Rulings reach the Bucket.** As the restarted Implementer does, write `$WT/.evidence/10/rulings.md`
  (`# Rulings: verify/fixture#10`, then a `## Findings at <sha>` section per round with `- **F1**
  "<title>": fixed in <sha>` or `dismissed. <why>` lines), then `$C drift push 10 > "$E/push10.json"`;
  `NEW=$(jq -r .head "$E/push10.json")`. Run `$C run --evidence "$E/01-refresh-new-head" -- refresh --json`:
  `actions` hold `verify/fixture#10: Evidence at $NEW kept in the Bucket`. Run
  `$C http --evidence "$E/02-bucket-rulings" GET "/bucket/verify/fixture/10/$NEW/rulings.md"`: HTTP `200`,
  the file's text.
- **Failed on verdict, and at a step.** Write `$E/findings.md`, then run
  `$C run --evidence "$E/03-fail-10" -- verdict verify/fixture#10 fail --sha "$NEW" --findings "$PWD/$E/findings.md" --json`
  and the same for `verify/fixture#11` on its seeded head (`04-fail-11`). Run
  `$C run --evidence "$E/05-refresh-failed" -- refresh --json`: `actions` hold `verify/fixture#11 failed
  at tab of its verdict restart: ...` and `verify/fixture#10 Failed: verdict again after 2 restarts for
  it`. Run `$C http --evidence "$E/06-api-status" GET /api/status`: `#10`'s `failure` is `{"error":
  "verdict again after 2 restarts for it", "reason": "verdict", "step": "restart"}`, its `restarts`
  two `verdict`; `#11`'s `{"step": "tab", "reason": "verdict", ...}`, one `verdict` restart.
- **The strip.** Run `$C page --evidence "$E/07-strip" --expect "rounds running"`: `region "Needs you"`
  has `button "Failed verify/fixture #11 Verify: seeded Dispatch 11 <time>"` and `button "Failed
  verify/fixture #10 The Reviewer failed it 3 rounds running; the Findings and Rulings are in its
  Evidence Merge its PR or close it on GitHub, and the loop Closes the Dispatch <time>"`, the help on
  the line under the text in the screenshot.
- **The panels.** Run `$C page --evidence "$E/08-panel-10" --click "button~Failed verify/fixture #10" --expect "Open Evidence"`:
  `.requests.txt` has `GET /api/node/verify%2Ffixture%2310 -> 200`; under `heading "Failure"`, `strong:
  The Reviewer failed it 3 rounds running; the Findings and Rulings are in its Evidence` and `paragraph:
  Merge its PR or close it on GitHub, and the loop Closes the Dispatch`; `heading "Restarts"` lists two
  `verdict by loop`; under `heading "Evidence"`, `1 head · 3 files`. Run
  `$C page --evidence "$E/09-panel-11" --click "button~Failed verify/fixture #11" --expect "step"`: under
  `heading "Failure"`, the herdr error in `strong` and `paragraph: At the tab step.`
- **Phone, dark.** Run `$C page --evidence "$E/10-phone-dark" --width 390 --scheme dark --click "button~Failed verify/fixture #10" --expect "Open Evidence"`:
  the same Failure section in the bottom sheet, `page 390px wide in a 390px window`.
- **The Evidence.** Run `$C http --evidence "$E/11-bucket-folder" GET /bucket/verify/fixture/10/`: HTTP
  `200`, a page linking `$NEW/findings.md`, `$NEW/proof.txt` and `$NEW/rulings.md`.
- **Proof.** `$C state > "$E/state.after.txt"`, its diff from `state.before.txt` in `$E/state.diff`
  (both Verdicts, both Dispatches' `failure`, the Bucket's `pr` commit of #10 at `$NEW` holding
  `rulings.md` and a `verdict` commit each with `findings.md`), and `outside.log` one `notify-send`
  per Failed Dispatch.
  Copy `$OUTSIDE_LOG` to `$E/outside.log`. Each `.console.txt` is empty.

## Gotchas

- With herdr stubbed every restart fails at its tab, so a run never uses `verdict` restarts up on
  its own: `seed dispatch <n> restarted` stands in for the two a working herdr lets the loop make.
  `max_restarts_per_reason` refuses `0`, so it cannot shortcut this.
- The restart prompt with `[prompts.restart] rulings` is never sent in a run (the restart fails at
  its tab first), nor is the Implementer's `## Findings` line in a PR body written (no GitHub):
  `cargo test` covers the prompt, the PR body is the Implementer's own edit.
- Merging or closing the PR, which the help names, is not drivable: no `drift` makes a seeded PR
  final. `cargo test` proves the Dispatch Closes on the next tick either way.
- Write `rulings.md` before `drift push`: the Bucket keeps a head's Evidence once, when a tick
  first sees it (and again at its Verdict).
