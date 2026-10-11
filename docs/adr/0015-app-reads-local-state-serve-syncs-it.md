# The app reads Local state; serve syncs it

Amends [ADR-0011](0011-serve-is-the-scheduler-and-reads-github-once.md).
Every read in the app waited on fresh work: each GET ran a new CLI process,
and the Board's called `git ls-remote` and GitHub for each Repo. On 2026-10-10
the Board took 16 s to load while SSH to GitHub timed out, and the Ideas tab
showed "No Repo yet" until it did, though the Repos are local config (#220).

So `serve` keeps the app's Local state: the Board, the configured Repos, Stats
and Partners, each with the time it was last synced. It holds it in memory and
in `state.json` in the config directory, written after each Sync and read back
when `serve` starts, so a restarted `serve` answers from its last state before
its first Sync completes.

Every read answers from Local state, without a subprocess or the network: the
app's `/api/board`, `/api/stats`, `/api/partners` and `/api/repos`, and the
Lead's MCP `board` tool.

A Sync is the one path that reads git and GitHub, through the one cache
ADR-0011 gives `serve`. It runs:

- when `serve` starts;
- every `sync.intervalSeconds` in config (120 unless set);
- on `POST /api/sync`, the app's Sync button.

Syncs never overlap: a Sync asked for while one runs joins it. Each Repo syncs
on its own, so one Repo's timeout neither holds up nor blanks the others; it
keeps its last state and records its error, which the app shows quietly beside
the time of the last Sync. A Sync that changes Local state emits
`state-changed` on `/api/events`, naming the parts that changed, and the page
refetches only those.

An action taken through `serve` (dispatch, Close, Queue, an answer) applies its
known effect to Local state once its command succeeds, and emits
`state-changed`; the next Sync confirms it or corrects it.

Unchanged from ADR-0011: `serve` is still the one reader of GitHub, reads it as
the bot where the App is installed, and runs `advance` every 10 minutes. The
CLI run in a terminal still reads GitHub itself.

## Consequences

- The app shows state up to `sync.intervalSeconds` old, and anything done
  outside `serve` (a terminal `dispatch`, a PR merged on GitHub) only appears
  after the next Sync or the Sync button.
- The app no longer waits on GitHub; it shows its last state, with its age,
  when GitHub is slow or down.
- `state.json` is a cache like the Dispatch record (ADR-0002): Sync overwrites
  it, and deleting it costs only a Sync.

## Considered Options

- **Keep reading on request, with a longer cache.** The first read after a
  restart or an expiry still waits on GitHub, and a slow Repo still holds up
  the whole Board.
- **Have the CLI read `serve`'s Local state.** It would make a terminal Board
  instant too, but is a separate step (#220, out of scope).
- **Sync all Repos in one call.** Simpler, but one Repo's SSH timeout would
  stall or blank every Repo.
