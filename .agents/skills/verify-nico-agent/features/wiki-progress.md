# A Wiki build's progress on the page

While a Wiki's build runs as its Run, the Wiki view's header says how far it got: the calls made
of its budget, the depth reached of `[wiki] depth`, the parts asked, those sent back for a
correction round, the Gaps so far, the part asked last, and since when its Run runs. The build
keeps these in `wiki/<folder>/progress.json` in the config dir after each call and each Gap, and
removes the file once it ends, built or failed. `status --json`'s `wikis[]` and `GET /api/wikis`
carry them as `progress` while the Wiki's Run is open, and never otherwise. The page follows the
file through `/api/events`, with no Refresh. A Wiki whose first build waits, runs or failed is
listed by `GET /api/wikis` with no commit, and the Wiki view shows its header over a line saying
there is no Wiki of it to read yet.

## Sub-features

- `wiki-progress-file` during `wiki build`, `wiki/<owner>/<name>/progress.json` holds `{at, calls, made, depth, reached, asked, sent_back, gaps, asking}`, `at` the build's start; after it, there is none.
- `wiki-progress-status` `status --json` `wikis[]` and `GET /api/wikis` give a building Wiki's `progress` with `at` its Run's start; a queued, built or failed one has `progress` null, as has a build with no Run open (one run by hand alone).
- `wiki-progress-header` the header reads `BUILDING since HH:MM` (with `in herdr pane <pane>` when it has one), then `Call <made> of <calls> · depth <reached> of <depth> · <asked> parts asked, <sent_back|none> sent back · <gaps> Gaps|no Gap` and `Asking <trail>`, each segment whole on a line.
- `wiki-progress-live` the header moves from one call to the next without a Refresh or a reload: `.requests.txt` has `GET /api/wikis` again after the stream's `changed`.
- `wiki-progress-first` a Wiki never built is in `combobox "Wiki"` while its build is `Queued`, building or failed, with its header and `No Wiki of <id> to read yet: it shows here once a build of it ends built.`; once built, it reads as any Wiki.

## How to get to it (user POV)

- A Project's Wiki view (`link "Wiki"`), while a build of one of its Wikis runs, waits or failed.
- `nico-agent status --json`'s `wikis`, `GET /api/status`'s, and `GET /api/wikis`.
- The build itself: the pane's `nico-agent wiki build <owner/name>`, here run by hand.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-progress`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project shop --json`, the same for
  `verify/second` with `$SECOND_CLONE`, then `printf '\n[wiki]\ncalls = 2\n' >> "$CONFIG_DIR/config.toml"`.
- Answers: `$E/answer-fixture.json`, a division into `Readme` and `Notes` (each `README.md`, no
  Interpretation), and `$E/answer-readme.json`, a leaf; `$C seed answer "$E/answer-fixture.json"
  "verify/fixture"`, `$C seed answer "$E/answer-readme.json" "verify/fixture > Readme"`. None for
  verify/second, so its build fails. Then `$C state > "$E/state.before.txt"`.

- **Both first builds.** Switch each Repo's `wiki` on (`PATCH /api/repo/<slug>/switches`
  `{"wiki":true}`, `01-`, `02-`), then `$C http --evidence "$E/03-refresh-queued" POST /api/refresh`:
  `verify/fixture: wiki queued, it has none`, the same for verify/second, then verify/fixture's
  start failing at herdr. `$C http --evidence "$E/04-wikis-first-builds" GET /api/wikis`: both, `commit`
  null, `builtAt` null, `gaps` `0`, `budget` `0`, `progress` null; verify/fixture `building`,
  verify/second `queued`.
- **Queued, never built.** `$C page --evidence "$E/05-queued-first-build-desk-light" --hash "#shop/wiki/verify%2Fsecond" --click button=Light --expect Queued --expect "No Wiki of verify/second to read yet"`:
  `combobox "Wiki"` with both, `status` `Queued`, `button "Update"`, `button "Rebuild"`.
- **A build to watch.** `$C seed pace 45`, then in the background `$C run --evidence "$E/06-build-first" -- wiki build verify/fixture --json`.
  Within its first call (45 s):
  `$C run --evidence "$E/07-status-call-1" -- status --json`: verify/fixture's `progress`
  `{"at":<its Run's at>,"calls":2,"made":1,"depth":7,"reached":0,"asked":1,"sent_back":0,"gaps":0,"asking":"verify/fixture"}`;
  copy `$CONFIG_DIR/wiki/verify/fixture/progress.json` to `$E/07-progress-file-call-1.json`, its `at`
  the build's own start, later than the Run's; `$C http --evidence "$E/08-wikis-call-1" GET /api/wikis`, the same `progress`.
- **Live, on a desk.** `$C page --evidence "$E/09-progress-live-desk-light" --hash "#shop/wiki/verify%2Ffixture" --click button=Light --expect "Call 1 of 2" --gone "Call 1 of 2" --expect "Call 2 of 2"`:
  `status` `Building since HH:MM`, `paragraph` `Call 2 of 2 · depth 1 of 7 · 2 parts asked, none sent back · no Gap Asking verify/fixture > Readme`,
  `No Wiki of verify/fixture to read yet`; `.requests.txt` `GET /api/events -> 200` and `GET
  /api/wikis -> 200` twice, no reload and no Refresh.
- **On a phone.** `$C page --evidence "$E/10-progress-phone-dark" --width 390 --hash "#shop/wiki/verify%2Ffixture" --click button=Dark --expect "Call 2 of 2"`:
  the same, each segment whole, `page 390px wide in a 390px window`. `$C http --evidence "$E/11-wikis-call-2" GET /api/wikis`:
  `made` `2`, `reached` `1`, `asking` `verify/fixture > Readme`.
- **Ended.** Once the build exits (`06-build-first.exit` `0`, `"gaps":{"budget":1}`), no
  `progress.json`; `$C seed pace none`; `$C http --evidence "$E/12-wikis-ended" GET /api/wikis`: verify/fixture
  `building` (its Run not closed yet) with `progress` null and its `commit`.
- **Closed built, then the next.** `$C http --evidence "$E/13-refresh-built" POST /api/refresh`:
  `verify/fixture: wiki built at <sha>`, then verify/second's start failing at herdr. `$C page --evidence "$E/14-built-desk-light" --hash "#shop/wiki/verify%2Ffixture" --click button=Light --expect "The README names the fixture"`:
  `Describes <sha>`, no `Building`, no progress line.
- **Failed, never built.** `$C http --evidence "$E/15-refresh-failed" POST /api/refresh`:
  `verify/second: wiki failed: ...`; `$C http --evidence "$E/16-wikis-failed" GET /api/wikis`:
  verify/second `failed`, `why` that error, `commit` null, `progress` null. `$C page --evidence "$E/17-failed-first-build-phone-light" --width 390 --hash "#shop/wiki/verify%2Fsecond" --click button=Light --expect "Last build failed" --expect "No Wiki of verify/second to read yet"`
  and the same at desk width in Dark (`18-failed-first-build-desk-dark`).
- **After.** `$C state > "$E/state.after.txt"`, its diff: `wikis.json` (verify/fixture built,
  verify/second failed), `runs.json` (two wiki Runs closed), `wiki-queue.json`, a Bucket commit
  `wiki verify/fixture <sha>`, and no `progress.json`. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- herdr is stubbed, so no build runs in a pane: the Run opens with its start failed and stays
  open till the next refresh, and the build run by hand meanwhile is the one it shows. Never
  refresh while it runs: the refresh closes that Run failed, and its progress goes with it.
- `seed pace` slows every call after it, a failing one too: set it back with `seed pace none`
  before the next build.
- The page looks for changes every 10 seconds: `--gone` the first call's line (up to a minute)
  rather than `--expect` the second's at once.
- A build with no Run open shows no progress: run it by hand only while its Run is open
  (`building` in `status`).
- The Gaps count moves after a depth's calls answer; with 2 calls the build ends right after,
  so the page never shows `1 Gap`: `cargo test` covers it (`tests/wiki.rs`).
