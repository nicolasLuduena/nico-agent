---
name: verify-nico-agent
description: "Verify a nico-agent change in the built binary and serve's page, with every outside call stubbed, and capture its Evidence under .evidence/<issue>/. Use after any change a user of the CLI or the page can see, and when reviewing a PR that made one."
---

# Verify nico-agent

nico-agent has two user surfaces, and this skill drives both: the CLI, which prints one JSON object per command with `--json`, and serve's page, the Svelte app `serve` embeds on `127.0.0.1:<port>`, with the `/api/*` routes it calls and `/bucket/*`.

The outside world (herdr's panes and agents, GitHub, Linear, desktop notifications) is stubbed: a feature that needs it is driven to its refusal or its cached-state behaviour, which is what the user sees when GitHub or herdr is down. `seed` writes what GitHub and herdr would have; only `seed herdr` reaches the real herdr, for a feature that needs a real agent's screen (answer.md).

Each run lives in `${VERIFY_RUN_ROOT:-${TMPDIR:-/tmp}/verify-nico-agent}/$VERIFY_RUN_ID`, with its own copy of the binary, a scratch HOME, two fixture clones, a Bucket and a port. Run the binary only through `$C run`, whose HOME is the run's: the real HOME holds the user's own config, Repos and Dispatches.

## The helper

`control-nico-agent` (bash) does everything; its `page` and `tunnel` run `page.mjs` and `tunnel.mjs`. `$C help` lists every subcommand, flag, `page` step and `--evidence` output: read it when a recipe uses one not shown here. [`features/REFERENCE.md`](features/REFERENCE.md) says what each `seed` and `drift` puts in a run, and lists the stable handles (flags, exit codes, JSON fields, the page's ARIA roles and names).

```sh
export VERIFY_RUN_ID=<issue>                           # one per run, normally the issue number
C=.agents/skills/verify-nico-agent/control-nico-agent  # from the repo root
```

## Launch

```sh
$C launch            # cargo build --locked --bin nico-agent (build.rs builds web/ with Vite), scratch HOME, fixtures, serve
$C doctor
. "$($C env)"        # $FIXTURE_CLONE, $SECOND_CLONE, $CONFIG_DIR, $BUCKET, $URL, $OUTSIDE_LOG
```

Ready when `launch` prints serve's pid and URL and `doctor` passes. A failing `cargo build` is a broken checkout: fix or report that before verifying. Drive only a run whose `doctor` passes, and rerun it whenever anything looks off; a rebuild since launch fails it, so relaunch.

## Drive a feature

Pick from [`features/`](features/README.md) every feature file the change touches; each is a recipe. Drive each feature from a fresh run, so its Dispatches stay out of the next one, and record into its own Evidence folder, named after the file without `.md`:

```sh
$C cleanup; $C launch --no-build && $C doctor && . "$($C env)"   # a fresh run
$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json   # the recipe's Preconditions
E=.evidence/<issue>/status; mkdir -p "$E"
$C state > "$E/state.before.txt"
$C run --evidence "$E/01-status" -- status --json                  # each of the recipe's steps, with --evidence
$C state > "$E/state.after.txt"
diff "$E/state.before.txt" "$E/state.after.txt" > "$E/state.diff"; cp "$OUTSIDE_LOG" "$E/outside.log"
```

- Run each command literally, flag names and quoted values unchanged.
- Reach nico-agent the way its user and its agents do. The CLI through `$C run`, always with `--json` (the plain output is no contract) and absolute paths (its cwd is the run's `work/`). `/api` through `$C http` with the body the page sends: `$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`. The page through `$C page`, clicked in Chromium by ARIA role and accessible name: `$C page --click "button=Refresh"`, and `ROLE~NAME` only where the name carries a time.
- Change outside state only through `seed` and `drift`, and read it through `state`. They set preconditions; `cargo test` proves the loop.
- Drive every entry point the feature file lists, each by its own path.

## Evidence

Each feature's folder holds:

- every invocation's `.cmd` and output;
- `state.diff`: for a read, empty or only the outside calls the feature names; for a mutation, the written file, plus a second view of it (`repo list`, `status` or the page), since a JSON answer does not show the file changed;
- for the page, the ARIA snapshot and screenshot after the action, and `.requests.txt` showing which `/api` call the click made;
- `outside.log`, showing every outside call went to a stub.

`.evidence/` is gitignored; nico-agent copies `.evidence/<issue>/` to the Bucket at each PR head, Verdict and Close, and the PR body's Evidence section links there.

Done when every entry point of every feature file the change touches has its Evidence, or a line in your report naming the command you tried and the precondition it lacked. An entry point you could not drive is reported as such, even when another path reached the same behaviour.

## Cleanup

```sh
$C cleanup
```

Stops everything the run started and removes the run dir, keeping `.evidence/` and the repo's build caches (`target/`, `web/node_modules/`). Run it after a failed iteration too: `launch` refuses a `VERIFY_RUN_ID` whose run dir is still there.

## Maintenance

`features/` is the maintained list of what this skill verifies. A PR that changes a command, flag, JSON field, route or page control updates the matching feature file in the same PR, and `REFERENCE.md` when a handle changes. A behaviour no file covers gets a file of its own, or a place in the README's "Not yet mapped" line.
