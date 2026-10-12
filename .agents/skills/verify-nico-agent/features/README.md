# nico-agent verification map

This directory is the maintained source for verifying the user-facing behavior of nico-agent: its
CLI and serve's page. Read the index before driving, then use the matching feature file as the
recipe.

## Baseline preconditions

- `export VERIFY_RUN_ID=<issue>`, `C=.agents/skills/verify-nico-agent/control-nico-agent`, from the
  repo root.
- A fresh run per feature: `$C cleanup; $C launch --no-build` (plain `launch` the first time, to
  build), then `$C doctor` passes and `. "$($C env)"` gives `$FIXTURE_CLONE`, `$SECOND_CLONE`,
  `$CONFIG_DIR`, `$BUCKET`, `$URL` and `$OUTSIDE_LOG`.
- The scratch config has no Repo until the recipe adds one; serve has ticked once, with none.
- Never run the binary with your real `HOME`, and never drive a serve this run did not launch.

## Driving conventions

- Make the feature's evidence folder first: `E=.evidence/<issue>/<feature>; mkdir -p "$E"`, the
  `<feature>` being the file's name without `.md`.
- Treat every command as literal; keep flag names and quoted values unchanged.
- Run CLI actions through `$C run [--evidence PREFIX] -- <args>`, always with `--json`; the plain
  output is not a contract.
- Run `/api` actions through `$C http`, with the JSON body the page sends.
- Run page actions through `$C page`, by ARIA role and accessible name; `ROLE~NAME` only where the
  name carries a time (strip rows).
- Change outside state only through `$C seed` and `$C drift`; read state through `$C state`.
- Use the issue numbers the fixtures give: 1 to 6 from `seed issues`, above 6 for `seed dispatch`.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state: `.cmd` and output per invocation.
- Read-only proof includes `state` before and after and their diff: empty, or only the outside
  calls the feature file names.
- Mutation proof includes the `state` diff showing the written file and a second view of it (`repo
  list`, `status`, the page, the Bucket over `/bucket/`).
- Page proof includes the ARIA snapshot, the screenshot and `.requests.txt`.
- Every feature folder holds a copy of `outside.log`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior.
It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-nico-agent` starts with `Preconditions:` and uses labeled bullets that
   pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state,
commands, and observable proof.

## Features

- [Add, remove and list Repos](./repos.md) covers `repo add|rm|list`, their refusals and no-ops,
  and the Bucket `repo add` makes.
- [Status](./status.md) covers `status` and `GET /api/status` from a fresh cache, a Source that
  refuses, a stale cache, a paused GitHub, and Dispatches with their Stage.
- [Dispatch's refusals](./dispatch-refusals.md) covers every refusal of `dispatch`, `POST
  /api/dispatch` and the page's Dispatch form, down to a Ready issue failing at its first herdr step.
- [Verdict recording to the Bucket](./verdict-bucket.md) covers `verdict` pass and fail, its
  refusals, the Bucket commit, `/bucket/` and the node panel's Evidence links.
- [The page's tabs and strip](./page-tabs-strip.md) covers the Repo tabs (click, keys, phone
  select) and the needs-you strip's Asking, Failed, Verified and Paused rows.
- [Switches](./switches.md) covers `PATCH /api/repo/<slug>/switches`, the page's toggles, what is
  written to `config.toml`, and the loop obeying a switch turned off.
- [Refresh](./refresh.md) covers the page's Refresh button, `POST /api/refresh` and `nico-agent
  refresh`, and what the tick it runs does.
- [Answer an Asking Implementer](./answer.md) covers `answer`, its refusals, a text starting with
  `--`, and the answer typed through herdr (stubbed, so not recorded in a run).
- [Live updates](./live-updates.md) covers `GET /api/events` (`changed`, and a keepalive otherwise),
  the page left open behind the tunnel, its reconnecting after the stream is lost, and the
  signed-out line when Access's session lapses.

Not yet mapped (drive by hand, then add a file): the faux-nico, gardening and quality-scan
triggers, `GET /api/map/<slug>` and the map's node layout beyond what the tabs file asserts, the morning agent and `morning.md` on the page (off in a run: set `morning.enabled = true` and `hour` to the current one to drive it), the theme switch, `serve` restarting Dispatches after a reboot, and everything that needs a live
herdr or GitHub (an Implementer started, a Reviewer started, a PR flipped to ready): `cargo test`
covers those through the fake World.
