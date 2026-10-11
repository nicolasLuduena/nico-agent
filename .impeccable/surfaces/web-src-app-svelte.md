---
version: 1
slug: "web-src-app-svelte"
primary_target: "web/src/App.svelte"
related_targets: []
---

# Surface brief: the nico-agent page (web/)

Scope: the one page `serve` embeds at `/` (spec #231). Mode: Operate.
Audience and job: the user, at the desk in the morning with GitHub beside it, reads the shape of each Repo's night (what is Ready, in flight, Verified, merged) before acting; the phone is a check-in.
Constraints: every number from `/api/status` or `/api/map`; readable with GitHub paused; standard web controls; Light, Dark, System.
Memorable moment: a Repo's map read like a timetable, dependency chains running left to right, the one yellow band saying what needs you.
Unresolved: exact node size once real titles are laid out; the morning slot's content (spec 3).

## Direction contract

THESIS: Each Repo reads like a printed railway timetable: Blocker chains run left to right like a train's calling pattern, issue numbers set bold and tabular like departure times. It refuses the SaaS card grid, the hacker terminal, and the airy marketing page.
OWN-WORLD: Arrivals-sheet white (night-board blue in Dark), full-ink type and hard rules, Barlow with tabular figures, square corners. Signal yellow belongs to what needs you and nothing else; blue is live, green Verified, red Failed. Stage is a mark in a fixed cell, readable without colour.
STORY: In one glance the user sees what needs them, then each Repo's shape and how stale it is, then opens a node for its restarts, Verdict and Evidence.
FIRST VIEWPORT: Header (wordmark, theme switch); morning slot (empty until spec 3); the needs-you band full width; Repo tabs with read times and Refresh right-aligned; the map filling the work area left, switches and Dispatch form in a 320px column right; the node panel replaces that column.
FORM: Station Timetable, candidate 4 of 7 on the ordered list, seed key 6cb4e308.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
