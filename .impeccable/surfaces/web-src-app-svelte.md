---
version: 1
slug: "web-src-app-svelte"
primary_target: "web/src/App.svelte"
related_targets: []
---

# Surface brief: the nico-agent page (web/)

Scope: the one page `serve` embeds at `/` (spec #231). Mode: Operate.
Audience and job: the user, at the desk in the morning with GitHub beside it, sees what work is happening and what needs them (Asking agents, failures, Verified PRs) before acting; the phone is a check-in to pick a Project, read an issue and answer.
Constraints: every number from `/api/status`, `/api/map`, `/api/roadmap`, `/api/node` or `/api/agent` (an agent's screen, read every 3 s only while its panel is open and the page visible); readable with GitHub paused or serve out of reach (cached work stays); standard web controls; Light, Dark, System on one layout and one component set; no Wiki, Libraries or MCP (removed in #429/#433); no Morning summary on the Board.
Memorable moment: the Project's map, each card leading with its issue's title, Blocker chains running left to right, and one amber `Needs you` on exactly the issues that need you.
Unresolved: none recorded; the tall column of unlinked issues (dagre's first rank) is gone, the groups now packed in wrapping rows to the field's aspect.

## Direction contract

THESIS: A calm work map (#432). The light workspace is everyday and approachable, the dark one focused; the same layout, components and interactions in both. It refuses the timetable metaphor it replaces (#247), the KPI dashboard, the hacker terminal and the airy marketing page.
OWN-WORLD: Neutral surfaces, hairline frames, modest rounding (8px cards, 6px controls), the platform's sans with tabular figures, one selection accent. Every state in words first: Stage words beside their icons in their hues, a node's live agents as a row each (Agent state dot, role), the state in words on hover, focus and in the agent's panel, `Needs you` as a soft amber badge. Repos have no colours; a Harness's hue is only a dot in a launch picker.
STORY: In one glance the user sees which issues carry `Needs you`, then each chain's shape and how fresh the reads are, then opens a node whose inspector puts the next action first: answer, recover, or open the PR on GitHub; or opens one of its agents to watch its screen, live, and answer it there while it is Asking (#435).
FIRST VIEWPORT: The Projects rail left (gauge and theme switch at its foot); the Project's header (name, Repos, read times, Refresh, Repos) and the Map / Roadmap tabs; the map filling the work area; the inspector at its right once a node is open, or an agent's panel in its place once an agent's row is; the Repo and Project controls behind `Repos`; the notices as a foldable band in the flow under the Map / Roadmap tabs (the `Needs you` badge, a row per notice, `Hide notices`), above the map, never over it.
FORM: the light concept's composition and the dark concept's theme treatment (design-references/board-workspace at 51b157c), with #432's corrections: no Wiki, Libraries, test counters, progress summaries, Open agent or Loop-running indicator. No concept roll (seed key) ran: issue #432's two reference images and written corrections pinned the direction (design-references/board-workspace at 51b157c), so the build was code-led against those references.
FINISH: unreviewed and undocumented is unfinished; this build ends with Evidence at 1440×900 and 390×844 in both themes, DESIGN.md and the verification recipes matching the shipped controls.
