# Settings

Each Repo's tab shows its settings beside its switches: the Implementer and Reviewer launches
(Harness, model, Effort), Base and Project, with room and the switches above them. Each shows its
effective value, tagged `PROJECT` or `DEFAULT` while the Repo does not set it. A change on the page
writes the Repo's own key to `config.toml` through `PATCH /api/repo/<slug>`, keeping the rest of
the file as written; "Use the Project's" (or "Use the default") beside a value the Repo sets removes
it. `PATCH /api/project/<name>` sets a Project's defaults the same way. A refusal shows its error
and help, and writes nothing. What the page wrote is what serve shows after a restart.

## Sub-features

- `settings-page` the tab's `region "Settings"`: `group "Implementer"` and `group "Reviewer"`, each with `combobox "<Role> Harness"`, `"<Role> model"` and `"<Role> Effort"`; `textbox "Base"`; `combobox "Project"`; each tagged `default` or `project` in the snapshot while the Repo does not set it.
- `settings-launch` a Harness picked on the page sends `{"reviewer": {harness, model: null, effort: null}}` and writes `reviewer = { harness = "<name>" }`.
- `settings-restart` a launch set on the page shows the same after serve restarts.
- `settings-undo` `button "Use the default <Setting>"` (or `Use the Project's <Setting>`) sends `{<key>: null}`, `{"switches": {<name>: null}}` for a switch, and removes the Repo's own line.
- `settings-base` a Base typed and entered writes `base = "<name>"`; emptied, it is removed and the field shows what takes its place.
- `settings-project` a Project typed in `combobox "Project"` writes `project = "<name>"`, the Repo then takes that Project's defaults, tagged `project`; `button "Leave <name>"` removes it.
- `settings-api` `PATCH /api/repo/<slug>` with any of `implementer`, `reviewer`, `room`, `base`, `project`, `switches` writes only those and answers `{slug, <each setting>: {value, from}}`; a percent-encoded slug reaches its Repo.
- `settings-project-api` `PATCH /api/project/<name>` with the same keys but `project` writes `[projects.<name>]` and answers `{name, defaults}`.
- `settings-refused` an unknown key, a Harness not configured, a model the Harness does not take, an empty Base, a Switch not boolean: 400 `{error, help}`; a Repo or Project not configured: 409; nothing written.

## How to get to it (user POV)

- Open the page, pick a Repo's tab, and change a select in `Settings`, or type in `Base` or
  `Project` and press Enter (or leave the field).
- Press `Use the default` or `Use the Project's` beside a setting the Repo sets, or `Leave <name>`
  under its Project.
- From a script: `PATCH /api/repo/<owner/name>` or `PATCH /api/project/<name>` with a JSON object.
- By hand: edit `repos."<slug>"` or `projects.<name>` in `config.toml` (`status` shows each setting
  with its `from`).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`;
  `$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`, so serve's tick at a
  restart dispatches nothing.
- `E=.evidence/<issue>/settings`; `$C state > "$E/state.before.txt"`.

- **On the page.** Run `$C page --evidence "$E/01-page" --click "region=Switches" --expect "Settings"`. The snapshot has
  `region "Settings"` with `group "Implementer"` (`text: Implementer default`, `combobox
  "Implementer Harness"` on `claude`), `group "Reviewer"` (`text: Reviewer default`, `codex`),
  `text: Base default` and `textbox "Base"`, `combobox "Project"`; `text: Room default` beside
  `spinbutton "Room"`, and `text: Review default` beside `switch "Review"`.
- **Reviewer on the page.** Run `$C page --evidence "$E/02-reviewer" --click "combobox=Reviewer Harness" --press ArrowDown --press Enter --expect "Reviewer Use the default"`.
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"reviewer":{"harness":"opencode","model":null,"effort":null}} -> 200`;
  the snapshot has `opencode [selected]` and `button "Use the default Reviewer"`;
  `cp "$CONFIG_DIR/config.toml" "$E/02-reviewer.config.toml"` has `reviewer = { harness = "opencode" }`.
- **Survives a restart.** Run `$C restart > "$E/03-restart.txt"` and `$C doctor`, which passes on the
  new pid. `$C page --evidence "$E/04-after-restart" --expect "Reviewer Use the default"`: `combobox
  "Reviewer Harness"` on `opencode`, `button "Use the default Reviewer"`. `$C run --evidence
  "$E/05-status" -- status --json`: `repos[0].reviewer` is
  `{"from":"repo","value":{"effort":null,"harness":"opencode","model":null}}`.
- **Use the default.** Run `$C page --evidence "$E/06-undo" --click "button=Use the default Reviewer" --expect "Reviewer default"`.
  `.requests.txt` has `PATCH ... {"reviewer":null} -> 200`; `codex [selected]`, `text: Reviewer
  default`; `config.toml` has no `reviewer` line.
- **Base.** Run `$C page --evidence "$E/07-base" --click "textbox=Base" --type dev --press Enter --expect "Base Use the default"`.
  `PATCH ... {"base":"dev"} -> 200`; `config.toml` has `base = "dev"`.
- **Join a Project.** Run `$C page --evidence "$E/08-join" --click "combobox=Project" --type verify --press Enter --expect "Leave verify"`.
  `PATCH ... {"project":"verify"} -> 200`, then `GET /api/status`; `config.toml` has
  `project = "verify"`.
- **The Project's defaults.** Run `$C http --evidence "$E/09-project" PATCH /api/project/verify '{"room":2,"base":"main","switches":{"review":false}}'`.
  HTTP `200`, `{"defaults":{"base":"main","room":2,"switches":{"review":false}},"name":"verify"}`;
  `config.toml` gains `[projects.verify]` with those three. `$C page --evidence "$E/10-page-project" --click "region=Switches" --expect "Use the Project's"`:
  `text: Room project`, `spinbutton "Room": "2"`, `text: Review project` with `switch "Review"`
  unchecked, `button "Use the Project's Base"` (the Repo's `dev` wins over the Project's `main`).
- **Use the Project's.** Run `$C page --evidence "$E/11-undo-to-project" --click "button=Use the Project's Base" --expect "Base project"`.
  `PATCH ... {"base":null} -> 200`; `text: Base project`, `textbox "Base": main`; `config.toml`'s
  Repo has no `base` line.
- **Emptied.** Run `$C page --evidence "$E/11b-empty-base" --click "textbox=Base" --press Control+a --press Backspace --press Enter --expect "Base project"`.
  `PATCH ... {"base":null} -> 200`; the field shows the Project's again, `textbox "Base": main`.
- **Leave it.** Run `$C page --evidence "$E/12-leave" --click "button=Leave verify" --gone "Leave verify"`.
  `PATCH ... {"project":null} -> 200`; `text: Room default`, `spinbutton "Room": "3"`;
  `config.toml`'s Repo has no `project` line, and `[projects.verify]` stays.
- **API, percent-encoded.** Run `$C http --evidence "$E/13-api" PATCH /api/repo/verify%2Ffixture '{"implementer":{"harness":"codex","model":"gpt-5"},"room":4,"switches":{"stack":false}}'`.
  HTTP `200`; `slug` `verify/fixture`, `implementer` `{"from":"repo","value":{"effort":null,"harness":"codex","model":"gpt-5"}}`,
  `room` `{"from":"repo","value":4}`, `switches.stack` `{"from":"repo","value":false}`, and
  `reviewer` `{"from":"default","value":{"harness":"claude",...}}` (another Harness than codex).
- **Refusals.** `cp "$CONFIG_DIR/config.toml" "$E/refusals.before.toml"`. On `/api/repo/verify/fixture`,
  each HTTP `400` (`14` to `19`): `'{"rom":2}'` `` `rom` is not a setting the page sets ``, help
  `Settings: implementer, reviewer, room, base, project, switches; null takes the Project's or the
  default`; `'{"reviewer":{"harness":"pi"}}'` `` unknown Harness `pi` ``, help `Valid Harnesses:
  claude, codex, opencode`; `'{"implementer":{"harness":"claude","model":"gpt-5"}}'` `` unknown
  model `gpt-5` for claude ``; `'{"base":""}'` `base is a name, not ""`; `'{"switches":{"review":"no"}}'`
  `review is true or false, not "no"`; `'{"room":0}'` `room is a whole number of at least 1, not 0`.
  `PATCH /api/project/verify '{"project":"x"}'` (`20`): `400`, `` `project` is not a setting the
  page sets ``. `PATCH /api/project/nope '{"room":2}'` (`21`): `409`, `nope is not a Project`,
  help `Projects: verify, verify/fixture`. `PATCH /api/repo/other/repo '{"room":2}'` (`22`): `409`,
  `other/repo is not a configured Repo`. `cmp "$E/refusals.before.toml" "$CONFIG_DIR/config.toml"`: the same.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- `restart` ticks once, as `launch` does: with Dispatch on, every Ready issue is dispatched and
  fails in the run. Turn Dispatch off first.
- A select is driven by clicking it, then `ArrowDown` and `Enter`: the next option. The Harnesses
  are listed claude, codex, opencode, and the Reviewer starts on codex, so ArrowDown is opencode.
- A Repo names a Project before the Project has defaults: `PATCH /api/project/<name>` refuses a
  name no Repo names and no `[projects.<name>]` holds. A Repo naming none is its own Project, named
  by its slug, so `PATCH /api/project/verify%2Ffixture` sets that one.
- Dispatch turned off is the Repo's own switch, so `button "Use the default Dispatch"` is on the
  page throughout: expect a row's own text (`Reviewer Use the default`, `Base project`), never a
  bare `Use the default`.
- A launch is replaced whole: picking a Harness sends model and Effort null, the Harness's own.
- The PATCH writes an inline table with toml_edit's spacing (`{ dispatch = false , stack = false }`):
  assert on the values, not the spacing.
