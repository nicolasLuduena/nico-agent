# Serve Wikis to agents through the MCP

`nico-agent mcp [--wiki <owner/name>]...` is an MCP server on stdio: one JSON-RPC message a line
in, one answer a line out, nothing else on stdout. It serves the built Wiki of every Repo, or of
those `--wiki` names, through five tools: `wikis`, `find_component`, `get_component`,
`read_anchor`, which reads lines at the commit the Wiki describes even after the Base has moved
on, and `ask`, which answers a question from the records closest to it by Ollama's embeddings,
through one call of the wiki model with no tools, keeping each sentence that cites only Anchors
of what was retrieved. A Wiki it does not serve, a missing Component or lines outside their file
are tool errors, and it goes on answering. It writes nothing but the embeddings `ask` makes of a
Wiki that lacks them. The user adds it to their own Claude Code with
`claude mcp add wiki -- nico-agent mcp`; the loop gives it to faux-nico and the morning agent with
their Repo's Wiki, its tools allowed on each Harness.

## Sub-features

- `mcp-handshake` `initialize` answers the version asked for (the latest it speaks, `2025-11-25`, for one it does not), `capabilities.tools`, `serverInfo` and `instructions`; `notifications/initialized` gets no answer; `tools/list` lists the five tools, each `readOnlyHint`.
- `mcp-tools` `wikis` gives each Wiki's `wiki`, `commit`, `builtAt` and `gaps`; `find_component` the matching Components' `id`, `name` and `overview`, best first; `get_component` the Component with its `interpretations`, `relationships` (`to` what it uses, `from` what uses it), `gaps`, sub-`components`, and its `files` when a leaf; `read_anchor` `{path, start, end, commit, text}`.
- `mcp-ask` with Ollama unreachable, `ask` is `isError` `search unavailable, use find_component` and calls no model; with it up, the first `ask` of a Wiki without embeddings embeds every overview and Interpretation, keeps them in `wiki/<owner>/<name>/vectors.json` in the config dir, then embeds the question; a later `ask` embeds the question alone. It answers `{answer: [{text, anchors}], records: [...]}`: each sentence cites Anchors of the Interpretations retrieved, and `records` are those it cites, each with its `component`; it answers a question whose words are not in the claim it cites.
- `mcp-base-moved` `read_anchor` reads the Wiki's commit, not `origin/<base>`, once the Base has moved.
- `mcp-errors` a Wiki not served (`--wiki` names another, no such Repo, or not built) is `isError` `no Wiki <id> is served here: ...`; lines outside the file and a file not at the commit are `isError`; an unknown tool is JSON-RPC `-32602`, an unknown method `-32601`, a batch `-32600`; `mcp` with a positional is exit `2`.
- `mcp-read-only` answering changes nothing in the config dir or the Bucket, and calls no stub but `ask`'s `curl` to Ollama.
- `mcp-claude` added to Claude Code, it is connected, its five `mcp__wiki__*` tools are listed, and `get_component` answers.
- `mcp-launches` a launch given Wikis (faux-nico's and the morning agent's, of each Repo with its `wiki` switch on and its Wiki built) carries its Harness's `mcp_args` with `{mcpArgs}` `["mcp","--wiki","<owner/name>",...]`: claude `--mcp-config` and `--allowedTools mcp__wiki__*`, codex `-c mcp_servers.wiki.command`, `.args` and `.default_tools_approval_mode="approve"`; opencode an `mcp` entry `{"wiki":{"command":["nico-agent","mcp","--wiki",...],"type":"local"}}` in its `OPENCODE_CONFIG_CONTENT`. Started for real, each calls a wiki tool with no question in its pane.

## How to get to it (user POV)

- The user adds it to their Claude Code once: `claude mcp add wiki -- nico-agent mcp` (`-s user`
  for every project); Claude Code starts it with each conversation and calls its tools.
- The user turns a Repo's `wiki` switch on; once its Wiki is built, each faux-nico of the Repo and
  each morning agent starts with the server, prompted with the commit the Wiki describes.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-mcp`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- A built Wiki: write a leaf answer to `$E/answer.json` with an overview and two `role`
  Interpretations, anchored at `README.md` lines `1`-`1` and `3`-`3`; `$C seed answer "$E/answer.json"`;
  `$C run --evidence "$E/01-wiki-build" -- wiki build verify/fixture --json` is `built` at `<commit>`, the
  fixture's `origin/main`.
- `$C state > "$E/state.before.txt"`.

Each exchange is a file of requests, a JSON object a line, on stdin:
`$C run --evidence "$E/<n>-<name>" -- mcp [--wiki ...] --json < "$E/<n>-<name>.requests.jsonl"`. Start each with
`initialize` (`protocolVersion` `2025-06-18`) and `notifications/initialized`; a tool call is
`{"jsonrpc":"2.0","id":<n>,"method":"tools/call","params":{"name":<tool>,"arguments":{...}}}`, and
its answer's `result.content[0].text` is the tool's JSON, or its error with `isError` `true`.

- **Handshake and tools.** Exchange `02-handshake`: `initialize`, `notifications/initialized`,
  `tools/list`, `wikis`, `find_component` `{"wiki":"verify/fixture","query":"fixture README"}`,
  `get_component` `{"wiki":"verify/fixture","id":"index"}`, `read_anchor`
  `{"wiki":"verify/fixture","path":"README.md","start":1,"end":1}`, `ask`
  `{"wiki":"verify/fixture","question":"What is this repo for?"}`. Exit `0`, seven lines (none for the
  notification): version `2025-06-18`; the five tools; `[{"wiki":"verify/fixture","commit":<commit>,"gaps":0,...}]`;
  `[{"id":"index",...}]`; `index` with both Interpretations, `files` `["README.md"]` and `components` `[]`;
  `{"commit":<commit>,"text":"# verify/fixture",...}`; `ask` `isError` `search unavailable, use find_component`.
- **Writes nothing.** `$C state > "$E/state.after.txt"`; its diff from `state.before.txt` is only
  `ask`'s one outside call, `curl ... http://127.0.0.1:11434/api/embed` (curl is offline in a run),
  and no `opencode2` call after the build's.
- **Base moved.** `$C drift base` prints `{old: <commit>, head: <new>}`; `git -C "$FIXTURE_CLONE" show
  origin/main:README.md` starts `# verify/fixture, moved on`. Exchange `04-after-base-moved`:
  `read_anchor` lines `1`-`3` still answers `commit` `<commit>` and `text`
  `# verify/fixture\n\nA verify-nico-agent fixture.`; lines `2`-`9` is `isError` `lines 2-9 are not
  inside README.md (3 lines)`; `src/nope.rs` is `isError` `src/nope.rs is not a file of
  verify/fixture at <commit>`.
- **Limited.** `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`. Exchange `05-limited` with
  `-- mcp --wiki verify/second --json`: `wikis` is `[]` (verify/second has no Wiki), `get_component` of
  `verify/fixture` and of `verify/nope` are `isError` `no Wiki <id> is served here: ...`, a call
  of tool `grep` is error `-32602` `Unknown tool: grep`, and a batch `[{...ping...}]` is error `-32600`
  `Invalid Request` with `id` `null`. The same requests with no `--wiki` (`06-every`)
  list verify/fixture and answer its `get_component`.
- **Usage.** `$C run --evidence "$E/07-bad-flag" -- mcp extra --json` is exit `2`, `error`
  ``unexpected argument `extra` for `mcp` ``, its help naming `claude mcp add wiki -- nico-agent mcp`.
- **In Claude Code.** Needs the user's own Claude Code, logged in. In the run's `work/` (so the
  server is local to that folder): `claude mcp add -s local wiki -e HOME="$VERIFY_HOME" --
  "$NICO_AGENT_BIN" mcp`, then `claude mcp get wiki` says `Status: ✔ Connected`. `claude -p --model
  haiku --output-format stream-json --verbose --allowedTools "mcp__wiki__get_component
  mcp__wiki__wikis" -- 'Use the wiki MCP server: call get_component with wiki "verify/fixture" and
  id "index". Reply with only its overview, then the text of each Interpretation, verbatim, one per
  line.'`: its `init` lists server `wiki` `connected` and the five `mcp__wiki__*` tools, it calls
  `mcp__wiki__get_component` and its result is the overview and both Interpretations. Keep only the
  `init`'s wiki entries, the tool calls, their results and the result (the `init` lists the
  user's whole setup), then `claude mcp remove wiki -s local`; `claude mcp get wiki` finds none.
  Copy `$OUTSIDE_LOG` to `$E/outside.log`: the build's one `opencode2` call and its `curl`, and from
  `mcp` only `ask`'s `curl`.
- **Ask, for real.** Needs the user's Ollama answering on `127.0.0.1:11434` with `nomic-embed-text`
  pulled, and opencode's key: driven outside a run, as the real build is (see
  [wiki-build.md](./wiki-build.md)), on a built Wiki of a real Repo, the scratch config dir's
  `wiki/<owner>/<name>/vectors.json` absent. `E=.evidence/<issue>/wiki-mcp/real-ask`. Exchange
  `01-ask`: `initialize`, then `ask` with a question in words the Wiki's claims do not use. Its answer's
  sentences each cite Anchors inside the `records` returned, `vectors.json` now holds one vector per
  overview and Interpretation, and the claim cited answers the question without its words.
  Exchange `02-again`, the same `ask`: one `/api/embed` request, the question's, not the Wiki's.

- **In each Harness's launch.** Needs the user's herdr, and claude, codex and opencode2 logged in.
  `E=.evidence/<issue>/wiki-mcp/launches`. In a run herdr is a stub, so the loop's own faux-nico or
  morning start stops at its first herdr call: start each Harness by hand, in a herdr workspace of
  your own on the run's `work/`, with the arguments the default config gives a launch serving
  `verify/fixture`, as below. Make `nico-agent` the run's binary on its
  scratch HOME for the pane only: a directory `$R/launch-bin` (`R=$(dirname "$VERIFY_HOME")`)
  holding a `nico-agent` script `exec env HOME="$VERIFY_HOME" "$NICO_AGENT_BIN" "$@"`;
  `herdr workspace create --cwd "$R/work" --no-focus`, and in each new tab's pane first `herdr pane
  run <pane> "export PATH=$R/launch-bin:\$PATH"`. Each is prompted `Use the wiki MCP server: call
  get_component with wiki "verify/fixture" and id "index", then reply with only its overview.`
  (`herdr agent prompt <agent> '<text>' --wait`), and its screen kept with `herdr agent read
  <agent> --source visible > "$E/<harness>.screen.txt"`:
  - claude: `herdr agent start verify-claude --kind claude --pane <pane> -- --model haiku
    --permission-mode default --mcp-config
    '{"mcpServers":{"wiki":{"command":"nico-agent","args":["mcp","--wiki","verify/fixture"]}}}'
    --allowedTools 'mcp__wiki__*'`, its folder trust answered with `herdr agent
    send-keys verify-claude down enter` as the loop does: `Called wiki` and the overview, no `Do you
    want to proceed?`. The control, without `--allowedTools mcp__wiki__*`, stops on `Do you want to
    proceed?` (Escape it).
  - codex: `herdr agent start verify-codex --kind codex --pane <pane> -- -c
    'projects={"<$R/work>"={trust_level="trusted"}}' -c 'mcp_servers.wiki.command="nico-agent"' -c
    'mcp_servers.wiki.args=["mcp","--wiki","verify/fixture"]' -c
    'mcp_servers.wiki.default_tools_approval_mode="approve"'`: `Called
    wiki.get_component` and the overview. The control, `default_tools_approval_mode="prompt"`,
    stops on `Allow the wiki MCP server to run tool "get_component"?`.
  - opencode: `herdr pane run <pane> "env
    OPENCODE_CONFIG_CONTENT='{\"mcp\":{\"wiki\":{\"command\":[\"nico-agent\",\"mcp\",\"--wiki\",\"verify/fixture\"],\"type\":\"local\"}}}'
    opencode2 --standalone"`, then `herdr agent rename <pane> verify-opencode`: `wiki.get_component` and the
    overview. The user's TUI may accept every permission by itself (`"permissions": "autoaccept"`
    in `~/.config/opencode/cli.json`), so its own default is shown headless too: `opencode2 run
    --standalone -m opencode-go/deepseek-v4.1-flash --format json '<the prompt>'` in `$R/work` with
    the same `OPENCODE_CONFIG_CONTENT` and `PATH`, no `--auto`, completes an `execute` tool call of
    `tools.wiki.get_component` whose output is the Component.
  Then `herdr workspace close <workspace>`.

## Gotchas

- `run` passes its stdin to the binary: without `< file`, `mcp` waits on the terminal till EOF.
- Stdout is the protocol's alone: an exchange's `.stdout` is JSON-RPC lines, with no `{...}` after
  them even with `--json`; refusals of bad flags come before any line and exit `2`.
- `$C drift base` moves only verify/fixture's Base, and fetches it into the clone as the loop would.
- In a run `curl` is offline, so `ask` there only ever says `search unavailable`; an answer needs the
  real Ollama and model, outside a run.
- The Claude Code step changes the user's own Claude config for the run's `work/` folder only:
  remove the server before `cleanup`, or `claude mcp get wiki` there keeps naming a deleted binary.
- The launches step runs in the user's own herdr: close its workspace before `cleanup`, which
  deletes the binary its panes' `nico-agent` points at. What the loop's own launches carry (the
  switch off or the Wiki unbuilt adding nothing, the prompts' lines) is `cargo test`'s.
