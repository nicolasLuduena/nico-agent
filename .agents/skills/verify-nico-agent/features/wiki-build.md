# Build a Repo's Wiki

`nico-agent wiki build <owner/name>` builds that Repo's Wiki from scratch: it checks the Repo out
at `origin/<base>`, records each file's blob and line count, and asks the `[wiki]` launch about the
code part by part, top-down, each part one headless, read-only `opencode2 run`. Code checks every
answer: a claim that fails goes back to the model in the same session, by its id with what failed,
up to 3 rounds, each a call of the budget; one still failing is dropped and its part recorded as a
Gap. The Wiki lands in the Bucket in one commit at `wiki/<owner>/<name>/wiki.json`; then its
overviews and Interpretations are embedded through Ollama's `/api/embed` for `ask`, kept in the
config dir, a failed embed leaving the Wiki built. The build writes its outcome to `wikis.json` as
its last act: built, with its Gaps by reason, or failed with why.

## Sub-features

- `wiki-usage` `wiki` alone is exit 2 with the usage; a slug that is no Repo is exit 1 and writes no outcome.
- `wiki-failed` a call that errors fails the build: exit 1 with why, `wikis.json` `failed` with it, nothing in the Bucket, the checkout gone.
- `wiki-read-only` each call is `opencode2 run --standalone -m <model> --format json <prompt>` with `OPENCODE_CONFIG_CONTENT` denying bash, edit, execute, external_directory, task, webfetch and websearch.
- `wiki-built` an answer lands as one Bucket commit `wiki <owner/name> <commit>`, served at `/bucket/wiki/<owner>/<name>/wiki.json`, its files with git's blobs and their line counts; `wikis.json` `built`.
- `wiki-embed` after the Bucket commit, one `curl` POSTs every overview and Interpretation to `http://127.0.0.1:11434/api/embed` with `nomic-embed-text`; with Ollama unreachable, stderr says `could not embed the Wiki of <owner/name>, so ask embeds it first: ...`, the build is still `built` and the config dir holds no `wiki/<owner>/<name>/vectors.json`; with Ollama up, it does.
- `wiki-gap` a claim failing a check (an Anchor past its file's end, an Explainer's arrow to a step it does not have) is sent back 3 times, each `opencode2 run ... -s <session>` continuing the first call's session; still failing, it is dropped, said on stderr, and its part a Gap `unreadable`; the build still succeeds.
- `wiki-corrected` a claim the model corrects in its first round is kept: one correction call, no Gap.
- `wiki-unread-reply` a correction that is no JSON keeps the answer before it, and the next round says so.

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
  "interpretations": [...], "explainer": {...}}`, one Interpretation anchored at `README.md` lines
  `1`-`1` and one at lines `1`-`9`, and an Explainer of one step at `1`-`1` with an arrow from
  step 1 to step 2. `$C seed answer "$E/answer.json"`, then `$C run --evidence "$E/04-built" -- wiki build verify/fixture --json`.
  Exit `0`, `{"outcome":"built","commit":<commit>,"components":1,"gaps":{"unreadable":1},"wiki":"verify/fixture",...}`;
  stderr says `verify/fixture: 2 claim(s) failed, sent back (round 1 of 3, call 2 of 48)`, then
  rounds 2 and 3 (calls 3 and 4), then `verify/fixture: dropped interpretation 2 {...}: lines 1-9 are not inside README.md (3 lines)`
  and `verify/fixture: dropped explainer 1 {...}: its arrow 1 to 2 is not between two of its steps`,
  then `could not embed the Wiki of verify/fixture, so ask embeds it first: could not reach
  http://127.0.0.1:11434/api/embed: curl: (6) verify-nico-agent: no network in this run`.
  `$C state`'s diff: `wikis.json` `built`, one Bucket commit `wiki verify/fixture <commit>`
  adding `wiki/verify/fixture/wiki.json`, no `wiki/verify/fixture/vectors.json`, four `opencode2 run`
  calls: the first as above, the three after it ending `--format json -s ses_verify_<n> $'## Corrections to the part: verify/fixture\n\nThese claims of your last answer failed their checks, each by its id:\n\n- interpretation 2 {...}: lines 1-9 are not inside README.md (3 lines)\n- explainer 1 {...}: its arrow 1 to 2 is not between two of its steps...'`,
  `<n>` the same in all three: the first call's session; and after them one
  `curl ... --request POST ... --data-binary '{"input":["<overview>","<the kept Interpretation>"],"model":"nomic-embed-text"}' http://127.0.0.1:11434/api/embed`.
- **Second view.** `$C http --evidence "$E/05-bucket-wiki" GET /bucket/wiki/verify/fixture/wiki.json` is
  `200`: `commit` the fixture's `origin/main`, `files` `[{"path":"README.md","blob":<git rev-parse origin/main:README.md>,"lines":3}]`,
  one Component `index` with the first Interpretation only, no `explainer`, and `gaps` `[{"paths":["README.md"],"reason":"unreadable"}]`.
  `git -C "$FIXTURE_CLONE" worktree list` lists the clone alone.
- **Corrected.** Write `$E/corrected.json`: the same leaf with the second Interpretation anchored at
  lines `1`-`3` and its Explainer's arrow from step 1 to step 1. `$C state > "$E/state.corrected.before.txt"`, `$C seed correction "$E/corrected.json"`,
  then `$C run --evidence "$E/06-corrected" -- wiki build verify/fixture --json`. Exit `0`, `"gaps":{}`;
  stderr says `verify/fixture: 2 claim(s) failed, sent back (round 1 of 3, call 2 of 48)` once and
  drops nothing. The `state` diff: `wikis.json` `built` with `gaps` `{}`, a second Bucket commit
  `wiki verify/fixture <commit>`, and two `opencode2 run` calls, the second with `-s` and the first's
  session. `$C http --evidence "$E/07-bucket-corrected" GET /bucket/wiki/verify/fixture/wiki.json` is
  `200`: Component `index` with both Interpretations, the second at lines `1`-`3`, its `explainer`, and `gaps` `[]`.
- **A reply that is no JSON.** Write `$E/prose.txt`, one line of prose. `$C state > "$E/state.unread.before.txt"`,
  `$C seed correction "$E/prose.txt"`, then `$C run --evidence "$E/08-unread-reply" -- wiki build verify/fixture --json`.
  Exit `0`, `"gaps":{"unreadable":1}`, stderr as in **Built, with a Gap**. The `state` diff's four
  `opencode2 run` calls: the second's correction lists `interpretation 2` and `explainer 1` alone; the third's and
  fourth's start with `- your last reply: it is no JSON object of either shape, leaf or division, so the claims below are of the answer before it`
  and then list them. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- The model is stubbed: `opencode2` answers every call with the seeded text (each correction with
  the seeded correction, if any), so a division would divide again at every depth. Seed leaves
  only, or seed each part's answer by its trail (`seed answer <file> <part>`, as
  [wiki-view.md](./wiki-view.md) does); `cargo test` covers divisions, budgets, depth and
  corrections cut by the budget.
- `seed answer none` puts the stub back to failing each call, and `seed correction none` back to
  answering a correction with the part's answer.
- A real build needs opencode's credentials, which the scratch HOME lacks: it is driven outside a
  run, in a scratch config dir, with `OPENCODE_API_KEY` set. It embeds through the user's own
  Ollama, which needs `nomic-embed-text` pulled (`scripts/install-service.sh` pulls it).
- `curl` is offline in a run, so a run's build never embeds: `wiki-embed` with Ollama up is
  driven with the real build.
