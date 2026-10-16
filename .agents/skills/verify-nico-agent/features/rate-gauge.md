# GitHub rate-limit gauge

Each tick ends by reading `gh api rate_limit`, and `ghbot`'s where it is installed (asking costs
none, so it is read even while GitHub is paused), and keeps the answer in `rate_limits.json` in the
config dir, rewritten only when it moved. `GET /api/status` carries it as `rate_limits`, by identity
(`gh`, `ghbot`) and budget (`core`, `graphql`), each `{limit, used, remaining, reset}`. The page's
header shows it as a ball beside the theme switch, filled to the most-used share across those
budgets and coloured by how near full it is, or `PAUSED` while GitHub is; hovering it, or a click or
tap, opens the panel of each identity's budgets.

## Sub-features

- `rate-tick` a tick (here `refresh`) calls `gh api rate_limit` and `ghbot api rate_limit` last and writes `rate_limits.json`.
- `rate-route` `GET /api/status` has `rate_limits` with both identities and both budgets.
- `rate-no-bot` with `ghbot` failing (not installed) only `gh` is kept, and nothing is said.
- `rate-fill` the button reads `<N>%`, the tightest budget's share: `ink` under 75%, `waiting` from 75%, `failed` from 90%.
- `rate-paused` while GitHub is paused the ball is full in `failed` and the button reads `Paused`; the panel says until when.
- `rate-panel` the panel lists `You · gh` and `Bot · ghbot`, each with `REST` and `GraphQL`: used / limit, left, and when it resets, `HH:MM · in N min`.
- `rate-phone` at 360px the gauge and theme switch sit under the wordmark at the right, and the panel spans the gutters.

## How to get to it (user POV)

- Look at the page's header, on any tab; hover the gauge, or click or tap it.
- `GET /api/status`, as the page reads it.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `E=.evidence/<issue>/rate-gauge`, and in it rate-limit answers in GitHub's shape
  (`{"resources": {"core": {limit, used, remaining, reset}, "graphql": {...}}}`, `reset` in Unix
  seconds within the hour): `gh.near.json` (core 3100 of 5000, graphql 1200), `ghbot.near.json` (core 900 of
  15000, graphql 4100 of 5000), `gh.calm.json` (400 and 150) and `gh.full.json` (core 4800).

- **Read.** `$C seed rate-limit "$E/gh.near.json" "$E/ghbot.near.json"`, then
  `$C run --evidence "$E/01-refresh" -- refresh --json`. `outside.log` ends a tick with
  `gh api rate_limit` and `ghbot api rate_limit`; `$CONFIG_DIR/rate_limits.json` holds `gh` and `ghbot`.
- **Route.** `$C http --evidence "$E/02-api-status" GET /api/status`: `rate_limits.gh` and
  `rate_limits.ghbot` each have `core` and `graphql`.
- **Gauge and panel.** For each `--scheme light|dark` and `--width 1280|360`:
  `$C page --evidence "$E/03-near-<scheme>-<width>" --scheme <scheme> --width <width> --expect "82%" --click "button~GitHub rate limits" --expect "Bot · ghbot"`.
  The ball is amber (`waiting`), and the panel shows both identities, each with `REST` and `GraphQL`.
- **Calm, no bot.** `$C seed rate-limit "$E/gh.calm.json"`, `$C run -- refresh --json`:
  `rate_limits.json` holds only `gh`; `$C page --evidence "$E/04-calm-light-360" --scheme light --width 360 --expect "8%"`.
- **Full.** `$C seed rate-limit "$E/gh.full.json"`, `$C run -- refresh --json`;
  `$C page --evidence "$E/05-full-dark-1280" --scheme dark --width 1280 --expect "96%"`: the ball is red.
- **Paused.** `$C drift pause`, `$C run -- refresh --json` (`gh api rate_limit` is still called);
  `$C page --evidence "$E/06-paused-light-1280" --width 1280 --expect "Paused" --click "button~GitHub paused" --expect "until"`.

## Gotchas

- `seed rate-limit` with one file makes `ghbot` fail again: pass both to keep the bot's.
- The button's name carries the share or the pause's time: click it by `button~GitHub`, never `=`.
- With no `seed rate-limit` both stubs fail, no file is written and the header has no gauge.
- `drift pause` stays an hour: run its step last, or start a fresh run after it.
