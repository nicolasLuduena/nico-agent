# Set up Wikis from the page

A Project tab's Wiki view has `button "Wiki settings"` in its header, there before any Wiki is
built too. It opens a bottom sheet titled "Settings for every Wiki", saying these apply to every
Wiki, holding what `[wiki]` in `config.toml` sets: the launch each part is asked of (Harness,
model, Effort), the hour the loop checks each Repo's Wiki, a build's `calls`, `depth` and calls at
once (`concurrency`), and the embedding model. The Harness is a select of those a Wiki builds on
(claude, codex, opencode); the model and the Effort are selects where the Harness lists its models
and Efforts (claude) and text fields where it takes any (codex, opencode). Each change is written
on the spot through `PATCH /api/wiki/settings`, which edits `[wiki]` keeping the user's comments
and answers every Wiki's settings; `GET /api/status` carries them as `wiki_settings`. A refusal
shows inline in the sheet, and the field goes back to what is set.

## Sub-features

- `wiki-settings-sheet` `button "Wiki settings"` opens `region "Settings for every Wiki"` with `group "Launch"` (`combobox "Harness"`, then `combobox` or `textbox` `"Model"` and `"Effort"`), `group "Budget"` (`spinbutton "Hour"`, `"Calls"`, `"Depth"`, `"Calls at once"`) and `textbox "Embedding model"`; focus goes to its title; `button "Close"` or Escape shuts it.
- `wiki-settings-model` on opencode or codex the model is `textbox "Model"` (placeholder `the Harness's default`); on claude `combobox "Model"` with `default`, `fable`, `opus`, `sonnet`, `haiku`, and the Effort a `combobox` of claude's Efforts.
- `wiki-settings-write` a change sends `PATCH /api/wiki/settings` with that setting alone (a Harness picked sends `{launch: {harness, model: null, effort: null}}`); `config.toml`'s `[wiki]` gets it with the comments around it kept; nothing else is written, and nothing outside is called.
- `wiki-settings-refused` a bad value is a `400` `{error, help}` and writes nothing: on the page an `alert` under the sheet (`hour is an hour from 0 to 23, not 24`) and the field back to what is set; by `PATCH`, an unknown Harness is ``unknown Harness `pi` `` with `Harnesses that build a Wiki: claude, codex, opencode`, a key it does not set `` `ollama` is not a setting the page sets ``.
- `wiki-settings-kept` after `restart`, `GET /api/status`'s `wiki_settings` and the sheet show what was saved.
- `wiki-build-harness` a real `wiki build` on claude, or on codex, set from the sheet, builds the Wiki into the Bucket (outside a run's stubs: see Gotchas).

## How to get to it (user POV)

- Click `Wiki` on a Project's tab, then `Wiki settings`; change a field.
- Ask serve: `PATCH /api/wiki/settings {hour, launch, calls, depth, concurrency, embed_model}`, null
  taking the default; `GET /api/status`'s `wiki_settings`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-settings`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project shop --json`.
- As the user writes it: `printf '\n# Wikis overnight, on the cheap model\n[wiki]\nhour = 3 # after the scan\n' >> "$CONFIG_DIR/config.toml"`.
- `$C state > "$E/state.before.txt"`.

- **The sheet.** `$C page --evidence "$E/01-sheet" --hash "#shop/wiki" --click "button=Wiki settings" --expect "These apply to every Wiki"`:
  `region "Settings for every Wiki"`, `combobox "Harness"` on `opencode`, `textbox "Model"`
  `opencode-go/deepseek-v4.1-flash`, `textbox "Effort"` empty, `spinbutton "Hour"` `3`, `"Calls"`
  `48`, `"Depth"` `7`, `"Calls at once"` `4`, `textbox "Embedding model"` `nomic-embed-text`; focus
  on its title.
- **claude.** `$C page --evidence "$E/02-claude" --hash "#shop/wiki" --click "button=Wiki settings" --click "combobox=Harness" --press ArrowUp --press ArrowUp --press Enter --expect "These apply to every Wiki"`:
  `.requests.txt` has `PATCH /api/wiki/settings {"launch":{"harness":"claude","model":null,"effort":null}} -> 200`;
  `combobox "Model"` (`default` selected, then `fable`, `opus`, `sonnet`, `haiku`) and `combobox "Effort"`.
- **A model and a budget.** `$C page --evidence "$E/03-model-and-calls" --hash "#shop/wiki" --click "button=Wiki settings" --click "combobox=Model" --press ArrowDown --press ArrowDown --press ArrowDown --press Enter --click "spinbutton=Calls" --press Control+A --type 20 --press Tab --expect "These apply to every Wiki"`:
  two PATCHes, `{"launch":{...,"model":"sonnet"}}` and `{"calls":20}`, each `200`; `sonnet` selected, `Calls` `20`.
- **Refused on the page.** `$C page --evidence "$E/04-refused" --hash "#shop/wiki" --click "button=Wiki settings" --click "spinbutton=Hour" --press Control+A --type 24 --press Enter --expect "hour is an hour from 0 to 23"`:
  `PATCH ... {"hour":24} -> 400`, an `alert` with `hour is an hour from 0 to 23, not 24` and its help, `Hour` back to `3`.
- **codex, free text.** `$C page --evidence "$E/05-codex" --hash "#shop/wiki" --click "button=Wiki settings" --click "combobox=Harness" --press ArrowDown --press Enter --click "textbox=Model" --type gpt-5.5 --press Enter --expect "These apply to every Wiki"`:
  `PATCH ... {"launch":{"harness":"codex","model":null,"effort":null}}` then `{"launch":{...,"model":"gpt-5.5"}}`, both `200`; `textbox "Model"` `gpt-5.5`.
- **Refused by PATCH.** `$C http --evidence "$E/06-unknown-harness" PATCH /api/wiki/settings '{"launch": {"harness": "pi"}}'`
  is `400` ``{"error":"unknown Harness `pi`","help":["Harnesses that build a Wiki: claude, codex, opencode"]}``;
  `$C http --evidence "$E/07-no-such-setting" PATCH /api/wiki/settings '{"ollama": "http://elsewhere"}'` is `400`.
- **Written.** `$C state > "$E/state.after.txt"`; the diff from `state.before.txt` is `config.toml`
  alone, whose `[wiki]` reads `# Wikis overnight, on the cheap model`, `[wiki]`, `hour = 3 # after
  the scan`, `launch = { harness = "codex", model = "gpt-5.5" }`, `calls = 20`; no outside call.
- **Kept.** `$C restart`, then `$C http --evidence "$E/08-status" GET /api/status`: `wiki_settings`
  with `launch` codex `gpt-5.5`, `calls` `20`, `hour` `3` and `harnesses` claude (its models and
  Efforts), codex and opencode (null); `$C page --evidence "$E/09-after-restart-phone" --width 390 --hash "#shop/wiki" --click "button=Wiki settings" --expect "These apply to every Wiki"`
  shows them, the page 390px wide; `--click button=Dark` first for dark. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- A Harness picked starts on its own defaults: the model and Effort are sent null with it.
- The run stubs `opencode2` only. A real build on claude or codex is driven by hand in the run's
  scratch HOME, with the environment `control-nico-agent` gives the binary (`env -i`, stubs first
  on `PATH`) plus `CLAUDE_CONFIG_DIR=$HOME/.claude` or `CODEX_HOME=$HOME/.codex` of the real HOME
  for their credentials: set the launch through the sheet or `PATCH`, then run
  `$NICO_AGENT_BIN wiki build verify/fixture --json` that way. Its call is not in `outside.log`:
  put a script first on `PATH` that logs its arguments and runs the real one to record it; the
  Bucket's commit and `wikis.json` prove the build. codex runs with `--ignore-user-config`, so its
  default model, not the user's, unless the launch names one. codex's build writes its answer schema to
  `wiki/answer.schema.json` in the config dir.
- `curl` is offline in a run, so such a build says it could not embed the Wiki, and is still built.
