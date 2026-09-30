# Harness launch and skill invocation spike

Verified on 2026-09-30 for [issue #2](https://github.com/nicolasLuduena/nico-agent/issues/2), against [ADR-0005](../adr/0005-harness-launch-modes.md) and the parent spec's Further Notes. This is a research result and proposed configuration, not a change to the application's defaults.

## Environment and method

Installed versions were herdr 0.8.2, Claude Code 2.1.284, Codex 0.159.0, and OpenCode 2.0.19. `opencode2` resolves to the local `@opencode/cli` installation and uses the OpenCode v2 full TUI. Results depend on these versions, available accounts, and inherited user settings.

A disposable git repository at `/tmp/nico-harness-spike/repo` contained the same `spike-marker/SKILL.md` under `.claude/skills`, `.agents/skills`, and `.opencode/skills`. Its instructions were to write `marker.txt` containing `SKILL_RESOLVED_2`, reply with model and Effort, and do nothing else. Each Harness got a separate herdr worktree workspace with a tab named `probe`. Worktrees were created with:

```sh
herdr worktree create --cwd /tmp/nico-harness-spike/repo \
  --branch spike-<harness> --path /tmp/nico-harness-spike/<harness> \
  --label nico-spike-<harness> --no-focus
```

Opaque IDs came from the responses. Claude used `w2W:p1`, Codex `w2X:p1`, and opencode2 `w2Y:p1`. Creation also opened the scratch repository workspace `w2V`. The original application workspace was never a cleanup target.

Evidence came from CLI help/version output, `herdr agent start/get/read`, `herdr pane read/process-info`, and actual marker files. UI model/Effort displays are stronger evidence than an agent's self-report. Claude claimed low effort despite its UI showing high; Codex and OpenCode could not reliably report Effort themselves.

## Results

| Harness | Skill invocation | Model and Effort observed in UI | Permission mode |
| --- | --- | --- | --- |
| claude | `/spike-marker` via `agent prompt` loaded the skill and wrote the marker | Sonnet 5.5, high | Bypass permissions enabled after a first-run warning |
| codex | `$spike-marker` loaded `.agents/skills/spike-marker/SKILL.md` and wrote the marker after a separate Enter | GPT-6.1-Sol, low | Full Access / YOLO mode |
| opencode2 | Typed `@spike` offered a skill completion. Selecting it produced a `skill spike-marker` attachment and wrote the marker | DeepSeek V4.1 Flash, OpenCode Go, max | `--auto` wrote without an approval |

### Claude

The successful launch was:

```sh
herdr agent start spike-claude --kind claude --pane <pane> -- \
  --model sonnet --effort high --dangerously-skip-permissions
herdr agent prompt spike-claude '/spike-marker' --wait --timeout 45000
```

`agent start` first returned `agent_not_ready` because Claude was blocked at its bypass-permissions warning. After the user authorized acceptance, Enter dismissed it. The UI showed `Sonnet 5.5 with high effort` and `bypass permissions on`. The slash invocation displayed `Write(marker.txt)`, and the file contained the expected literal. The agent reached herdr `done`.

Installed help documents `--model`, `--effort`, `--dangerously-skip-permissions`, and `/skill-name` resolution. Do not assume the bypass flag eliminates first-run prompts. This spike verifies the `sonnet`/`high` combination, not every alias or Effort listed in help.

### Codex

The successful launch was:

```sh
herdr agent start spike-codex --kind codex --pane <pane> -- \
  -m gpt-6.1-sol -c model_reasoning_effort=low \
  -c 'projects={"/tmp/nico-harness-spike/repo"={trust_level="trusted"}}' \
  --dangerously-bypass-approvals-and-sandbox
herdr agent prompt spike-codex '$spike-marker' --wait --timeout 45000
```

The prompt returned `agent_prompt_stalled`, with text still in the editor and no observed state change within five seconds. `herdr agent send-keys spike-codex enter` submitted it. The UI then showed an explicit skill read, a shell write, `GPT-6.1-Sol low`, and `Full Access`; the marker matched. This verifies skill resolution from literal pasted `$skill` once submitted, but the installed herdr prompt submission was unreliable.

An earlier launch with `-m gpt-6.1` displayed that model and low effort but failed on its first request with an account-specific unsupported-model error. `gpt-6.1-sol` came from the local Codex model catalog and completed the task. Discover account-supported IDs; do not derive them from display names.

The earlier `-a never -s workspace-write` launch was accepted and displayed low effort, but its unsupported model prevented a successful write test. Installed help confirms these flags and the stronger bypass flag. The per-launch `projects` override avoided a trust prompt without editing the user's Codex config.

### OpenCode v2 model and Effort

The full TUI has no model/Effort flags. `run --model` is a different entry point and is not a substitute for this launch mode.

The first launch used:

```sh
OPENCODE_CONFIG_CONTENT='{"model":"openai/gpt-6.1#low"}' \
  opencode2 --standalone --auto
```

The UI instead selected the inherited Build-agent model, DeepSeek V4.1 Flash, with max Effort. A top-level default model alone does not override the active agent's model.

The corrected, verified launch used:

```sh
XDG_STATE_HOME=/tmp/nico-harness-spike/state \
OPENCODE_CONFIG_CONTENT='{"model":"opencode-go/deepseek-v4.1-flash#high","agents":{"build":{"model":"opencode-go/deepseek-v4.1-flash#high"}}}' \
  opencode2 --standalone --auto
herdr agent rename <pane> spike-opencode2
```

With no saved variant for that model, the UI displayed `high`. After writing the following file and relaunching with the same conflicting `#high` config, it displayed `max`:

```json
{
  "recent": [],
  "favorite": [],
  "variant": {
    "opencode-go/deepseek-v4.1-flash": "max"
  }
}
```

The file was `/tmp/nico-harness-spike/state/opencode/model.json`. Without `XDG_STATE_HOME`, the installed resolver uses `~/.local/state/opencode/model.json`. The live test changed an isolated equivalent, not the user's shared preference file. It verifies that writing the chosen saved variant controls displayed Effort and takes precedence over both agent and top-level config. No claim is made about a provider's internal reasoning budget.

Embedded installed source confirms variant precedence: saved `variant[provider/model]`, then the matching agent model variant, then the matching default model variant. A variant must exist in the model catalog. `recent` and `favorite` contain `{providerID, modelID}` entries; `variant` keys are full `provider/model` strings. `"default"` serializes no variant. Preserve unrelated preferences when updating a shared file.

ADR-0005 deliberately specifies writing the user's saved default. This spike establishes that mechanism, but its test uses isolated state to avoid changing concurrent user sessions. Isolation is a possible future ADR change, not an implemented replacement for the current decision.

### OpenCode v2 skills and herdr

Herdr recognized the process as `opencode`, without an `opencode2` kind. `agent rename` succeeded and reported idle. A plain `agent prompt '@spike-marker' --wait` returned `agent_prompt_stalled`; the text remained in the editor. A separate Enter started work and the marker appeared. Herdr rejected a long alternate-screen read while it was working with `agent_not_idle`; a visible read showed the active tool calls. It later reported `done`, the background equivalent of idle.

Typing `@spike` with `herdr pane send-text` offered `@spike-marker` labelled `skill`, alongside file matches. Selecting the skill with Enter and then submitting produced a structured `skill spike-marker` attachment. That turn wrote the marker and completed in about seven seconds.

These are distinct behaviors. The installed TUI's paste handler inserts text; selecting a completion creates a skill reference. Its submit handler forwards structured skills, and the server expands those references. Plain pasted `@skill` can lead the model to load the skill, as it did here, but does not itself guarantee attachment. The proposed `$` sigil is not the TUI skill-completion sigil. Do not treat changing `$` to `@` as proof of deterministic skill dispatch.

Prompt submission also varies: the later ordinary write probe returned `agent_prompted` and a settled state before the actual tool work completed. `--wait` tracks lifecycle transitions, not a specific turn. Confirm the expected output and settled state; a successful prompt response alone is insufficient.

A final permission probe omitted `--auto`, set `OPENCODE_CLI_CONFIG_CONTENT='{"session":{"permissions":"prompt"}}'`, and set both top-level and `agents.build.permissions` to `[{"action":"*","resource":"*","effect":"ask"}]`. A dummy write displayed `Permission required` for `permission-check.txt`; herdr reported `blocked`, with state-change sequence 141. The approval was not accepted, and no file was written. Combined with the working read and idle/done observations, all requested lifecycle states were observed.

Omitting `--auto` alone is insufficient when the user's CLI config already selects autoaccept. The earlier probe without the flag still displayed `Build auto` and wrote the dummy file. CLI permission mode comes from a separate config document, overridden through `OPENCODE_CLI_CONFIG_CONTENT`; this differs from `OPENCODE_CONFIG_CONTENT`. Saved project allow rules can also affect approval decisions.

Installed help describes `--auto` as approving permissions that are not explicitly denied. Explicit denies still apply. V2 config uses an ordered plural `permissions` array of `{action, resource, effect}`, not the v1 singular permission object.

## Proposed defaults

The following recipes are version-specific recommendations for the next implementation. Models and valid Effort levels should still come from discovery or explicit configuration.

| Harness | Launch mode | Kind or command | Sigil | Model args | Effort args | Extra args |
| --- | --- | --- | --- | --- | --- | --- |
| claude | `herdr-kind` | `claude` | `/` | `--model {model}` | `--effort {effort}` | `--dangerously-skip-permissions` for explicitly unattended dispatches |
| codex | `herdr-kind` | `codex` | `$` | `-m {model}` | `-c model_reasoning_effort={effort}` | `--dangerously-bypass-approvals-and-sandbox` for explicitly unattended dispatches |
| opencode2 | `pane-command` | configured absolute `opencode2` path | `@` | `OPENCODE_CONFIG_CONTENT`, both `model` and `agents.build.model` | saved `model.json.variant[provider/model]` | `--standalone --auto` for explicitly unattended dispatches |

Keep Codex's session-local Repo trust override. Example working selections are Claude `sonnet`/`high`, Codex `gpt-6.1-sol`/`low`, and OpenCode `opencode-go/deepseek-v4.1-flash`/`max`. These examples are not universal model defaults.

For OpenCode, render model/Effort into both model config entries, write the chosen saved variant before launch as ADR-0005 requires, wait for live detection, then rename the detected agent. The model entries accept either `provider/model#variant` or `{providerID, model, variant}`. Herdr detection works, but deterministic skill attachment and prompt submission need explicit handling before this launch mode is considered ready for unattended dispatch. Do not automatically repeat stalled prompts; inspect whether text was submitted before adding another Enter.

## Primary evidence and validation

All behavioral claims above are from the disposable live probe. Syntax and source conclusions came from the installed tools, not assumptions from upstream's current branch:

- `herdr --version`, `herdr --skill`, and the `agent`, `pane`, `tab`, `workspace`, and `worktree` command-group help.
- `claude --version` and `claude --help` from the installed 2.1.284 binary.
- `codex --version`, `codex --help`, and the account's `~/.codex/models_cache.json` model IDs/Effort catalog.
- `opencode2 --version`, `opencode2 --help`, `opencode2 run --help`, and `opencode2 api --help` from 2.0.19.
- The installed `@opencode/cli` package and its Linux ELF's embedded JavaScript. Source sections `Config.ModelSelection`/`Config.Agent`, full-TUI model/variant selection, `model.json` reader/writer, prompt paste/completion/submit, `SessionPrompt.prepare`, and config virtual-document loading establish the source-based conclusions. Temporary source extracts are removed after capture; this note retains the relevant field shapes and precedence.

Typechecking, the existing 28 Harness tests, and the full suite of 142 tests passed after installing locked dependencies. No new automated test is appropriate for a documentation-only live contract spike; the marker files and UI/state observations are its behavioral checks.

## Cleanup

Removed the three probe worktrees with `herdr worktree remove --workspace <id> --force`, which closed their workspaces and stopped their agents, and closed the extra scratch-repository workspace. The scratch repository then listed only its main checkout. Deleted the two spike Codex sessions using `codex delete --force`, the four directory-matched OpenCode sessions using its session API, and Claude's scratch-project transcript directory. The OpenCode session query returned an empty list afterward. The scratch repository, isolated state, source extracts, helper scripts, and the scratch project's OpenCode snapshot were removed after review; none is part of the PR.

The user's shared OpenCode saved-variant file was read but never edited by the probes. Normal tool logs and shared database bookkeeping may retain records of the experiment; cleanup does not rewrite shared logs or delete shared databases. Thus the literal "nothing on disk" criterion cannot include those tools' normal audit history. The explicit spike files, workspaces, worktrees, and saved sessions are the cleanup targets.
