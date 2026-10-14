# Libraries on the page

A Repo's panel has a Libraries section listing the Library versions it links, each with where its
Wiki stands, an Unlink per version and a form (Library, Tag, Subfolder) that links another; each
change is `PATCH /api/repo/<slug> {libraries}`, written to the Repo's own `libraries` in
`config.toml` with the rest as the user wrote it, and a version no build has tried is queued at
once. A Libraries tab beside the Project tabs (`#/libraries`) lists the versions `[wiki]
libraries` adds that no Repo links, adds one (`POST /api/libraries`, queued too) and removes one,
asked twice (`DELETE /api/libraries/<id>`), its Wiki taken out of the Bucket's files in one commit
that its history keeps. Removing a version a Repo links is refused with help. A Project tab's Wiki
view lists the Wikis of its Repos, then of the Library versions they link, each opening its page.

## Sub-features

- `link-settings` the Repo panel's Libraries form sends `PATCH /api/repo/<slug>` with the whole list; `config.toml` gains `libraries = [{ repo = "...", tag = "...", path = "..." }]` under the Repo, `wiki-queue.json` waits on the version's id, and its row reads `Wiki queued`, the chip beside `Linked versions` reading `set here`; Unlink sends the list without it, the chip's × (`button "Use the default Libraries"`) removes the Repo's own list and the chip reads `default`.
- `picker` the Wiki view's `list "Wikis"` lists the Repo's Wiki, then each Library version it links, each a `link` to its page, `/wiki/<owner>/<name>@<tag>[:<path>]`, its `@` and `:` as written; an old link naming one on the Board (`#<project>/wiki/<id>`) opens that page.
- `tab-add` the Libraries tab's Add sends `POST /api/libraries {repo, tag, path}` (no `path` when Subfolder is empty), answers `<id> added`, writes `[wiki] libraries`, queues it, and lists it; a version a Repo links answers `<id> already linked by <slug> (no-op)` and writes nothing.
- `tab-remove` `Remove <id>…`, then `Remove <id>`, sends `DELETE /api/libraries/<id>`: `config.toml` drops the entry, `wikis.json` forgets its builds, the Bucket's one commit `wiki <id> removed` deletes its `wiki.json`, which `git show` still finds at the commit before; `/bucket/` answers 404 for it.
- `refused` `DELETE` of a linked version is 409 `<id> is linked by <slug>` with help to unlink it in that Repo's settings; a bad version is 400 with what a Library version is; either writes nothing.

## How to get to it (user POV)

- A Repo's panel on its Project's tab: the Libraries section under Settings, folded to one line reading `None linked` or `N linked`; click it open.
- The Libraries tab after the Project tabs (the phone's Project select's last option, `Libraries`), or a link to `#/libraries`.
- The Wiki view of a Project tab: its list, each Wiki a link to its page.
- `/api` directly, as the page sends it.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`; `export VERIFY_PLAYWRIGHT=<the playwright package's dir>` if `page` says none is found beside the CLI.
- `E=.evidence/<issue>/library-links`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C drift tag v1.0`.
- `$C state > "$E/state.before.txt"`.

- **Link from the Repo's settings.** `$C page --evidence "$E/01-link-from-settings" --within
  "region=verify/fixture" --click "region=Libraries" --click "textbox=Library" --type verify/second --click "textbox=Tag" --type
  v1.0 --click "textbox=Subfolder" --type lib --click "button=Link" --expect "Wiki queued"`:
  `.requests.txt` holds `PATCH /api/repo/verify/fixture
  {"libraries":[{"repo":"verify/second","tag":"v1.0","path":"lib"}]} -> 200`; the ARIA snapshot's
  `region "Libraries"` reads `Libraries 1 linked`, its chip `set here` with `button "Use the default
  Libraries"`, and `list "Linked versions"` holds `verify/second`, `v1.0 · lib Wiki queued` and `button "Unlink
  verify/second@v1.0:lib"`. `$C state` diff: `config.toml` gains `libraries = [{ repo =
  "verify/second", tag = "v1.0", path = "lib" }]` under `[repos."verify/fixture"]`, and
  `wiki-queue.json` waits on `verify/second@v1.0:lib`.
- **Picker.** Seed answers by trail (`seed answer <file> "verify/second@v1.0:lib"`, `seed answer
  <file> "verify/fixture"`), then `$C run -- wiki build verify/second@v1.0:lib --json` and `wiki
  build verify/fixture --json`. `$C page --evidence "$E/04-picker" --hash "#verify%2Ffixture/wiki"
  --click "link=verify/second@v1.0:lib" --expect "<its Interpretation's text>"`: `.view.txt` `at
  /wiki/verify/second@v1.0:lib`, `article "verify/second@v1.0:lib"`, no `button "Update"`, and
  "Describes" links `https://github.com/verify/second/commit/<tag's commit>`; `04b-picker-list`
  (`--hash "#verify%2Ffixture/wiki" --expect Built`) shows `list "Wikis"` with `link
  "verify/fixture"` then `link "verify/second@v1.0:lib"`. `$C page --evidence "$E/04c-old-link" --hash
  "#verify%2Ffixture/wiki/verify%2Fsecond%40v1.0%3Alib" --expect "<its Interpretation's text>"`: the
  same page, `.view.txt` `at /wiki/verify/second@v1.0:lib`.
- **Add from the tab.** `$C drift tag v2.0`; `$C page --evidence "$E/05-tab-add" --click
  "tab=Libraries" --click "textbox=Library" --type verify/second --click "textbox=Tag" --type v2.0
  --click "button=Add" --expect "verify/second@v2.0 added." --expect "Wiki queued"`:
  `POST /api/libraries {"repo":"verify/second","tag":"v2.0"} -> 200`, `tab "Libraries" [selected]`,
  `list "Libraries"` with its row; `$C state` diff: `[wiki]` with `libraries = [{ repo =
  "verify/second", tag = "v2.0" }]` and `wiki-queue.json`.
- **Remove from the tab.** Build it: `seed answer <file> "verify/second@v2.0"`, `$C run -- wiki build
  verify/second@v2.0 --json`; `$C page --evidence "$E/08-tab-remove" --click "tab=Libraries"
  --click "button=Remove verify/second@v2.0…" --expect "Its Wiki leaves the Bucket's files" --click
  "button=Remove verify/second@v2.0" --expect "None added."`: `DELETE
  /api/libraries/verify%2Fsecond%40v2.0 -> 200`; `$C state` diff: `libraries = []`, its line gone
  from `wikis.json`, the Bucket log's `wiki verify/second@v2.0 removed` deleting
  `wiki/verify/second/v2.0/wiki.json`; `$C http GET /bucket/wiki/verify/second/v2.0/wiki.json` is
  404, and `git -C "$BUCKET" show HEAD~1:wiki/verify/second/v2.0/wiki.json` still prints it.
- **Refused.** `$C http --evidence "$E/10-remove-linked" DELETE
  "/api/libraries/verify%2Fsecond%40v1.0%3Alib"` is 409 `verify/second@v1.0:lib is linked by
  verify/fixture`, help `Unlink it in verify/fixture's settings first; ...`; `POST /api/libraries`
  of it answers `already linked by verify/fixture (no-op)`; one with `"path":"../.."` is 400; the
  `state` diff around them is empty.
- **Unlink.** After the refusals, `$C page --evidence "$E/14-unlink" --within "region=verify/fixture"
  --click "region=Libraries" --click "button=Unlink verify/second@v1.0:lib" --expect "None linked" --click "button=Use the
  default Libraries" --gone "set here"`: `.requests.txt` holds `PATCH
  /api/repo/verify/fixture {"libraries":[]}` then `{"libraries":null}`; the section reads `None linked`,
  `status` `Saved` where the chip was, which reads `default` once `Saved` goes (2 seconds); `$C state` diff: the
  Repo's `libraries` line gone from `config.toml`; its Wiki stays in the Bucket, as `wikis.json`
  keeps its build, so linking it again builds nothing.
- **Phone.** `$C page --evidence "$E/13-tab-phone" --width 390 --hash "#/libraries" --expect "None
  added."`: the Project select reads `Libraries`, the page is 390px wide in a 390px window.

## Gotchas

- A Wiki built by hand with `wiki build` while its id still waits in `wiki-queue.json` (no tick
  started it) shows `Wiki queued`, as `status` does: the queue says so until a tick's Run takes it.
- A `POST /api/refresh` with versions queued starts the first at herdr, which the stub refuses, so
  its Run closes failed at a later tick: drive the tab before any refresh, or expect those lines.
- The Libraries tab shows two `button "Add"`, Add a Library's then Add a Repo's: `--click
  button=Add` takes the first, the Library's.
- The chip's × is named `Use the default Libraries` but shows no text: `--gone "Use the default"` passes at
  once; wait for its `set here` to go instead.
- A Repo's `region "Libraries"` is folded: a `--click "textbox=Library"` or `"button=Unlink ..."` on it
  times out. Open it first with `--within "region=<slug>" --click "region=Libraries"`.
- The tab lists only the versions no Repo links: a linked one is removed by unlinking it in its
  Repo's settings, never from the tab.
