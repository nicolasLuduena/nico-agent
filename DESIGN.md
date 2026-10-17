---
name: nico-agent
description: The Station Timetable. Each Project reads like a printed railway timetable, Blocker chains running left to right like a train's stops, on an arrivals-sheet white (a night-board blue in Dark), each Stage in its own status colour and each Repo on its own line colour, with signal yellow kept for what needs you.
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
  ready: "#00747a"
  stackable: "#a32385"
  waiting: "#99560f"
  merged: "#8250df"
  closed: "#7a6655"
  harness-claude: "#a94a26"
  harness-codex: "#0b7b63"
  harness-opencode: "#6a4bd6"
  line-1: "#2560c0"
  line-2: "#c22b62"
  line-3: "#457b20"
  line-4: "#06779a"
  line-5: "#8d5a2c"
  line-6: "#4b4f9e"
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
  ready-dark: "#45cbc5"
  stackable-dark: "#f07fd6"
  waiting-dark: "#e8a35a"
  merged-dark: "#a98bfa"
  closed-dark: "#c3ab98"
  harness-claude-dark: "#f2956c"
  harness-codex-dark: "#4dd0aa"
  harness-opencode-dark: "#a996ff"
  line-1-dark: "#7aa7ff"
  line-2-dark: "#f481a8"
  line-3-dark: "#94d16c"
  line-4-dark: "#55c2e3"
  line-5-dark: "#d9a674"
  line-6-dark: "#a1a6e8"
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
  field:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  field-phone:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
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
  toast:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.none}"
    padding: "10px 8px 12px 14px"
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
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "0 8px"
    height: "36px"
  fold:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "11px 12px 9px"
    height: "40px"
  chip:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 2px 0 6px"
    height: "22px"
---

<!-- SEED: established with the user before implementation (#247); re-run /impeccable document once there's code to capture the actual tokens and components. -->

# nico-agent: The Station Timetable

## Overview

The page is one working screen, read at the desk in the morning and checked on the phone. Its world is the printed railway timetable: the departures poster on the platform and the arrivals sheet beside it. That world contributes four things and nothing else: **type** (a grotesk with tabular figures, numbers set bold like departure times), **palette** (sheet white, full ink, and the working colours a timetable prints: a status colour per Stage, a line colour per Repo), **density** (a timetable fits a lot on one sheet without crowding), and **one signature move**: each Project's map reads like a timetable, with Blocker chains running left to right like a train's stops. The navigation, switches, selects and buttons are standard web controls. The world never supplies them.

**The Costume Rule.** If a part of the page reads as a station sign before it reads as a working control, it has gone too far. Take the world back out until it is type, colour, density and the map's move.

Motion is short and functional. The panel and the sheet slide in 160ms ease-out. When a refetch changes a line, that line flashes once (200ms, 18% of its own ink), like a board updating a single line: a node's Stage cell, a toast new to the page (not on the first read), and the read times when a read moves them (not when another Project shows its own). When a node taking keyboard focus or Fit moves the map, the view glides there in 300ms, easing out, so the map shows where it went; a drag or zoom stops it where it is. Nothing loops and nothing moves on load. Under `prefers-reduced-motion` all motion is off and changes simply appear.

## Colors

A full working palette on a restrained sheet. The sheet stays tinted neutrals; on it, every working hue does one job, as a timetable prints each line and each status in its own colour. There are three families, and each has its own shape, so a hue never has to be read alone: **a ring is a Stage, a square is a Repo, a diamond is a Harness.** Shape still carries every state; the page reads without colour.

- **Sheet:** `ground` is the page and the faint band of a folded section; `surface` is the map field, the panel, the sheet and the form. `hairline` separates rows and frames nodes. `rule` (full ink) is for structural rules: a toast's frame, the current view's underline, the panel's leading edge.
- **Ink:** `ink` is for everything you read first. `ink-muted` is for field labels, kinds, times and where a setting comes from. It is never used for an issue number, a title or a Stage word.
- **Signal yellow (`signal`):** what needs you, and nothing else. It fills the 4px flag on a node that needs you, and the toasts.
- **Live blue (`live`):** an agent is at work: the Implementing and PR draft Stages, links, focus rings, a toggle that is on, and the `stack` edge.
- **Stage hues**, one per Stage, on its ring, its Stage word and a light tint of its node (7% of the hue over `surface`, 12% in Dark): Waiting `waiting` (amber sienna: pending, never a yellow), Ready `ready` (teal), Stackable `stackable` (magenta), Implementing and PR draft `live`, Verified `verified` (green, a passing Verdict on the head commit), Merged `merged` (the purple GitHub uses, since the merging happens beside it), Closed `closed` (taupe), Failed `failed` (red). A Blocker not offered to the loop has none: an untinted node, its word in `ink-muted`.
- **Failed red (`failed`)** is also a failing Verdict, a refusal, a refused field's frame, and serve out of reach: the errata rule, the strike, the Stage word and the node's tint, never a solid fill, but for the rate-limit gauge's ball, a level that fills, at 90% of a budget and while GitHub is paused (a refusal coming, or come).
- **Waiting amber (`waiting`)** is also the rate-limit gauge from 75% of a budget: pending, as its Stage, never a yellow.
- **Repo line colours** (`line-1` to `line-6`), in a Project of more than one Repo: each Repo takes the next by its order in the Project (its Repos sorted by slug, as serve lists them), so it keeps its colour across reloads; a seventh starts again at `line-1`. It is a 10px square before its name on a node, and on its toasts (framed in `signal-ink`, so it shows on the yellow in both themes), and a 3px rule across the top of its panel, as a timetable's column head sits on its rule. A Project of one Repo has none.
- **Harness hues** (`harness-claude`, `harness-codex`, `harness-opencode`): an 8px diamond wherever a Harness is named: inside its select in every launch picker, before the node panel's review line that names its Reviewer's, and as the agent at work on a node (filled while it works, hollow while it idles). Any other Harness is marked in `ink-muted`.
- **Reversed:** the selected node, full ink with the text reversed out.

**The One Job Rule.** Each hue does one job. Yellow means needs you, and no other hue is a yellow; a yellow pixel anywhere else is a bug. A Stage hue is never a Repo's square, a Repo's line colour is never a ring or a word.

**The Reversal Rule.** The selected node is the only reversed element on the page.

Dark is the station board at night: `ground-dark` night blue, `surface-dark` one step up, the ink reversed. Structural rules drop to `rule-dark` so lines don't glare in a dark room. Every working hue has a `-dark` twin tuned for AA on `surface-dark` and `ground-dark`. The signal yellow is dimmed slightly (`signal-dark`) and keeps black ink. Themes are Light, Dark and System. System follows `prefers-color-scheme` and is the default; the choice is remembered in `localStorage`.

All text pairs meet WCAG AA, light and dark, on `surface`, on `ground` and on a node's tint: 4.5:1 for body (every Stage word, at 14px, does) and 3:1 for the 22px numbers and for non-text marks (rings, squares, diamonds, toggles). Every colour is a token here and in `app.css`, and nothing hard-codes a hex.

## Typography

Barlow is a grotesk drawn from transit and highway signage. It is served from the binary as woff2 (400, 600, 700, Latin subset), with no hosted font stylesheet. Tabular figures are on everywhere (`font-variant-numeric: tabular-nums`).

**The Two Sizes Rule.** There are two sizes, 14px and 22px. Rank comes from weight (400, 600, 700), from case (all-caps `label` for kinds, column heads, toast kinds and section heads), from ink (`ink-muted` for a field's label) and from reversal. A size step is not a way to rank.

**The Phone Field Exception.** Under 720px, the text inside a field (`field-phone`) is 16px, so iOS never zooms the page into it.

- `number` (22px bold): the issue number on a node, which is the "departure time" of the timetable.
- `head` (22px semibold): the panel's title and the Repo name where it heads a section.
- `body` and `strong` (14px): titles, Stage words, form text, history rows.
- `label` (14px semibold caps, 0.06em): `CODE` / `RESEARCH`, `ASKING` / `FAILED` / `REVIEW` / `VERIFIED` / `PAUSED` / `INSTALL` / `CHECK`, and section heads (`DISPATCH`, `ROOM`, `SETTINGS`), which outrank the fields under them.
- Field labels (`body`, sentence case, `ink-muted`): `Harness`, `Model`, `Base`, `Install command`. A group's name over its fields (`Implementer`, `Reviewer`) is `strong` in `ink`.

**The Right Column Rule.** Every time on the page (Source read, PRs checked, restarted at, Verdict at, paused until) is set right-aligned in a tabular column, `HH:MM`, plus the date when it isn't today.

## Layout

A 4px base. Spacing steps are 4, 8, 12, 16, 24 and 32. On desktop the page gutter is 24px; on phone it is 16px.

**Desktop (720px and wider), top to bottom:**

1. **Header:** the `nico-agent` wordmark (14px caps label) on the left; on the right the GitHub rate-limit gauge (see Components), once a tick has read it, then the Light / Dark / System segmented control. On a phone, where they leave the wordmark no room, the gauge and the control take a line under it, at the right.
2. **Project row:** on a `hairline` baseline, the `Project` select (see Components), then the views, `MAP` and `ROADMAP`: two `label` links 24px apart, the current one `ink` on a 3px `rule` underline, the other `ink-muted`. At the row's right, "Source read HH:MM · PRs checked HH:MM", the oldest of its Repos', and the Refresh button; when the select and the views leave them no room, they take the line under them, still right-aligned. The URL's hash holds the Project and the view, so a link opens it and back and forward work.
3. **Work area:** the Project's map fills the left; a 320px column on the right holds, unless the Project is a Repo's own, the Project's defaults (its name as `head` over an `ink-muted` line "Defaults for its Repos, where they set none", then its Room, Switches and Settings, folded), then a panel per Repo (its slug as `head`, on its line colour, when the Project has the defaults panel, then, once it is checked, who its agents post as in `ink-muted`: "Agents post as <the bot>", or "PRs and comments are posted as you" and an "Install the App" link, then its Dispatch form, its one action, then Readiness, Room, Switches, Settings and Install, each folded to a line, and Remove at its foot). A `button-quiet` at the map's bottom left, while it holds a merged issue, reads "Hide merged", or "Show N merged" once they are hidden; hidden is remembered in this browser for every map. Opening a node puts the 400px node panel in place of that column, and closing it brings the column back. Beside a map taller than the window, the panel stays in view. The map keeps its pan and zoom throughout.

**Phone (under 720px):**

- 16px gutters and no horizontal scroll, anywhere, with the sheet open or closed.
- The `Project` select takes the row's first line, full width; the views, the read times and Refresh wrap under it.
- The map starts fitted to the viewport width at 60vh tall and still pans and zooms. Fitted, a vertical swipe on it scrolls the page past it and a sideways one pans it; pinched in, every drag pans it. The Dispatch form, the room and the switches follow below it.
- The node panel becomes a bottom sheet: up to 85vh, scrolls inside, closed by a button or a swipe down.

**The No Scroll Rule.** At 360px wide, nothing is wider than the viewport. Long titles ellipsize on nodes and wrap in the panel.

## Elevation & Depth

Flat, like the printed sheet. Depth is drawn with rules, never with blur. The only shadow is on the panel and the sheet, and it is one hard step: a 1px `rule` on their leading edge plus `0 0 0 1px` hairline, so they sit on the map like a slip laid on a sheet. Nothing uses glass, gradients or soft drop shadows.

## Shapes

Structure is square (`rounded.none`): nodes, toasts, the panel, the sheet. Controls (buttons, inputs, selects, toggles) get `rounded.control` (2px) so they read as pressable.

**Node** (248×88px, `hairline` frame, `surface` fill), three rows, and a fourth while it is PR draft or Waiting:

1. The issue number (`number`) on the left, followed, when the Project has more than one Repo, by its Repo's square in its line colour and its name (`strong`, `ink-muted`, ellipsized); `RESEARCH` (`label`, `ink-muted`) on the right for a research issue, and nothing for code, which nearly every node is. The panel names the kind either way.
2. The title (`body`), one line, ellipsized.
3. The Stage cell: a 14px mark in a fixed cell, then the Stage word (`strong`), both in the Stage's hue, like a departures board's status column; the node's fill is a light tint of the same hue. The panel's Stage word does the same; the selected node reverses it with the rest. On the right, the Agent state mark (an 8px diamond in the Harness's hue of the agent at work: filled = working, hollow = idle; `signal` with `signal-ink` = Asking; none = no agent) and the PR number with "draft" when it is one.
4. Under the Stage word, where its review stands (`body`, `ink-muted`): `reviewing`, `review off`, `review gave up`, …; while Waiting, why, without its own key (`waits on acme/web#1 to close`), or, when who it is assigned to keeps it from Ready, `assigned to @someone`, or `unassigned` in a Repo with `mine` on; ellipsized. The node is 22px taller for it.

**Stage marks** (shape carries the state; its hue repeats it on the mark, the Stage word and the node's tint):

| Stage | Mark | Hue |
|---|---|---|
| Waiting on a Blocker | dashed ring | `waiting` |
| Ready | hollow ring | `ready` |
| Stackable | ring with centre dot | `stackable` |
| Implementing | half-filled disc | `live` |
| PR draft | filled disc | `live` |
| Verified | double ring | `verified` |
| Merged | filled disc, node at 45% opacity | `merged` |
| Closed | struck ring | `closed` |
| Failed | ✕ strike, plus a 4px `failed` errata rule down the node's left edge | `failed` |

A node that needs you carries a 4px `signal` flag across its top edge: an Implementer Asking, its faux-nico blocked, a Failed Dispatch, a review given up on or stopped, a Verified PR. The flag is all the page says of it; its panel has the rest.

**Edges:** dagre lays them out left to right (Blockers left, blocked right) as polylines with a small open arrowhead at the blocked end.

- `blocker`: one 2px `ink` line, so a chain reads as a route between its stops.
- `stack`: double rails, `live`, drawn as a 5px stroke with a 2px `surface` stroke over it, so it reads as two parallel lines (a through-coach connection) and never as a heavier blocker line.

**Toasts (needs you):** what needs you and has no node to flag, stacked over the page's bottom right corner (across its foot on a phone), each `signal` with a 1px `rule` frame and a × that dismisses it for this page load; the next load shows it again. One toast per item: kind (`label`), then its name (`strong`), then a line under them. GitHub paused: `PAUSED · GitHub`, then `until HH:MM`. An agent of the loop's own that herdr reports blocked and has no node (a quality-scan, the morning agent): `BLOCKED · <agent>`, then `HH:MM`. A failing Readiness check: `CHECK · <repo>:` (after its Repo's square in a Project of more than one), then what it says with its help on the line under it, both wrapped, never ellipsized: the help is the fix. A failed or refused Install the same way: `INSTALL · <repo>:`, then its output's last line, and the command that runs it again under it. Nothing shows when nothing needs you.

**Project select:** one native `<select>` named "Project", at every width, its `label` beside it: an option per Project, a Repo with none being its own. The Project shown is in 600.

**Panel and sheet:** the `head` title with a `#number` link to the issue (`#number name`, its Repo's, when the Project has more than one), then sections separated by hairlines, each with a `label` head: Asking, first, while the Dispatch is Asking (see Answer, under Components), Assigned, while a Source read holds the issue (each assignee by name, the user as "you", or "Unassigned" in `ink-muted`; an issue no one has, before its Dispatch, has a `button-quiet` "Assign to me" at its right, reading "Assigning…" and disabled while it runs, its refusal inline under it on the errata rule; an issue someone else has offers none), PR (link, draft flag), then for a Waiting issue why it waits, whole (`body`, no head), Failure when the Dispatch Failed (the error in `strong` on the errata rule, then the step it stopped at; for one the Reviewer kept failing, the line "The Reviewer failed it N rounds running; the Findings and Rulings are in its Evidence" in `strong`, then what ends it), Restarts (rows of time, then reason), Review (where the review stands, in a line, after its Reviewer's Harness diamond when it names it, unless a Verdict on the head says it; while the review is off (with no Verdict on the head), stopped or given up on, a `button-quiet` "Review now" at the line's right, reading "Starting…" and disabled while it runs, its refusal inline under it on the errata rule, kept while the tick tries again after a start that failed; then the Verdict: the result word in its colour, the sha in tabular figures, the time, then the findings text wrapped at a 70-character measure), Evidence (one link per file, under `/bucket/`). Opening it moves focus to its title; closing it returns focus to the node that opened it.

## Components

- **Controls**, one set for every form on the Board, styled once in `app.css`: a field (its label above it in sentence case, `ink-muted`, or beside it in a row), a native select, a text or number input (`input`: `surface`, a 1px `ink-muted` border, `rounded.control`), a toggle (a 40×22 track, `live` when on, `hairline` when off), `button` (`ink` fill, the form's one action) and `button-quiet`. One look for each state: hover takes the border to `ink` (a button's fill a step lighter, a quiet one's to `ground`); focus is the 2px `focus` ring; disabled is `ink-muted` text on `ground` with a `hairline` border, never an opacity; refused is the field framed 2px in `failed` until its next save. Under 720px every field and button is at least 44px tall, a toggle's target 44px around it, and field text 16px (the Phone Field Exception). Every form holds the No Scroll Rule at 360px.
- **Launch picker:** one component for the Dispatch form, the Implementer and the Reviewer: Harness across, its diamond inside its select in the Harness's hue, then Model and Effort side by side; in a row of three where it has 480px. Model and Effort are native selects of what the Harness lists, and text fields where it takes any (placeholder `default`).
- **Folded sections:** in a Repo's panel Readiness, Room, Switches, Settings and Install, and in a Project's defaults Room, Switches and Settings, each fold (a native disclosure) to one line on a faint `ground` band, 40px tall (44px on a phone), a drawn chevron, its `label` head, and at its right in `ink-muted` what is set, whole, wrapping under itself when long: `2 of 6 pass`, `3 · 2 in flight`, `7 of 9 on`, `Implementer claude · opus · high`, `Installed a1b2c3d`. The bands, with 8px between them, keep the column reading as distinct parts. A section holding a refusal or a failing state (a failing check, a failed Install) opens by itself; which sections the user opened is remembered in this browser per panel, the ones that opened by themselves are not. The Dispatch form is never folded.
- **Tips:** a field label whose name doesn't say what the setting does (each Switch) carries a one-sentence tip: the label underlined dotted in `ink-muted`, and on hover, after 400ms, a 240px panel under it in `body` on `surface`, with the rate-limit panel's leading `rule` edge and hairline frame. Hover only: the sentence says what the loop does, never what the field takes.
- **Saving:** a field that saves on change (a select, a toggle; a text or number field on Enter and on leaving it, Escape putting back what is set) stays fully legible while it saves. Beside it, where its chip sits, "Saving…" in `ink-muted`, then "Saved" in `ink` for two seconds, then the chip again; "Saved" is heard through a polite live region. A refusal goes on the errata rule under its section, as before, and the field goes back to what is set, framed in `failed`.
- **Where a setting comes from:** one chip beside the setting, quieter than its control: `from Project` or `default` in `ink-muted`, unframed, while it is taken; `set here` in `ink`, framed in `hairline`, once the Repo (or the Project) sets it, with a drawn × whose accessible name is "Use the Project's <Setting>" (or "Use the default <Setting>"), which removes its own.
- **Readiness:** folded under how many checks pass, open by itself while one fails: each failing check on the errata rule, what it says in `strong` and its help in `body`; then the passing ones in `ink-muted`, and one `ink-muted` line with the time the results last changed.
- **Install:** folded under how the last one went; its field "Install command" (emptied, removed; a refusal inline under it); then the last Install: one `ink-muted` line "Installed <sha> at HH:MM", or on the errata rule "Failed at HH:MM" in `strong`, its output as printed, wrapped, and the command that runs it again, which opens the section by itself.
- **Switches:** set once and left, so folded under how many are on. Opened, nine rows (answer, dispatch, flip, gardening, mine as "Only issues assigned to me", quality_scan, restart, review, stack), each its name as a field label, its chip, and a toggle on the right.
- **Room:** folded under the room and, for a Repo, its Dispatches In flight; a row like a switch's, "Room" and its chip on the left and a number input on the right, then, for a Repo, one `ink-muted` line counting its Dispatches In flight. A refused value appears inline under it, and the input goes back to the room set.
- **Settings:** folded under the Implementer's launch and, on a line under it, the Reviewer's ("Reviewer: not the Implementer's" while nothing sets it): the Implementer and the Reviewer, each its name as `strong` with its chip, then the launch picker; the Reviewer's Harness select opens on "Not the Implementer's", the rule serve follows while nothing sets a Reviewer, Model and Effort disabled on "default" and its diamond hollow, with an `ink-muted` line under the picker naming what the rule picks for each Implementer (offered only where removing this layer's Reviewer reaches the rule, so not under a Project that sets one); then Base and, for a Repo, Project as text inputs, Project offering the Projects there are and, while the Repo is in one, a `button-quiet` "Leave <name>" beside it.
- **Remove:** a `button-quiet` "Remove <slug>…" at the column's foot, which asks once more ("Its clone stays") before it removes; a refusal appears inline under it.
- **Add a Repo:** a `surface` section under the work area: Repo, its clone and its Project as text inputs in a row (stacked on a phone), then a `button` "Add". Its Project shows once added.
- **Answer:** the node panel's first section while its Dispatch is Asking, headed `ASKING`: the Implementer's pane as herdr reads it, whole and unwrapped, in the one monospace on the Board (a terminal's screen reads only in its own grid, so this is no monospace wall): 14px `ink` on `ground` in a square 1px `hairline` frame, at most 24em tall (30vh on a phone, so the pane, its options and the keys share the sheet's first screen), scrolling inside its own box sideways and down, and starting scrolled to its foot, where a dialog is; its trailing spaces and runs of blank rows left out. Under it a `button-quiet` per numbered option the pane shows (its last run of lines `1.`, `2.`, …), the digit then what it says, whole and wrapping, full width; then a row of `button-quiet` keys, ↑ ↓ Tab Enter Esc, each at least 44px wide; then "Answer in words", a text input with a `button` "Send" at its right. A key or option sends at once; the pane is read again after each answer and on each change. A refusal, or a pane herdr could not read, goes on the errata rule under it. Every key and option is 44px tall on a phone, and only the pane's box scrolls sideways.
- **Dispatch form:** first in a Repo's panel, never folded, under a `label` head: a native select for the issue (Ready, Stackable and Gardening only, `#number title`), then the launch picker, then two `ink-muted` lines: where the picker starts ("Starts on the last launch used in this Repo", or "Starts on the Implementer's launch in Settings" before any), and who will review it ("Reviewed on <diamond> codex, not the Implementer's Harness", "…, as Settings sets it", or "Not reviewed: review is off for this Repo"), then a `button` labelled "Dispatch". A refusal appears inline under the button as a `failed` 4px errata rule with the error in `strong` and the help lines in `body`; one of an issue no one has, in a Repo with `mine` on, has a `button-quiet` "Assign to me" under it, as in the node panel.
- **Refresh:** a `button-quiet`. It reads "Refreshing…" and is disabled while the POST runs. The read times update when it answers.
- **Roadmap:** in place of the work area, every open issue of the Project's Repos not labelled `ready-for-agent`, read-only, for seeing where things stand. One `surface` field with a `hairline` frame, at full size, scrolling inside when the Roadmap is wider or taller (60vh on a phone); in it a lane per label, left to right, `NEEDS-TRIAGE`, `NEEDS-INFO`, `READY-FOR-HUMAN`, `WONTFIX`, then `NO LABEL`, each a `hairline` frame around its issues stacked in a column, its name a `label` in `ink-muted` on the frame's top line; an issue goes in the first lane its labels match, and an empty lane isn't drawn. Each issue is a node of the map's width, its number and Repo row then its title, without the Stage row (66px tall): the map's look, untinted, its square before its Repo's name in a Project of more than one, reversed when open. Each Blocker's arrow is the map's `blocker` line, leaving the side of its node facing the issue it blocks and running along the gutter beside its lane. Opening a node puts the 400px panel at the Roadmap's right (the bottom sheet on a phone): the `head` title with a `#number` link to the issue, then Labels, Assigned (as the node panel's), Description (its body as Markdown, or "No description." in `ink-muted`) and Blocked by and Blocks, each issue a `#number` link and its title, off the Roadmap too; nothing to press but Close. With nothing to show, one `ink-muted` line says so.
- **Rate-limit gauge:** a button in the header: a 22px ball (a 2px circle) filled from the bottom to the most-used share of every GitHub budget the last tick read (each identity's REST and GraphQL), then that share as `strong` tabular `N%`, both in the gauge's ink: `ink` under 75%, `waiting` from 75%, `failed` from 90%; while GitHub is paused the ball is full `failed` and the share gives way to `PAUSED` (`label`, `failed`). A circle is not a ring: it is never a Stage. Shape and the number carry it without colour. Hovered with a mouse, or clicked or tapped (till clicked again, Escape or a click elsewhere), it opens a 320px panel under it, at its right (between the gutters on a phone), with the panel's leading `rule` edge and hairline frame: `GITHUB RATE LIMITS` (`label`), `Paused` in `failed` with "until HH:MM" right-aligned while it is, then per identity, on a `hairline`, its name in 600 (`You`, `Bot`) and its CLI in `ink-muted` (`· gh`, `· ghbot`), and per budget two rows: its name (`REST`, `GraphQL`) in `ink-muted` and "**used** / limit" at the right; "N left" and "resets HH:MM · in N min" (right column) in `ink-muted`.
- **Theme switch:** a three-segment control (Light / Dark / System), with the active segment reversed. This is the one sanctioned reversal outside the map, because a segmented control's selected state is a standard affordance.

## Do's and Don'ts

- **Do** let shape carry each state, so it reads without colour: a ring is a Stage, a square a Repo, a diamond a Harness.
- **Do** give every hue one job, and a token here and in `app.css`; never a hex in a component.
- **Do** set every number with tabular figures and every time in the right column.
- **Do** fold what is set once and left, and say what is set on the folded line.
- **Do** say a save happened beside the field; never grey a field out while it saves.
- **Don't** use yellow for anything except needs you, and make no other hue a yellow.
- **Don't** put nodes in rounded cards, gradient pills or KPI tiles, and tint them only with their Stage's hue. The user ruled out the SaaS dashboard look.
- **Don't** style a control in a component: a form uses the shared controls, and a component lays them out.
- **Don't** add mascots, bounce or confetti (no toy look), and no green-on-black or monospace walls (no hacker terminal).
- **Don't** pad toward airiness. The desk view should show a Repo's whole night without scrolling.
- **Don't** draw station-sign chrome (pictograms, split-flap animation, platform numbers). That is the costume.
