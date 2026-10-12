# Refresh

Refresh is the one way to ask GitHub again on purpose: every Repo's Source is read even when its
cached read is fresh, then a tick runs that asks about every watched PR, final ones included, and
does whatever the loop would do. The page's `Refresh` button sends it and refetches what it shows; a
paused GitHub stays paused and is asked nothing.

## Sub-features

- `refresh-button` clicking `button "Refresh"` sends `POST /api/refresh`, then the page refetches `/api/status` and the map.
- `refresh-reads` every Repo's Source is asked even with a fresh cache; a refusal is the Repo's `error`, and the cache stands.
- `refresh-tick` the tick runs and its lines are `actions`: here, the Ready and Stackable issues dispatched (and failing in the run).
- `refresh-prs` every watched PR is asked about again; a refusal is an action line, and `prs` lists them as last known.
- `refresh-paused` with GitHub paused nothing is asked; each Repo's `error` says until when.
- `refresh-cli` `nico-agent refresh` answers the same `{repos, prs, actions}`.

## How to get to it (user POV)

- Press `Refresh` beside the read times in a Repo's tab on the page.
- Run `nico-agent refresh` in a terminal.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`.
- `E=.evidence/<issue>/refresh`.

- **Before.** Run `$C page --evidence "$E/01-before"`: `region "Needs you"` says `Nothing needs you`;
  the map shows `#1` and `#5` Ready, `#6` Stackable. `: > "$OUTSIDE_LOG"`.
- **Press Refresh.** Run `$C page --evidence "$E/02-pressed" --click "button=Refresh" --expect "Failed"`.
  `.requests.txt` has, after the first load, `POST /api/refresh -> 200` then `GET /api/status -> 200`
  and `GET /api/map/verify/fixture -> 200`; the strip now lists `Failed verify/fixture #1`, `#5` and
  `#6`, and the map's nodes say `Failed, needs you`. `$OUTSIDE_LOG` starts `gh api user --jq .login`
  (the fresh cache was not trusted), then the dispatches' `gh issue edit`, `herdr worktree create`
  and `notify-send` lines. Copy it to `$E/outside.pressed.log`.
- **CLI.** Run `$C seed dispatch 10 pr`, `: > "$OUTSIDE_LOG"`, then `$C run --evidence "$E/03-cli" -- refresh --json`.
  Exit `0`; `repos` is `[{"error":"not authenticated with GitHub; run \`gh auth login\`","read_at":<the seed's>,"slug":"verify/fixture"}]`;
  `prs` is `[{"final":false,"state":"open","url":"https://github.com/verify/fixture/pull/110"}]`;
  `actions` are, in order, `could not look for the PR of verify/fixture#1: ...` (and `#5`, `#6`),
  `could not ask GitHub about https://github.com/verify/fixture/pull/110: not authenticated with GitHub; run \`gh auth login\``,
  the same for `.../pull/109` (the PR `#6` stacks on, watched from then on), `verify/fixture#10: Evidence
  at <its head> kept in the Bucket`, `could not list herdr's agents: ...`
  and `could not start the Reviewer of verify/fixture#10: \`herdr tab create\` failed: ...`.
  `$OUTSIDE_LOG` has `gh api user --jq .login`, a `gh pr list --repo verify/fixture --head agent/fixture-<n> ...`
  per Dispatch without a PR, `gh pr view 110 --repo verify/fixture --json ...` and `gh pr view 109 ...`,
  `herdr agent list` and `herdr tab create --workspace verify-workspace-10 ...`. Copy it to `$E/outside.cli.log`.
- **Paused.** Run `$C drift pause`, `: > "$OUTSIDE_LOG"`, then `$C http --evidence "$E/04-paused" POST /api/refresh`.
  HTTP `200`; `repos[0].error` `GitHub rate limit exceeded; nico-agent asks it again at <the pause>`;
  `actions` hold only the two herdr lines; `$OUTSIDE_LOG` has no `gh` line, only `herdr agent list`
  and `herdr tab create`. Run `$C page --evidence "$E/05-paused-page"`: the strip adds `Paused
  GitHub until <time>` under the three Failed rows.
- **Proof.** `$C state > "$E/state.after.txt"`; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- The button's `Refreshing…` state lasts as long as the tick; in a run that is under a second, so
  prove the click by `.requests.txt`, not by catching the label.
- In a run GitHub always refuses, so the read times beside the button do not move after a refresh;
  what changes is what the tick did (dispatches, strip rows) and what `$OUTSIDE_LOG` recorded.
- A refused POST (a config that does not load) shows an `alert` under the button; a 200 with a
  Repo's `error` does not.
- Every refresh tick restarts nothing for a seeded Dispatch whose Agent states are unknown (herdr
  stubbed), but tries its Reviewer each time (`herdr tab create`, refused); past
  `max_restarts_per_reason` refusals the loop stops trying that head and tells the user once.
