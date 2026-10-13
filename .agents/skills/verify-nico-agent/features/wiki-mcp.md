# Serve Wikis to agents through the MCP

`nico-agent mcp [--wiki <owner/name>]...` is an MCP server on stdio: one JSON-RPC message a line
in, one answer a line out, nothing else on stdout. It serves the built Wiki of every Repo, or of
those `--wiki` names, through four tools: `wikis`, `find_component`, `get_component` and
`read_anchor`, which reads lines at the commit the Wiki describes even after the Base has moved
on. A Wiki it does not serve, a missing Component or lines outside their file are tool errors,
and the session goes on. It writes nothing. The user adds it to their own Claude Code with
`claude mcp add wiki -- nico-agent mcp`.

## Sub-features

- `mcp-handshake` `initialize` answers the version asked for (the latest it speaks, `2025-11-25`, for one it does not), `capabilities.tools`, `serverInfo` and `instructions`; `notifications/initialized` gets no answer; `tools/list` lists the four tools, each `readOnlyHint`.
- `mcp-tools` `wikis` gives each Wiki's `wiki`, `commit`, `builtAt` and `gaps`; `find_component` the matching Components' `id`, `name` and `overview`, best first; `get_component` the Component with its `interpretations`, `relationships`, `gaps`, sub-`components`, and its `files` when a leaf; `read_anchor` `{path, start, end, commit, text}`.
- `mcp-base-moved` `read_anchor` reads the Wiki's commit, not `origin/<base>`, once the Base has moved.
- `mcp-errors` a Wiki not served (`--wiki` names another, no such Repo, or not built) is `isError` `no Wiki <id> is served here: ...`; lines outside the file and a file not at the commit are `isError`; an unknown tool is JSON-RPC `-32602`, an unknown method `-32601`; `mcp` with a positional is exit `2`.
- `mcp-read-only` a session changes nothing in the config dir or the Bucket, and calls no stub.
- `mcp-claude` added to Claude Code, it is connected, its four `mcp__wiki__*` tools are listed, and `get_component` answers.

## How to get to it (user POV)

- The user adds it to their Claude Code once: `claude mcp add wiki -- nico-agent mcp` (`-s user`
  for every project); Claude Code starts it per session and calls its tools.
- An agent's launch starts it the same way, with `--wiki` per Wiki it may read.

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

Each session is a file of requests, a JSON object a line, on stdin:
`$C run --evidence "$E/<n>-<name>" -- mcp [--wiki ...] < "$E/<n>-<name>.requests.jsonl"`. Start each with
`initialize` (`protocolVersion` `2025-06-18`) and `notifications/initialized`; a tool call is
`{"jsonrpc":"2.0","id":<n>,"method":"tools/call","params":{"name":<tool>,"arguments":{...}}}`, and
its answer's `result.content[0].text` is the tool's JSON, or its error with `isError` `true`.

- **Handshake and tools.** Session `02-session`: `initialize`, `notifications/initialized`,
  `tools/list`, `wikis`, `find_component` `{"wiki":"verify/fixture","query":"fixture README"}`,
  `get_component` `{"wiki":"verify/fixture","id":"index"}`, `read_anchor`
  `{"wiki":"verify/fixture","path":"README.md","start":1,"end":1}`. Exit `0`, six lines (none for the
  notification): version `2025-06-18`; the four tools; `[{"wiki":"verify/fixture","commit":<commit>,"gaps":0,...}]`;
  `[{"id":"index",...}]`; `index` with both Interpretations, `files` `["README.md"]` and `components` `[]`;
  `{"commit":<commit>,"text":"# verify/fixture",...}`.
- **Writes nothing.** `$C state > "$E/state.after.txt"`; its diff from `state.before.txt` is empty.
- **Base moved.** `$C drift base` prints `{old: <commit>, head: <new>}`; `git -C "$FIXTURE_CLONE" show
  origin/main:README.md` starts `# verify/fixture, moved on`. Session `04-after-base-moved`:
  `read_anchor` lines `1`-`3` still answers `commit` `<commit>` and `text`
  `# verify/fixture\n\nA verify-nico-agent fixture.`; lines `2`-`9` is `isError` `lines 2-9 are not
  inside README.md (3 lines)`; `src/nope.rs` is `isError` `src/nope.rs is not a file of
  verify/fixture at <commit>`.
- **Limited.** `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`. Session `05-limited` with
  `-- mcp --wiki verify/second`: `wikis` is `[]` (verify/second has no Wiki), `get_component` of
  `verify/fixture` and of `verify/nope` are `isError` `no Wiki <id> is served here: ...`, and a call
  of tool `ask` is error `-32602` `Unknown tool: ask`. The same requests with no `--wiki` (`06-every`)
  list verify/fixture and answer its `get_component`.
- **Usage.** `$C run --evidence "$E/07-bad-flag" -- mcp extra --json` is exit `2`, `error`
  ``unexpected argument `extra` for `mcp` ``, its help naming `claude mcp add wiki -- nico-agent mcp`.
- **In Claude Code.** Needs the user's own Claude Code, logged in. In the run's `work/` (so the
  server is local to that folder): `claude mcp add -s local wiki -e HOME="$VERIFY_HOME" --
  "$NICO_AGENT_BIN" mcp`, then `claude mcp get wiki` says `Status: ✔ Connected`. `claude -p --model
  haiku --output-format stream-json --verbose --allowedTools "mcp__wiki__get_component
  mcp__wiki__wikis" -- 'Use the wiki MCP server: call get_component with wiki "verify/fixture" and
  id "index". Reply with only its overview, then the text of each Interpretation, verbatim, one per
  line.'`: its `init` lists server `wiki` `connected` and the four `mcp__wiki__*` tools, it calls
  `mcp__wiki__get_component` and its result is the overview and both Interpretations. Keep only the
  `init`'s wiki entries, the tool calls, their results and the result (the `init` lists the
  user's whole setup), then `claude mcp remove wiki -s local`; `claude mcp get wiki` finds none.
  Copy `$OUTSIDE_LOG` to `$E/outside.log`: the build's one `opencode2` call, nothing from `mcp`.

## Gotchas

- `run` passes its stdin to the binary: without `< file`, `mcp` waits on the terminal till EOF.
- Stdout is the protocol's alone: a session's `.stdout` is JSON-RPC lines, never the `{...}` a
  command prints; refusals of bad flags come before any line and exit `2`.
- `$C drift base` moves only verify/fixture's Base, and fetches it into the clone as the loop would.
- The Claude Code step changes the user's own Claude config for the run's `work/` folder only:
  remove the server before `cleanup`, or `claude mcp get wiki` there keeps naming a deleted binary.
