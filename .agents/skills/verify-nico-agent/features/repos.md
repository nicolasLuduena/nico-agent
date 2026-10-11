# Add, remove and list Repos

`repo add` gives the loop a GitHub repository to work, by slug and local clone, after checking the
clone's remote points at that slug; `repo list` shows each Repo with its defaults filled in; `repo
rm` stops the loop working one and says what stays. The first `repo add` also makes the Bucket.

## Sub-features

- `repo-add` adds a Repo to `config.toml` with its absolute path; answers `<slug> added`.
- `repo-add-noop` adding the same slug and path again answers `already added (no-op)` and writes nothing.
- `repo-add-bucket` the first `repo add` makes the Bucket: a git repo with `README.md` committed as `nico-agent's Bucket`.
- `repo-add-not-clone` a path that is not a clone's top directory is refused (exit 1) with the `git clone` to run.
- `repo-add-wrong-remote` a clone of another slug is refused (exit 1), naming its remotes.
- `repo-add-usage` a bad slug, or no `--path`, is a bad invocation (exit 2) with the usage line.
- `repo-list` lists each Repo with `path`, `room` 3, `implementer` claude, `reviewer` codex, and every switch.
- `repo-rm` removes a Repo, keeping its clone (`stays`); a second `rm` is a no-op.
- `repo-usage` `repo` with no subcommand is exit 2 with the three usage lines.

## How to get to it (user POV)

- Run `nico-agent repo add <owner/name> --path <clone>` in a terminal.
- Run `nico-agent repo list` and `nico-agent repo rm <owner/name>`.
- See the result on the page: one tab per Repo in `tablist "Repos"` (see page-tabs-strip).

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
  add order, each with `room` `3`, `implementer` `{"harness":"claude",...}`, `reviewer`
  `{"harness":"codex",...}`, `linear` `null`, `base` `null` and `switches` with `dispatch`,
  `stack`, `review`, `restart`, `flip` true and `answer`, `gardening`, `quality_scan` false.
- **Remove.** Run `$C run --evidence "$E/10-rm" -- repo rm verify/second --json`. Exit `0`,
  `{"repo":"verify/second removed","stays":["the clone at $SECOND_CLONE"]}`.
- **Remove again.** Run `$C run --evidence "$E/11-rm-again" -- repo rm verify/second --json`. Exit
  `0`, `{"repo":"verify/second not configured (no-op)"}`.
- **No subcommand.** Run `$C run --evidence "$E/12-repo" -- repo --json`. Exit `2`, `error`
  `` `repo` needs a subcommand: add, rm or list ``, three `help` lines.
- **Proof.** `$C state > "$E/state.after.txt"`; `diff "$E/state.before.txt" "$E/state.after.txt" > "$E/state.diff"`
  shows only `config.toml` gaining `[repos."verify/fixture"]` with its `path` (verify/second added
  and removed), and the Bucket log gaining the commit `nico-agent's Bucket` with `README.md`.
  `$C run --evidence "$E/13-list-after" -- repo list --json` lists `verify/fixture` alone. Copy
  `$OUTSIDE_LOG` to `$E/outside.log`: empty, `repo` asks nothing outside.

## Gotchas

- The slug is matched case-insensitively against the remote, and kept as first added: `repo add
  VERIFY/FIXTURE` on the same clone is the existing Repo.
- `--path` is made absolute against the cwd, which for `$C run` is the run's `work/`: always pass
  an absolute path.
- A path inside a clone (not its top directory) is "not a git clone", by design.
- `repo rm` of a Repo with a live Dispatch lists `<issue>, In flight till it is Closed` in `stays`;
  the Dispatch goes on. Seed one (`$C seed dispatch 10 pr`) to see it.
- The Bucket is made once; a later `repo add` leaves it as is, so the Bucket commit shows only after
  the first add of a fresh run.
