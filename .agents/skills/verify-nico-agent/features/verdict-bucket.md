# Verdict recording to the Bucket

`verdict` is how a Reviewer records its pass or fail on one head of a Dispatch's open PR. The
Bucket keeps the worktree's `.evidence/<n>/` at `<owner>/<repo>/<n>/<sha>/` as soon as a tick sees
the PR at that head, so the PR body's link opens before any Verdict; a recorded Verdict commits it
again there with the findings. serve shows the Bucket under `/bucket/` and the node's panel links
it; a pass makes the Stage Verified, and a push to the PR leaves the Verdict on a head the PR no
longer has.

## Sub-features

- `verdict-usage` a missing result, `--sha`, or `--findings` on a fail, a word other than pass or fail, or an issue key without its number (`owner/repo#abc`, `owner/repo#`), is exit 2.
- `verdict-no-dispatch` an issue with no live Dispatch is exit 1.
- `verdict-no-pr` a live Dispatch with no open PR is exit 1.
- `verdict-wrong-head` a `--sha` other than the PR's head is exit 1, naming the head to verify.
- `verdict-reviewer-worktree` when the Dispatch's Reviewer was prompted for that head, a `--sha` its own worktree (`rev-<repo>-<n>` beside the Implementer's) is not at, or that worktree with changes to tracked files, is exit 1; a Verdict by hand, with no Reviewer prompted for the head, is not checked.
- `verdict-reviewer-evidence` a Verdict on the head its Reviewer was prompted for keeps the Reviewer's own `.evidence/<n>/`, from its worktree, under `<sha>/review/`, beside the Implementer's: a file of the same name in both is kept twice.
- `verdict-findings-unreadable` a `--findings` file that cannot be read is exit 1.
- `bucket-pr-head` a tick (here a refresh) keeps the Evidence of a Dispatch's open PR at its head with no Verdict: action `<issue>: Evidence at <sha> kept in the Bucket`, a Bucket commit `pr <issue> <sha>`, and `/bucket/<owner>/<repo>/<n>/` listing it.
- `bucket-pr-head-noop` a tick on a head whose Evidence is kept already keeps nothing and says nothing.
- `bucket-new-head` a tick after a push keeps the Evidence again under the new head's `<sha>/`.
- `verdict-pass` records `pass` on the head: `verdicts/<owner>/<repo>#<n>.json`, a Bucket commit `verdict <issue> pass <sha>` with the Evidence, and `stage` `Verified`.
- `verdict-noop` the same Verdict again answers `already recorded (no-op)` and commits nothing.
- `verdict-push` after a push, the old head's Verdict no longer counts (`PR draft`) and is refused for the new head.
- `verdict-fail` records `fail` with the findings file's text: the Bucket gains `findings.md` beside the Evidence.
- `bucket-serve` `GET /bucket/<path>` serves a kept file (sandboxed), an issue's folder as its Evidence page by head, folder and step, 404 for a missing file, 403 outside the working tree.
- `bucket-panel` on the page, the node's panel shows the Verdict and an Open Evidence link to the issue's folder, with its heads and files counted.

## How to get to it (user POV)

- The loop's tick, or the user's Refresh, sees the PR at a head it has not kept Evidence at.
- The Reviewer runs `nico-agent verdict <issue> pass|fail --sha <head> [--findings <file>]` in its
  own worktree, checked out detached at the PR's head.
- The user opens `/bucket/<owner>/<repo>/<n>/` (or the PR body's link), or clicks the node on the page and follows its Evidence links.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/verdict-bucket`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C seed dispatch 10 pr > "$E/seed10.json"` and `$C seed dispatch 12 asking`;
  `HEAD=$(jq -r .head "$E/seed10.json")`.
- `$C state > "$E/state.before.txt"`.

- **Usage.** Run `verdict verify/fixture#10 --json` (`--evidence "$E/01-no-result"`): exit `2`
  `pass|fail is required`; `verdict verify/fixture#10 maybe --sha "$HEAD" --json` (`02-maybe`): exit
  `2` `` `maybe` is not a Verdict: pass or fail ``; `verdict verify/fixture#10 pass --json`
  (`03-no-sha`): exit `2` `--sha is required`; `verdict verify/fixture#10 fail --sha "$HEAD" --json`
  (`04-fail-no-findings`): exit `2` `a failing Verdict needs --findings <file>`;
  `verdict verify/fixture#abc pass --sha "$HEAD" --json` (`04-no-number`) and
  `verdict 'verify/fixture#' pass --sha "$HEAD" --json` (`04-empty-number`): exit `2`
  `` `verify/fixture#abc` is not an issue reference `` (and `` `verify/fixture#` ``).
- **No Dispatch.** Run `$C run --evidence "$E/05-no-dispatch" -- verdict verify/fixture#11 pass --sha "$HEAD" --json`.
  Exit `1`, `error` `verify/fixture#11 has no live Dispatch`.
- **No PR.** Run `$C run --evidence "$E/06-no-pr" -- verdict verify/fixture#12 pass --sha "$HEAD" --json`.
  Exit `1`, `error` `verify/fixture#12 has no open PR`.
- **Wrong head.** Run `$C run --evidence "$E/07-wrong-head" -- verdict verify/fixture#10 pass --sha deadbeef --json`.
  Exit `1`, `error` `deadbeef is not the head of https://github.com/verify/fixture/pull/110`, `help`
  `The PR moved to $HEAD: verify that head and run \`nico-agent verdict verify/fixture#10 pass|fail --sha $HEAD\``.
- **Unreadable findings.** Run `$C run --evidence "$E/08-findings-missing" -- verdict verify/fixture#10 fail --sha "$HEAD" --findings /nonexistent.md --json`.
  Exit `1`, `error` `could not read the findings in /nonexistent.md: No such file or directory (os error 2)`.
  `$C state` still matches `state.before.txt`: no refusal wrote anything.
- **Kept before any Verdict.** Run `$C run --evidence "$E/09-refresh" -- refresh --json`.
  `actions` hold `verify/fixture#10: Evidence at $HEAD kept in the Bucket`, after the `could not ask
  GitHub about ...` lines. Run `$C http --evidence "$E/10-bucket-before-verdict" GET /bucket/verify/fixture/10/`:
  HTTP `200`, a page with `Head <first 7 of $HEAD>` and a `proof` step showing its text, linked to `$HEAD/proof.txt`. Run `$C run --evidence "$E/11-refresh-again" -- refresh --json`:
  no `kept in the Bucket` action. `$C state > "$E/state.kept.txt"`: its Bucket log adds one commit
  `pr verify/fixture#10 $HEAD` with `verify/fixture/10/$HEAD/proof.txt`.
- **Pass.** Run `$C run --evidence "$E/12-pass" -- verdict verify/fixture#10 pass --sha "$HEAD" --json`.
  Exit `0`, `{"stage":"Verified","verdict":"verify/fixture#10 pass at $HEAD"}`.
- **Same again.** Same command, `--evidence "$E/13-pass-again"`: `verdict` ends `already recorded (no-op)`.
  `$C state > "$E/state.pass.txt"`; its diff from `state.kept.txt` adds `verdicts/verify/fixture#10.json`
  `{"result":"pass","sha":"$HEAD"}` and one Bucket commit `verdict verify/fixture#10 pass $HEAD`,
  with no file changed: the `pr` commit before it holds `verify/fixture/10/$HEAD/proof.txt`.
- **Served.** Run `$C http --evidence "$E/14-bucket-file" GET "/bucket/verify/fixture/10/$HEAD/proof.txt"`:
  HTTP `200`, body `Evidence of verify/fixture#10 at $HEAD, seeded by verify-nico-agent`, headers
  `Content-Type: text/plain; charset=utf-8` and `Content-Security-Policy: sandbox`.
- **Panel.** Run `$C page --evidence "$E/15-panel" --click "button~#10, Verify: seeded Dispatch 10"`.
  `.requests.txt` has `GET /api/node/verify%2Ffixture%2310 -> 200`; the ARIA snapshot has
  `region "Verify: seeded Dispatch 10"` with `strong: Verified`, `heading "Review"` then
  `pass <first 7 of $HEAD> <time>`, and under `heading "Evidence"` a `link "Open Evidence"` to
  `/bucket/verify/fixture/10/` and `1 head · 1 file`.
- **Push.** Run `$C drift push 10 > "$E/push10.json"`; `NEW=$(jq -r .head "$E/push10.json")`. Run
  `$C run --evidence "$E/16-after-push" -- status --json`: `#10`'s `stage` is `PR draft`, its
  `verdict.sha` still `$HEAD`. Run `$C run --evidence "$E/17-old-head" -- verdict verify/fixture#10 pass --sha "$HEAD" --json`:
  exit `1`, `$HEAD is not the head of ...`, `The PR moved to $NEW`.
- **New head.** Run `$C run --evidence "$E/18-refresh-new-head" -- refresh --json`: `actions` hold
  `verify/fixture#10: Evidence at $NEW kept in the Bucket` (and the Reviewer's refusal).
- **Fail.** Write `$E/findings.md` (`# Findings` and one item), then run
  `$C run --evidence "$E/19-fail" -- verdict verify/fixture#10 fail --sha "$NEW" --findings "$PWD/$E/findings.md" --json`.
  Exit `0`, `{"stage":"PR draft","verdict":"verify/fixture#10 fail at $NEW"}`. Run
  `$C http --evidence "$E/20-bucket-findings" GET "/bucket/verify/fixture/10/$NEW/findings.md"`:
  HTTP `200`, the findings' text.
- **Folder, missing, outside.** `$C http --evidence "$E/21-bucket-folder" GET /bucket/verify/fixture/10/`:
  HTTP `200`, an HTML page linking `$HEAD/proof.txt`, `$NEW/findings.md`, `$NEW/proof.txt`.
  `$C http --evidence "$E/22-bucket-missing" GET /bucket/verify/fixture/10/nope.txt`: HTTP `404`,
  `no file verify/fixture/10/nope.txt in the Bucket`. `$C http --evidence "$E/23-bucket-outside" GET /bucket/../config.toml`:
  HTTP `403`, `../config.toml is not in the Bucket's working tree`.
- **Proof.** `$C state > "$E/state.after.txt"`: the Bucket log has five commits, newest first
  `verdict verify/fixture#10 fail $NEW` (`findings.md`), `pr verify/fixture#10 $NEW` (`proof.txt`),
  `verdict verify/fixture#10 pass $HEAD` (no file), `pr verify/fixture#10 $HEAD` (`proof.txt`),
  `nico-agent's Bucket`. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

- **Reviewer's Evidence.** A fresh run; `repo add` and `seed issues`, then `$C seed dispatch 10 pr > "$E/seed10.json"`
  and `$C seed reviewer 10`. Run `$C run --evidence "$E/30-refresh-reviewer" -- refresh --json`: `actions`
  hold `verify/fixture#10: Reviewer started on codex for $HEAD`. Write `$RUN_DIR/worktrees/rev-fixture-10/.evidence/10/proof.txt`
  (the Implementer's has the same name), `$C state > "$E/state.before-review.txt"`, then run
  `$C run --evidence "$E/31-reviewer-pass" -- verdict verify/fixture#10 pass --sha "$HEAD" --json`: `Verified`.
  `$C http --evidence "$E/32-bucket-implementer" GET "/bucket/verify/fixture/10/$HEAD/proof.txt"` is the
  seeded text; `$C http --evidence "$E/33-bucket-reviewer" GET "/bucket/verify/fixture/10/$HEAD/review/proof.txt"`
  is the Reviewer's; `$C http --evidence "$E/34-bucket-folder" GET /bucket/verify/fixture/10/` links both.
  `$C state > "$E/state.after-review.txt"`: the diff adds the Verdict and one Bucket commit
  `verdict verify/fixture#10 pass $HEAD` with `review/proof.txt`.

## Gotchas

- `--findings` is read relative to the cwd, which for `$C run` is the run's `work/`: pass an
  absolute path.
- The seeded Dispatch's Evidence is `.evidence/<n>/proof.txt` in its worktree; the Bucket copies
  whatever that folder holds when a tick first sees a head and at each Verdict, under that head's
  sha. A Verdict on a head without a tick first (as right after `drift push`) commits the Evidence
  itself.
- Keeping Evidence at Close (a merged or closed PR) is not drivable: no `drift` makes a PR final.
  `cargo test` covers it.
- A refresh before the Pass step also tries the Reviewer (refused by the herdr stub), which never
  fails the Dispatch: the Pass still answers `Verified`.
- Do not tick (refresh) after a fail Verdict unless that is the point: the loop restarts the
  Implementer, the herdr stub refuses, and the Dispatch turns Failed.
- A pass Verdict on a draft PR leaves the PR draft in `prs.json`: flipping it needs GitHub, which a
  run never reaches (a refresh tick tries `gh pr ready` and records the refusal).
- `curl` normalises `..` unless told not to; `$C http` sends the path as given, which the 403 needs.
- The panel's heading names the issue `#10` once a tab has picked the Repo, but the
  whole key `verify/fixture#10` when the node is clicked on the first tab as the page opened (no
  Repo picked yet). That is the page's behavior today (a product gap, not drift); match with `~`.
