---
name: verify-nico-agent
description: "Drive nico-agent the way its user and its agents do — the CLI (`repo`, `status`, `dispatch`, `verdict`, `refresh`) and serve's page (tabs, needs-you strip, switches, Refresh) — in a scratch HOME on a free port, with gh, herdr and notifications stubbed, and capture proof under .evidence/<issue>/. Use to prove a change works in the real binary and the real page, not only in `cargo test`; the feature map in features/ is the maintained list of what to drive."
---

# Verify nico-agent

nico-agent is one Rust binary with two user surfaces, and this skill drives both:

- **The CLI**, what outsiders call: `repo add|rm|list`, `status`, `dispatch`, `verdict`, `refresh`,
  `install`, `wiki build` (`--update`, `--rebuild`, `--continue`), and `mcp`, an MCP server on stdio fed by `run`'s stdin.
  Every command prints one JSON object with `--json`; exit `0` is an answer, `1` a refusal the user
  can act on, `2` a bad invocation, each refusal as `{error, help}`.
- **serve's page**, the Svelte app `serve` embeds and answers on `127.0.0.1:<port>`, with the
  `/api/*` routes it calls (each the shape of the command it stands for) and `/bucket/*`.

The loop's outside world (herdr's panes and agents, GitHub, Linear, desktop notifications) is not
driven: a verification never reaches it. Features that need it are driven to their refusal or to
their cached-state behaviour, which is what the user sees when GitHub or herdr is down.

Decisions this skill was generated from (the interview of the repo):

- **Surface:** the CLI and serve's page, both primary (PRODUCT.md: the commands outsiders call, and
  the page the user reads in the morning). herdr's panes and the Sources are outside the process.
- **Run:** `cargo build --locked --bin nico-agent` (its `build.rs` builds `web/` with Vite and embeds
  it), then `nico-agent serve` for the page; each other command is one short-lived process.
- **Drive:** the binary run with `HOME` set to a scratch directory, so it reads and writes
  `$HOME/.config/nico-agent` there (`src/main.rs`); serve on a free port (`port` in that
  `config.toml`); the page in headless Chromium through Playwright; `/api` with curl.
- **Observe:** stdout JSON and exit codes; the files of the scratch config dir (`config.toml`,
  `dispatches.json`, `prs.json`, `issues/`, `verdicts/`, `pauses.json`, `checks.json`, `installs.json`,
  `runs.json`, `wikis.json`, `wiki-queue.json`); the Bucket's git log; HTTP
  status, headers and body; the page's ARIA snapshot, screenshot and the `/api` requests it made;
  every call the binary made outside the process, recorded by the stubs in `outside.log`.
- **Isolate:** yes. Each run has its own directory `${VERIFY_RUN_ROOT:-${TMPDIR:-/tmp}/verify-nico-agent}/$VERIFY_RUN_ID`
  holding the binary's copy, the scratch HOME, two fixture clones, the Bucket and a port of its own;
  runs with different ids never share state. Never run the binary with the real HOME: that is the
  user's own config, Repos and Dispatches.

## Helpers

Three executable scripts ship with the skill: `control-nico-agent` (bash; needs `cargo`, `git`, `jq`,
`curl`, `node`, `ss`, `setsid`), `page.mjs`, which `control-nico-agent page` runs (needs the
`playwright` CLI on `PATH`, and its browser or a `chromium` on `PATH`), and `tunnel.mjs`, which
`control-nico-agent tunnel start` runs. Every subcommand reads
`VERIFY_RUN_ID`; pick one per verification run, normally the issue number:

```sh
export VERIFY_RUN_ID=<issue>
C=.agents/skills/verify-nico-agent/control-nico-agent   # run from the repo root

$C launch [--no-build]          # build, make the scratch HOME, fixtures and config, start serve
$C restart                      # stop serve and start it again on the same HOME and port, as a reboot would
$C doctor                       # read-only health check of this run
. "$($C env)"                   # this run's paths: $FIXTURE_CLONE, $SECOND_CLONE, $CONFIG_DIR, $BUCKET, $URL, $OUTSIDE_LOG
$C seed issues [second]         # a fresh read of verify/fixture's issues (or verify/second's), as the Source would cache it
$C seed dispatch <n> pr|asking|stacked  # a Dispatch of verify/fixture#<n> as the loop records one; prints JSON
$C seed run quality-scan|morning|faux-nico <n>  # a Run of the loop's own agent, blocked; prints JSON
$C seed morning <file>|none     # the Morning summary the morning agent leaves: <file> as morning.md, or none
$C seed answer <file>|none [<part>]  # what the wiki model (the opencode2 stub) answers every call: <file>'s text, or none;
                                # with <part>, a trail such as `verify/fixture > Readme`, only the calls about it
$C seed correction <file>|none  # what the wiki model answers each correction (a call with -s): <file>'s text, or none
$C drift push <n>|stale|pause   # what GitHub would change: a new PR head, an old read, a rate limit
$C drift below merged|closed    # ... or the PR below a Stacked dispatch merged or closed unmerged
$C drift base [<file>]          # ... or verify/fixture's Base moved on by a merge rewriting README.md (or <file>), fetched into its clone
$C drift tag <tag>              # ... or verify/second tagged <tag>, a release adding lib/, as a Library is
$C state                        # fingerprint: config dir files, Dispatches, Verdicts, Bucket log, outside calls
$C run [--evidence PREFIX] -- <nico-agent args...>       # the CLI in the scratch HOME; exit code is the CLI's
$C http [--evidence PREFIX] [--header 'NAME: VALUE']... <METHOD> <PATH> [BODY]
                                # ask serve, as the page does (or with other headers); exit 1 on 4xx/5xx
$C page [--tunnel] [--evidence PREFIX] [--width PX] [--storage FILE|none] [--hash HASH] [--within ROLE=NAME|page | --click ROLE=NAME | --click ROLE~NAME | --press KEY | --type TEXT
        | --expect TEXT | --gone TEXT | --wait SECONDS | --history back|forward | --mode pass|502|signed-out]...
                                # open the page (through the tunnel stand-in), act in order, capture
$C tunnel start|pass|502|signed-out   # a stand-in for cloudflared and Access in front of serve; $TUNNEL_URL, $TUNNEL_LOG
$C cleanup                      # stop what the run started, remove the run dir; never touches .evidence/
```

`run --evidence PREFIX` writes `PREFIX.cmd`, `.stdout`, `.stderr` and `.exit`; `http --evidence`
writes `.cmd` (each `--header` in brackets first), `.stdout` (the body), `.stderr`, `.exit` (the
HTTP status) and `.headers`; `page
--evidence` writes `.cmd`, `.aria.txt`, `.png` (the whole page), `.view.png` (the window, as scrolled),
`.view.txt` (where the window is scrolled, the page's width against the window's, and what has focus),
`.requests.txt` and `.console.txt`. Each still prints
what it captured, so a recipe can record and inspect at once. `page` steps: `--click tab=verify/second`
clicks the element of that ARIA role whose accessible name is exactly the text, `--click
"button~Failed verify/fixture #1"` one whose name contains it, `--within "region=verify/fixture"` makes
every later `--click` look only inside that element (a Repo's panel on a Project's tab, whose
controls share their names with the Project's and the other Repos'), `--within page` the whole
page again, `--press ArrowRight` a key, `--type
dev` text into what has focus,
`--expect "Source not read yet"` waits for the text, `--gone TEXT` up to a minute for it to go,
`--wait 120` lets two minutes pass, `--history back` (or `forward`) is the browser's Back (or
Forward) button, and `--mode 502` switches the tunnel stand-in (with `--tunnel` only). `--hash
"#shop/wiki/verify%2Ffixture"` opens the page at that hash, as a link to it does. Each `page` is a new browser with nothing stored: `--storage FILE` starts it with the
storage `FILE` holds (none the first time) and saves it back at the end, so the next `page` with
the same `FILE` is a reload in the same browser; `--storage none` is a browser whose `localStorage`
throws, as one blocking the site's data does. `page` prints `ok` or `FAIL` per step and exits 1 on
the first failure, after capturing.
`.requests.txt` lists each `/api/events` stream as it is answered too, so a reconnect is a line.

`tunnel start` sets `bucket.url` to the stand-in's URL, as `scripts/setup-tunnel.sh` does to the
tunnel's, since serve refuses a request on a host not its own, and puts `tunnel.mjs` between the
page and serve, where cloudflared and Access sit: it
cuts a response that sends nothing for 100 seconds, as Cloudflare does; switched to `502` it answers
every request with a 502, as while the tunnel comes back, and to `signed-out` with Access's redirect
to its login on another origin, as once the session lapses; `pass` passes requests on again.
Switching to `502` cuts the open streams, as a dropped tunnel does; a lapse leaves them open, as
Access does. It logs each answer, and each stream's end, to `$TUNNEL_LOG`.

`seed dispatch` prints `{ issue, kind, worktree, branch, head, pr, evidence }`; keep it, the verdict
recipes need `head`.

## Launch

From the repo root:

```sh
export VERIFY_RUN_ID=<issue>
.agents/skills/verify-nico-agent/control-nico-agent launch
```

This runs `cargo build --locked --bin nico-agent` (the first build also runs `npm ci` in `web/`
when `web/node_modules` is older than its lockfile), copies the binary into the run dir, and makes:

- `stubs/`: `gh`, `ghbot`, `herdr`, `notify-send`, `curl` and `opencode2`, first on the binary's `PATH`. Each
  appends its command line to `outside.log` and reaches nothing: `gh` says what it says in a HOME
  that never ran `gh auth login` (exit 4), `herdr` fails with code `verify_stub`, `notify-send`
  succeeds without showing anything, `curl` fails as if offline, `opencode2` fails as with no model
  (exit 1, an `error` event) unless `seed answer` gave it a text to answer with.
- `home/`: the scratch HOME, with a `.gitconfig` naming `Verify Nico <verify-nico@example.com>`.
  Its `.config/nico-agent/config.toml` sets `port` to a free port, `tick_minutes = 600`,
  `bucket.path` to `bucket/` in the run dir and `morning.enabled = false` (the morning agent
  would otherwise start in the hour after 07:00, so a run's ticks would depend on the clock).
- `fixture/fixture` and `fixture/second`: clones of `verify/fixture` and `verify/second`, each with
  origin `https://github.com/<slug>.git`, which the scratch `.gitconfig` rewrites to a bare repo in
  `fixture/`; any other github.com URL is rewritten to a path that does not exist. `repo add` sees
  GitHub clones; `git fetch` stays on disk.
- serve, started with `setsid` in the scratch HOME: one tick at once (no Repo yet, so nothing),
  then none for 10 hours; every later tick is a `refresh` or the page's Refresh button.

Ready signal: `launch` prints serve's pid and URL once `GET /api/status` answers and the port's
owner is this run's binary; then `doctor` passes. `restart` stops serve and starts it again the same
way, on the same port, recording its new pid; serve ticks once at start, as at launch. Teardown is `cleanup`. `launch` refuses to run
twice for one `VERIFY_RUN_ID` (cleanup first). Pass `--no-build` to reuse `target/debug/nico-agent`
as built; a failing `cargo build` is a broken checkout: fix or report that before verifying.

## Doctor

```sh
.agents/skills/verify-nico-agent/control-nico-agent doctor
```

Read-only. Passes only when: `nico-agent --version` prints the version in `Cargo.toml`; the run's
binary is byte for byte `target/debug/nico-agent` (a rebuild since launch fails this: relaunch to
verify the new build); serve's pid is alive and runs the run's binary; the port is that pid's;
`/api/status` answers 200 with JSON; the scratch HOME is under the run dir and not your `$HOME`;
`config.toml` holds the run's port and Bucket; `gh`, `ghbot`, `herdr`, `notify-send`, `curl` and `opencode2`
resolve to the run's stubs; the fixture's origin is the GitHub URL and `git ls-remote` reaches it on
disk. It also prints the build's commit, the Repos configured and the outside calls so far. Run it
first, and again whenever anything looks off; a failing doctor means "do not drive this run".

## Drive

Start each feature from a fresh run, so one feature's Dispatches never leak into the next:

```sh
C=.agents/skills/verify-nico-agent/control-nico-agent
$C cleanup; $C launch --no-build && $C doctor && . "$($C env)"
$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json   # most features start here
$C seed issues                      # Ready #1, Research #5, Stackable #6; #2, #3, #4 not Ready
$C run -- status --json
$C run -- dispatch verify/fixture#2 --json
$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'
$C page --click "button=Refresh"
```

What the fixtures hold:

- `seed issues` caches, read now (fresh for a tick, 10 hours here), `verify/fixture#1` "Verify: a
  Ready issue" (Ready), `#2` "Verify: not labelled", `#3` "Verify: waits on #1" (unresolved Blocker
  `#1`, no PR), `#4` "Verify: assigned to someone else" (assignee `someone-else`), `#5` "Verify: a
  Research issue" (Ready, `research`), `#6` "Verify: stacks on #9 PR" (Stackable on PR #109, head
  `agent/fixture-9`, which the fixture's origin does not have). The user is `verify-nico`.
  `seed issues second` caches, read now, `verify/second#1` "Verify: waits on fixture #1"
  (unresolved Blocker `verify/fixture#1`, a Blocker in another Repo), `#2` "Verify: waits on an
  outside issue" (unresolved Blocker `verify/outside#7` "Verify: an outside Blocker", in no Repo)
  and `#3` "Verify: waits on fixture #20 installed" (Blocker `verify/fixture#20` "Verify: a closed
  Blocker", closed at the read: Ready, until verify/fixture is in its Project with an `install`
  that has not run since).
- `seed dispatch <n> pr` records Dispatch `verify/fixture#<n>` "Verify: seeded Dispatch <n>" with
  every step done, in a worktree `worktrees/fixture-<n>` on `agent/fixture-<n>` holding
  `.evidence/<n>/proof.txt`, and its draft PR `https://github.com/verify/fixture/pull/<100+n>` open
  on the worktree's head in `prs.json`. `asking` records the same without a PR, its Implementer
  Asking "Should the fixture keep its README? (seeded by verify-nico-agent)". `stacked` records the
  same as `pr`, but Stacked on `#9`'s open PR `https://github.com/verify/fixture/pull/109` (head
  `agent/fixture-9`, on `main`, also put in `prs.json`): its Base and its PR's base are
  `agent/fixture-9`. Use numbers above 6.
- `seed run` records a Run open and blocked since now, as the loop does once herdr reports its
  agent blocked: `quality-scan` of verify/fixture (agent `quality-scan-fixture`), `morning` (agent
  `morning`), or `faux-nico <n>` (agent `faux-nico-fixture-<n>`) on the Asking of a Dispatch seeded
  `asking`. A tick leaves it as it is: with herdr stubbed, no agent is ever seen ended.
- `seed morning <file>` puts `<file>`'s text in the config dir as `morning.md`, as the morning agent
  writes its summary (the agent itself is off in a run); `seed morning none` takes it away.
- `seed answer <file>` makes the `opencode2` stub answer every headless call with `<file>`'s text, as
  the wiki model's last message, in a session of its own (`ses_verify_<n>`); `seed answer <file>
  "<trail>"` only the calls whose prompt asks about that part (`## The part: <trail>`, or a
  correction's `## Corrections to the part: <trail>`), ahead of the answer for every call; `seed
  correction <file>` answers each correction (a call with `-s <session>`, which it continues) with
  `<file>`'s text instead, and `seed correction none` goes back to the part's answer; `seed answer
  none` takes every answer away, corrections too, and each call fails again, as opencode with no
  model does. The stub logs each call after the `OPENCODE_CONFIG_CONTENT` it was given.
- `drift push <n>` commits to the seeded worktree and moves the PR's `head_sha`, as a push would;
  `drift stale` dates the cached read 2000-01-01, so the next `status` or `dispatch` asks GitHub;
  `drift pause` writes GitHub paused for an hour, as a rate limit does; `drift below merged|closed`
  makes PR #109 final, merged or closed unmerged, as GitHub would say; `drift base [<file>]` pushes a commit
  rewriting `README.md`, or `<file>` (a path in the fixture, made if new), to verify/fixture's
  `main` and fetches it, as a merge and the loop's next fetch would, printing `{base, file, old, head}`;
  `drift tag <tag>` pushes tag `<tag>` to verify/second's origin, on a commit off its `main` adding
  `lib/greet.sh` and `lib/README.md`, as a Library's release would, printing `{repo, tag, commit}`.
  `state` shows each Library's bare clone in the config dir by its tags and worktrees, not its files.

Stable handles are the command words and flags (`--path`, `--json`, `--harness`, `--model`,
`--effort`, `--sha`, `--findings`), the exit codes, the JSON field names, the routes in `GET` of an
unknown path's `help`, and on the page the ARIA roles and names: `tablist "Projects"` with one
`tab` per Project (a Repo with none is its own, named by its slug), then `tab "Libraries"` (its
`tabpanel "Libraries"`: `list "Libraries"` with `button "Remove <id>…"` per version, then `region
"Add a Library"` with `textbox "Library"`, `textbox "Tag"`, `textbox "Subfolder"` and `button
"Add"`), `region "Needs you"`, `button
"Refresh"`, a `region "<project>"` of its defaults unless it is a Repo's own, then a `region
"<slug>"` per Repo, each holding `switch "Dispatch"` (and `Faux-nico answers`,
`Flip to ready`, `Gardening`, `Quality-scan`, `Restart`, `Review`, `Stack`, `Wiki`), `spinbutton "Room"`,
`navigation "View"` with `link "Map"` and `link "Wiki"` (the
Wiki view: `combobox "Wiki"`, `searchbox "Search this Wiki"` with, while it holds words, a `status`
`N found` and `navigation "Found"` with a `link` per hit in place of `navigation "Components"` with
a `link` per Component, `button "Update"`, `button "Rebuild"` and, while the budget left Gaps,
`button "Continue +N calls"` under the header, `article "<Component>"` with a `region` per kind of Interpretation,
`"Components"` and `"Gaps"`, `navigation "Outline"` with a `button` per head; under 1080px
`button "Outline"`, under 720px `button "Components"` too, each opening its sheet with `button
"Close"`; `button "Wiki settings"` opening `region "Settings for every Wiki"` with `combobox
"Harness"`, `combobox` or `textbox` `"Model"` and `"Effort"`, `spinbutton "Hour"`, `"Calls"`,
`"Depth"` and `"Calls at once"`, and `textbox "Embedding model"`), `region "Dispatch"` with `button "Dispatch"` (a Repo's only), `region "Readiness"` with a `group` reading `N of M pass` (a Repo's only), `region "Map of <project>"`, `region "Settings"` with
`combobox "Implementer Harness"` (and `model`, `Effort`, and the same for `Reviewer`), `textbox
"Base"`, `combobox "Project"` (a Repo's only), `region "Libraries"` with `button "Unlink <id>"` per version and `form "Link a Library"` (`textbox "Library"`, `textbox "Tag"`, `textbox "Subfolder"`, `button "Link"`) (a Repo's only), `region "Install"` with `textbox "Install"` (a Repo's only), `button "Use the default <Setting>"` or `"Use the
Project's <Setting>"`, `button "Remove <slug>…"`; a `--click` takes the first match, which is the
Project's defaults before any Repo's, `region "Add a Repo"` with `textbox "Repo"`, `textbox "Its
clone"`, `combobox "Its Project"` and `button "Add"`. `run` executes with the run's `work/` as cwd: pass absolute paths (`--findings`).

Recipes per feature are in [`features/`](features/README.md); drive the ones the change touches,
and every entry point the feature file lists, not just the convenient one.

## Evidence

Record into `.evidence/<issue>/<feature>/` in the worktree, one folder per feature driven;
nico-agent copies `.evidence/<issue>/` to the Bucket at each PR head, Verdict and Close, and the PR
body's Evidence section links there. `.evidence/` is gitignored at the repo root.

```sh
E=.evidence/<issue>/status
$C state > "$E/state.before.txt"
$C run --evidence "$E/01-status" -- status --json
$C state > "$E/state.after.txt"
diff "$E/state.before.txt" "$E/state.after.txt" > "$E/state.diff"; cp "$OUTSIDE_LOG" "$E/outside.log"
```

Proof standards:

- Exercise the real user path: the built binary with user flags, serve's page clicked through
  Chromium, `/api` with the body the page sends. Never call a module, never edit state by hand
  except through `seed` and `drift`, which stand in for what herdr and GitHub would have written
  (they are preconditions, not proofs of the loop: `cargo test` owns that).
- Capture the action and the resulting state: every invocation's `.cmd` and output; a `state`
  before and after a command, and its diff, which proves what it wrote (`config.toml`, a Verdict, a
  Bucket commit) and that a read wrote nothing; the page's ARIA snapshot and screenshot after the
  action, with `.requests.txt` proving which `/api` call the click made.
- Verify side effects alongside what is visible: a JSON answer is not proof the file changed; the
  `state` diff and a second view (`repo list`, `status`, the page) are.
- Prove isolation: copy `outside.log` into the folder. It lists every outside call the binary made;
  each went to a stub, and none can reach GitHub, herdr or the desktop.
- Mocks only at the process boundary nico-agent already isolates behind its `World` (`gh`, `herdr`,
  `notify-send`, `curl`, `opencode2`); `git` is real, on the run's own repos.

## Cleanup

```sh
.agents/skills/verify-nico-agent/control-nico-agent cleanup
```

Stops every process whose executable lives in the run dir (serve, with its session and the `git`
it runs; any CLI run still going), any browser `page` left with its profile in the run's `tmp/` and
the tunnel stand-in,
then removes the run dir: the binary's copy, the scratch HOME and config, the fixtures and their
worktrees, the Bucket, the stubs and `outside.log`. It refuses paths outside the run root, kills
nothing by name, and never touches `.evidence/`, where the proof lives after cleanup. Run it after
every failed iteration too, so a half-made run does not block the next `launch`. `target/` and
`web/node_modules/` are the repo's own build caches (gitignored) and stay.

## Maintenance

The feature map under `features/` is the maintained source for what this skill verifies. When a
command, flag, JSON field, route or page control changes, update the matching feature file in the
same PR; use `/maintain-verification-skill` to re-check the map against the app.
