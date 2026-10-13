# Define the names a Wiki's text uses, as Terms

A wiki build asks each part for its Terms beside its Interpretations, in both shapes of answer: each
a name the part's overview, Interpretations, Explainer or Relationships use that a newcomer could
not know, with one sentence of what it stands for, citing the lines that declare it. Code checks
each one: a Term whose name the Component's text never uses (case aside), whose name is not in the
lines it cites, or whose Anchors are not real lines goes back to the model in the correction round,
by its id with what failed, as a failing Interpretation does. Terms have no cap and never count
against the Interpretations. On a Wiki's page, a Component with Terms shows a `Terms` section after
its overview and before its Interpretations, each name in the margin where a kind goes (above its
meaning on a phone), with its meaning and Anchors; the outline lists `Terms` with its count, and
search finds a Term by its name or meaning, its hit labelled `TERM`. A Term citing a file changed on
the Base is `STALE`, as an Interpretation is, on the page, at `GET /api/wiki/<id>` and through the
MCP's `get_component`, which returns a Component's `terms`; `find_component` finds a Component by a
Term's name. A Wiki with no Terms, as every one built before them, reads as before.

## Sub-features

- `terms-asked` each part's prompt holds the `"terms": [{"name": "...", "meaning": "...", "anchors": [...]}]` field in both the leaf's and the division's shape.
- `terms-checked` a Term failing a check goes back in the correction round as `term <n> {...}: <why>`: `<name> is not used in this Component's text, so it is no Term`, `<name> is not in the lines it cites, which must declare it`, or an Anchor's own failure (`lines 1-9 are not inside README.md (3 lines)`); corrected, it is kept and its part leaves no Gap.
- `terms-stored` the Component in the Bucket's `wiki.json` and at `GET /api/wiki/<id>` carries `terms`, each `{name, meaning, anchors}`; a Component with none has no `terms` key.
- `terms-page` `region "Terms"` comes between the overview and `region "Interpretations"`, each Term a `term` (its name) and a `definition` (its meaning, then its Anchor links), its name in the 144px margin on a desk and above its meaning at phone width, in light and dark.
- `terms-outline` `navigation "Outline"` holds `button "Terms <n>"` between the Component's name and `button "Interpretations <n>"`; pressed, it brings `heading "Terms"` to the top with focus.
- `terms-search` words in a Term's name or meaning put a hit `link "<Component> Term <name>: <meaning>"` after the Component hits and before the Interpretation ones, `TERM` at its right and the name in 600; followed, the Term's row has focus and its ring.
- `terms-stale` once the Base changes a file a Term cites, `GET /api/wiki/<id>` and `get_component` give it `"stale": true` (the Wiki's `stale` still counts Interpretations only) and the page reads `Stale <meaning>`.
- `terms-mcp` `get_component` returns the Component's `terms`; `find_component` finds a Component by a word only a Term's name holds; `initialize`'s `instructions` name Terms.
- `terms-none` a Wiki whose `wiki.json` has no `terms` key reads on the page, with no `region "Terms"` and no `button "Terms"`, and through `get_component` and `find_component`.

## How to get to it (user POV)

- Build a Wiki (`nico-agent wiki build <owner/name>`, or the loop's nightly build, or the page's
  Update and Rebuild); read the corrections the model was sent in its Run's pane.
- Open the Wiki's page, `/wiki/<owner>/<name>`, at a Component with Terms; use its outline, or type
  in Search this Wiki and follow a `TERM` hit.
- Ask through `nico-agent mcp`: `get_component`, `find_component`.
- Ask serve: `GET /api/wiki/<owner>/<name>`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-terms`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C state > "$E/state.before.txt"`.

- **Build, a Term corrected.** Write `$E/answer.json`, a leaf with overview "The verify/fixture Repo,
  standing in for a real one; its README names it.", a `role` "The README says a verify-nico-agent
  run drives it." at `README.md` `1`-`3`, and five Terms: `fixture` and `verify-nico-agent`, each
  at `3`-`3`; `Bucket` at `1`-`1` (its text never says it); `README` at `3`-`3` (not in that line);
  `verify/fixture` at `1`-`9` (past the end). Write `$E/correction.json`, the same with only
  `fixture`, `verify-nico-agent` and `verify/fixture` at `1`-`1`. `$C seed answer "$E/answer.json"`,
  `$C seed correction "$E/correction.json"`, then
  `$C run --evidence "$E/01-build" -- wiki build verify/fixture --json`: exit `0`, `"gaps":{}`, stderr
  `verify/fixture: 3 claim(s) failed, sent back (round 1 of 3, call 2 of 48)`. `$OUTSIDE_LOG`'s
  correction call (`-s ses_verify_1`) lists `term 3 ...: Bucket is not used in this Component's
  text, so it is no Term`, `term 4 ...: README is not in the lines it cites, which must declare it`
  and `term 5 ...: lines 1-9 are not inside README.md (3 lines)`; the first call's prompt holds the
  `"terms": [{"name": "...", "meaning": "...", "anchors"` shape twice.
- **Stored.** `$C http --evidence "$E/02-wiki" GET /api/wiki/verify/fixture`: `index`'s `terms` are
  `fixture`, `verify-nico-agent` and `verify/fixture` (at `1`-`1`), in that order.
- **On the page, desk and phone, light and dark.** `$C page --evidence "$E/03-page-desk-light" --width 1440 --path /wiki/verify/fixture --expect "The skill that drives"`:
  `region "Terms"` after the overview's `paragraph` and before `region "Interpretations"`, with
  `term: fixture` then its `definition` (the meaning, then `link "README.md line 3"`), and the same
  for the others; `.png` each name in the margin, `verify-nico-agent` broken at its hyphen. Then
  `04-page-desk-dark` with `--scheme dark`, `05-page-phone-light` and `06-page-phone-dark` with
  `--width 390`: on the phone each name above its meaning, `page 390px wide in a 390px window`.
- **Outline.** `03-page-desk-light.aria.txt`'s `navigation "Outline"`: `button "verify/fixture"`,
  `button "Terms 3"`, `button "Interpretations 1"`. `$C page --evidence "$E/07-outline-terms" --path /wiki/verify/fixture --expect "The skill that drives" --within "navigation=Outline" --click "button~Terms"`:
  `focus on h2 "Terms"`.
- **Search.** `$C page --evidence "$E/08-search-desk-light" --width 1440 --path /wiki/verify/fixture --expect "The skill that drives" --click "searchbox=Search this Wiki" --type skill --expect "1 found" --click "link~The skill that drives"`:
  `navigation "Found"` with `link "verify/fixture Term verify-nico-agent: The skill that drives
  nico-agent's binary and page in a scratch home."`, `TERM` at its right; `.view.txt` `focus on div
  "verify-nico-agent The skill ..."`, its ring in `.view.png`. At phone width in Dark:
  `$C page --evidence "$E/09-search-phone-dark" --width 390 --scheme dark --path /wiki/verify/fixture --expect "The skill that drives" --click button=Components --click "searchbox=Search this Wiki" --type fixture --expect found`:
  `3 found`, the Component's hit first, then the `fixture` and `verify/fixture` Terms', each `TERM`.
- **Through the MCP.** Exchange `10-mcp` (`initialize`, `notifications/initialized`, `get_component`
  `{"wiki":"verify/fixture","id":"index"}`, `find_component` `{"wiki":"verify/fixture","query":"agent"}`):
  `instructions` say `each Component defining the names its text uses (its Terms)`; `index` with
  the three `terms`; `find_component` `[{"id":"index",...}]`, found by `verify-nico-agent` alone.
- **Stale.** `$C drift base` (README.md rewritten). `$C http --evidence "$E/12-wiki-stale" GET /api/wiki/verify/fixture`:
  each Term `"stale": true`, the Wiki `"stale":1` (its one Interpretation), `"behind":1`.
  `13-stale-desk-light` and `14-stale-phone-dark` as above: each `definition` reads `Stale <meaning>`.
  Exchange `15-mcp-stale`: `get_component`'s `terms` each `"stale": true`.
- **No Terms.** `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`; seed a leaf answer
  with no `terms` for `"verify/second"` and build it (`16-build-no-terms`): the Bucket's
  `wiki/verify/second/wiki.json` has no `terms` key. `$C page --evidence "$E/17-no-terms-page" --path /wiki/verify/second --expect "The README names the second fixture"`:
  no `region "Terms"`, the outline `button "verify/second"` and `button "Interpretations 1"` only.
  Exchange `18-mcp-no-terms`: `get_component` and `find_component` `{"query":"second"}` answer.
- **After.** `$C state`'s diff: `wikis.json` and the Bucket commits of the builds; the page, the
  routes and `mcp` wrote nothing. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- A Term's name must be in the text and in the lines it cites, case aside, as a substring: the
  fixture's `README.md` holds only `verify/fixture`, `verify-nico-agent` and `fixture`, so a Term
  for any other word fails.
- `find_component` matches words, split at anything not a letter or digit: `verify-nico-agent` is
  found by `agent`, never by `verify-nico-agent` as one word.
- A Term's hit is named `<Component> Term <name>: <meaning>`; click it by `link~<words of its meaning>`.
- The fixture holds no long code name, so a name breaking only at its seams (`InstallationToken|Cache`,
  `wiki_|build_|budget_|calls`) in the margin is the web tests' (`seams` in `wiki.test.ts`), not this recipe's.
- The Wiki's `stale` counts Interpretations only, so the masthead's `N Interpretations Stale` leaves
  Stale Terms out.
