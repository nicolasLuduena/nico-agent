# Status

`status` shows per Repo what the loop may start (Ready, Stackable and waiting issues, from the
Source's read), when that read was made, and every Dispatch with its Stage, its Agent state and its
Verdict. It reads the Source only when its cached read is older than a tick, and shows the cache,
however old, when the Source refuses or GitHub is paused. `GET /api/status` is the same answer from
the cache alone, plus what the page shows beside each map.

## Sub-features

- `status-no-cache` with no read yet and GitHub refusing, the Repo shows `read_at` null, empty lists and the refusal as `error`.
- `status-cached` a fresh cached read is shown without asking GitHub: Ready `#1` (code) and `#5` (research), Stackable `#6` with `base` `agent/fixture-9`.
- `status-not-ready` issues not labelled, waiting on a Blocker without PR, or assigned to someone else are in no list (`gardening`, the Ready `gardening` issues, is empty: the fixture has none).
- `status-stale` a read older than a tick asks GitHub again; refused, the cache is still shown, with `error`.
- `status-paused` a paused GitHub is asked nothing: `sources.github.paused_until` is set, an uncached Repo's `error` says when it is asked again.
- `status-dispatches` each Dispatch with `stage` (`Failed`, `PR draft`, `Implementing`, `Verified`), `agent_state` `unknown` while herdr does not answer, `review` (see review.md), `verdict` and `pr`.
- `status-api` `GET /api/status` holds the command's `sources` and `dispatches`, and per Repo also `switches`, `room`, `implementer`, `reviewer`, `harnesses`, `prs_checked_at` and `github_paused_until`.

## How to get to it (user POV)

- Run `nico-agent status` in a terminal (`--json` for scripts).
- Open serve's page: `/api/status` is what it renders (see page-tabs-strip).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `E=.evidence/<issue>/status`.

- **No read yet.** Run `$C run --evidence "$E/01-no-cache" -- status --json`. Exit `0`; `repos[0]`
  is `{"error":"not authenticated with GitHub; run \`gh auth login\`","read_at":null,"ready":[],"slug":"verify/fixture","stackable":[],"waiting":[]}`;
  `dispatches` `[]`. `$OUTSIDE_LOG` gained `gh api user --jq .login`.
- **Cached read.** Run `$C seed issues`, then `$C state > "$E/state.before.txt"` and `$C run --evidence "$E/02-cached" -- status --json`.
  Exit `0`; no `error`; `read_at` is the seed's; `ready` is `verify/fixture#1` "Verify: a Ready
  issue" `kind` `code` and `verify/fixture#5` "Verify: a Research issue" `kind` `research`;
  `stackable` is `verify/fixture#6` with `base` `agent/fixture-9`; `#2`, `#3`, `#4` are nowhere.
  `$C state > "$E/state.after.txt"`; their diff is empty: nothing written, nothing asked.
- **Dispatches.** Run `$C run -- dispatch verify/fixture#1 --json` (fails at worktree, see
  dispatch-refusals), `$C seed dispatch 10 pr` and `$C seed dispatch 12 asking`, then `$C run --evidence "$E/03-dispatches" -- status --json`.
  `dispatches` in that order: `verify/fixture#1` `stage` `Failed` with `failure.step` `worktree`
  and a `could not Claim` warning, `verify/fixture#10` `PR draft` with `pr.url`
  `https://github.com/verify/fixture/pull/110` and `pr.draft` true, `verify/fixture#12`
  `Implementing` with `asking.question`; each `agent_state.implementer` `unknown`. `ready` no longer
  lists `#1`. `$OUTSIDE_LOG` gained `herdr agent list`.
- **API.** Run `$C http --evidence "$E/04-api" GET /api/status`. HTTP `200`; `dispatches` and
  `sources` equal the command's; `repos[0]` adds `switches` (`dispatch`, `flip`, `restart`,
  `review`, `stack` true; `answer`, `gardening`, `quality_scan` false), `room` `3`, `implementer` claude, `reviewer` codex, `harnesses`
  (claude with its models and Efforts, codex and opencode null), `prs_checked_at` (the seeded PR's
  `checked_at`) and `github_paused_until` null.
- **Stale read.** Run `$C drift stale`, then `$C run --evidence "$E/05-stale" -- status --json`.
  `repos[0].error` is the `gh auth login` refusal, `read_at` `2000-01-01T00:00:00Z`, and `ready` and
  `stackable` still hold the cached rows. `$OUTSIDE_LOG` gained one more `gh api user --jq .login`.
- **Paused.** Run `$C run -- repo add verify/second --path "$SECOND_CLONE" --json` and `$C drift pause`,
  then `$C run --evidence "$E/06-paused" -- status --json`. `sources.github.paused_until` is the
  pause's time; both Repos (verify/fixture's read is stale, verify/second has none) have `error`
  `GitHub rate limit exceeded; nico-agent asks it again at <that time>`, verify/fixture still with
  its cached rows; `$OUTSIDE_LOG` gained no `gh` line.
- **Proof.** Copy `$OUTSIDE_LOG` to `$E/outside.log` and `$C state > "$E/state.end.txt"`.

## Gotchas

- `status` reads the Source when the cache is older than `tick_minutes` (600 in the run), so after
  `seed issues` it never asks; use `drift stale` to make it ask.
- A refused read is never written: the stale cache keeps its 2000 date, and status keeps showing it.
- With any live Dispatch, `status` asks herdr for Agent states (`herdr agent list` in
  `$OUTSIDE_LOG`); the stub refuses, so every Agent state is `unknown`, never `gone`.
- The pause lasts an hour and survives everything but cleanup; drive it last.
- The plain (non-`--json`) output prints each list item as JSON on its own line; assert on `--json`.
