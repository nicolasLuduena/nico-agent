---
name: nico-agent
description: The Station Timetable. Each Project reads like a printed railway timetable, Blocker chains running left to right like a train's stops, on an arrivals-sheet white (a night-board blue in Dark), with signal yellow kept for what needs you.
colors:
  ground: "#f4f5f2"
  surface: "#ffffff"
  ink: "#111214"
  ink-muted: "#50545b"
  rule: "#111214"
  hairline: "#cfd2d6"
  signal: "#ffd400"
  signal-ink: "#111214"
  live: "#1d4f91"
  verified: "#00754a"
  failed: "#c8102e"
  reversed: "#111214"
  reversed-ink: "#ffffff"
  focus: "#1d4f91"
  ground-dark: "#0b1220"
  surface-dark: "#121a2b"
  ink-dark: "#eef1f4"
  ink-muted-dark: "#a9b1bd"
  rule-dark: "#6b7689"
  hairline-dark: "#2a3447"
  signal-dark: "#f2c200"
  signal-ink-dark: "#111214"
  live-dark: "#7fb0ff"
  verified-dark: "#3ccf8e"
  failed-dark: "#ff6b6b"
  reversed-dark: "#eef1f4"
  reversed-ink-dark: "#0b1220"
  focus-dark: "#7fb0ff"
typography:
  number:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  head:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  strong:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
rounded:
  none: "0px"
  control: "2px"
spacing:
  hair: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "8px 12px"
    width: "248px"
    height: "88px"
  node-selected:
    backgroundColor: "{colors.reversed}"
    textColor: "{colors.reversed-ink}"
    rounded: "{rounded.none}"
  strip:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.none}"
    padding: "12px 24px"
  strip-empty:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.none}"
    padding: "12px 24px"
  tab:
    textColor: "{colors.ink-muted}"
    typography: "{typography.head}"
    padding: "10px 0 8px"
  tab-active:
    textColor: "{colors.ink}"
    typography: "{typography.head}"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "24px"
    width: "400px"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "16px"
  button:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "36px"
  button-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "8px 16px"
    height: "36px"
---

<!-- SEED: established with the user before implementation (#247); re-run /impeccable document once there's code to capture the actual tokens and components. -->

# nico-agent: The Station Timetable

## Overview

The page is one working screen, read at the desk in the morning and checked on the phone. Its world is the printed railway timetable: the departures poster on the platform and the arrivals sheet beside it. That world contributes four things and nothing else: **type** (a grotesk with tabular figures, numbers set bold like departure times), **palette** (sheet white, full ink, a few working colours), **density** (a timetable fits a lot on one sheet without crowding), and **one signature move**: each Project's map reads like a timetable, with Blocker chains running left to right like a train's stops. The navigation, tabs, switches, selects and buttons are standard web controls. The world never supplies them.

**The Costume Rule.** If a part of the page reads as a station sign before it reads as a working control, it has gone too far. Take the world back out until it is type, colour, density and the map's move.

Motion is short and functional. The panel and the sheet slide in 160ms ease-out. When a refetch changes a line, that line flashes once (200ms, 18% of its own ink), like a board updating a single line: a node's Stage cell, a row new to the needs-you band (not on the first read, nor as the band turns yellow, which says it already), and the read times when a read moves them (not when another tab shows its own), and the Interpretation a search hit opens in the Wiki view. When a band row, a node taking keyboard focus, or Fit moves the map, the view glides there in 300ms, easing out, so the map shows where it went; a drag or zoom stops it where it is. Opened from the band, the page then scrolls to the node. Nothing loops and nothing moves on load. Under `prefers-reduced-motion` all motion is off and changes simply appear.

## Colors

Restrained strategy with working colours: tinted neutrals for the sheet, and four hues that each do one job.

- **Sheet:** `ground` is the page; `surface` is the map field, the panel, the sheet and the form. `hairline` separates rows and frames nodes. `rule` (full ink) is for structural rules: the band edges, the active tab's underline, the Morning summary's column heads, the panel's leading edge.
- **Ink:** `ink` is for everything you read first. `ink-muted` is for labels, kinds and times. It is never used for an issue number, a title or a Stage word.
- **Signal yellow (`signal`):** what needs you, and nothing else. It fills the needs-you band and the 4px flag on a node that needs you.
- **Live blue (`live`):** an agent is at work (Implementing, PR draft), links, focus rings, and the `stack` edge.
- **Verified green (`verified`):** a passing Verdict on the head commit.
- **Failed red (`failed`):** Failed (the node, and its Failure in the panel), a failing Verdict, refusals, and serve out of reach. It shows up as the errata rule, the strike and the Stage word, never as a fill.
- **Reversed:** the selected node, full ink with the text reversed out.

**The One Job Rule.** Yellow means needs you. A yellow pixel anywhere else is a bug.

**The Reversal Rule.** The selected node is the only reversed element on the page.

Dark is the station board at night: `ground-dark` night blue, `surface-dark` one step up, the ink reversed. Structural rules drop to `rule-dark` so lines don't glare in a dark room. Each working colour has a `-dark` twin tuned for AA on `surface-dark`. The signal yellow is dimmed slightly (`signal-dark`) and keeps black ink. Themes are Light, Dark and System. System follows `prefers-color-scheme` and is the default; the choice is remembered in `localStorage`.

All text pairs meet WCAG AA: 4.5:1 for body and 3:1 for the 22px numbers and for non-text marks.

## Typography

Barlow is a grotesk drawn from transit and highway signage. It is served from the binary as woff2 (400, 600, 700, Latin subset), with no hosted font stylesheet. Tabular figures are on everywhere (`font-variant-numeric: tabular-nums`).

**The Two Sizes Rule.** There are two sizes, 14px and 22px. Rank comes from weight (400, 600, 700), from case (all-caps `label` for kinds, column heads and strip kinds) and from reversal. A size step is not a way to rank.

- `number` (22px bold): the issue number on a node, which is the "departure time" of the timetable.
- `head` (22px semibold): the panel's title and the Repo name where it heads a section.
- `body` and `strong` (14px): titles, Stage words, form text, history rows.
- `label` (14px semibold caps, 0.06em): `CODE` / `RESEARCH`, `ASKING` / `FAILED` / `REVIEW` / `VERIFIED` / `PAUSED` / `INSTALL` / `CHECK`, form field labels.

**The Right Column Rule.** Every time on the page (Source read, PRs checked, restarted at, Verdict at, paused until) is set right-aligned in a tabular column, `HH:MM`, plus the date when it isn't today.

## Layout

A 4px base. Spacing steps are 4, 8, 12, 16, 24 and 32. On desktop the page gutter is 24px; on phone it is 16px.

**Desktop (720px and wider), top to bottom:**

1. **Header:** the `nico-agent` wordmark (14px caps label) on the left, the Light / Dark / System segmented control on the right.
2. **Morning slot:** the page's first content section: the Morning summary, `morning.md` rendered as Markdown on `surface`, the night's history only (Landed, Filed, faux-nico said: Merge these, Answer these and Fix these are the needs-you band's, shown there live, where a morning snapshot of them would go stale once acted on), its section heads as `label`s in `ink`, each on a 3px `rule` like a timetable's column head, its lists flowing in columns at least 280px wide (one on a phone). It renders nothing when `morning.md` is absent, and takes no space then. A `button-quiet` "Hide" at its right folds it to one line, the first line it shows that is not a heading, its list marker dropped, beside a "Show" that opens it again; hidden stays first, and is remembered in this browser until `morning.md` says something else.
3. **Needs-you band:** full width, square, set at the top of the work.
4. **Project tabs:** one tab per Project, a Repo with none being its own. The same row carries "Source read HH:MM · PRs checked HH:MM", the oldest of its Repos', and the Refresh button, right-aligned. When long Project names leave them no room, those two move to a line above the tabs, still right-aligned, so the tabs stay on their baseline.
5. **Views:** `MAP` and `WIKI`, two `label` links under the tabs, 24px apart; the current one `ink` on a 3px `rule` underline, as the tabs, the other `ink-muted`. The URL's hash holds the Project, the view and, in the Wiki view, the Wiki and Component, so a link opens it and back and forward work.
6. **Work area:** the Project's map fills the left; a 320px column on the right holds, unless the Project is a Repo's own, the Project's defaults (its name as `head` over an `ink-muted` line "Defaults for its Repos, where they set none", then its room, switches and settings), then a panel per Repo (its slug as `head` when the Project has the defaults panel, then its Readiness, Dispatch form, room, switches, settings, Install and Remove). A `button-quiet` at the map's bottom left, while it holds a merged issue, reads "Hide merged", or "Show N merged" once they are hidden; hidden is remembered in this browser for every map. Opening a node puts the 400px node panel in place of that column, and closing it brings the column back. Beside a map taller than the window, the panel stays in view. The map keeps its pan and zoom throughout.

**Phone (under 720px):**

- 16px gutters and no horizontal scroll, anywhere, with the sheet open or closed.
- The tabs become one native `<select>` named "Project".
- The band's items stack, one item per block (kind and Repo/#issue on the first line, the question or title on the second).
- The map starts fitted to the viewport width at 60vh tall and still pans and zooms. Fitted, a vertical swipe on it scrolls the page past it and a sideways one pans it; pinched in, every drag pans it. The Dispatch form, the room and the switches follow below it.
- The node panel becomes a bottom sheet: up to 85vh, scrolls inside, closed by a button or a swipe down.

**The No Scroll Rule.** At 360px wide, nothing is wider than the viewport. Long titles ellipsize on nodes and wrap in the panel.

## Elevation & Depth

Flat, like the printed sheet. Depth is drawn with rules, never with blur. The only shadow is on the panel and the sheet, and it is one hard step: a 1px `rule` on their leading edge plus `0 0 0 1px` hairline, so they sit on the map like a slip laid on a sheet. Nothing uses glass, gradients or soft drop shadows.

## Shapes

Structure is square (`rounded.none`): nodes, the band, tabs, the panel, the sheet. Controls (buttons, inputs, selects, toggles) get `rounded.control` (2px) so they read as pressable.

**Node** (248×88px, `hairline` frame, `surface` fill), three rows, and a fourth while it is PR draft or Waiting:

1. The issue number (`number`) on the left, followed, when the Project has more than one Repo, by its Repo's name (`strong`, `ink-muted`, ellipsized); `RESEARCH` (`label`, `ink-muted`) on the right for a research issue, and nothing for code, which nearly every node is. The panel names the kind either way.
2. The title (`body`), one line, ellipsized.
3. The Stage cell: a 14px mark in a fixed cell, then the Stage word (`strong`), in its mark's colour when that is a working one (Implementing and PR draft `live`, Verified `verified`, Failed `failed`), like a departures board's status column, and in `ink` for every other Stage. The panel's Stage word does the same; the selected node reverses it with the rest. On the right, the Agent state mark (an 8px dot: `live` filled = working, hollow = idle, `signal` = Asking, none = no agent) and the PR number with "draft" when it is one.
4. Under the Stage word, where its review stands (`body`, `ink-muted`): `reviewing`, `review off`, `review gave up`, …; while Waiting, why, without its own key (`waits on acme/web#1 to close`), ellipsized. The node is 22px taller for it.

**Stage marks** (shape carries the state; colour repeats it, and the Stage word repeats the working colours):

| Stage | Mark | Colour |
|---|---|---|
| Waiting on a Blocker | dashed ring | `ink-muted` |
| Ready | hollow ring | `ink` |
| Stackable | ring with centre dot | `ink` |
| Implementing | half-filled disc | `live` |
| PR draft | filled disc | `live` |
| Verified | double ring | `verified` |
| Merged | filled disc, node at 45% opacity | `ink-muted` |
| Closed | struck ring | `ink-muted` |
| Failed | ✕ strike, plus a 4px `failed` errata rule down the node's left edge | `failed` |

A node that needs you carries a 4px `signal` flag across its top edge.

**Edges:** dagre lays them out left to right (Blockers left, blocked right) as polylines with a small open arrowhead at the blocked end.

- `blocker`: one 2px `ink` line, so a chain reads as a route between its stops.
- `stack`: double rails, `live`, drawn as a 5px stroke with a 2px `surface` stroke over it, so it reads as two parallel lines (a through-coach connection) and never as a heavier blocker line.

**Band (needs you):** one row per item: kind (`label`), `repo #issue` (`strong`, tabular), the question's first line, the title, or where the review stands with the command that records a Verdict by hand (`body`, ellipsized), and the time right-aligned. The whole row is the button that focuses the node. With items, it is `signal` with a 1px `rule` top and bottom. With none, it is `surface` with a hairline frame and reads "Nothing needs you" in `ink-muted`. GitHub paused is a row like the others: `PAUSED · GitHub · until HH:MM`. So is an agent of the loop's own that herdr reports blocked: `BLOCKED · <agent> · HH:MM`, under its `repo #issue` for a faux-nico, the only one with a node to focus. A failing Readiness check is `CHECK · <repo>: · what it says · HH:MM`, its help on the line under what it says, both wrapped, never ellipsized: the help is the fix. A failed or refused Install is a row the same way: `INSTALL · <repo>: · its output's last line · HH:MM`, the command that runs it again under it.

**Tabs:** text tabs on a hairline baseline, each Project's name set in `head` (it heads the work below it), 24px apart with no side padding, so the first aligns with the gutter and the underline is as wide as the name. The active tab is `ink` with a 3px `rule` underline; the others are `ink-muted`.

**Panel and sheet:** the `head` title with a `#number` link to the issue (`#number name`, its Repo's, when the Project has more than one), then sections separated by hairlines, each with a `label` head: PR (link, draft flag), then for a Waiting issue why it waits, whole (`body`, no head), Failure when the Dispatch Failed (the error in `strong` on the errata rule, then the step it stopped at), Restarts (rows of time, then reason), Review (where the review stands, in a line, unless a Verdict on the head says it; then the Verdict: the result word in its colour, the sha in tabular figures, the time, then the findings text wrapped at a 70-character measure), Evidence (one link per file, under `/bucket/`). Opening it moves focus to its title; closing it returns focus to the node or strip row that opened it.

## Components

These are the shapes the UI tickets build. They are not implemented yet.

- **Readiness:** first in the column, under a `label` head: each failing check on the errata rule, what it says in `strong` and its help in `body`; then a native disclosure "N of M pass" folding the passing ones, and one `ink-muted` line with the time the results last changed.
- **Install:** under the settings, a `label` head and a text input holding the Repo's install command (emptied, removed; a refusal inline under it); then the last Install: one `ink-muted` line "Installed <sha> at HH:MM", or on the errata rule "Failed at HH:MM" in `strong`, its output as printed, wrapped, and the command that runs it again.
- **Switches:** set once and left, so folded (a native disclosure) to one line: `SWITCHES` (`label`) and how many are on, `6 of 8 on` in `ink-muted` at its right. Opened, eight rows (dispatch, stack, review, restart, flip, answer, gardening, quality_scan), with the name as `strong` on the left and a standard toggle on the right (`live` when on, `hairline` track when off). A toggle that is saving is disabled until the PATCH answers.
- **Where a setting comes from:** beside each setting, left of its control, a `label` in `ink-muted` reading `project` or `default` while the Repo does not set it; once it does, a `button-quiet` "Use the Project's" (or "Use the default") in its place, which removes the Repo's own. A Project's defaults read `default` while it does not set one, and "Use the default" once it does. A long name wraps it under the name.
- **Room:** a row like a switch's, "Room" as `strong` on the left and a number input on the right, then, for a Repo, one `ink-muted` line counting its Dispatches In flight. A refused value appears inline under it, as the Dispatch form's refusal does, and the input goes back to the room set.
- **Settings:** under a `label` head, the Implementer and the Reviewer, each its name as `strong` then Harness, model and Effort as the Dispatch form's selects; then Base and, for a Repo, Project as text inputs, Project offering the Projects there are and, while the Repo is in one, a `button-quiet` "Leave <name>". A change is written as it is made; a refusal appears inline under the section.
- **Remove:** a `button-quiet` "Remove <slug>…" at the column's foot, which asks once more ("Its clone stays") before it removes; a refusal appears inline under it.
- **Add a Repo:** a `surface` section under the work area: Repo, its clone and its Project as text inputs in a row (stacked on a phone), then a `button` "Add". The tab of its Project opens once added.
- **Dispatch form:** a native select for the issue (Ready, Stackable and Gardening only, `#number title`), then Harness, model and Effort as native selects, then a `button` labelled "Dispatch". A refusal appears inline under the button as a `failed` 4px errata rule with the error in `strong` and the help lines in `body`.
- **Refresh:** a `button-quiet`. It reads "Refreshing…" and is disabled while the POST runs. The read times update when it answers.
- **Wiki view:** in place of the work area. A row with `WIKI` (`label`) and a native select of the Project's Wikis on the left, and "Describes <sha> · Built HH:MM" in `ink-muted` in the right column, the sha a link to the commit. Under it three columns: the Component tree, the open Component, its outline.
  - **Tree** (240px, staying in view beside a long Component): `COMPONENTS` (`label`, `ink-muted`), a search field "Search this Wiki", then nested lists on `hairline` guides, names in `ink`, the open one `strong` on a 3px `rule` underline, as the active tab. While the field holds words, the hits stand in place of the tree, under "N found" (or "Nothing found") in `ink-muted`: every Component whose name or overview holds each word, then every Interpretation that does, each a row on a `hairline`: the Component's name (`strong`) with the Interpretation's kind (`label`, `ink-muted`) at its right, then the text, two lines at most, in `ink-muted`. Following a hit opens its Component scrolled to the Interpretation, which flashes once and keeps its 2px `focus` ring until focus moves on.
  - **Component:** on `surface` with a `hairline` frame and 24px padding: its name as `head`, its overview at a 70-character measure, then a section per kind of Interpretation (Roles, Invariants, Preconditions, Postconditions, Effects), then Relationships, the Explainer when there is one, Components and Gaps, each headed by a `label` on a 3px `rule`, as the Morning summary's column heads. An Interpretation is a row on a `hairline`: its sentence on the left, its Anchors in the right column, each a link framed in `hairline` with 2px corners (`path` then the lines in `strong`), opening GitHub at the Wiki's commit. A sub-Component is its name (`strong` link) and its overview's first line in `ink-muted`, ellipsized. A Gap is its reason in `strong` and its files in a native disclosure. The Relationship diagram and the Explainer are laid out with dagre and drawn as the map is, left to right while that fits the column at full size and top to bottom otherwise, fitted to the column and never past full size; their arrows are the map's `blocker` line, a label set on its arrow with the line knocked out behind it. Relationships: the Component (its name in `strong`, framed in 2px `ink`) between what uses it, on the left, and what it uses, on the right, each a box framed in `hairline` that opens that Component, each arrow its kind as a `label` in `ink-muted`; with none, one `ink-muted` line. Explainer: its title in `strong`, then each step a node of the map's width, its number as `number` on the first row and how many Anchors it cites in `ink-muted` at its right, then its caption in `body`, wrapped to 4 lines; a lane is a `hairline` frame around its steps, its name a `label` in `ink-muted` on the frame's top line. A step opens, framed in 2px `ink`, its caption and its Anchor links under the drawing; opened again, it closes.
  - **Outline** (200px, staying in view): `OUTLINE` (`label`, `ink-muted`), the open Component's name in `strong`, then each section it shows with how many it holds in the right column in `ink-muted`; each brings its head to the top of the window. It changes with the open Component.
  - **Narrower:** under 1080px the outline folds behind a `button-quiet` "Outline" at the end of the row; under 720px the tree (with its search) too, behind "Components" before it, the Anchors go under their sentence, the Relationship diagram and the Explainer go top to bottom, and the Component's padding is 16px. Each opens as a bottom sheet, the node panel's: up to 85vh, scrolling inside, a 1px `rule` on its top edge, its head (`label` in `ink`, and Close) staying on top. Close or Escape shuts it and gives focus back to its button; following a link in it shuts it too. One is open at a time.
  - **No Wiki yet:** one `ink-muted` line per Repo with the command that builds it.
- **Theme switch:** a three-segment control (Light / Dark / System), with the active segment reversed. This is the one sanctioned reversal outside the map, because a segmented control's selected state is a standard affordance.

## Do's and Don'ts

- **Do** let shape carry each state, so it reads without colour.
- **Do** set every number with tabular figures and every time in the right column.
- **Do** keep the morning slot first, even while it is empty.
- **Don't** use yellow for anything except needs you.
- **Don't** put nodes in rounded cards, gradient pills or KPI tiles. The user ruled out the SaaS dashboard look.
- **Don't** add mascots, bounce or confetti (no toy look), and no green-on-black or monospace walls (no hacker terminal).
- **Don't** pad toward airiness. The desk view should show a Repo's whole night without scrolling.
- **Don't** draw station-sign chrome (pictograms, split-flap animation, platform numbers). That is the costume.
