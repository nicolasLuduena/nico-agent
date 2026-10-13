# Read a Wiki on its page

Each Wiki has a page of its own at `/wiki/<id>`, a Repo's `<owner>/<name>` or a Library version's
`<owner>/<name>@<tag>[:<path>]` (its `@` and `:` as written), the open Component in the URL's
fragment (`#<component>`); serve answers the app there as it does at `/`, through the tunnel too.
The page holds the Wiki alone: a masthead line with `link "Board"`, the Wiki's id, and its build
and buttons ([wiki-buttons.md](./wiki-buttons.md), [wiki-progress.md](./wiki-progress.md)); its
Component tree with search beside the open Component and its outline. The Component reads in
order: its trail, its name, the one file it cites said once when it cites one, its overview, its
Interpretations as one list in the build's order, each with its kind and its Anchors set quietly,
each opening GitHub at the Wiki's commit and lines, then whichever of its Relationship
diagram, its Explainer, its sub-Components (each with its overview's first sentence) and its Gaps
it has, and a link to the next Component in the tree's order. Under 1080px the outline, and under
720px the tree too, open as bottom sheets. A Project tab's Wiki view lists its Wikis, each a link to
its page, and keeps the Wiki settings; an old link to a Component on the Board,
`#<project>/wiki/<wiki>/<component>`, opens the page at that Component. Back and forward move
between Components. serve answers the Wikis at `GET /api/wikis` and one at `GET /api/wiki/<id>`.

## Sub-features

- `wiki-routes` `GET /api/wikis` lists each Repo's built Wiki (`id`, `target`, `commit`, `builtAt`, `gaps` counted, and its build: see [wiki-buttons.md](./wiki-buttons.md)), and one never built while its first build waits, runs or failed, with `commit` null ([wiki-progress.md](./wiki-progress.md)); `GET /api/wiki/<owner>/<name>` is the Bucket's `wiki.json` with `base`, `behind` and `stale` (see [wiki-update.md](./wiki-update.md)); a Wiki not built, or no Repo's, is `404` `{error: "<id> has no Wiki", help}`.
- `wiki-page-route` `GET /wiki/<id>` (any id, a Library version's too) is `200` `text/html`, the app's page, as `GET /` is.
- `wiki-list` a Project's Wiki view (`#<project>/wiki`) holds `button "Wiki settings"` and `list "Wikis"`: per Wiki a `link "<id>"` to `/wiki/<id>` and where its build stands (`Built HH:MM · describes <sha>`, or `Not built yet`, after `Building` or `Queued`; `Last build failed` and why under it).
- `wiki-empty` a Project with no Wiki built shows, in its Wiki view, `nico-agent wiki build <slug>` for each of its Repos.
- `wiki-page` `/wiki/<id>#<component>` opens the page on it: `banner` with `link "Board"` (to `/`), the id, `Describes <sha> · Built HH:MM · Up to date with main` (how far behind and what is Stale: [wiki-update.md](./wiki-update.md)); `navigation "Components"` holds the tree, `article "<name>"` the Component, `heading "<name>" [level=1]`; nothing of the Board (no `tablist "Projects"`, no `Nothing needs you`).
- `wiki-old-link` `/#<project>/wiki/<owner%2Fname>/<component>` lands at `/wiki/<owner>/<name>#<component>`; `#<project>/wiki` alone stays the Board's Wiki view.
- `wiki-unknown` `/wiki/<id>` of no Wiki says `No Wiki is named <id>.` with a `link "Board"`.
- `wiki-trail` `navigation "Trail"` holds a `link` per Component above the open one, from the top down; the top one has none.
- `wiki-interpretations` `region "Interpretations"`, only on a Component with any, is one list in the build's order, each `listitem` its kind (`role`, `invariant`, …), then its sentence (`Stale` first when it is), then its Anchors.
- `wiki-anchor` each Anchor is a link to `https://github.com/<repo>/blob/<commit>/<path>#L<start>-L<end>` titled and named by its full path: `<path> <lines>` showing `<file's name> <lines>` (with the folders that tell two of a name apart); when every Anchor of the Component is in one file, `Every line it cites is in <path>` (a `link` to the file) and each named `<path> line <n>` / `<path> lines <a>–<b>`, showing `line <n>` / `lines <a>–<b>`.
- `wiki-relationships` `region "Relationships"`, only on a Component a Relationship joins to another either way, draws the Component and each Component a Relationship joins it to, each a `link "<from> <kind> <to>: <description>"` opening that Component.
- `wiki-explainer` `region "Explainer"`, only on a Component with one, holds its title and one `button "Step <n>[, <lane>]: <caption>"` per step, each lane framed with its name; a step pressed shows its caption and its Anchor links under the drawing, pressed again hides them.
- `wiki-parts` `region "Components"` holds each sub-Component's `link` and its overview's first sentence, whole.
- `wiki-gaps` a Component's Gaps show under `region "Gaps"` with their reason (`Unreadable: an answer failed its checks`, `Not explored: the build's calls ran out`, `Not explored: deeper than the build divides`) and their files folded.
- `wiki-next` the article ends with `link "Next <name>"`, the next Component in the tree's order (its first sub-Component, else the next one beside it or beside a Component above it); the last has none.
- `wiki-focus` another Component opened (tree, Next, a sheet's link) moves focus to its `heading` level 1, with no focus ring after a click in `.view.png`.
- `wiki-history` a Component opened from the tree, from `region "Components"` or by Next is a new fragment: back and forward move between Components.
- `wiki-search` words typed in `searchbox "Search this Wiki"` put `N found` (or `Nothing found`) and `navigation "Found"` in place of the tree: a `link` per Component whose name or overview holds every word, then per Interpretation that does, each named `<Component> <kind> <text>`; following one opens its Component scrolled to the Interpretation, which has focus.
- `wiki-outline` `navigation "Outline"` holds a `button` for the open Component's name and one per section it shows with how many it holds (`Interpretations 3`, `Gaps 1`); each brings that head to the top and focuses it; another Component opened, the outline is its.
- `wiki-narrow` under 1080px the outline folds behind `button "Outline"` after the Wiki's id, and opens as a bottom sheet with `button "Close"`; Close or Escape shuts it and focus goes back to `button "Outline"`.
- `wiki-phone` under 720px the tree, with its search, folds behind `button "Components"` too and opens as a sheet the same way; following a link in a sheet shuts it; the kind goes above its sentence; the Relationship diagram and the Explainer go top to bottom, fitted to the column; nothing is wider than the viewport.
- `wiki-tunnel` the page opens through the tunnel stand-in as on `127.0.0.1`.

## How to get to it (user POV)

- Click `Wiki` beside `Map` on a Project's tab, then a Wiki's name; on its page, a Component in the
  tree, its trail, under Components, in a Relationship diagram or Next, and a step of an Explainer;
  or type in Search this Wiki and follow a hit, or a head in the outline.
- Open a link to `<serve>/wiki/<owner>/<name>#<component>`, as a PR body, the morning summary or an
  agent's answer can point at one, or one copied from the address bar; an old
  `<serve>/#<project>/wiki/<owner%2Fname>/<component>`.
- Ask serve: `GET /wiki/<owner>/<name>`, `GET /api/wikis`, `GET /api/wiki/<owner>/<name>`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-view`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project shop --json`, the same for
  `verify/second` with `$SECOND_CLONE`, then `$C seed issues` and `$C seed issues second`.
- `$C drift base docs/notes.md` and `$C drift base docs/guide.md`: the fixture holds `README.md` and
  two docs, so a division's claim can cite more than one of its Components (see Gotchas).
- `$C state > "$E/state.before.txt"`.

- **Empty.** `$C page --evidence "$E/01-empty" --hash "#shop/wiki" --expect "No Wiki of shop yet"`:
  `paragraph` `nico-agent wiki build verify/fixture`, and the same for `verify/second`; `button "Wiki settings"`.
- **Build.** `printf '\n[wiki]\ncalls = 7\n' >> "$CONFIG_DIR/config.toml"`: the top part, its three
  Components and Readme's three correction rounds, each answered with Readme's answer again, leave
  none for Title. Write one answer per part: `$E/answer-fixture.json`, a division into `Readme`
  (`README.md`, `docs/notes.md`), `Notes` and `Badge` (each `README.md`), with Relationships
  `Notes` `reads` `Readme` ("Notes quote the README's title.") and `Readme` `uses` `Badge` ("The
  README shows the badge."), and a `role` "The fixture is described by its README." anchored at
  `README.md` `1`-`3` and `docs/guide.md` `1`-`1`; `$E/answer-readme.json`, a division into `Title`
  (`docs/notes.md`) with, in `README.md`, a `role` at `1`-`1`, an `invariant` at `3`-`3`, an
  `effect` at both, and a `postcondition` at `2`-`9`; `$E/answer-notes.json` and `$E/answer-badge.json`, leaves with no Interpretations,
  overviews "Notes on the README." and "The badge the README shows."; `$E/answer-second.json`, a
  leaf with a `role` at `1`-`1` and an Explainer "How the README reads": step 1 "The title names
  the second fixture." at `1`-`1` and step 2 "A blank line ends the heading." at `2`-`2`, both in
  lane `Heading`, step 3 "The last line says what the fixture is for." at `3`-`3` and `1`-`1` in
  lane `Body`, arrows 1 to 2 labelled `then` and 2 to 3. Seed
  them: `$C seed answer "$E/answer-fixture.json" "verify/fixture"`,
  `$C seed answer "$E/answer-readme.json" "verify/fixture > Readme"`,
  `$C seed answer "$E/answer-notes.json" "verify/fixture > Notes"`,
  `$C seed answer "$E/answer-badge.json" "verify/fixture > Badge"` and
  `$C seed answer "$E/answer-second.json" "verify/second"`. Then
  `$C run --evidence "$E/02-build-fixture" -- wiki build verify/fixture --json` is `built`,
  `"gaps":{"budget":1,"unreadable":1}` (`Title` past the 7 calls), and
  `$C run --evidence "$E/03-build-second" -- wiki build verify/second --json` `built`.
- **Routes.** `$C http --evidence "$E/04-wikis" GET /api/wikis` is `200`, both Wikis, `verify/fixture`
  with `"gaps":2`; `$C http --evidence "$E/05-wiki" GET /api/wiki/verify/fixture` is `200`,
  Components `index`, `readme` (Gap `unreadable`), `notes` and `badge`, `readme` and `notes` each
  with its Relationship, and `readme/title` (Gap `budget`); `GET /api/wiki/verify/second`'s `index`
  carries the `explainer`;
  `$C http --evidence "$E/06-unknown" GET /api/wiki/verify/nope` is `404`
  `{"error":"verify/nope has no Wiki","help":["Ask for a Wiki /api/wikis lists, or build one: nico-agent wiki build <owner/name>[@<tag>[:<path>]]"]}`.
- **The page's route.** `$C http --evidence "$E/06b-page-route" GET /wiki/verify/fixture` and
  `$C http --evidence "$E/06c-page-route-library" GET "/wiki/verify/second@v1.0:lib"` are `200`,
  `Content-Type: text/html; charset=utf-8`, the body `GET /` answers.
- **The Board's list.** `$C page --evidence "$E/07-list" --hash "#shop/wiki" --expect Built`: `list
  "Wikis"` with `link "verify/fixture"` (`/url: /wiki/verify/fixture`) and `link "verify/second"`,
  each `Built HH:MM · describes <sha>`. `$C page --evidence "$E/07b-list-to-page" --hash "#shop/wiki"
  --click link=verify/fixture --expect "The fixture is described"`: `.view.txt` `at /wiki/verify/fixture`.
- **By path, light and dark.** `$C page --evidence "$E/08-page-desk-light" --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo"`:
  `banner` with `link "Board"` and `verify/fixture`; `article "Readme"` with `navigation "Trail"`
  (`link "verify/fixture"`), `heading "Readme" [level=1]`, `Every line it cites is in` `link
  "README.md"`, `region "Interpretations"` with `role`, `invariant` and `effect` (no `postcondition`:
  dropped), each `link "README.md line 1"` (or `line 3`) to
  `https://github.com/verify/fixture/blob/<commit>/README.md#L1-L1`, `region "Relationships"`,
  `region "Components"` with `link "Title"`, `region "Gaps"` with `Unreadable: an answer failed its
  checks`, and `link "Next Title"`; no `tablist`; `.requests.txt` `GET /api/wikis` and `GET
  /api/wiki/verify%2Ffixture`, no `GET /api/status`. In Dark:
  `$C page --evidence "$E/08b-page-desk-dark" --scheme dark --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo"`.
- **An old link.** `$C page --evidence "$E/08c-old-link" --hash "#shop/wiki/verify%2Ffixture/readme" --expect "The title names the Repo"`:
  `.view.txt` `at /wiki/verify/fixture#readme`, `article "Readme"`.
- **No such Wiki.** `$C page --evidence "$E/08d-unknown" --path /wiki/verify/nope --expect "No Wiki is named verify/nope"`:
  the sentence with `link "Board"`. `$C page --evidence "$E/08e-board-link" --path /wiki/verify/fixture --click link=Board --expect "Nothing needs you"`:
  `.view.txt` `at /`.
- **Back and forward.** `$C page --evidence "$E/09-back-forward" --path /wiki/verify/fixture --expect "The fixture is described" --within "navigation=Components" --click link=Readme --expect "The title names the Repo" --within page --click link=Title --expect "Not explored: the build's calls ran out" --history back --expect "The title names the Repo" --history back --expect "The fixture is described" --history forward --expect "The title names the Repo"`:
  `.view.txt` `at /wiki/verify/fixture#readme`, `focus on h1 "Readme"`, and `.view.png` no ring round it.
- **Next.** `$C page --evidence "$E/10-next" --path /wiki/verify/fixture --hash "#readme" --click "link~Next" --expect "Not explored"`:
  `.view.txt` `at /wiki/verify/fixture#readme/title`, `focus on h1 "Title"`, no ring in `.view.png`.
- **Relationships, light and dark.** `$C page --evidence "$E/25-relationships-light" --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo"`:
  `region "Relationships"` with `link "Notes reads Readme: Notes quote the README's title."` and
  `link "Readme uses Badge: The README shows the badge."`, Notes left of Readme and Badge right of
  it, each arrow naming its kind. `$C page --evidence "$E/26-relationships-dark" --scheme dark --path /wiki/verify/fixture --hash "#readme" --within "region=Relationships" --click "link~Notes reads Readme" --expect "Notes on the README."`:
  `article "Notes"`, its diagram Notes and Readme, `.view.txt` `at /wiki/verify/fixture#notes`.
  `$C page --evidence "$E/27-relationships-none" --path /wiki/verify/second --expect "How the README reads"`:
  no `region "Relationships"`, and the outline no `button "Relationships"`.
- **Explainer, light and dark.** `$C page --evidence "$E/28-explainer-light" --path /wiki/verify/second --expect "How the README reads" --click "button~Step 3" --expect "The last line says what the fixture is for."`:
  `region "Explainer"` with `button "Step 1, Heading: The title names the second fixture."`,
  `"Step 2, Heading: …"` and `"Step 3, Body: …"`, step 3 framed in full ink and expanded, and under the
  drawing `link "README.md line 3"` and `link "README.md line 1"` (every Anchor of verify/second's
  is in `README.md`); the lanes `HEADING` and `BODY` framed.
  `$C page --evidence "$E/29-explainer-dark" --scheme dark --path /wiki/verify/second --click "button~Step 1" --expect "line 1" --click "button~Step 1" --expect "Open a step for the lines it cites."`.
  `article "Readme"` of verify/fixture has no `region "Explainer"`.
- **Phone.** `$C page --evidence "$E/12-phone-light" --width 390 --path /wiki/verify/fixture --hash "#readme" --click button=Components --expect "Unreadable"`:
  the tree open as a sheet over the Component's foot, its `button "Close"`, `focus on h2 "Components"`;
  `.view.txt` `page 390px wide in a 390px window`.
  `$C page --evidence "$E/13-phone-dark" --width 390 --scheme dark --path /wiki/verify/fixture --hash "#readme" --expect "Unreadable"`:
  both sheets shut, `button "Components"` and `button "Outline"` in the masthead, each kind above its
  sentence. `$C page --evidence "$E/14-phone-tree" --width 390 --path /wiki/verify/fixture --hash "#readme" --click button=Components --within "navigation=Components" --click link=Title --expect "Not explored"`:
  `article "Title"`, the sheet shut, `focus on h1 "Title"`, no ring in `.view.png`.
  `$C page --evidence "$E/30-phone-explainer" --width 390 --path /wiki/verify/second --click "button~Step 2" --expect "A blank line ends the heading."`
  and `$C page --evidence "$E/31-phone-relationships" --width 390 --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo"`:
  both drawn top to bottom, inside the column.
- **Search.** `$C page --evidence "$E/15-search-desk-light" --path /wiki/verify/fixture --expect "The fixture is described" --click "searchbox=Search this Wiki" --type sentence --expect "1 found" --click "link~exactly one sentence" --expect "The title names the Repo"`:
  `article "Readme"`, `navigation "Found"` still holding the hit, `.view.txt` `focus on li "invariant
  The README describes the fixture in exactly one sentence after its title. README.md line 3"`. In
  Dark at phone width, in the tree's sheet:
  `$C page --evidence "$E/16-search-sheet-phone-dark" --width 360 --scheme dark --path /wiki/verify/fixture --expect "The fixture is described" --click button=Components --click "searchbox=Search this Wiki" --type readme --expect "found"`:
  the sheet open with `button "Close"` and the hits, `.view.txt` `page 360px wide in a 360px window`;
  then following one, where the Component is longer than the window:
  `$C page --evidence "$E/17-search-phone-dark" --width 360 --scheme dark --path /wiki/verify/fixture --expect "The fixture is described" --click button=Components --click "searchbox=Search this Wiki" --type sentence --click "link~exactly one sentence" --expect "The title names the Repo"`:
  the sheet shut, `.view.txt` scrolled down (`scrolled to 0,<more than 0>`), `page 360px wide in a
  360px window`, focus on that `li`, and `.view.png` shows it in the window with its focus ring.
  `$C page --evidence "$E/18-search-nothing" --path /wiki/verify/fixture --click "searchbox=Search this Wiki" --type "readme nowhere" --expect "Nothing found"`:
  `status` `Nothing found`, no `navigation "Found"` nor `navigation "Components"`.
- **Outline.** `$C page --evidence "$E/19-outline-desk-dark" --scheme dark --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo" --within "navigation=Outline" --click "button~Gaps" --expect "Unreadable"`:
  `.view.txt` scrolled down and `focus on h2 "Gaps"`. `$C page --evidence "$E/20-outline-follows" --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo" --within "navigation=Components" --click link=Title --expect "Not explored"`:
  `navigation "Outline"` holds `button "Title"`, `button "Relationships"` and `button "Gaps 1"` only. At phone width, in Dark:
  `$C page --evidence "$E/21-outline-sheet-phone-dark" --width 360 --scheme dark --path /wiki/verify/fixture --hash "#readme" --click button=Outline --expect Close`:
  the outline open as a sheet with `button "Close"`, `.view.txt` `page 360px wide in a 360px window`
  and `focus on h2 "Outline"`. `$C page --evidence "$E/22-outline-phone-light" --width 390 --path /wiki/verify/fixture --hash "#readme" --click button=Outline --within "navigation=Outline" --click "button~Gaps" --expect "Unreadable"`:
  the sheet shut, `.view.txt` scrolled down and `focus on h2 "Gaps"`.
- **Between.** `$C page --evidence "$E/23-narrow-open" --width 900 --path /wiki/verify/fixture --hash "#readme" --click button=Outline --expect Close`:
  the tree beside the Component, the outline open as a sheet, `button "Outline"` after the Wiki's id.
  `$C page --evidence "$E/24-narrow-shut" --width 900 --path /wiki/verify/fixture --hash "#readme" --click button=Outline --expect Close --press Escape --gone Close`:
  no `navigation "Outline"`, `.view.txt` `focus on button "Outline"`.
- **Through the tunnel.** `$C tunnel start`, then `$C page --tunnel --evidence "$E/32-tunnel" --path /wiki/verify/fixture --hash "#readme" --expect "The title names the Repo"`:
  `article "Readme"`, `.view.txt` `at /wiki/verify/fixture#readme`; `$TUNNEL_LOG` has `GET
  /wiki/verify/fixture 200`.
- **A real Wiki** (the Evidence of how it reads). After `repo add verify/fixture`, `$C seed wiki
  <a Repo's wiki.json> <its clone>` and `$C run -- repo add <its slug> --path <the clone it printed>
  --json`; then `$C page --evidence "$E/thoth/after-desk-light" --width 1440 --path /wiki/<slug>
  --hash "#<component>" --expect "<its name>"`, and `--scheme dark`, and both at `--width 390`.
- **After.** `$C state`'s diff: `wikis.json` and two Bucket commits, `wiki verify/fixture <commit>`
  and `wiki verify/second <commit>`; the page wrote nothing. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- `--expect` waits for visible text: a region's name (`Map of shop`) is not text; wait for a title on it.
- An Anchor link opens github.com: read its URL from the ARIA snapshot, never click it in a run.
- Seed each part's answer by its trail; one answer for every part divides again at every depth.
- A division's Interpretation whose Anchors all fall in the files of one of its Components fails
  its check: the top part's `role` cites `docs/guide.md`, in no Component, and Readme's cite
  `README.md`, not in Title.
- A Relationship link's name carries its description: click it by `link~<from> <kind> <to>`.
- The Relationship diagram and the Explainer are laid out once the column has a width: `--expect`
  their text first, then read the snapshot.
- The page is not the Board: it has no theme switch, so `--scheme dark` stands for Dark (System, the
  default, follows it); `button=Dark` is the Board's.
- `--tunnel` comes before every other `page` argument.
- `--type` types into what has focus: click `searchbox "Search this Wiki"` first. A hit's name holds
  its Component, kind and text, so `link~<words of its text>` picks it.
- `--expect` matches text case aside: a section head's word (`Interpretations`) is on the page
  already; wait for `Close` to know a sheet opened.
- "Scrolled to it" shows only in `.view.txt` and `.view.png`: `.png` is the whole page.
