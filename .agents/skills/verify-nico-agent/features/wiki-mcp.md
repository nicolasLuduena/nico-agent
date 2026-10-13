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
`claude mcp add wiki -- nico-agent mcp`.

## Sub-features

- `mcp-handshake` `initialize` answers the version asked for (the latest it speaks, `2025-11-25`, for one it does not), `capabilities.tools`, `serverInfo` and `instructions`; `notifications/initialized` gets no answer; `tools/list` lists the five tools, each `readOnlyHint`.
- `mcp-tools` `wikis` gives each Wiki's `wiki`, `commit`, `builtAt` and `gaps`; `find_component` the matching Components' `id`, `name` and `overview`, best first; `get_component` the Component with its `interpretations` (each `"stale": true` once a file it cites changed on the Base: [wiki-update.md](./wiki-update.md)), `relationships` (`to` what it uses, `from` what uses it), `gaps`, sub-`components`, and its `files` when a leaf; `read_anchor` `{path, start, end, commit, text}`.
- `mcp-ask` with Ollama unreachable, `ask` is `isError` `search unavailable, use find_component` and calls no model; with it up, the first `ask` of a Wiki without embeddings embeds every overview and Interpretation, keeps them in `wiki/<owner>/<name>/vectors.json` in the config dir, then embeds the question; a later `ask` embeds the question alone. It answers `{answer: [{text, anchors}], records: [...]}`: each sentence cites Anchors of the Interpretations retrieved, and `records` are those it cites, each with its `component`; it answers a question whose words are not in the claim it cites.
- `mcp-base-moved` `read_anchor` reads the Wiki's commit, not `origin/<base>`, once the Base has moved.
- `mcp-errors` a Wiki not served (`--wiki` names another, no such Repo, or not built) is `isError` `no Wiki <id> is served here: ...`; lines outside the file and a file not at the commit are `isError`; an unknown tool is JSON-RPC `-32602`, an unknown method `-32601`, a batch `-32600`; `mcp` with a positional is exit `2`.
- `mcp-read-only` answering changes nothing in the config dir or the Bucket, and calls no stub but `ask`'s `curl` to Ollama.
- `mcp-claude` added to Claude Code, it is connected, its five `mcp__wiki__*` tools are listed, and `get_component` answers.

## How to get to it (user POV)

- The user adds it to their Claude Code once: `claude mcp add wiki -- nico-agent mcp` (`-s user`
  for every project); Claude Code starts it with each conversation and calls its tools.

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

## Gotchas

- `run` passes its stdin to the binary: without `< file`, `mcp` waits on the terminal till EOF.
- Stdout is the protocol's alone: an exchange's `.stdout` is JSON-RPC lines, with no `{...}` after
  them even with `--json`; refusals of bad flags come before any line and exit `2`.
- `$C drift base` moves only verify/fixture's Base, and fetches it into the clone as the loop would.
- In a run `curl` is offline, so `ask` there only ever says `search unavailable`; an answer needs the
  real Ollama and model, outside a run.
- The Claude Code step changes the user's own Claude config for the run's `work/` folder only:
  remove the server before `cleanup`, or `claude mcp get wiki` there keeps naming a deleted binary.
