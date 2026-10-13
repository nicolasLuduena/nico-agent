---
version: 1
slug: "web-src-wiki-wikipage-svelte"
primary_target: "web/src/wiki/WikiPage.svelte"
related_targets: []
---

# Surface brief: a Wiki's page (`/wiki/<id>`)

Scope: the page `serve` answers at `/wiki/<id>`, one Wiki alone, its Component in the fragment (#358). Mode: Read.
Audience and job: the user, and anyone they send the link to, learning a codebase one Component at a time, at the desk or on the phone through the tunnel; often arriving from a PR body, the morning summary or an agent's answer pointing at one Component.
Constraints: the Board's Svelte reader (search, tree, Explainer, Anchors' highlight) reused; every claim cites its lines; readable while a build runs or failed; Light, Dark, System.
Memorable moment: a Component read like a page of a reference book, claims down a calm column with their kind in the margin and their lines quietly under each, ending on the next Component.
Unresolved: a summary of its own per Component (the page shows the overview's first sentence); a theme switch on the page; the Explainer drawn as the reading column's own list, and the Relationship diagram's and the Explainer's text at narrow widths (follow-ups, out of #358's scope).

## Direction contract

THESIS: The Wiki's page is the timetable's printed companion, a reference book: one Component a page, its claims a calm column, wayfinding as a route (the trail above, the next stop below). It refuses the Board panel: no framed cards, blue Anchor boxes or 3px rules chopping the reading.
OWN-WORLD: The Station Timetable's tokens: a `surface` sheet on `ground`, full-ink Barlow with tabular figures, caps `label`s; each Interpretation's kind hangs in a left margin column like a timetable's row head; its lines cited under it in `ink-muted` 14px; hairlines only.
STORY: The reader lands on a Component, reads its overview and claims in the build's order with where each rests, follows a Relationship or a part, and turns to the next Component.
FIRST VIEWPORT: Desk: one quiet masthead line on `ground` (Board link, Wiki id, the build's facts and Update and Rebuild right), then tree rail 240px, the sheet (trail, 32px title, overview at 18px/1.6 on a 68ch measure), outline rail 200px. Phone: the masthead wraps (Board, id and the sheet buttons; then the build's facts with its buttons at their end), the sheet edge to edge under it with the name in the first screen, tree and outline as bottom sheets.
FORM: the established world (The Station Timetable) extended to a Read surface; code-led; no concept roll, issue #358 pins the composition; seed key: none.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
