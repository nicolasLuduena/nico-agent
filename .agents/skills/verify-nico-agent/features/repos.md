# Add, remove and list Repos

`repo add` gives the loop a GitHub repository to work, by slug and local clone, after checking the
clone's remote points at that slug, and with `--project` names the Project it joins; `repo list`
shows each Repo with its defaults filled in; `repo rm` stops the loop working one and says what
stays. The first `repo add` also makes the Bucket. The page does the same: `Add a Repo` under the
tabs runs `repo add` through `POST /api/repo`, and `Remove <slug>…` in a Repo's tab runs `repo rm`
through `DELETE /api/repo/<slug>`, refused while the Repo has a Dispatch In flight.

## Sub-features

- `repo-add` adds a Repo to `config.toml` with its absolute path; answers `<slug> added`.
- `repo-add-noop` adding the same slug and path again answers `already added (no-op)` and writes nothing.
- `repo-add-bucket` the first `repo add` makes the Bucket: a git repo with `README.md` committed as `nico-agent's Bucket`.
- `repo-add-not-clone` a path that is not a clone's top directory is refused (exit 1) with the `git clone` to run.
- `repo-add-wrong-remote` a clone of another slug is refused (exit 1), naming its remotes.
- `repo-add-usage` a bad slug, or no `--path`, is a bad invocation (exit 2) with the usage line.
- `repo-list` lists each Repo with `path`, `project` (its slug, naming none), `room` 3, `implementer` claude, `reviewer` codex, and every switch.
- `repo-rm` removes a Repo, keeping its clone (`stays`); a second `rm` is a no-op.
- `repo-usage` `repo` with no subcommand is exit 2 with the three usage lines.
- `repo-add-project` `--project <name>` writes `project = "<name>"`; adding again without it keeps it.
- `repo-page-add` the page's `region "Add a Repo"` sends `POST /api/repo {slug, path, project}`, answered as `repo add`; the new Repo's tab opens.
- `repo-page-remove` `button "Remove <slug>…"`, then `button "Remove <slug>"`, sends `DELETE /api/repo/<slug>`, answered as `repo rm`; its tab goes.
- `repo-page-remove-refused` with a Dispatch In flight the DELETE is 409, `<slug> has a Dispatch In flight: <issue>`, shown under the button; nothing written.
- `repo-api-refused` a POST without a path, or with a field not a string, is 400 with the `repo add` usage.

## How to get to it (user POV)

- Run `nico-agent repo add <owner/name> --path <clone>` in a terminal.
- Run `nico-agent repo list` and `nico-agent repo rm <owner/name>`.
- See the result on the page: one tab per Repo in `tablist "Repos"` (see page-tabs-strip).
- On the page: fill `Repo`, `Its clone` and, if any, `Its Project` under `Add a Repo`, and press
  `Add`; in a Repo's tab press `Remove <slug>…`, then `Remove <slug>` (or `Keep it`).
- From a script: `POST /api/repo {slug, path, project}`, `DELETE /api/repo/<owner/name>`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/repos`; `$C state > "$E/state.before.txt"`.

- **Empty list.** Run `$C run --evidence "$E/01-list-empty" -- repo list --json`. Exit `0`, stdout `{"repos":[]}`.
- **Add.** Run `$C run --evidence "$E/02-add" -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
  Exit `0`, stdout `{"path":"$FIXTURE_CLONE","repo":"verify/fixture added"}`.
- **Add again.** Run the same command with `--evidence "$E/03-add-again"`. Exit `0`, `repo`
  `verify/fixture already added (no-op)`.
- **Add a second.** Run `$C run --evidence "$E/04-add-second" -- repo add verify/second --path "$SECOND_CLONE" --json`.
  Exit `0`, `verify/second added`.
- **Wrong remote.** Run `$C run --evidence "$E/05-wrong-remote" -- repo add verify/second --path "$FIXTURE_CLONE" --json`.
  Exit `1`, `error` `$FIXTURE_CLONE is not a clone of verify/second (its remotes: https://github.com/verify/fixture.git)`.
- **Not a clone.** Run `$C run --evidence "$E/06-not-clone" -- repo add verify/second --path "$FIXTURE_CLONE/missing" --json`.
  Exit `1`, `error` `$FIXTURE_CLONE/missing is not a git clone`, `help` `Run \`git clone https://github.com/verify/second $FIXTURE_CLONE/missing\` first, or pass the path of an existing clone`.
- **Bad slug.** Run `$C run --evidence "$E/07-bad-slug" -- repo add notaslug --path "$FIXTURE_CLONE" --json`.
  Exit `2`, `error` `` `notaslug` is not an owner/name slug ``.
- **No path.** Run `$C run --evidence "$E/08-no-path" -- repo add verify/x --json`. Exit `2`,
  `error` `missing required flag --path`.
- **List.** Run `$C run --evidence "$E/09-list" -- repo list --json`. Exit `0`, two Repos in
  add order, each with `project` its own slug, `room` `3`, `implementer` `{"harness":"claude",...}`, `reviewer`
  `{"harness":"codex",...}`, `linear` `null`, `base` `null` and `switches` with `dispatch`,
  `stack`, `review`, `restart`, `flip` true and `answer`, `gardening`, `quality_scan` false.
- **Remove.** Run `$C run --evidence "$E/10-rm" -- repo rm verify/second --json`. Exit `0`,
  `{"repo":"verify/second removed","stays":["the clone at $SECOND_CLONE"]}`.
- **Remove again.** Run `$C run --evidence "$E/11-rm-again" -- repo rm verify/second --json`. Exit
  `0`, `{"repo":"verify/second not configured (no-op)"}`.
- **No subcommand.** Run `$C run --evidence "$E/12-repo" -- repo --json`. Exit `2`, `error`
  `` `repo` needs a subcommand: add, rm or list ``, three `help` lines.
- **Add with a Project.** Run `$C run --evidence "$E/14-add-project" -- repo add verify/second --path "$SECOND_CLONE" --project verify --json`.
  Exit `0`, `verify/second added`; `config.toml`'s `[repos."verify/second"]` has `project = "verify"`.
  `$C run --evidence "$E/15-add-again" -- repo add verify/second --path "$SECOND_CLONE" --json`:
  `already added (no-op)`, `project` kept.
- **Remove on the page.** Run `$C page --evidence "$E/16-page-remove" --click "tab=verify/second" --click "button=Remove verify/second…" --expect "Its clone stays" --click "button=Remove verify/second" --gone "Remove verify/second"`.
  `.requests.txt` has `DELETE /api/repo/verify/second -> 200`; the snapshot's `tablist "Repos"`
  holds `tab "verify/fixture"` alone; `config.toml` has no `verify/second`.
- **Add on the page.** Run `$C page --evidence "$E/17-page-add" --click "textbox=Repo" --type verify/second --click "textbox=Its clone" --type "$SECOND_CLONE" --click "combobox=Its Project" --type verify --click "button=Add" --expect "verify/second added"`.
  `.requests.txt` has `POST /api/repo {"slug":"verify/second","path":"$SECOND_CLONE","project":"verify"} -> 200`;
  the snapshot has `tab "verify/second" [selected]`; `config.toml` has it again with `project = "verify"`.
- **The routes.** `$C http --evidence "$E/18-post-no-path" POST /api/repo '{"slug":"verify/x"}'`:
  `400`, `missing required flag --path`, help the `repo add` usage. `$C http --evidence
  "$E/19-delete" DELETE /api/repo/verify%2Fsecond`: `200`, `{"repo":"verify/second removed","stays":[...]}`.
- **Refused with work In flight.** `$C seed dispatch 7 pr`; run `$C page --evidence "$E/20-page-remove-refused" --click "button=Remove verify/fixture…" --click "button=Remove verify/fixture" --expect "has a Dispatch In flight"`.
  `.requests.txt` has `DELETE /api/repo/verify/fixture -> 409`; an `alert` reads `verify/fixture
  has a Dispatch In flight: verify/fixture#7` with help `Remove it once each is Closed, or run
  \`nico-agent repo rm verify/fixture\`, which leaves them to finish`; `config.toml` still has
  verify/fixture.
- **Proof.** `$C state > "$E/state.after.txt"`; `diff "$E/state.before.txt" "$E/state.after.txt" > "$E/state.diff"`
  shows `config.toml` gaining `[repos."verify/fixture"]` with its `path` (verify/second added
  and removed, three times), the Bucket log gaining the commit `nico-agent's Bucket` with
  `README.md`, and the seeded Dispatch #7's files. `$C run --evidence "$E/21-list-after" -- repo
  list --json` lists `verify/fixture` alone. Copy `$OUTSIDE_LOG` to `$E/outside.log`: only `herdr
  agent list`, the page asking the seeded Dispatch's Agent states; `repo` and its routes ask nothing
  outside.

## Gotchas

- The slug is matched case-insensitively against the remote, and kept as first added: `repo add
  VERIFY/FIXTURE` on the same clone is the existing Repo.
- `--path` is made absolute against the cwd, which for `$C run` is the run's `work/`: always pass
  an absolute path.
- A path inside a clone (not its top directory) is "not a git clone", by design.
- `repo rm` of a Repo with a live Dispatch lists `<issue>, In flight till it is Closed` in `stays`;
  the Dispatch goes on. Seed one (`$C seed dispatch 10 pr`) to see it.
- The page's Remove is refused while the Repo has a Dispatch In flight; the CLI's `repo rm` is not.
- The page sends the clone path as typed: serve makes a relative one absolute against its own cwd.
- The Bucket is made once; a later `repo add` leaves it as is, so the Bucket commit shows only after
  the first add of a fresh run.
