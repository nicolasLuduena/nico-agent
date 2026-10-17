# Status

`status` shows per Repo what the loop may start (Ready, Stackable and waiting issues, from the
Source's read), when that read was made, and every Dispatch with its Stage, its Agent state and its
Verdict; and every Project, with each Repo's settings and where each comes from (see projects.md).
It reads the Source only when its cached read is older than a tick, and shows the cache, however
old, when the Source refuses or GitHub is paused. `GET /api/status` is the same answer from the
cache alone, plus what the page shows beside each map.

## Sub-features

- `status-no-cache` with no read yet and GitHub refusing, the Repo shows `read_at` null, empty lists and the refusal as `error`.
- `status-cached` a fresh cached read is shown without asking GitHub: Ready `#1` (code) and `#5` (research), Stackable `#6` with `base` `agent/fixture-9`.
- `status-not-ready` an issue waiting on a Blocker without PR is in `waiting` with why (`<key> waits on <blocker> to close`); issues not labelled or assigned to someone else are in no list (`gardening`, the Ready `gardening` issues, is empty: the fixture has none).
- `status-chain` with `seed issues chain`, `#6`'s two Blockers' PRs form one chain (#108 on `agent/fixture-9`, #109 on `main`): Stackable `#6` with `base` `agent/fixture-8`, the top.
- `status-stale` a read older than a tick asks GitHub again; refused, the cache is still shown, with `error`.
- `status-hung` a `gh` that never answers is killed at its deadline: the Repo's `error` names the call and the deadline, and the next status and Refresh still answer.
- `status-paused` a paused GitHub is asked nothing: `sources.github.paused_until` is set, an uncached Repo's `error` says when it is asked again.
- `status-dispatches` each Dispatch with `stage` (`Failed`, `PR draft`, `Implementing`, `Verified`), `agent_state` `unknown` while herdr does not answer, `review` (see review.md), `verdict` and `pr`.
- `status-runs` a Run its agent blocked shows `blocked_since` where status shows it: `repos[].last_scan`, the live Dispatch's `faux_nico`, `morning`.
- `status-settings` each Repo shows `room`, `base`, `implementer`, `reviewer`, `quality_scan`, `faux_nico` and each switch as `{value, from}`; `projects` lists a Project per Repo that names none, named by its slug.
- `status-api` `GET /api/status` holds the command's `projects`, `sources` and `dispatches`, and per Repo also `harnesses`, `prs_checked_at` and `github_paused_until`.

## How to get to it (user POV)

- Run `nico-agent status` in a terminal (`--json` for scripts).
- Open serve's page: `/api/status` is what it renders (see page-tabs-strip).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `E=.evidence/<issue>/status`.

- **No read yet.** Run `$C run --evidence "$E/01-no-cache" -- status --json`. Exit `0`; `repos[0]`
  has `slug` `verify/fixture`, `error` `not authenticated with GitHub; run \`gh auth login\``,
  `read_at` null and `ready`, `stackable`, `gardening`, `waiting` `[]`; its settings are each
  `from` `default`: `room` `3`, `base` null, `implementer` claude, `reviewer` codex, `quality_scan`
  and `faux_nico` claude, `switches` `dispatch`, `stack`, `review`, `restart`, `flip` true and
  `answer`, `gardening`, `quality_scan` false. `projects` is
  `[{"name":"verify/fixture","repos":["verify/fixture"],"defaults":{}}]`; `dispatches` `[]`.
  `$OUTSIDE_LOG` gained `gh api user --jq .login`.
- **Cached read.** Run `$C seed issues`, then `$C state > "$E/state.before.txt"` and `$C run --evidence "$E/02-cached" -- status --json`.
  Exit `0`; no `error`; `read_at` is the seed's; `ready` is `verify/fixture#1` "Verify: a Ready
  issue" `kind` `code` and `verify/fixture#5` "Verify: a Research issue" `kind` `research`;
  `stackable` is `verify/fixture#6` with `base` `agent/fixture-9`; `waiting` is `verify/fixture#3`
  with `reason` `verify/fixture#3 waits on verify/fixture#1 to close`; `#2` and `#4` are nowhere.
  `$C state > "$E/state.after.txt"`; their diff is empty: nothing written, nothing asked.
- **A chain of Blocker PRs.** Run `$C seed issues chain`, then `$C run --evidence "$E/02-chain" -- status --json`.
  `stackable` is `verify/fixture#6` with `base` `agent/fixture-8`: #108 sits on #109's branch, so
  one Dispatch on top covers both Blockers. Then `$C seed issues` again, for the steps below.
- **Dispatches.** Run `$C run -- dispatch verify/fixture#1 --json` (fails at worktree, see
  dispatch-refusals), `$C seed dispatch 10 pr` and `$C seed dispatch 12 asking`, then `$C run --evidence "$E/03-dispatches" -- status --json`.
  `dispatches` in that order: `verify/fixture#1` `stage` `Failed` with `failure.step` `worktree`
  and a `could not Claim` warning, `verify/fixture#10` `PR draft` with `pr.url`
  `https://github.com/verify/fixture/pull/110` and `pr.draft` true, `verify/fixture#12`
  `Implementing` with `asking.question`; each `agent_state.implementer` `unknown`. `ready` no longer
  lists `#1`. `$OUTSIDE_LOG` gained `herdr agent list`.
- **Blocked Runs.** Run `$C seed run faux-nico 12`, `$C seed run quality-scan` and `$C seed run morning`,
  then `$C run --evidence "$E/03-runs" -- status --json`. `repos[0].last_scan` is agent
  `quality-scan-fixture`, `dispatches[2].faux_nico` agent `faux-nico-fixture-12` with `issue`
  `verify/fixture#12` and `asking` that Dispatch's `asking.since`, and `morning` agent `morning`;
  each with `blocked_since` the seed's time and `closed_at` null.
- **API.** Run `$C http --evidence "$E/04-api" GET /api/status`. HTTP `200`; `projects`,
  `dispatches` and `sources` equal the command's; `repos[0]` has the command's settings, each
  `{value, from}`, and adds `harnesses` (claude with its models and Efforts, codex and opencode
  null), `prs_checked_at` (the seeded PR's `checked_at`) and `github_paused_until` null.
- **Stale read.** Run `$C drift stale`, then `$C run --evidence "$E/05-stale" -- status --json`.
  `repos[0].error` is the `gh auth login` refusal, `read_at` `2000-01-01T00:00:00Z`, and `ready` and
  `stackable` still hold the cached rows. `$OUTSIDE_LOG` gained one more `gh api user --jq .login`.
- **Hung gh.** Run `$C drift stale` and `$C drift hang`, then `$C run --evidence "$E/05-hung" -- status --json`
  and `$C http --evidence "$E/05-hung-refresh" POST /api/refresh`, then `$C run --evidence "$E/05-hung-again" -- status --json`.
  Each status exits `0` in about 5 s with `repos[0].error` `` `gh api user` ran past its 5s deadline and was killed ``.
  The refresh answers HTTP `200` within a minute (each `gh` call it makes waits out its 5 s), not "tick skipped", its
  `actions` led by `could not read the issues of verify/fixture:` and that error, and no dispatch line: the Repo's
  room (3) is full with the three live Dispatches of the Dispatches step, so the second status still lists `ready`
  `["verify/fixture#5"]` and `stackable` `["verify/fixture#6"]` from the cache. (With room to spare it would try the
  cached rows instead, and they fail at worktree; see dispatch-refusals.) `gh` hangs until cleanup: drive this step just before Paused, the last one.
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
