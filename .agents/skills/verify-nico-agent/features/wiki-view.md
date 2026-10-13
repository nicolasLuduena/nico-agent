# Read a Wiki on the page

Each Project's tab has two views, `Map` and `Wiki`. The Wiki view lists the built Wikis of the
Project's Repos in a picker, heads the open one with the commit it describes and when it was
built, and shows its Component tree beside the open Component: its overview, its Interpretations
grouped by kind, each with Anchor links that open GitHub at the Wiki's commit and the cited lines,
its sub-Components and its Gaps with why. A search field over the tree finds words in the Wiki's
Component names, overviews and Interpretations, each hit opening its Component scrolled to it; an
outline of the open Component beside it brings each section's head to the top. Under 1080px the
outline, and under 720px the tree too, open as bottom sheets. What is open lives in the URL's hash
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
- `wiki-search` words typed in `searchbox "Search this Wiki"` put `N found` (or `Nothing found`) and `navigation "Found"` in place of the tree: a `link` per Component whose name or overview holds every word, then per Interpretation that does, each named `<Component> <kind> <text>`; following one opens its Component scrolled to the Interpretation, which has focus.
- `wiki-outline` `navigation "Outline"` holds a `button` for the open Component's name and one per section it shows with how many it holds (`Roles 1`, `Gaps 1`); each brings that head to the top and focuses it; another Component opened, the outline is its.
- `wiki-narrow` under 1080px the outline folds behind `button "Outline"` in the Wiki's row, and opens as a bottom sheet with `button "Close"`; Close or Escape shuts it and focus goes back to `button "Outline"`.
- `wiki-phone` under 720px the tree, with its search, folds behind `button "Components"` too and opens as a sheet the same way; following a link in a sheet shuts it; an Anchor goes under its Interpretation; nothing is wider than the viewport.

## How to get to it (user POV)

- Click `Wiki` beside `Map` on a Project's tab, then a Component in the tree or under Components,
  or type in Search this Wiki and follow a hit, or a head in the outline.
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
- **Build.** `printf '\n[wiki]\ncalls = 2\n' >> "$CONFIG_DIR/config.toml"`. Write one answer per
  part: `$E/answer-fixture.json`, a division into one Component `Readme` (`README.md`) with a
  `role` anchored at `README.md` `1`-`3`; `$E/answer-readme.json`, a division into `Title`
  (`README.md`) with a `role` at `1`-`1`, an `invariant` at `3`-`3`, an `effect` at both, and a
  `postcondition` at `2`-`9`; `$E/answer-second.json`, a leaf with a `role` at `1`-`1`. Seed
  them: `$C seed answer "$E/answer-fixture.json" "verify/fixture"`,
  `$C seed answer "$E/answer-readme.json" "verify/fixture > Readme"` and
  `$C seed answer "$E/answer-second.json" "verify/second"`. Then
  `$C run --evidence "$E/02-build-fixture" -- wiki build verify/fixture --json` is `built`,
  `"gaps":{"budget":1,"unreadable":1}`, and
  `$C run --evidence "$E/03-build-second" -- wiki build verify/second --json` `built`.
- **Routes.** `$C http --evidence "$E/04-wikis" GET /api/wikis` is `200`, both Wikis, `verify/fixture`
  with `"gaps":2`; `$C http --evidence "$E/05-wiki" GET /api/wiki/verify/fixture` is `200`,
  Components `index`, `readme` (Gap `unreadable`) and `readme/title` (Gap `budget`);
  `$C http --evidence "$E/06-unknown" GET /api/wiki/verify/nope` is `404`
  `{"error":"verify/nope has no Wiki","help":["Ask for a Wiki /api/wikis lists, or build one: nico-agent wiki build <owner/name>"]}`.
- **By hash, light and dark.** `$C page --evidence "$E/07-hash-desk-light" --hash "#shop/wiki/verify%2Ffixture/readme" --expect "The title names the Repo"`:
  `article "Readme"` with regions `roles`, `invariants`, `effects` (no `postconditions`: dropped),
  `Components` with `link "Title"`, and `Gaps` with `Unreadable: an answer failed its checks`;
  `link "README.md 1"` to `https://github.com/verify/fixture/blob/<commit>/README.md#L1-L1`;
  `.requests.txt` `GET /api/wikis` and `GET /api/wiki/verify%2Ffixture`. In Dark:
  `$C page --evidence "$E/08-hash-desk-dark" --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Dark --expect "The title names the Repo"`.
- **Back and forward.** `$C page --evidence "$E/09-back-forward" --hash "#shop/wiki/verify%2Ffixture" --expect "The fixture is described" --within "navigation=Components" --click link=Readme --expect "The title names the Repo" --within page --click link=Title --expect "Not explored: the build's calls ran out" --history back --expect "The title names the Repo" --history back --expect "The fixture is described" --history forward --expect "The title names the Repo"`.
- **Picker.** `$C page --evidence "$E/10-picker" --hash "#shop/wiki/verify%2Ffixture/readme" --click combobox=Wiki --press ArrowDown --press Enter --expect "The README names the second fixture"`.
- **Map and back.** `$C page --evidence "$E/11-map-toggle" --hash "#shop/wiki/verify%2Ffixture/readme" --click link=Map --expect "Verify: a Ready issue" --history back --expect "The title names the Repo"`.
- **Phone.** `$C page --evidence "$E/12-phone-light" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Components --expect "Unreadable"`:
  the tree open as a sheet over the Component's foot, its `button "Close"`, each Anchor under its
  Interpretation; `.view.txt` `page 390px wide in a 390px window`.
  `$C page --evidence "$E/13-phone-dark" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Dark --expect "Unreadable"`:
  both sheets shut, `button "Components"` and `button "Outline"` in the Wiki's row. `$C page --evidence "$E/14-phone-tree" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Components --within "navigation=Components" --click link=Title --expect "Not explored"`:
  `article "Title"`, the sheet shut.
- **Search.** `$C page --evidence "$E/15-search-desk-light" --hash "#shop/wiki/verify%2Ffixture" --expect "The fixture is described" --click "searchbox=Search this Wiki" --type sentence --expect "1 found" --click "link~exactly one sentence" --expect "The title names the Repo"`:
  `article "Readme"`, `navigation "Found"` still holding the hit, `.view.txt` `focus on li "The
  README describes the fixture in exactly one sentence after its title. README.md 3"`. In Dark at
  phone width, in the tree's sheet:
  `$C page --evidence "$E/16-search-sheet-phone-dark" --width 360 --hash "#shop/wiki/verify%2Ffixture" --click button=Dark --expect "The fixture is described" --click button=Components --click "searchbox=Search this Wiki" --type readme --expect "5 found"`:
  the sheet open with `button "Close"` and the hits, `.view.txt` `page 360px wide in a 360px window`;
  then following one, where the Component is longer than the window:
  `$C page --evidence "$E/17-search-phone-dark" --width 360 --hash "#shop/wiki/verify%2Ffixture" --click button=Dark --expect "The fixture is described" --click button=Components --click "searchbox=Search this Wiki" --type sentence --click "link~exactly one sentence" --expect "The title names the Repo"`:
  the sheet shut, `.view.txt` scrolled down (`scrolled to 0,<more than 0>`), `page 360px wide in a
  360px window`, focus on that `li`, and `.view.png` shows it in the window with its focus ring.
  `$C page --evidence "$E/18-search-nothing" --hash "#shop/wiki/verify%2Ffixture" --click "searchbox=Search this Wiki" --type "readme nowhere" --expect "Nothing found"`:
  `status` `Nothing found`, no `navigation "Found"` nor `navigation "Components"`.
- **Outline.** `$C page --evidence "$E/19-outline-desk-dark" --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Dark --expect "The title names the Repo" --within "navigation=Outline" --click "button~Gaps" --expect "Unreadable"`:
  `.view.txt` scrolled down and `focus on h3 "Gaps"`. `$C page --evidence "$E/20-outline-follows" --hash "#shop/wiki/verify%2Ffixture/readme" --expect "The title names the Repo" --within "navigation=Components" --click link=Title --expect "Not explored"`:
  `navigation "Outline"` holds `button "Title"` and `button "Gaps 1"` only. At phone width, in Dark:
  `$C page --evidence "$E/21-outline-sheet-phone-dark" --width 360 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Dark --click button=Outline --expect Close`:
  the outline open as a sheet with `button "Close"`, `.view.txt` `page 360px wide in a 360px window`
  and `focus on h2 "Outline"`. `$C page --evidence "$E/22-outline-phone-light" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Outline --within "navigation=Outline" --click "button~Gaps" --expect "Unreadable"`:
  the sheet shut, `.view.txt` scrolled down and `focus on h3 "Gaps"`.
- **Between.** `$C page --evidence "$E/23-narrow-open" --width 900 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Outline --expect Close`:
  the tree beside the Component, the outline open as a sheet. `$C page --evidence "$E/24-narrow-shut" --width 900 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Outline --expect Close --press Escape --gone Close`:
  no `navigation "Outline"`, `.view.txt` `focus on button "Outline"`.
- **After.** `$C state`'s diff: `wikis.json` and two Bucket commits, `wiki verify/fixture <commit>`
  and `wiki verify/second <commit>`; the page wrote nothing. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- `--expect` waits for visible text: a region's name (`Map of shop`) is not text; wait for a title on it.
- An Anchor link opens github.com: read its URL from the ARIA snapshot, never click it in a run.
- Seed each part's answer by its trail; one answer for every part divides again at every depth.
- Picking a Wiki in the `combobox` is a key press in headless Chromium: click it, `ArrowDown`, `Enter`.
- `--type` types into what has focus: click `searchbox "Search this Wiki"` first. A hit's name holds
  its Component, kind and text, so `link~<words of its text>` picks it.
- `--expect` matches text case aside: a section head's word (`Invariants`) is on the page already;
  wait for `Close` to know a sheet opened.
- "Scrolled to it" shows only in `.view.txt` and `.view.png`: `.png` is the whole page.
