# Library Wikis

A Library version is a GitHub repository at a tag, with an optional subfolder: `{ repo, tag,
path }` in a Repo's `libraries` in `config.toml` (a Project's defaults carry it to its Repos like
any Repo key), or under `[wiki] libraries` for one no Repo links. Its Wiki's id is
`<owner/name>@<tag>`, then `:<path>` with a subfolder. A linked or added version with no Wiki is
queued at the next tick like a Repo's, and built once: `nico-agent wiki build <id>` fetches the
tag into a bare clone in the config dir (`libraries/<owner>/<name>.git`, one for every version)
with the user's own git credentials, checks it out in a worktree removed after, and asks about
the subfolder's files alone, every Anchor still a path from the repo's root. The Wiki lands in the Bucket at `wiki/<owner>/<name>/<tag>/<path>/wiki.json`, a `/`
in the tag kept as `%2F`. A built one is never queued again; one whose build failed is tried again
at the wiki hour. `status`, `GET /api/wikis`, `GET /api/wiki/<id>` and the MCP serve it.

## Sub-features

- `lib-queued` a refresh queues each Library version with no Wiki (`<id>: wiki queued, it has none`) whether or not its Repo's `wiki` switch is on, and starts its Run in a herdr workspace in the config dir, whose pane runs `nico-agent wiki build <id>; exit`.
- `lib-built` `wiki build <id>` is `built` at the tag's commit; the config dir holds a bare clone with the tag and no worktree after; the Bucket's one commit `wiki <id> <commit>` adds `wiki/<owner>/<name>/<tag>/<path>/wiki.json`, whose `target` is `{repo, tag, path}` and whose files are the subfolder's alone.
- `lib-subfolder` a claim citing a file outside the subfolder is sent back, `<path> is not one of the Wiki's files`, and dropped as a Gap.
- `lib-reused` a second version of the same Library fetches into the same bare clone, which then holds both tags; a tag with no subfolder covers every file.
- `lib-unknown-tag` a tag the Library lacks fails the build, exit `1`, with git's `couldn't find remote ref refs/tags/<tag>`, written to `wikis.json` as `failed`, nothing in the Bucket; a subfolder the tag lacks fails it with `<owner/name> has no file under <path> at <commit>`, no model asked.
- `lib-once` once built, a refresh closes its Run built and queues it no more; one failed is not queued again that day.
- `lib-served` `status`'s `wikis`, `GET /api/wikis` and `GET /api/wiki/<id>` (the id URL-encoded) list and answer it with its `target`; the MCP's `wikis`, `find_component`, `get_component` and `read_anchor` serve it, the lines read from the bare clone at the Wiki's commit; `--wiki <id>` limits the MCP to it.
- `lib-refused` a `libraries` entry whose `repo` is not `<owner>/<name>`, whose `tag` holds `:`, or whose `path` leaves the repo (`..`) is refused at its line; `wiki build` of a version the config does not name is exit `1`.

## How to get to it (user POV)

- The user links a Library version to a Repo in `config.toml` (`libraries = [{ repo = "Effect-TS/effect",
  tag = "effect@3.17.0", path = "packages/effect" }]` under `[repos."<slug>"]` or a Project), or adds one
  under `[wiki] libraries`, then waits for the next tick or presses Refresh; or does either on the
  page, which queues it at once ([library-links.md](./library-links.md)).
- The user runs `nico-agent wiki build <owner/name>@<tag>[:<path>]` by hand.
- Agents and the user's own Claude Code read it through `nico-agent mcp`; the user sees it in `status`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/library-wikis`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C drift tag v1.0` prints `{repo: "verify/second", tag: "v1.0", commit}`: verify/second's origin
  has tag `v1.0`, adding `lib/greet.sh` (5 lines) and `lib/README.md` beside the root `README.md`.
- Link it: append `libraries = [{ repo = "verify/second", tag = "v1.0", path = "lib" }]` to the
  `[repos."verify/fixture"]` table of `$CONFIG_DIR/config.toml`, as the user would.
- `$C state > "$E/state.before.txt"`.

- **Queued.** `$C http --evidence "$E/01-refresh" POST /api/refresh`: `actions` hold
  `verify/second@v1.0:lib: wiki queued, it has none` and `could not start the wiki of
  verify/second@v1.0:lib: ... verify_stub ...` (herdr is a stub); `outside.log` holds `herdr
  workspace create --cwd <config dir> --label wiki-second-v1-0-lib --no-focus`.
  `$C run --evidence "$E/02-status" -- status --json`: `wikis` is one entry, `wiki`
  `verify/second@v1.0:lib`, `target` `{"repo":"verify/second","tag":"v1.0","path":"lib"}`, `state`
  `building`.
- **Built, the subfolder alone.** Write `$E/answer.json`: a leaf with one Interpretation anchored at
  `lib/greet.sh` lines `3`-`5` and one at `README.md` lines `1`-`1`. `$C seed answer "$E/answer.json"
  "verify/second@v1.0:lib"`, then `$C run --evidence "$E/03-build-v1.0" -- wiki build verify/second@v1.0:lib --json`.
  Exit `0`, `built`, `commit` the tag's, `gaps` `{"unreadable":1}`; stderr says `1 claim(s) failed,
  sent back` in rounds 1 to 3, then `dropped interpretation 2 {...}: README.md is not one of the
  Wiki's files`. `$C http --evidence "$E/04-bucket-wiki" GET /bucket/wiki/verify/second/v1.0/lib/wiki.json`:
  `target` as above, `files` `lib/README.md` and `lib/greet.sh` only, `index` named
  `verify/second@v1.0:lib` with the `lib/greet.sh` claim alone.
- **Second version, same clone.** `$C drift tag v2.0`. Add `[wiki]` with `libraries = [{ repo =
  "verify/second", tag = "v2.0" }, { repo = "verify/second", tag = "v9" }]` to `config.toml`. Write
  `$E/answer-v2.json`: a leaf with Interpretations at `lib/greet.sh` `3`-`5` and `README.md` `1`-`1`;
  `$C seed answer "$E/answer-v2.json" "verify/second@v2.0"`; `$C run --evidence "$E/05-build-v2.0" --
  wiki build verify/second@v2.0 --json` is `built` with `gaps` `{}`. `$C state`'s Library clones:
  `libraries/verify/second.git: tags v1.0 v2.0`, its one worktree the bare clone itself.
- **Unknown tag.** `$C run --evidence "$E/06-build-v9" -- wiki build verify/second@v9 --json` is exit
  `1`, `error` `` could not build the Wiki of verify/second@v9: `git fetch --quiet --depth 1
  https://github.com/verify/second.git +refs/tags/v9:refs/tags/v9` failed in <config
  dir>/libraries/verify/second.git: fatal: couldn't find remote ref refs/tags/v9 ``. With the v1.0
  link's `path` set to `nope`, `$C run --evidence "$E/06-build-no-subfolder" -- wiki build
  verify/second@v1.0:nope --json` is exit `1`, `error` `could not build the Wiki of
  verify/second@v1.0:nope: verify/second has no file under nope at <commit>`, no `opencode2` call
  in `outside.log` for it; put the link back.
- **Once.** `$C http --evidence "$E/07-refresh" POST /api/refresh`: `verify/second@v1.0:lib: wiki
  built at <commit>`, `verify/second@v9: wiki queued, it has none` and its start failing at herdr;
  v2.0 is not queued. `$C http --evidence "$E/08-refresh" POST /api/refresh`: `verify/second@v9:
  wiki failed: ...`, nothing queued. `$C run --evidence "$E/09-status" -- status --json`: `wikis`
  v1.0:lib and v2.0 `built`, v9 `failed`.
- **Served.** `$C http --evidence "$E/10-api-wikis" GET /api/wikis` lists both built, each with its
  `target`; `$C http --evidence "$E/11-api-wiki" GET /api/wiki/verify%2Fsecond%40v1.0%3Alib` is the
  Bucket's Wiki. `$C state > "$E/state.mcp.before.txt"`. Exchange `12-mcp` (as in
  [wiki-mcp.md](./wiki-mcp.md)): `initialize`, `notifications/initialized`, `wikis`, `find_component`
  `{"wiki":"verify/second@v1.0:lib","query":"greet"}`, `get_component` `index`, `read_anchor`
  `lib/greet.sh` `3`-`5`. `wikis` lists both versions; `read_anchor` answers `text` `greet() {\n  echo
  "hello, $1"\n}` at the v1.0 commit. Exchange `13-mcp-limited`, `-- mcp --wiki verify/second@v2.0 --json`:
  `wikis` lists v2.0 alone. `$C state > "$E/state.mcp.after.txt"`: no change. Copy `$OUTSIDE_LOG`
  to `$E/outside.log`.
- **Refused.** `$C state > "$E/state.refused.before.txt"`; with `path = "../.."` in the `[wiki]`
  entry, `$C run --evidence "$E/14-bad-path" -- status --json` is exit `1`, `error` `<config>
  line <n>: wiki.libraries[0].path: invalid value: string "../..", expected a folder's path from the
  repository's root, such as packages/effect`. Put it back.

## Gotchas

- `drift tag` tags verify/second only, at a commit off its `main`: verify/second need not be a Repo.
  `git fetch <url>` goes through the scratch `.gitconfig`'s rewrite of `https://github.com/verify/second.git`
  to the bare repo in the run dir; any other Library's URL is rewritten to a path that does not exist.
- The opencode2 stub answers by trail: seed each version's answer by its id, which is its trail.
- A real build of a public Library needs opencode's credentials: run it outside a run with `HOME` a
  scratch dir (nico-agent's config dir is `$HOME/.config/nico-agent`), `XDG_CONFIG_HOME`,
  `XDG_DATA_HOME`, `XDG_STATE_HOME` and `XDG_CACHE_HOME` the real ones (opencode's config and auth),
  and `GIT_CONFIG_GLOBAL` the user's `~/.gitconfig` (their credentials); keep `[wiki] calls` low.
