# Read a Wiki on the page

Each Project's tab has two views, `Map` and `Wiki`. The Wiki view lists the built Wikis of the
Project's Repos in a picker, heads the open one with the commit it describes and when it was
built, and shows its Component tree beside the open Component: its overview, its Interpretations
grouped by kind, each with Anchor links that open GitHub at the Wiki's commit and the cited lines,
its Relationship diagram (what uses it on the left, what it uses on the right, each other Component
a link opening it), its Explainer when it has one (numbered steps, each opening the Anchors it
cites), its sub-Components and its Gaps with why. What is open lives in the URL's hash
(`#<project>/wiki/<wiki>/<component>`, each part escaped), so a link opens it and back and forward
move between Components. serve answers the Wikis at `GET /api/wikis` and one at
`GET /api/wiki/<id>`, a Repo's id being its slug.

## Sub-features

- `wiki-routes` `GET /api/wikis` lists each Repo's built Wiki (`id`, `target`, `commit`, `builtAt`, `gaps` counted); `GET /api/wiki/<owner>/<name>` is the Bucket's `wiki.json`; a Wiki not built, or no Repo's, is `404` `{error: "<id> has no Wiki", help}`.
- `wiki-empty` a Project with no Wiki built shows, in its Wiki view, `nico-agent wiki build <slug>` for each of its Repos.
- `wiki-hash` a hash naming a Component opens the page on it: `combobox "Wiki"` holds the Wiki, the header says `Describes <sha> · Built HH:MM`, `navigation "Components"` holds the tree, and `article "<name>"` the Component.
- `wiki-anchor` each Anchor is a link to `https://github.com/<repo>/blob/<commit>/<path>#L<start>-L<end>`, named `<path> <lines>`.
- `wiki-relationships` `region "Relationships"` draws the Component and each Component a Relationship joins it to, in both directions, each a `link "<from> <kind> <to>: <description>"` opening that Component; a Component no Relationship touches says `None: no Component of this Wiki uses it, and it uses none.`
- `wiki-explainer` `region "Explainer"`, only on a Component with one, holds its title and one `button "Step <n>[, <lane>]: <caption>"` per step, each lane framed with its name; a step pressed shows its caption and its Anchor links under the drawing, pressed again hides them.
- `wiki-gaps` a Component's Gaps show under `region "Gaps"` with their reason (`Unreadable: an answer failed its checks`, `Not explored: the build's calls ran out`, `Not explored: deeper than the build divides`) and their files folded.
- `wiki-history` a Component opened from the tree or from `region "Components"` is a new hash: back and forward move between Components.
- `wiki-picker` picking another Wiki opens its top Component.
- `wiki-toggle` `link "Map"` shows the map again, and back the Wiki view.
- `wiki-phone` at phone width the tree folds behind `button "Components"`, an Anchor goes under its Interpretation, and the Relationship diagram and the Explainer go top to bottom, fitted to the column; nothing is wider than the viewport.

## How to get to it (user POV)

- Click `Wiki` beside `Map` on a Project's tab, then a Component in the tree, under Components or
  in a Relationship diagram, and a step of an Explainer.
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
  part: `$E/answer-fixture.json`, a division into `Readme`, `Notes` and `Badge` (each
  `README.md`), with Relationships `Notes` `reads` `Readme` ("Notes quote the README's title.")
  and `Readme` `uses` `Badge` ("The README shows the badge."), and a `role` anchored at
  `README.md` `1`-`3`; `$E/answer-readme.json`, a division into `Title` (`README.md`) with a
  `role` at `1`-`1`, an `invariant` at `3`-`3`, an `effect` at both, and a `postcondition` at
  `2`-`9`; `$E/answer-second.json`, a leaf with a `role` at `1`-`1` and an Explainer "How the
  README reads": step 1 "The title names the second fixture." at `1`-`1` and step 2 "A blank line
  ends the heading." at `2`-`2`, both in lane `Heading`, step 3 "The last line says what the
  fixture is for." at `3`-`3` and `1`-`1` in lane `Body`, arrows 1 to 2 labelled `then` and 2 to
  3. Seed
  them: `$C seed answer "$E/answer-fixture.json" "verify/fixture"`,
  `$C seed answer "$E/answer-readme.json" "verify/fixture > Readme"` and
  `$C seed answer "$E/answer-second.json" "verify/second"`. Then
  `$C run --evidence "$E/02-build-fixture" -- wiki build verify/fixture --json` is `built`,
  `"gaps":{"budget":3,"unreadable":1}` (`Notes`, `Badge` and `Title` past the 2 calls), and
  `$C run --evidence "$E/03-build-second" -- wiki build verify/second --json` `built`.
- **Routes.** `$C http --evidence "$E/04-wikis" GET /api/wikis` is `200`, both Wikis, `verify/fixture`
  with `"gaps":4`; `$C http --evidence "$E/05-wiki" GET /api/wiki/verify/fixture` is `200`,
  Components `index`, `readme` (Gap `unreadable`), `notes` and `badge` (Gap `budget`, each with
  its Relationship) and `readme/title` (Gap `budget`); `GET /api/wiki/verify/second`'s `index`
  carries the `explainer`;
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
- **Relationships, light and dark.** `$C page --evidence "$E/15-relationships-light" --hash "#shop/wiki/verify%2Ffixture/readme" --expect "The title names the Repo"`:
  `region "Relationships"` with `link "Notes reads Readme: Notes quote the README's title."` and
  `link "Readme uses Badge: The README shows the badge."`, Notes left of Readme and Badge right of
  it, each arrow naming its kind. `$C page --evidence "$E/16-relationships-dark" --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Dark --within "region=Relationships" --click "link~Notes reads Readme" --expect "Notes on the README."`:
  `article "Notes"`, its diagram Notes and Readme, the hash `#shop/wiki/verify%2Ffixture/notes`.
  `$C page --evidence "$E/17-relationships-none" --hash "#shop/wiki/verify%2Ffixture" --expect "None: no Component of this Wiki uses it"`.
- **Explainer, light and dark.** `$C page --evidence "$E/18-explainer-light" --hash "#shop/wiki/verify%2Fsecond" --expect "How the README reads" --click "button~Step 3" --expect "The last line says what the fixture is for."`:
  `region "Explainer"` with `button "Step 1, Heading: The title names the second fixture."`,
  `"Step 2, Heading: …"` and `"Step 3, Body: …"`, step 3 framed in full ink and expanded, and under the
  drawing `link "README.md 3"` and `link "README.md 1"`; the lanes `HEADING` and `BODY` framed.
  `$C page --evidence "$E/19-explainer-dark" --hash "#shop/wiki/verify%2Fsecond" --click button=Dark --click "button~Step 1" --expect "README.md 1" --click "button~Step 1" --expect "Open a step for the lines it cites."`.
  `article "Readme"` of verify/fixture has no `region "Explainer"`.
- **Phone.** `$C page --evidence "$E/12-phone-light" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Components --expect "Unreadable"`:
  the tree open above the Component, each Anchor under its Interpretation.
  `$C page --evidence "$E/13-phone-dark" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Dark --expect "Unreadable"`:
  the tree folded. `$C page --evidence "$E/14-phone-tree" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --click button=Components --click link=Title --expect "Not explored"`:
  `article "Title"`, the tree folded again.
  `$C page --evidence "$E/20-phone-explainer" --width 390 --hash "#shop/wiki/verify%2Fsecond" --click "button~Step 2" --expect "A blank line ends the heading."`
  and `$C page --evidence "$E/21-phone-relationships" --width 390 --hash "#shop/wiki/verify%2Ffixture/readme" --expect "The title names the Repo"`:
  both drawn top to bottom, inside the column.
- **After.** `$C state`'s diff: `wikis.json` and two Bucket commits, `wiki verify/fixture <commit>`
  and `wiki verify/second <commit>`; the page wrote nothing. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- `--expect` waits for visible text: a region's name (`Map of shop`) is not text; wait for a title on it.
- An Anchor link opens github.com: read its URL from the ARIA snapshot, never click it in a run.
- Seed each part's answer by its trail; one answer for every part divides again at every depth.
- A Relationship link's name carries its description: click it by `link~<from> <kind> <to>`.
- The Relationship diagram and the Explainer are laid out once the column has a width: `--expect`
  their text first, then read the snapshot.
- Picking a Wiki in the `combobox` is a key press in headless Chromium: click it, `ArrowDown`, `Enter`.
