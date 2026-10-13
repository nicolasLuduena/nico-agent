# Read a Wiki on the page

Each Project's tab has two views, `Map` and `Wiki`. The Wiki view lists the built Wikis of the
Project's Repos in a picker, heads the open one with the commit it describes and when it was
built, and shows its Component tree beside the open Component: its overview, its Interpretations
grouped by kind, each with Anchor links that open GitHub at the Wiki's commit and the cited lines,
its sub-Components and its Gaps with why. What is open lives in the URL's hash
(`#<project>/wiki/<wiki>/<component>`, each part escaped), so a link opens it and back and forward
move between Components. serve answers the Wikis at `GET /api/wikis` and one at
`GET /api/wiki/<id>`, a Repo's id being its slug.

## Sub-features

- `wiki-routes` `GET /api/wikis` lists each Repo's built Wiki (`id`, `target`, `commit`, `builtAt`, `gaps` counted); `GET /api/wiki/<owner>/<name>` is the Bucket's `wiki.json`; a Wiki not built, or no Repo's, is `404` `{error: "<id> has no Wiki", help}`.
- `wiki-empty` a Project with no Wiki built shows, in its Wiki view, `nico-agent wiki build <slug>` for each of its Repos.
- `wiki-hash` a hash naming a Component opens the page on it: `combobox "Wiki"` holds the Wiki, the header says `Describes <sha> · Built HH:MM`, `navigation "Components"` holds the tree, and `article "<name>"` the Component.
- `wiki-anchor` each Anchor is a link to `https://github.com/<repo>/blob/<commit>/<path>#L<start>-L<end>`, named `<path> <lines>`.
- `wiki-gaps` a Component's Gaps show under `region "Gaps"` with their reason (`Unreadable: an answer failed its checks`, `Not explored: the build's calls ran out`, `Not explored: deeper than the build divides`) and their files folded.
- `wiki-history` a Component opened from the tree or from `region "Components"` is a new hash: back and forward move between Components.
- `wiki-picker` picking another Wiki opens its top Component.
- `wiki-toggle` `link "Map"` shows the map again, and back the Wiki view.
- `wiki-phone` at phone width the tree folds behind `button "Components"`, and an Anchor goes under its claim; nothing is wider than the viewport.

## How to get to it (user POV)

- Click `Wiki` beside `Map` on a Project's tab, then a Component in the tree or under Components.
- Open a link to `<serve>/#<project>/wiki/<owner%2Fname>/<component>`, as one copied from the
  address bar.
- Ask serve: `GET /api/wikis`, `GET /api/wiki/<owner>/<name>`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-view`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project shop --json`, the same for
  `verify/second` with `$SECOND_CLONE`, then `$C seed issues` and `$C seed issues second`.
- `$C state > "$E/state.before.txt"`.

- **Empty.** `$C page --evidence "$E/01-empty" --click link=Wiki --expect "No Wiki of shop yet"`:
  `paragraph` `nico-agent wiki build verify/fixture`, and the same for `verify/second`.
- **Build.** Append `[wiki]` with `calls = 2` to `$CONFIG_DIR/config.toml`. Seed one answer per
  part: for `verify/fixture` a division into one Component `Readme` (`README.md`) with a `role`
  anchored at `README.md` `1`-`3`; for `verify/fixture > Readme` a division into `Title`
  (`README.md`) with a `role` at `1`-`1`, an `invariant` at `3`-`3`, an `effect` at both, and a
  `postcondition` at `2`-`9`; for `verify/second` a leaf with a `role` at `1`-`1`
  (`$C seed answer <file> "verify/fixture > Readme"`). Then `$C run -- wiki build verify/fixture --json`
  is `built`, `"gaps":{"budget":1,"unreadable":1}`, and `$C run -- wiki build verify/second --json`
  `built`.
- **Routes.** `$C http --evidence "$E/04-wikis" GET /api/wikis` is `200`, both Wikis, `verify/fixture`
  with `"gaps":2`; `$C http --evidence "$E/05-wiki" GET /api/wiki/verify/fixture` is `200`,
  Components `index`, `readme` (Gap `unreadable`) and `readme/title` (Gap `budget`);
  `$C http --evidence "$E/06-unknown" GET /api/wiki/verify/nope` is `404`
  `{"error":"verify/nope has no Wiki","help":["Ask for a Wiki /api/wikis lists, or build one: nico-agent wiki build <owner/name>"]}`.
- **By hash, light and dark.** `$C page --evidence "$E/07-hash-desk-light" --hash "#shop/wiki/verify%2Ffixture/readme" --expect "The title names the Repo"`:
  `article "Readme"` with regions `roles`, `invariants`, `effects` (no `postconditions`: dropped),
  `Components` with `link "Title"`, and `Gaps` with `Unreadable: an answer failed its checks`;
  `link "README.md 1"` to `https://github.com/verify/fixture/blob/<commit>/README.md#L1-L1`;
  `.requests.txt` `GET /api/wikis` and `GET /api/wiki/verify/fixture`. Again with
  `--click button=Dark` for `08-hash-desk-dark`.
- **Back and forward.** `$C page --evidence "$E/09-back-forward" --hash "#shop/wiki/verify%2Ffixture" --expect "The fixture is described" --within "navigation=Components" --click link=Readme --expect "The title names the Repo" --within page --click link=Title --expect "Not explored: the build's calls ran out" --history back --expect "The title names the Repo" --history back --expect "The fixture is described" --history forward --expect "The title names the Repo"`.
- **Picker.** `$C page --evidence "$E/10-picker" --hash "#shop/wiki/verify%2Ffixture/readme" --click combobox=Wiki --press ArrowDown --press Enter --expect "The README names the second fixture"`.
- **Map and back.** `$C page --evidence "$E/11-map-toggle" --hash "#shop/wiki/verify%2Ffixture/readme" --click link=Map --expect "Verify: a Ready issue" --history back --expect "The title names the Repo"`.
- **Phone.** `--width 390` with `--click button=Components --expect "Unreadable"` (`12-phone-light`,
  the tree open above the Component), with `--click button=Dark` (`13-phone-dark`), and with
  `--click button=Components --click link=Title --expect "Not explored"` (`14-phone-tree`, the
  tree folded again).
- **After.** `$C state`'s diff: `wikis.json` and two Bucket commits, `wiki verify/fixture <commit>`
  and `wiki verify/second <commit>`; the page wrote nothing. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- `--expect` waits for visible text: a region's name (`Map of shop`) is not text; wait for a title on it.
- An Anchor link opens github.com: read its URL from the ARIA snapshot, never click it in a run.
- Seed each part's answer by its trail; one answer for every part divides again at every depth.
- Picking a Wiki in the `combobox` is a key press in headless Chromium: click it, `ArrowDown`, `Enter`.
