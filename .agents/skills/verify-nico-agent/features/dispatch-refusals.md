# Dispatch's refusals

`dispatch` starts an Implementer on a Ready issue, but first refuses anything it should not start,
each refusal saying why and what to run instead: a bad invocation, an issue of no Repo, a Source it
cannot read, an issue that is not Ready, a launch the Harness does not take, an issue already In
flight on another launch. Past them, its steps run until one fails; the failure is recorded on the
Dispatch, which turns Failed, and the same command continues from that step. In a verification run
herdr is stubbed, so a Ready issue always ends at the worktree step: that is the deepest point a run
reaches.

## Sub-features

- `dispatch-usage` no issue, or an unknown flag, is exit 2 with the usage line.
- `dispatch-not-a-reference` text that is no `owner/repo#N` or Linear id is exit 2.
- `dispatch-unconfigured` an issue of a Repo not added is exit 1 with the `repo add` to run.
- `dispatch-source-unreadable` with no cached read and GitHub refusing, exit 1 `could not read the issues`.
- `dispatch-not-ready` exit 1 `<issue> is not Ready`, `help` saying why: not labelled, waits on a Blocker to close (or, in another Repo of its Project, to be installed there), assigned to someone else, or not in the read.
- `dispatch-launch` an unknown Harness, model or Effort is exit 2, listing the valid ones.
- `dispatch-step-failed` a Ready issue is claimed (a warning when the Claim fails), fetched, and fails at `worktree`; exit 1 with `Run the same \`nico-agent dispatch\` again to continue from worktree`; its Stage is Failed.
- `dispatch-paused` while GitHub is paused, the Claim asks GitHub nothing: its warning names the pause.
- `dispatch-in-flight` the same issue on another Harness is exit 1 `already In flight with claude`.
- `dispatch-api` `POST /api/dispatch` answers a refusal 409 (400 for a bad body) with the same `{error, help}`.
- `dispatch-form` the page's Dispatch form posts the chosen issue and launch and shows the refusal inline under it.

## How to get to it (user POV)

- Run `nico-agent dispatch <issue>... [--harness <h> --model <m> --effort <e>]` in a terminal.
- On the page, choose an issue, Harness, model and Effort in the `Dispatch` section of a Repo's tab
  and press `Dispatch`.
- From a script: `POST /api/dispatch {issue, harness, model, effort}`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; no `seed issues` yet.
- `E=.evidence/<issue>/dispatch-refusals`.

- **Source unreadable.** Run `$C run --evidence "$E/01-no-source" -- dispatch verify/fixture#1 --json`.
  Exit `1`, `error` `could not read the issues of verify/fixture: not authenticated with GitHub; run \`gh auth login\``.
  Then run `$C seed issues` for the rest.
- **No issue.** Run `$C run --evidence "$E/02-usage" -- dispatch --json`. Exit `2`, `error` `<issue> is required`.
- **Unknown flag.** Run `$C run --evidence "$E/03-flag" -- dispatch verify/fixture#1 --frob x --json`.
  Exit `2`, `error` `unknown flag --frob for \`dispatch\``.
- **Not a reference.** Run `$C run --evidence "$E/04-nonsense" -- dispatch nonsense --json`. Exit
  `2`, `error` `` `nonsense` is not an issue reference ``.
- **Unconfigured Repo.** Run `$C run --evidence "$E/05-unconfigured" -- dispatch other/repo#1 --json`.
  Exit `1`, `error` `other/repo is not a configured Repo`, `help` `Run \`nico-agent repo add other/repo --path <clone>\` first`.
- **Not labelled.** Run `$C run --evidence "$E/06-not-labelled" -- dispatch verify/fixture#2 --json`.
  Exit `1`, `error` `verify/fixture#2 is not Ready`, `help[0]` `verify/fixture#2 is not labelled ready-for-agent`.
- **Waits on a Blocker.** `#3`, `--evidence "$E/07-blocked"`: `help[0]` `verify/fixture#3 waits on verify/fixture#1 to close`.
- **Assigned elsewhere.** `#4`, `--evidence "$E/08-assigned"`: `help[0]` `verify/fixture#4 is assigned to someone-else`.
- **Not in the read.** `#99`, `--evidence "$E/09-unknown"`: `help[0]` `verify/fixture#99 was not an open issue labelled ready-for-agent when its Source was read, at <read_at>`.
- **Launch.** Run `dispatch verify/fixture#1` with `--harness pi`, `--model gpt-9`, `--effort ludicrous`
  (`--evidence "$E/10-harness"`, `11-model`, `12-effort`). Each exit `2`: `unknown Harness \`pi\``
  / `Valid Harnesses: claude, codex, opencode`; `unknown model \`gpt-9\` for claude` / `Valid models
  for claude: fable, opus, sonnet, haiku`; `unknown Effort \`ludicrous\` for claude` / `Valid
  Efforts for claude: low, medium, high, xhigh, max`. `dispatches.json` holds no Dispatch yet.
- **Step failed.** `$C state > "$E/state.before.txt"`; run `$C run --evidence "$E/13-ready" -- dispatch verify/fixture#1 --json`.
  Exit `1`, `error` `verify/fixture#1 failed at worktree: \`herdr worktree create\` failed: verify_stub: herdr is a stub in this verification run`,
  `help` ends `Run the same \`nico-agent dispatch\` again to continue from worktree`. `$OUTSIDE_LOG`
  gained `gh issue edit 1 --repo verify/fixture --add-assignee @me` then `herdr worktree create --cwd $FIXTURE_CLONE --branch agent/fixture-1 --base origin/main --label fixture#1 --no-focus`.
  `$C state > "$E/state.after.txt"`: `dispatches.json` holds `verify/fixture#1` with
  `completed` `claim`, `fetch` and `failure.step` `worktree`.
- **Continue.** Run the same command again (`--evidence "$E/14-again"`). Same refusal; `$OUTSIDE_LOG`
  gained a second `herdr worktree create` and no second `gh issue edit` (claim and fetch stand).
- **In flight.** Run `$C run --evidence "$E/15-in-flight" -- dispatch verify/fixture#1 --harness codex --json`.
  Exit `1`, `error` `verify/fixture#1 is already In flight with claude`.
- **API.** Run `$C http --evidence "$E/16-api-not-ready" POST /api/dispatch '{"issue":"verify/fixture#2"}'`:
  HTTP `409`, the not-labelled refusal. Run `$C http --evidence "$E/17-api-bad-body" POST /api/dispatch '{"issue":7}'`:
  HTTP `400`, `error` `issue is a string, not 7`.
- **Form.** Run `$C page --evidence "$E/18-form" --click "button=Dispatch" --expect "failed at worktree"`.
  The form's Issue starts on `#5 Verify: a Research issue` (#1 is In flight); `.requests.txt` has
  `POST /api/dispatch {"issue":"verify/fixture#5","harness":"claude","model":null,"effort":null} -> 409`;
  the ARIA snapshot has an `alert` under `button "Dispatch"` reading `verify/fixture#5 failed at worktree:`.
- **Paused.** Run `$C drift pause`, then `$C run --evidence "$E/19-paused" -- dispatch verify/fixture#6 --json`.
  Exit `1`, `error` `verify/fixture#6 failed at fetch: ...` (see Gotchas); `$OUTSIDE_LOG` gained
  no line: no `gh issue edit 6`.
- **Proof.** Copy `$OUTSIDE_LOG` to `$E/outside.log`; `$C run --evidence "$E/20-status" -- status --json`
  shows `#1`, `#5` and `#6` with `stage` `Failed`, `#6`'s `warnings` `could not Claim verify/fixture#6:
  GitHub rate limit exceeded; nico-agent asks it again at <the pause's time>; assign it to yourself by hand`.

## Gotchas

- Refusals are checked in order: reference, Repo, Source read, Ready, launch. A launch refusal shows
  only for a Ready issue, and with no cached read every issue is refused at the Source.
- A Ready issue's dispatch is not a refusal but a Dispatch that fails at a step: it is recorded,
  holds the Repo's room, turns Failed, and makes the issue leave `ready`. It cannot be undone in the
  run; relaunch to start clean.
- The Claim's failure is only a warning on the Dispatch (`could not Claim ...`), never a refusal.
- The pause lasts an hour and survives everything but cleanup: drive it last.
- `#6` (Stackable) fails at `fetch`, not `worktree`: the fixture's origin has no `agent/fixture-9`.
- The browser logs its own `Failed to load resource: ... 409` in `.console.txt` for a refused
  request; that is not an app error.
