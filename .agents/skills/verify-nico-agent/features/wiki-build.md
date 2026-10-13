# Build a Repo's Wiki

`nico-agent wiki build <owner/name>` builds that Repo's Wiki from scratch: it checks the Repo out
at `origin/<base>`, records each file's blob and line count, and asks the `[wiki]` launch about the
code part by part, top-down, each part one headless, read-only `opencode2 run`. Code checks every
answer: a claim that fails is dropped and its part recorded as a Gap. The Wiki lands in the Bucket
in one commit at `wiki/<owner>/<name>/wiki.json`; then its overviews and Interpretations are embedded
through Ollama's `/api/embed` for `ask`, kept in the config dir, a failed embed leaving the Wiki
built. The build writes its outcome to `wikis.json` as its last act: built, with its Gaps by
reason, or failed with why.

## Sub-features

- `wiki-usage` `wiki` alone is exit 2 with the usage; a slug that is no Repo is exit 1 and writes no outcome.
- `wiki-failed` a call that errors fails the build: exit 1 with why, `wikis.json` `failed` with it, nothing in the Bucket, the checkout gone.
- `wiki-read-only` each call is `opencode2 run --standalone -m <model> --format json <prompt>` with `OPENCODE_CONFIG_CONTENT` denying bash, edit, execute, external_directory, task, webfetch and websearch.
- `wiki-built` an answer lands as one Bucket commit `wiki <owner/name> <commit>`, served at `/bucket/wiki/<owner>/<name>/wiki.json`, its files with git's blobs and their line counts; `wikis.json` `built`.
- `wiki-embed` after the Bucket commit, one `curl` POSTs every overview and Interpretation to `http://127.0.0.1:11434/api/embed` with `nomic-embed-text`; with Ollama unreachable, stderr says `could not embed the Wiki of <owner/name>, so ask embeds it first: ...`, the build is still `built` and the config dir holds no `wiki/<owner>/<name>/vectors.json`; with Ollama up, it does.
- `wiki-gap` a claim failing a check (an Anchor past its file's end) is dropped, said on stderr, and its part a Gap `unreadable`; the build still succeeds.

## How to get to it (user POV)

- The user runs `nico-agent wiki build <owner/name>` by hand, and watches it on stderr.
- The Wiki is read at `/bucket/wiki/<owner>/<name>/wiki.json`, and the last build's outcome in
  `wikis.json` in the config dir.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-build`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C state > "$E/state.before.txt"`.

- **Usage.** `$C run --evidence "$E/01-no-subcommand" -- wiki --json` is exit `2`, `error`
  `` `wiki` needs a subcommand: build ``; `$C run --evidence "$E/02-not-a-repo" -- wiki build verify/nope --json`
  is exit `1`, `error` `verify/nope is not a configured Repo`.
- **Failed.** With no answer seeded, run `$C run --evidence "$E/03-failed" -- wiki build verify/fixture --json`.
  Exit `1`, `error` `` could not build the Wiki of verify/fixture: `opencode2 run` failed: Model unavailable: opencode2 is a stub in this verification run ``;
  stderr `building the Wiki of verify/fixture at <commit>: 48 calls, 7 deep, 4 at once`.
  `$C state`'s diff from `state.before.txt`: `wikis.json` holds `{"wiki":"verify/fixture","outcome":"failed",...,"why":...}`,
  the Bucket's log is unchanged, no file under `wiki/verify/fixture/checkout/` is left, and one
  outside call, `OPENCODE_CONFIG_CONTENT={"permission":{"bash":"deny","edit":"deny","execute":"deny","external_directory":"deny","task":"deny","webfetch":"deny","websearch":"deny"}} opencode2 run --standalone -m opencode-go/deepseek-v4.1-flash --format json $'You are writing one part of the Wiki of verify/fixture...'`
  (shell-quoted).
- **Built, with a Gap.** Write a leaf answer to `$E/answer.json`: `{"kind": "leaf", "overview": "...",
  "interpretations": [...]}`, one Interpretation anchored at `README.md` lines `1`-`1` and one at
  lines `1`-`9`. `$C seed answer "$E/answer.json"`, then `$C run --evidence "$E/04-built" -- wiki build verify/fixture --json`.
  Exit `0`, `{"outcome":"built","commit":<commit>,"components":1,"gaps":{"unreadable":1},"wiki":"verify/fixture",...}`;
  stderr says `verify/fixture: dropped {...}: lines 1-9 are not inside README.md (3 lines)`, then
  `could not embed the Wiki of verify/fixture, so ask embeds it first: could not reach
  http://127.0.0.1:11434/api/embed: curl: (6) verify-nico-agent: no network in this run`.
  `$C state`'s diff: `wikis.json` `built`, one Bucket commit `wiki verify/fixture <commit>`
  adding `wiki/verify/fixture/wiki.json`, no `wiki/verify/fixture/vectors.json`, and after the
  `opencode2` call one `curl ... --request POST ... --data-binary '{"input":["<overview>","<the kept Interpretation>"],"model":"nomic-embed-text"}' http://127.0.0.1:11434/api/embed`.
- **Second view.** `$C http --evidence "$E/05-bucket-wiki" GET /bucket/wiki/verify/fixture/wiki.json` is
  `200`: `commit` the fixture's `origin/main`, `files` `[{"path":"README.md","blob":<git rev-parse origin/main:README.md>,"lines":3}]`,
  one Component `index` with the first Interpretation only and `gaps` `[{"paths":["README.md"],"reason":"unreadable"}]`.
  `git -C "$FIXTURE_CLONE" worktree list` lists the clone alone. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- The model is stubbed: `opencode2` answers every call with the seeded text, so a division would
  divide again at every depth. Seed leaves only, or seed each part's answer by its trail
  (`seed answer <file> <part>`, as [wiki-view.md](./wiki-view.md) does); `cargo test` covers
  divisions, budgets and depth.
- `seed answer none` puts the stub back to failing each call.
- A real build needs opencode's credentials, which the scratch HOME lacks: it is driven outside a
  run, in a scratch config dir, with `OPENCODE_API_KEY` set. It embeds through the user's own
  Ollama, which needs `nomic-embed-text` pulled (`scripts/install-service.sh` pulls it).
- `curl` is offline in a run, so a run's build never embeds: `wiki-embed` with Ollama up is
  driven with the real build.
