---
name: verify-nico-agent
description: "Drive nico-agent the way its user and its agents do: the CLI (`repo`, `status`, `dispatch`, `verdict`, `refresh`, `install`, `wiki build`, `mcp`) and serve's page, in a scratch HOME on a free port, with gh, herdr and notifications stubbed, and capture proof under .evidence/<issue>/. Use to prove a change works in the real binary and the real page, not only in `cargo test`; the feature map in features/ is the maintained list of what to drive."
---

# Verify nico-agent

nico-agent is one Rust binary with two user surfaces, and this skill drives both:

- **The CLI**, what outsiders call. Every command prints one JSON object with `--json`; exit `0` is an answer, `1` a refusal the user can act on (`{error, help}`), `2` a bad invocation.
- **serve's page**, the Svelte app `serve` embeds on `127.0.0.1:<port>`, with the `/api/*` routes it calls (each the shape of the command it stands for) and `/bucket/*`.

The outside world (herdr's panes and agents, GitHub, Linear, desktop notifications) is never reached: features that need it are driven to their refusal or their cached-state behaviour, which is what the user sees when GitHub or herdr is down. `seed` stands in for what GitHub and herdr would have written; the one exception is `seed herdr`, for a feature that needs a real agent's screen (answer.md).

Each run has its own directory, `${VERIFY_RUN_ROOT:-${TMPDIR:-/tmp}/verify-nico-agent}/$VERIFY_RUN_ID`, holding the binary's copy, a scratch HOME (so its own `~/.config/nico-agent`), two fixture clones, the Bucket and a port of its own. Never run the binary with the real HOME: that is the user's own config, Repos and Dispatches.

## The helper

`control-nico-agent` (bash) does everything; `page.mjs` and `tunnel.mjs` are what its `page` and `tunnel` run. **`control-nico-agent help` is the reference** for every subcommand, the `--evidence` outputs, the `page` steps and the tunnel stand-in: read it once per run. [`features/REFERENCE.md`](features/REFERENCE.md) says what the fixtures hold and lists the stable handles (flags, exit codes, JSON fields, the page's ARIA roles and names).

```sh
export VERIFY_RUN_ID=<issue>                           # one per run, normally the issue number
C=.agents/skills/verify-nico-agent/control-nico-agent  # from the repo root
$C help
```

## Launch

```sh
$C launch            # cargo build --locked --bin nico-agent (build.rs builds web/ with Vite), scratch HOME, fixtures, serve
. "$($C env)"        # $FIXTURE_CLONE, $SECOND_CLONE, $CONFIG_DIR, $BUCKET, $URL, $OUTSIDE_LOG
```

Ready when `launch` prints serve's pid and URL. A failing `cargo build` is a broken checkout: fix or report that before verifying. `launch --no-build` reuses `target/debug/nico-agent` as built; `restart` is a reboot of serve on the same HOME.

## Doctor

```sh
$C doctor
```

Read-only. Passes only when the run's binary is byte for byte `target/debug/nico-agent` (a rebuild since launch fails it: relaunch), serve is alive on the run's port and answers `/api/status`, the scratch HOME is under the run dir and not your `$HOME`, every stub resolves first on `PATH`, and the fixture's origin is reachable on disk. Run it first and whenever anything looks off; a failing doctor means "do not drive this run".

## Drive

Start each feature from a fresh run, so one feature's Dispatches never leak into the next:

```sh
$C cleanup; $C launch --no-build && $C doctor && . "$($C env)"
$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json   # most features start here
$C seed issues                      # Ready #1, Research #5, Stackable #6; #2, #3, #4 not Ready
$C run -- status --json
$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'
$C page --click "button=Refresh"
```

Recipes per feature are in [`features/`](features/README.md): drive the ones the change touches, and every entry point the feature file lists, not just the convenient one. `run` executes with the run's `work/` as cwd: pass absolute paths (`--findings`).

## Evidence

Record into `.evidence/<issue>/<feature>/` in the worktree, one folder per feature driven; nico-agent copies `.evidence/<issue>/` to the Bucket at each PR head, Verdict and Close, and the PR body's Evidence section links there. `.evidence/` is gitignored.

```sh
E=.evidence/<issue>/status; mkdir -p "$E"
$C state > "$E/state.before.txt"
$C run --evidence "$E/01-status" -- status --json
$C state > "$E/state.after.txt"
diff "$E/state.before.txt" "$E/state.after.txt" > "$E/state.diff"; cp "$OUTSIDE_LOG" "$E/outside.log"
```

Proof standards:

- Exercise the real user path: the built binary with user flags, the page clicked through Chromium, `/api` with the body the page sends. Never call a module, never edit state by hand except through `seed` and `drift` (preconditions, not proofs of the loop: `cargo test` owns that).
- Capture the action and the resulting state: every invocation's `.cmd` and output; `state` before and after, and its diff, which proves what was written and that a read wrote nothing; the page's ARIA snapshot and screenshot after the action, with `.requests.txt` proving which `/api` call the click made.
- A JSON answer is not proof the file changed: the `state` diff and a second view (`repo list`, `status`, the page) are.
- Copy `outside.log` into the folder: every outside call the binary made went to a stub.

## Cleanup

```sh
$C cleanup
```

Stops every process the run started, removes the run dir, never touches `.evidence/`. Run it after every failed iteration too, so a half-made run does not block the next `launch`. `target/` and `web/node_modules/` are the repo's own build caches and stay.

## Maintenance

The feature map under `features/` is the maintained source for what this skill verifies. When a command, flag, JSON field, route or page control changes, update the matching feature file (and `REFERENCE.md` when a handle changes) in the same PR; use `/maintain-verification-skill` to re-check the map against the app.
