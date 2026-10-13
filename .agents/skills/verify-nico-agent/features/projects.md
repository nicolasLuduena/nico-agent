# Projects

A Project groups Repos that work together. A Repo names its Project with `project = "<name>"`;
one that names none is a Project of its own, named by its slug. `projects.<name>` in `config.toml`
holds defaults its Repos take where they set none: any Repo key but `path`, `linear` and `project`.
Switches are taken one by one; a launch whole. `repo list` names each Repo's Project, and `status`
lists the Projects and shows each setting of a Repo with where it comes from: `repo`, `project` or
`default`.

## Sub-features

- `projects-inherit` a Project's value reaches each of its Repos; a Repo's own value wins.
- `projects-switches` a Project's switch reaches its Repos while the Repos' other switches stay their defaults.
- `projects-list` `repo list` shows each Repo's `project`: the one it names, else its slug.
- `projects-status` `status` and `GET /api/status` hold `projects: [{name, repos, defaults}]` and, per Repo, each setting as `{value, from}`, the Reviewer's default launch included.
- `projects-page` the Repo's tab shows the effective Room and switches, a Project's included.
- `projects-refused` an unknown key, or a launch naming no Harness, in `projects.<name>` is refused (exit 1) naming its line.

## How to get to it (user POV)

- By hand: add `project = "<name>"` under each `repos."<slug>"` and a `[projects.<name>]` table in
  `config.toml`.
- Run `nico-agent repo list` and `nico-agent status` (`--json` for scripts).
- Open serve's page: each Repo's tab shows its Room and switches as they take effect.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, the same for verify/second
  with `$SECOND_CLONE`, and `$C seed issues`.
- `E=.evidence/<issue>/projects`; `$C state > "$E/state.before.txt"`.

- **Make the Project.** Edit `$CONFIG_DIR/config.toml`: add `project = "verify"` under both
  `[repos."verify/fixture"]` and `[repos."verify/second"]`, `room = 4` under verify/second, and
  at the end `[projects.verify]` with `room = 2`, `reviewer = { harness = "opencode", model = "big" }`
  and `switches = { review = false }`. Keep a copy: `cp "$CONFIG_DIR/config.toml" "$E/good.config.toml"`.
- **List.** Run `$C run --evidence "$E/01-list" -- repo list --json`. Both Repos have `project`
  `verify` and `reviewer` opencode `big`; verify/fixture `room` `2`, verify/second `room` `4`;
  `switches.review` false and `switches.stack` true in both.
- **Status.** Run `$C run --evidence "$E/02-status" -- status --json`. `projects` is
  `[{"name":"verify","repos":["verify/fixture","verify/second"],"defaults":{"room":2,"reviewer":{...},"switches":{"review":false}}}]`.
  verify/fixture's `room` is `{"value":2,"from":"project"}`, verify/second's `{"value":4,"from":"repo"}`;
  both have `reviewer` `from` `project`, `switches.review` `{"value":false,"from":"project"}`,
  `switches.dispatch` `{"value":true,"from":"default"}`, `implementer` claude `from` `default` and
  `base` `{"value":null,"from":"default"}`.
- **API.** Run `$C http --evidence "$E/03-api" GET /api/status`. HTTP `200`; `projects` equals the
  command's, and each Repo has the same `{value, from}` settings plus `harnesses`.
- **Page.** Run `$C page --evidence "$E/04-page-fixture" --click "tab=verify/fixture" --expect "Switches" --click "region=Switches" --expect "Faux-nico answers"`:
  the snapshot has `spinbutton "Room": "2"`, `Switches 4 of 8 on`, `switch "Review"` unchecked and
  `switch "Dispatch" [checked]`. With `--click "tab=verify/second"` (`05-page-second`): `spinbutton "Room": "4"`, `switch "Review"`
  unchecked. `.console.txt` is empty.
- **Refused.** Rename `room = 2` under `[projects.verify]` to `rom = 2` and run
  `$C run --evidence "$E/06-unknown-key" -- repo list --json`: exit `1`, `error` `<config> line <n>:
  projects.verify.rom: unknown field \`rom\`, expected one of \`room\`, ...`, `<n>` the line of `rom`.
  Restore `good.config.toml`; set the Project's reviewer to `{ harness = "pi" }` and run
  `$C run --evidence "$E/07-no-harness" -- status --json`: exit `1`, `projects.verify.reviewer.harness:
  \`pi\` is not a Harness` at its line, help `Harnesses: claude, codex, opencode`. Restore
  `good.config.toml`.
- **Proof.** `$C state > "$E/state.after.txt"`; the diff with `state.before.txt` shows only the hand
  edit of `config.toml`, and the outside call `gh api user --jq .login` (verify/second's first read).
  Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- No command writes a Project yet: the page and `repo add --project` come later. Edit the file by
  hand, and restore it after each refusal, or every later command refuses too.
- A Repo with no `project` takes the defaults of `projects."<its slug>"` if there is one: it is
  that Project.
- A launch is replaced whole: a Repo's `implementer = { harness = "claude" }` drops the Project's
  model and Effort.
