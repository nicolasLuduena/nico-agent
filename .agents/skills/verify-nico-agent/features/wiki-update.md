# Update a Wiki and see what is Stale

`nico-agent wiki build <owner/name> --update` builds a Repo's Wiki from the one the Bucket holds,
at the Repo's `origin/<base>`: a part whose files kept their blobs is copied over, a leaf whose
files changed is asked again, as is a part with an `unanswered` Gap (see
[wiki-build.md](./wiki-build.md)), a file added goes to the leaf holding the most files of its folder,
asked again, or, when no leaf holds one, the part holding its nearest folder's files is divided
again, and each part its new division names with the same id and unchanged files is copied with
its parts rather than asked; the part a file removed sits under is divided again, its parts from
scratch, and a parent whose parts changed keeps its Interpretations. Each part keeps
its place in the tree. Between builds, `GET /api/wiki/<id>` and the MCP's `get_component` mark
`stale` each Interpretation, Term and Explainer citing a file whose blob at `origin/<base>` (as the clone last
fetched it) is not the one it was written against, and the Wiki's page's masthead says how many
commits behind the Base the Wiki is and how many Interpretations are Stale, each one labelled
`STALE` before its sentence. A parent kept by an Update stays Stale until the next build from
scratch. The loop's nightly build is an Update once the Repo has a Wiki.

## Sub-features

- `update-copy` with one file changed, `--update` asks only the leaf holding it (one `opencode2 run`), copies every other part, and keeps the parent's Interpretations; stderr says `updating it from <old>: N part(s) copied or kept, M to ask again`; one Bucket commit `wiki <owner/name> <new>`.
- `update-added` a file added to a folder a leaf holds files of asks again only that leaf (the one holding the most, the first of those), divided anew if it answers a division (its new parts asked too); every other part is copied, in its place.
- `update-new-folder` a file added to a folder no leaf holds files of divides again the part holding its nearest folder's files; the parts that division names again, with their files unchanged, are copied with their parts (stderr `<trail>: copied N part(s) it kept`), and only the new ones are asked.
- `stale-route` `GET /api/wiki/<id>` adds `base`, `behind` (commits from the Wiki's commit to `origin/<base>`) and `stale` (how many), and `"stale": true` on each Stale Interpretation, Term and Explainer; reading it writes nothing and fetches nothing.
- `stale-page` the masthead reads `Describes <sha> · Built HH:MM · 1 commit behind main · 3 Interpretations Stale`, or `Up to date with main` with the Stale count left out when none is; each Stale Interpretation's paragraph reads `Stale <sentence>`, in light, dark and at phone width.
- `stale-mcp` `get_component` marks the same Interpretations, Terms and Explainer `stale`.
- `stale-kept` after an Update, a parent kept with its claims stays Stale (its Component carries the `blobs` they were written against) while the parts asked again are not.

## How to get to it (user POV)

- The user runs `nico-agent wiki build <owner/name> --update`; the loop runs the same in a herdr pane
  at the wiki hour once the Base moved (see [wiki-runs.md](./wiki-runs.md)).
- The Wiki's page, `/wiki/<owner>/<name>` (a Project's Wiki view links it): its masthead and each
  Component's Interpretations.
- Ask serve: `GET /api/wiki/<owner>/<name>`; an agent: the MCP's `get_component`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/wiki-update`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project shop --json`, then
  `$C drift base docs/notes.md`: the fixture holds `README.md` and `docs/notes.md`.
- Answers seeded by trail: `verify/fixture`, a division into `Readme` (`README.md`) and `Docs`
  (`docs/notes.md`), `Docs` `reads` `Readme`, with a `role` at `README.md` `1`-`1` and
  `docs/notes.md` `1`-`1` (one at `README.md` alone would be about Readme, and fail its check);
  `verify/fixture > Readme`, a leaf with a `role` at `1`-`1` and an `invariant` at `3`-`3`;
  `verify/fixture > Docs`, a leaf with a `role` at `docs/notes.md` `3`-`3`. `$C run --evidence "$E/01-build" -- wiki build
  verify/fixture --json` is `built`, `"components":3`.
- `$C state > "$E/state.before.txt"`.

- **Fresh.** `$C http --evidence "$E/02-wiki-fresh" GET /api/wiki/verify/fixture`: `200`, `"base":"main"`,
  `"behind":0`, `"stale":0`, no `stale` on any Interpretation. `$C page --evidence "$E/03-page-fresh"
  --path /wiki/verify/fixture --hash "#readme" --expect "Up to date with main"`.
- **A merge into the Base.** `$C drift base` (rewrites `README.md`). `$C state >
  "$E/state.stale.before.txt"`. `$C http --evidence "$E/05-wiki-stale" GET /api/wiki/verify/fixture`:
  `"behind":1`, `"stale":3`, `"stale":true` on the top Component's and both of Readme's
  Interpretations, none on Docs'.
- **Stale on the page.** `$C page --evidence "$E/06-page-stale-light" --path /wiki/verify/fixture
  --hash "#readme" --expect "1 commit behind main"`: the masthead `· Built HH:MM · 1
  commit behind main · 3 Interpretations Stale`, `paragraph: Stale The title names the Repo.` and
  `Stale The README describes ...`; the same in Dark on the top Component (`07-page-stale-dark-index`,
  `--path /wiki/verify/fixture --scheme dark`); Docs (`08-page-docs-not-stale`) with no
  `Stale`; at `--width 390` (`08b-page-stale-phone`) the masthead wraps and `.view.txt` says `page 390px
  wide in a 390px window`.
- **In the MCP.** Exchange `09-mcp` (`initialize`, `notifications/initialized`, `get_component` of
  `readme` and of `docs`, as in [wiki-mcp.md](./wiki-mcp.md)): Readme's two Interpretations
  `"stale":true`, Docs' none. `$C state > "$E/state.stale.after.txt"`; its diff from
  `state.stale.before.txt` is empty: reading wrote nothing and called no stub.
- **Update.** Seed `verify/fixture > Readme` a new leaf (a `role` "The title says the fixture moved
  on." at `1`-`1`), `$C state > "$E/state.update.before.txt"`, then `$C run --evidence
  "$E/10-update" -- wiki build verify/fixture --update --json`: exit `0`, `built` at the new head,
  `"components":3`; stderr `updating it from <old>: 2 part(s) copied or kept, 1 to ask again` and
  `verify/fixture > Readme: asked (call 1 of 48)`. The `state` diff: one `opencode2 run` call, about
  `## The part: verify/fixture > Readme`, and one Bucket commit.
- **Kept, still Stale.** `$C http --evidence "$E/11-wiki-updated" GET /api/wiki/verify/fixture`:
  `"behind":0`, `"stale":1`, Components `index`, `readme`, `docs` in that order; `index` keeps its
  Interpretation, `"stale":true`, with `blobs` `{"README.md": <its blob before the merge>}`; Readme's
  new one and Docs' copied one are not Stale. `$C page --evidence "$E/12-page-updated-index" --path
  /wiki/verify/fixture --expect "Up to date with main"`: `Up to date with main · 1
  Interpretation Stale`, `Stale The README's title names the fixture.`; `13-page-updated-readme`
  shows `The title says the fixture moved on.` with no `Stale`.
- **A file added.** `$C drift base docs/guide.md`; seed `verify/fixture > Docs` a division into
  `Notes` (`docs/notes.md`) and `Guide` (`docs/guide.md`), and a leaf for each by its trail. `$C run
  --evidence "$E/15-update-added" -- wiki build verify/fixture --update --json`: `"components":5`; the
  `state` diff's three `opencode2 run` calls are about `verify/fixture > Docs`, `... > Docs > Notes`
  and `... > Docs > Guide` only. `$C http --evidence "$E/16-wiki-added" GET /api/wiki/verify/fixture`:
  Components `index`, `readme` (copied as it was), `docs`, `docs/notes`, `docs/guide`; `index`'s
  `files` gain `docs/guide.md`. `17-page-added-docs` (`--path /wiki/verify/fixture --hash "#docs"`)
  shows `link "Notes"` and `link "Guide"`.
- **A file in a new folder.** `$C drift base guide/intro.md`; seed `verify/fixture` a division into
  `Readme` (`README.md`), `Docs` (`docs/notes.md`, `docs/guide.md`) and `Intro` (`guide/intro.md`),
  and `verify/fixture > Intro` a leaf. `$C run --evidence "$E/18-update-new-folder" -- wiki build
  verify/fixture --update --json`: `"components":6`; stderr `verify/fixture: copied 1 part(s) it kept`
  and `copied 3 part(s) it kept`; the `state` diff's two `opencode2 run` calls are about
  `verify/fixture` and `verify/fixture > Intro` only. `$C http --evidence "$E/19-wiki-new-folder" GET
  /api/wiki/verify/fixture`: Components `index`, `readme`, `docs`, `docs/notes`, `docs/guide`,
  `intro`, Readme and Docs' as they were.
- **After.** `git -C "$BUCKET" log --format=%s`: four `wiki verify/fixture <commit>`, one per build.
  Copy `$OUTSIDE_LOG` to `$E/outside.log`: `opencode2` and `curl` calls only, the curls each build's
  embed.

## Gotchas

- Stale is read against `origin/<base>` as the clone has it: serve never fetches. `drift base`
  fetches, as the loop's next fetch would; a merge on GitHub shows once the clone is fetched
  (Refresh's Readiness checks, a Dispatch, the wiki hour's check).
- `drift base <file>` writes the same three lines to `<file>`; a first `drift base docs/notes.md`
  before the first build gives the fixture a folder, so an added file has a part to sit under.
  An added file whose folder no leaf holds a file of divides again the part holding its nearest
  folder's files, the whole Wiki for the fixture's top folder; a new file at the top goes to
  Readme, which holds `README.md`.
- Seeding a trail again replaces its answer: seed `verify/fixture > Docs` its division only after
  the first build.
- A removed file is `cargo test`'s (`tests/wiki.rs`): `drift base` only writes.
- The pane's command, `nico-agent wiki build <owner/name> --update; exit` once a Wiki exists, is
  `cargo test`'s (`tests/wiki_runs.rs`): herdr is stubbed in a run.
