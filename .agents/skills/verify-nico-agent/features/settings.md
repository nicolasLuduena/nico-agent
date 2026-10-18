# Settings

Each Repo's panel shows its settings beside its switches: the Implementer and Reviewer launches
(Harness, model, Effort), Base and Project, folded to one line (`Implementer <launch>`) under Room
and Switches. Each shows its effective value, with a chip `from Project` or `default` while the
Repo does not set it, `set here` and a × once it does. A change on the page shows `Saving…`, then
`Saved`, in the chip's place and writes the Repo's own key to `config.toml` through `PATCH
/api/repo/<slug>`, keeping the rest of the file as written; the × ("Use the Project's" or "Use the
default") beside a value the Repo sets removes it. `PATCH /api/project/<name>` sets a Project's
defaults the same way. A refusal shows its error and help, and writes nothing. What the page wrote is what serve shows after a restart.

## Sub-features

- `settings-page` the Repo's `region "Settings"`, folded to `Settings Implementer <launch>`: `group "Implementer"` and `group "Reviewer"`, each with `combobox "<Role> Harness"`, `"<Role> model"` and `"<Role> Effort"` (a `textbox` each where the Harness lists none: codex, opencode); `textbox "Base"`; `combobox "Project"`; each chipped `default` or `from Project` in the snapshot while the Repo does not set it, `set here` once it does.
- `settings-launch` a Harness picked on the page sends `{"reviewer": {harness, model: null, effort: null}}`, shows `Saved`, and writes `reviewer = { harness = "<name>" }`.
- `settings-restart` a launch set on the page shows the same after serve restarts.
- `settings-undo` `button "Use the default <Setting>"` (or `Use the Project's <Setting>`), the × after `set here`, sends `{<key>: null}`, `{"switches": {<name>: null}}` for a switch, and removes the Repo's own line.
- `settings-base` a Base typed and entered writes `base = "<name>"`; emptied, it is removed and the field shows what takes its place.
- `settings-project` a Project typed in `combobox "Project"` writes `project = "<name>"`, the Repo then takes that Project's defaults, chipped `from Project`; `button "Leave <name>"` removes it.
- `settings-api` `PATCH /api/repo/<slug>` with any of `implementer`, `reviewer`, `room`, `base`, `project`, `switches` writes only those and answers `{slug, <each setting>: {value, from}}`; a percent-encoded slug reaches its Repo.
- `settings-project-api` `PATCH /api/project/<name>` with the same keys but `project` writes `[projects.<name>]` and answers `{name, defaults}`.
- `settings-retired` a `config.toml` an earlier build wrote, holding `[wiki]`, a Repo's `libraries` and `wiki` switch and a Harness's `mcp_args`, still loads: serve restarts on it, the Repo's other settings show as written, and the next write drops those keys.
- `settings-refused` an unknown key, a Harness not configured, a model the Harness does not take, an empty Base, a Switch not boolean: 400 `{error, help}`; a Repo or Project not configured: 409; nothing written.

## How to get to it (user POV)

- Open the page, pick a Repo's Project in the rail, open `Repos`, then `Settings` (folded to `Implementer <launch>`), and change
  a select, or type in `Base` or `Project` and press Enter (or leave the field; Escape puts it back).
- Press the × after `set here` (`Use the default` or `Use the Project's`) beside a setting the Repo
  sets, or `Leave <name>` under its Project.
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

- **On the page.** Run `$C page --evidence "$E/01-page" --click "button=Repos" --click "region=Room" --click "region=Switches" --click "region=Settings" --expect "Each Dispatch's Reviewer runs on another Harness"`. The snapshot has
  `region "Settings"` (`text: "Settings Implementer claude Reviewer: not the Implementer's"`) with `group "Implementer"` (`strong: Implementer`, `text: default`, `combobox
  "Implementer Harness"` on `claude`), `group "Reviewer"` (`text: default`, `combobox
  "Reviewer Harness"` on `option "Not the Implementer's" [selected]`, `combobox "Reviewer model" [disabled]` and
  `combobox "Reviewer Effort" [disabled]` on `default`, and `paragraph: "Each Dispatch's Reviewer runs on another
  Harness than its Implementer's: codex for claude, claude for codex and opencode."`),
  `text: Base`, `text: default` and `textbox "Base"`, `combobox "Project"`; `text: default` beside
  `spinbutton "Room"`, and `text: default` beside `switch "Review"`.
- **Reviewer on the page.** Run `$C page --evidence "$E/02-reviewer" --click "button=Repos" --click "region=Settings" --click "combobox=Reviewer Harness" --press ArrowDown --press Enter --expect "Saved" --expect "Reviewer set here"`.
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"reviewer":{"harness":"claude","model":null,"effort":null}} -> 200`
  (ArrowDown leaves `Not the Implementer's` for the first Harness);
  the snapshot has `claude [selected]` and `text: set here` with `button "Use the default Reviewer"`;
  `cp "$CONFIG_DIR/config.toml" "$E/02-reviewer.config.toml"` has `reviewer = { harness = "claude" }`.
- **Survives a restart.** Run `$C restart > "$E/03-restart.txt"` and `$C doctor`, which passes on the
  new pid. `$C page --evidence "$E/04-after-restart" --click "button=Repos" --click "region=Settings" --expect "Reviewer set here"`: `combobox
  "Reviewer Harness"` on `claude`, `button "Use the default Reviewer"`. `$C run --evidence
  "$E/05-status" -- status --json`: `repos[0].reviewer` is
  `{"from":"repo","value":{"effort":null,"harness":"claude","model":null}}`.
- **Use the default.** Run `$C page --evidence "$E/06-undo" --click "button=Repos" --click "region=Settings" --click "button=Use the default Reviewer" --expect "Reviewer default"`.
  `.requests.txt` has `PATCH ... {"reviewer":null} -> 200`; `Not the Implementer's [selected]`, `strong: Reviewer`
  and `text: default`; `config.toml` has no `reviewer` line.
- **Base.** Run `$C page --evidence "$E/07-base" --click "button=Repos" --click "region=Settings" --click "textbox=Base" --type dev --press Enter --expect "Saved" --expect "Base set here"`.
  `PATCH ... {"base":"dev"} -> 200`; `config.toml` has `base = "dev"`.
- **Join a Project.** Run `$C page --evidence "$E/08-join" --click "button=Repos" --within "region=verify/fixture" --click "region=Settings" --click "combobox=Project" --type verify --press Enter --expect "Leave verify"`.
  `PATCH ... {"project":"verify"} -> 200`, then `GET /api/status` and `GET /api/map/verify`; the rail's
  `link "verify"` is now `[current=page]`, its Project's, with `region "verify"` (the Project's defaults)
  above `region "verify/fixture"`; `config.toml` has `project = "verify"`.
- **The Project's defaults.** Run `$C http --evidence "$E/09-project" PATCH /api/project/verify '{"room":2,"base":"main","switches":{"review":false}}'`.
  HTTP `200`, `name` `verify`, `defaults` `{"base":"main","room":2,"switches":{"review":false}}`
  and each of the Project's settings as status shows it, `room` `{"from":"project","value":2}`;
  `config.toml` gains `[projects.verify]` with those three. `$C page --evidence "$E/10-page-project" --click "button=Repos" --within "region=verify/fixture" --click "region=Room" --click "region=Switches" --click "region=Settings" --expect "2 · 0 in flight"`:
  `text: from Project` beside `spinbutton "Room": "2"`, `text: from Project` beside `switch "Review"`
  unchecked, `text: set here` with `button "Use the Project's Base"` (the Repo's `dev` wins over the Project's `main`).
- **Use the Project's.** Run `$C page --evidence "$E/11-undo-to-project" --click "button=Repos" --within "region=verify/fixture" --click "region=Settings" --click "button=Use the Project's Base" --expect "Base from Project"`.
  `PATCH ... {"base":null} -> 200`; `text: from Project`, `textbox "Base": main`; `config.toml`'s
  Repo has no `base` line.
- **Emptied.** Run `$C page --evidence "$E/11b-empty-base" --click "button=Repos" --within "region=verify/fixture" --click "region=Settings" --click "textbox=Base" --press Control+a --press Backspace --press Enter --expect "Base from Project"`.
  `PATCH ... {"base":null} -> 200`; the field shows the Project's again, `textbox "Base": main`.
- **Leave it.** Run `$C page --evidence "$E/12-leave" --click "button=Repos" --within "region=verify/fixture" --click "region=Settings" --click "button=Leave verify" --gone "Leave verify" --click "region=Room" --expect "3 · 0 in flight"`.
  `PATCH ... {"project":null} -> 200`; `link "verify/fixture" [current=page]` again, no `link "verify"`
  (it has no Repo left), `text: default` beside `spinbutton "Room": "3"`;
  `config.toml`'s Repo has no `project` line, and `[projects.verify]` stays.
- **API, percent-encoded.** Run `$C http --evidence "$E/13-api" PATCH /api/repo/verify%2Ffixture '{"implementer":{"harness":"codex","model":"gpt-5"},"room":4,"switches":{"stack":false}}'`.
  HTTP `200`; `slug` `verify/fixture`, `implementer` `{"from":"repo","value":{"effort":null,"harness":"codex","model":"gpt-5"}}`,
  `room` `{"from":"repo","value":4}`, `switches.stack` `{"from":"repo","value":false}`, and
  `reviewer` `{"from":"default","value":{"harness":"claude",...}}` (another Harness than codex).
- **Refusals.** `cp "$CONFIG_DIR/config.toml" "$E/refusals.before.toml"`. On `/api/repo/verify/fixture`,
  each HTTP `400` (`14` to `19`): `'{"rom":2}'` `` `rom` is not a setting the page sets ``, help
  `Settings: implementer, reviewer, room, base, project, install, switches; null takes
  the Project's or the default`; `'{"reviewer":{"harness":"pi"}}'` `` unknown Harness `pi` ``, help `Valid Harnesses:
  claude, codex, opencode`; `'{"implementer":{"harness":"claude","model":"gpt-5"}}'` `` unknown
  model `gpt-5` for claude ``; `'{"base":""}'` `base is a name, not ""`; `'{"switches":{"review":"no"}}'`
  `review is true or false, not "no"`; `'{"room":0}'` `room is a whole number of at least 1, not 0`.
  `PATCH /api/project/verify '{"project":"x"}'` (`20`): `400`, `` `project` is not a setting the
  page sets ``. `PATCH /api/project/nope '{"room":2}'` (`21`): `409`, `nope is not a Project`,
  help `Projects: verify, verify/fixture`. `PATCH /api/repo/other/repo '{"room":2}'` (`22`): `409`,
  `other/repo is not a configured Repo`. `cmp "$E/refusals.before.toml" "$CONFIG_DIR/config.toml"`: the same.
- **An earlier build's config.** Append a Repo and keys as the build before #429 wrote them:
  `printf '\n[repos."verify/second"]\npath = "%s"\nroom = 2\nswitches = { dispatch = false, review = false, wiki = true }\nlibraries = [{ repo = "acme/kit", tag = "v1" }]\n\n[wiki]\nhour = 4 # after the scan\nlibraries = [{ repo = "acme/ui", tag = "v2" }]\n\n[harnesses.claude]\nmcp_args = ["--mcp-config", "{mcpArgs}"]\n' "$SECOND_CLONE" >> "$CONFIG_DIR/config.toml"`.
  `$C restart > "$E/23-retired-restart.txt"` and `$C doctor` pass. `$C run --evidence "$E/24-retired-status" -- status --json`:
  `repos[1]` is `verify/second` with `room` `{"from":"repo","value":2}`, `switches.review` `{"from":"repo","value":false}`,
  no `switches.wiki` and no `libraries`. `$C http --evidence "$E/25-retired-write" PATCH /api/repo/verify/second '{"room":3}'`:
  HTTP `200`; `cp "$CONFIG_DIR/config.toml" "$E/25-retired-write.config.toml"` has `room = 3` and `switches = { dispatch = false, review = false}`
  under `verify/second`, and no `[wiki]`, `libraries` or `mcp_args` (`[harnesses.claude]` stays, empty).
- **Proof.** `$C state > "$E/state.after.txt"` and the diff; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- The Readiness checks failing in the run (no implement skill, the stubbed `ghbot`, `herdr`) are one `Check`
  notice in the band between the views and the map, in the page's flow: it covers no control.
- `restart` ticks once, as `launch` does: with Dispatch on, every Ready issue is dispatched and
  fails in the run. Turn Dispatch off first.
- A select is driven by clicking it, then `ArrowDown` and `Enter`: the next option. The Harnesses
  are listed claude, codex, opencode; the Reviewer's starts on `Not the Implementer's`, the rule serve
  follows while nothing sets one, so ArrowDown is claude.
- `--expect` finds visible text, not an ARIA name: `combobox "Reviewer Harness"` is labelled `Harness`
  under `Reviewer`, so expect the line under the Reviewer's picker or the folded line instead.
- A Repo names a Project before the Project has defaults: `PATCH /api/project/<name>` refuses a
  name no Repo names and no `[projects.<name>]` holds. A Repo naming none is its own Project, named
  by its slug, so `PATCH /api/project/verify%2Ffixture` sets that one.
- Dispatch turned off is the Repo's own switch, so `set here` is on the page throughout: expect a
  row's own text (`Reviewer set here`, `Base from Project`), never a bare `set here`. The × is a
  button named `Use the default <Setting>` with no text: `--click` it, never `--expect` it.
- Room, Switches and Settings are each folded to one line, in each panel and each new browser:
  `--click "region=<Section>"` opens it (`--within "region=<slug>"` first for a Repo's on a
  Project's page). `--expect` is page-wide and takes the first match, which may sit in a folded
  section (the Project's `Base set here`) and never show: expect text only the open one holds.
- `Saved` shows for 2 seconds after a save, then the chip again: expect it right after the action.
- On a Project its defaults come first, with the same control names as a Repo's: a bare
  `--click` reaches the Project's. Scope a Repo's with `--within "region=<slug>"`.
- A launch is replaced whole: picking a Harness sends model and Effort null, the Harness's own.
- The PATCH writes an inline table with toml_edit's spacing (`{ dispatch = false , stack = false }`):
  assert on the values, not the spacing.
