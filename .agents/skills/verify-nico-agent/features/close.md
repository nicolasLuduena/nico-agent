# Close

Once a Dispatch's PR is final, each tick Closes it: keeps its Evidence in the Bucket, removes its
worktree and closes its workspace. A merged PR's worktree is removed with `--force`, whatever is
left in it. A PR closed unmerged with modified or untracked files in its worktree is not removed:
the tick says once `could not Close <issue>: worktree has uncommitted changes: <files>`, the
Dispatch is `Failed` at the `close` step and in the needs-you strip, and later ticks check again
without a word until the files are gone.

## Sub-features

- `close-merged-force` a merged PR's worktree is removed with `herdr worktree remove --workspace <ws> --force`.
- `close-dirty-once` a closed-unmerged PR's dirty worktree is said once in a tick's `actions`, not again the next tick, with no `herdr worktree remove`.
- `close-dirty-failed` that Dispatch is `stage: "Failed"` with `failure: {step: "close", error: "worktree has uncommitted changes: <files>"}`, and `closed_at: null`.
- `close-dirty-strip` the strip has `button "Failed verify/fixture #<n> <title> <time>"`; its panel shows the error and `At the close step.`

## How to get to it (user POV)

- A tick: `nico-agent refresh --json` (or serve's own tick, or the page's Refresh), then `nico-agent status --json`.
- Open `http://127.0.0.1:<port>/` (the run's `$URL`) and the Failed row.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C seed dispatch 10 pr` and `$C seed dispatch 11 pr`: each worktree holds an untracked `.evidence/`, so both are dirty.
- `E=.evidence/<issue>/close`.

- **Make both final.** Run `$C drift final 10 closed` and `$C drift final 11 merged`.
- **First tick.** Run `$C run --evidence "$E/01-refresh" -- refresh --json`. `actions` has
  `could not Close verify/fixture#10: worktree has uncommitted changes: ?? .evidence/` and, herdr
  being a stub, `could not Close verify/fixture#11: ... verify_stub ...`. `$OUTSIDE_LOG` has
  `herdr worktree remove --workspace verify-workspace-11 --force` and no `herdr worktree remove` for `verify-workspace-10`.
- **Second tick.** Run `$C run --evidence "$E/02-refresh-again" -- refresh --json`. `actions` has no
  line for `verify/fixture#10`; #11's is said again (herdr is down, not a dirty worktree).
- **Status.** Run `$C run --evidence "$E/03-status" -- status --json`. `#10` is `stage: "Failed"`,
  `failure.step: "close"`, `closed_at: null`; `#11` is `stage: "Merged"`, `failure: null`.
- **Strip.** Run `$C page --evidence "$E/04-strip" --expect Failed`. `region "Needs you"` has
  `button "Failed verify/fixture #10 Verify: seeded Dispatch 10 <time>"`.
- **Open it.** Run `$C page --evidence "$E/05-open" --click "button~Failed verify/fixture #10"`.
  `.requests.txt` has `GET /api/node/verify%2Ffixture%2310 -> 200`; the panel has
  `strong: "worktree has uncommitted changes: ?? .evidence/"` and `paragraph: At the close step.`
- **Proof.** Copy `$OUTSIDE_LOG` to `$E/outside.log`. Each `.console.txt` is empty.

## Gotchas

- herdr is stubbed, so a merged PR's forced removal fails with `verify_stub` and is retried each
  tick; only `cargo test` sees a Close succeed.
- git lists an untracked folder as one line: `?? .evidence/`, not the files in it.
