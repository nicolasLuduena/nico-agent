# Update, Rebuild and Continue a Wiki from the page

A Wiki's page's masthead (`/wiki/<id>`) shows its build and three buttons, in one quiet line. While a build of it is open
it reads `BUILDING`, with the herdr pane it runs in; while one waits its turn, `QUEUED`; after one
failed, `Last build failed` and why. `Update` (a Repo's Wiki only) and `Rebuild` are always there;
`Continue +N calls` only while the budget or a failed call left Gaps, after `N parts not explored`. Each
button queues its build first in `wiki-queue.json`, even with the Repo's `wiki` switch off, and the
next tick starts it as asked: `nico-agent wiki build <owner/name> --update|--rebuild|--continue`.
`--continue` checks out the commit the Wiki describes, asks only the parts with a budget or `unanswered` Gap, with
a fresh `[wiki] calls`, and fills them in place.

## Sub-features

- `wiki-buttons-list` `GET /api/wikis` gives each Wiki `state` (`built`, `building`, `queued`, `failed`), `pane`, `why`, `progress` (see [wiki-progress.md](./wiki-progress.md)), `budget` (its budget and `unanswered` Gaps) and `calls`.
- `wiki-buttons-shown` the masthead's `button "Update"`, `button "Rebuild"`, and, only with budget or `unanswered` Gaps, `1 part not explored` and `button "Continue +<calls> calls"`.
- `wiki-buttons-queue` a button is `POST /api/wiki/<id>/update|rebuild|continue`, `200` `{wiki, build, waiting}`; `wiki-queue.json` has the id first in `waiting` and its build in `asked`; the masthead reads `Queued`.
- `wiki-buttons-states` after a refresh the masthead reads `BUILDING` (the start failed at herdr in a run, so no pane), after another `Last build failed` with why on the errata rule.
- `wiki-buttons-continue` `wiki build <owner/name> --continue` asks only the parts with a budget Gap, at the Wiki's commit though the Base moved, and leaves none; Continue is gone from the masthead.
- `wiki-buttons-refused` `continue` of a Wiki with no budget or `unanswered` Gaps, or of a Repo with no Wiki, and any button of no Repo are `409` with help; another word than the three is `404`. On the CLI, `--continue` of a Repo with no Wiki is exit 1 `could not build the Wiki of <owner/name>: <owner/name> has no Wiki to continue`, and two of `--update`, `--rebuild`, `--continue` exit 2 `--update, --rebuild and --continue are one at a time`.

## How to get to it (user POV)

- On the Wiki's page, `/wiki/<owner>/<name>` (a Project's Wiki view links it), the buttons at the
  end of the masthead's line.
- `POST /api/wiki/<owner>/<name>/<update|rebuild|continue>` (the id escaped or not).
- `nico-agent wiki build <owner/name> --continue --json` (or `--update`, `--rebuild`).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-buttons`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project shop --json`, then
  `printf '\n[wiki]\ncalls = 2\n' >> "$CONFIG_DIR/config.toml"`.
- Answers: `$E/answer-fixture.json`, a division into `Readme` and `Notes` (each `README.md`) with
  no Interpretation (one citing `README.md` alone would be about one of them, and fail its
  check); `$E/answer-readme.json` and `$E/answer-notes.json`, leaves, Notes' overview
  "Notes on the README, filled in by Continue." with a `role` at `3`-`3`. Seed the first two:
  `$C seed answer "$E/answer-fixture.json" "verify/fixture"`, `$C seed answer
  "$E/answer-readme.json" "verify/fixture > Readme"`.
- **A Wiki with a budget Gap.** `$C run --evidence "$E/01-build" -- wiki build verify/fixture --json`:
  `built`, `"gaps":{"budget":1}` (Notes past the 2 calls). Then `$C state > "$E/state.before.txt"`.

- **Listed.** `$C http --evidence "$E/02-wikis" GET /api/wikis`: `"state":"built"`, `"budget":1`,
  `"calls":2`, `"pane":null`, `"why":null`, `"progress":null`.
- **Shown.** `$C page --evidence "$E/03-built-desk-light" --path /wiki/verify/fixture --expect "Continue +2 calls"`:
  `button "Update"`, `button "Rebuild"`, `1 part not explored`, `button "Continue +2 calls"`.
- **Continue clicked.** `$C page --evidence "$E/04-continue-clicked" --path /wiki/verify/fixture --expect "Continue +2 calls" --click "button=Continue +2 calls" --expect Queued`:
  `.requests.txt` `POST /api/wiki/verify%2Ffixture/continue -> 200`; `wiki-queue.json`
  `{"waiting":["verify/fixture"],"asked":{"verify/fixture":"continue"}}`, the `wiki` switch still off.
- **Building, then failed.** `$C http --evidence "$E/05-refresh-start" POST /api/refresh`: `actions`
  has ``could not start the wiki of verify/fixture: `herdr workspace create` failed: ...``;
  `$C page --evidence "$E/06-building-desk-dark" --path /wiki/verify/fixture --scheme dark --expect Building`.
  `$C http --evidence "$E/07-refresh-failed" POST /api/refresh`: `verify/fixture: wiki failed: ...`;
  `$C http --evidence "$E/08-wikis-failed" GET /api/wikis`: `"state":"failed"`, `why` that error.
  `$C page --evidence "$E/09-failed-desk-dark" --path /wiki/verify/fixture --scheme dark --expect "Last build failed"`
  and `$C page --evidence "$E/10-failed-phone-light" --width 390 --path /wiki/verify/fixture --expect "Last build failed"`:
  the errata rule, the buttons wrapped under it, `page 390px wide in a 390px window`.
- **Rebuild clicked, on a phone.** `$C page --evidence "$E/11-rebuild-phone-dark" --width 390 --path /wiki/verify/fixture --scheme dark --click button=Rebuild --expect Queued`:
  `POST /api/wiki/verify%2Ffixture/rebuild -> 200`, `wiki-queue.json` `asked` now `rebuild`.
- **Continue.** `$C drift base | tee "$E/12-drift-base.json"`, `$C seed answer "$E/answer-notes.json" "verify/fixture > Notes"`,
  then `$C run --evidence "$E/13-build-continue" -- wiki build verify/fixture --continue --json`:
  `built` at the `old` commit of the drift, `"gaps":{}`; its stderr `continuing it: 2 part(s) copied or
  kept, 1 to ask again` and `verify/fixture > Notes: asked (call 1 of 2)`; `outside.log` has one
  `opencode2` call more, about `verify/fixture > Notes`.
- **Continue gone.** `$C http --evidence "$E/14-wikis-continued" GET /api/wikis`: `"budget":0`,
  `"state":"queued"`. `$C page --evidence "$E/18-continued-desk-light" --path /wiki/verify/fixture --hash "#notes" --expect "filled in by Continue" --expect Queued`:
  `status` `Queued`, `button "Update"` and `button "Rebuild"`, no Continue.
- **Refused.** `$C http --evidence "$E/15-continue-refused" POST /api/wiki/verify/fixture/continue`:
  `409` `the Wiki of verify/fixture has no budget or unanswered Gaps to continue`; `$C http --evidence
  "$E/16-unknown-refused" POST /api/wiki/verify/nope/update`: `409` `verify/nope is not a configured
  Repo`; `$C http --evidence "$E/17-no-such-build" POST /api/wiki/verify/fixture/delete`: `404`.
- **Refused on the CLI.** In a fresh run with verify/fixture added and no Wiki built: `$C run
  --evidence "$E/19-cli-continue-no-wiki" -- wiki build verify/fixture --continue --json` exits `1`,
  `could not build the Wiki of verify/fixture: verify/fixture has no Wiki to continue`, help `Build it
  first: nico-agent wiki build verify/fixture`; `$C run --evidence "$E/20-cli-two-builds" -- wiki
  build verify/fixture --update --rebuild --json` exits `2`, `--update, --rebuild and --continue are
  one at a time`. The first leaves `wikis.json` `failed` with that why, as any build that stops
  does; the second writes nothing.
- **After.** `$C state > "$E/state.after.txt"`, its diff: `wiki-queue.json`, `runs.json` (the
  failed Run), `wikis.json` (`gaps` `{}`) and a Bucket commit `wiki verify/fixture <old>`. Copy
  `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- herdr is stubbed: a queued build never runs from the loop in a run, its start fails at `herdr
  workspace create`, so `BUILDING` shows no pane and the command its pane would run (`--rebuild`,
  `--continue`, `--update`) is `cargo test`'s (`tests/wiki_runs.rs`). Drive `--continue` by hand.
- Every Wiki is a Repo's: no Library Wiki exists yet, so Update's absence on one is not drivable.
- A refresh with a build queued and none open starts it at once: click, then read the page before
  the refresh to see `Queued`.
- `drift base` before `--continue` proves it builds at the Wiki's commit: the output's `commit` is
  the drift's `old`, not its `head`.
