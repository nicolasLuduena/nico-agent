# Wiki builds from the loop

A Repo's `wiki` switch, off by default, has the loop build its Wiki. A tick checks it once the
switch turns on and then once a day from `[wiki] hour`, and queues a build when the Repo has no
Wiki or its `origin/<base>` moved from the Wiki's commit. One build runs at a time, as a Run in a
herdr workspace `wiki-<repo>` whose pane runs `nico-agent wiki build <owner/name>; exit`; the
others wait in `wiki-queue.json`. A later tick closes the Run on the build's outcome, or failed
once its pane is gone without one. `status` lists every Wiki with its state (built, building,
queued, failed), the commit, time and Gap count of the build that built it (kept through a
failed build after it), why its last build failed, and the open Run's pane. No Wiki is ever in Needs you.

## Sub-features

- `wiki-runs-queued` with the switch on and no Wiki, a refresh says `<slug>: wiki queued, it has none` and starts its build: `herdr workspace create --cwd <clone> --label wiki-<repo>`.
- `wiki-runs-failed-start` a start that fails is said (`could not start the wiki of <slug>: ...`), and the next refresh closes the Run failed with that why, kept in `wikis.json`.
- `wiki-runs-status` `status --json` `wikis[]`: `state` `building` while its Run is open (`pane` its pane, null when its start failed; `progress` how far its build got: [wiki-progress.md](./wiki-progress.md)), then `failed` with `why` and `failed_at`, or `built` with `commit`, `built_at` and `gaps`.
- `wiki-runs-once` a failed build is not queued again before the next wiki hour, unless the switch goes off and on.
- `wiki-runs-unmoved` a Wiki whose commit is still `origin/main`'s is not queued; a Base that moves later that day waits for the next day's check.
- `wiki-runs-moved` a Wiki whose `origin/main` moved is queued: `<slug>: wiki queued, origin/main moved from <old> to <new>`.
- `wiki-runs-not-needs-you` nothing about a Wiki flags a node, is a toast, or reaches a notification.

## How to get to it (user POV)

- Toggle `switch "Wiki"` in a Repo's panel (see [switches](./switches.md)), or `PATCH
  /api/repo/<owner/name>/switches` with `{"wiki": true}`, or set `repos."<slug>".switches.wiki`
  in `config.toml`.
- The loop acts at its next tick: in a run, `POST /api/refresh` (the page's Refresh).
- Read the Wikis in `nico-agent status --json`'s `wikis`, or `GET /api/status`'s.

## Driving it with control-nico-agent

Preconditions:

- A fresh run per scenario below; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `E=.evidence/<issue>/wiki-runs` (`-daily`, `-moved` for the later scenarios); `mkdir -p "$E"`;
  `$C state > "$E/state.before.txt"`.

Queued with no Wiki, failed at herdr:

- **Switch on.** `$C http --evidence "$E/01-switch-on" PATCH /api/repo/verify/fixture/switches '{"wiki":true}'`:
  HTTP `200`, `switches.wiki` true.
- **Queued and started.** `$C http --evidence "$E/02-refresh-queued" POST /api/refresh`: `actions` has
  `verify/fixture: wiki queued, it has none`, then ``could not start the wiki of verify/fixture:
  `herdr workspace create` failed: verify_stub: herdr is a stub in this verification run``.
- **Building.** `$C run --evidence "$E/03-status-building" -- status --json`: `wikis` is
  `[{"wiki":"verify/fixture","target":{"repo":"verify/fixture"},"state":"building","commit":null,"built_at":null,"gaps":null,"pane":null,"progress":null}]`.
- **Closed failed.** `$C http --evidence "$E/04-refresh-failed" POST /api/refresh`: `actions` has
  ``verify/fixture: wiki failed: `herdr workspace create` failed: verify_stub: ...``; `$C run
  --evidence "$E/05-status-failed" -- status --json`: `state` `failed`, `why` that error, `failed_at`.
- **Not again.** `$C http --evidence "$E/06-refresh-not-again" POST /api/refresh`: `actions` holds
  only the Source's refusal.
- **Proof.** `state` after and its diff: `config.toml` gains `switches = { wiki = true }`,
  `runs.json` a Run `"trigger": "wiki"` closed, `wikis.json` the failure; `outside.log` gains one
  `herdr workspace create --cwd .../fixture/fixture --label wiki-fixture --no-focus` and no
  `notify-send`.

Unmoved, and once a day (`-daily`):

- **A Wiki first.** Write `{"kind": "leaf", "overview": "..."}` to `$E/answer.json`, `$C seed answer
  "$E/answer.json"`, `$C run --evidence "$E/01-build-by-hand" -- wiki build verify/fixture --json`:
  `outcome` `built` at the fixture's `origin/main`.
- **Unmoved.** Switch on as above (`02-switch-on`), then `$C http --evidence "$E/03-refresh-unmoved"
  POST /api/refresh`: no wiki action; `status` (`04-status-built`) shows `state` `built`, `commit`
  that commit, `gaps` `0`.
- **Same day.** `$C drift base | tee "$E/05-drift-base.json"`, then `$C http --evidence
  "$E/06-refresh-same-day" POST /api/refresh`: still no wiki action.

Moved (`-moved`):

- **A Wiki, then a merge.** Build by hand as above (`01-build-by-hand`), then `$C drift base |
  tee "$E/02-drift-base.json"`: it prints `{ base, old, head }`, `old` the Wiki's `commit`.
- **Queued.** Switch on (`03-switch-on`), then `$C http --evidence "$E/04-refresh-moved" POST
  /api/refresh`: `actions` has `verify/fixture: wiki queued, origin/main moved from <old> to
  <head>`, then the start failing at herdr.
- **Second view.** `$C run --evidence "$E/05-status" -- status --json`: `state` `building`, with
  the hand-built `commit`.

## Gotchas

- herdr is stubbed, so no build ever runs from the loop in a run: every start fails at `herdr
  workspace create`, and the command its pane would run (`nico-agent wiki build <owner/name>`, with
  `--update` once the Repo has a Wiki, or the build a button asked: [wiki-buttons.md](./wiki-buttons.md)) is `cargo test`'s. A build running in its pane, closing on its outcome and a pane gone are
  `cargo test`'s (`tests/wiki_runs.rs`); here, the queue, the check and the failed start.
- The daily check runs at the first refresh after the switch goes on, whatever the hour (a Repo
  never checked is due), then not again till the next `[wiki] hour`: move the Base with `drift
  base` before switching on to see it queued, and use a fresh run to check again.
- `drift base` pushes to the fixture origin's `main` and fetches it, as the loop would: the clone's
  `origin/main` moves, its own `main` (`git -C "$FIXTURE_CLONE" rev-parse main`) still names the
  Wiki's commit, and that is expected.
