---
name: nico-agent
description: A calm work map. Neutral light and dark workspaces with one layout, the Project map central, each node a card that leads with its issue's title and says its Stage and agent state in words, one selection accent, and Needs you as a soft amber badge on the issue it belongs to.
colors:
  ground: "#f5f6f8"
  surface: "#ffffff"
  raised: "#eef0f3"
  ink: "#1a1d23"
  ink-muted: "#5b636e"
  hairline: "#e1e4e9"
  rule: "#8b929c"
  accent: "#2459d1"
  accent-ink: "#ffffff"
  accent-soft: "#e8eefb"
  focus: "#2459d1"
  signal: "#fff1c2"
  signal-edge: "#c99400"
  signal-ink: "#533c00"
  live: "#1d4f91"
  verified: "#00754a"
  failed: "#c8102e"
  ready: "#00747a"
  stackable: "#a32385"
  waiting: "#99560f"
  merged: "#8250df"
  closed: "#7a6655"
  harness-claude: "#a94a26"
  harness-codex: "#0b7b63"
  harness-opencode: "#6a4bd6"
  ground-dark: "#0e1117"
  surface-dark: "#161a21"
  raised-dark: "#1e232c"
  ink-dark: "#e6e9ee"
  ink-muted-dark: "#9ba3af"
  hairline-dark: "#2a303a"
  rule-dark: "#6b7380"
  accent-dark: "#6ea2ff"
  accent-ink-dark: "#0e1117"
  accent-soft-dark: "#1b2740"
  focus-dark: "#6ea2ff"
  signal-dark: "#3a2f0d"
  signal-edge-dark: "#a07c12"
  signal-ink-dark: "#ffd96a"
  live-dark: "#7fb0ff"
  verified-dark: "#3ccf8e"
  failed-dark: "#ff6b6b"
  ready-dark: "#45cbc5"
  stackable-dark: "#f07fd6"
  waiting-dark: "#e8a35a"
  merged-dark: "#a98bfa"
  closed-dark: "#c3ab98"
  harness-claude-dark: "#f2956c"
  harness-codex-dark: "#4dd0aa"
  harness-opencode-dark: "#a996ff"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  head:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
  node-title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "20px"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  strong:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.45
  small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "18px"
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, DejaVu Sans Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  field-phone:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  control: "6px"
  card: "8px"
  sheet: "12px"
  pill: "999px"
spacing:
  hair: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
components:
  node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "9px 12px"
    width: "248px"
    height: "108px"
  node-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  needs:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.signal-ink}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "20px"
  notice:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "10px 6px 12px 14px"
  inspector:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "0 20px 20px"
    width: "400px"
  sheet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "0 16px 16px"
  rail:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    width: "220px"
  button:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "36px"
  button-quiet:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "36px"
  fold:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    typography: "{typography.strong}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "40px"
  chip:
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0 2px 0 8px"
    height: "22px"
---

# nico-agent: a calm work map

## Overview

The page is one workspace, read at the desk in the morning and checked on the phone. It answers two questions at a glance: what work is happening, and what needs me. The Project's map is the centre of it; everything else is either how you got there (the Projects rail, the views) or what you do with what you picked (the inspector). Settings exist and are one click away, but they never sit beside the work while you only watch it.

Light is the everyday workspace: a neutral grey page, white cards and panels with hairline frames, readable system type. Dark is the same layout and the same components on a near-black page for a focused evening: no new layout, no new components, only its own tokens. Themes are Light, Dark and System. System follows `prefers-color-scheme` and is the default; the choice is remembered in `localStorage`.

**The Words First Rule.** Every state is said in words: a Stage is its word, an agent's state is `Asking`, `Working` or `Idle`, needs you is `Needs you`. Colour and icons repeat what the word says, so the page reads without colour and without a legend of shapes to learn.

**The One Accent Rule.** One accent marks what is selected and what you can act on: the open node, the current Project, the current view, links, focus and the form's one action. No other hue is used for selection.

Motion is short and functional. The inspector slides in 160ms ease-out (rises, on a phone). When a refetch changes a node's Stage, its Stage row flashes once (200ms), as does a notice new to the page (not on the first read) and the read times when a read moves them (not when another Project shows its own). When a node taking keyboard focus or Fit moves the map, the view glides there in 300ms, easing out; a drag or zoom stops it where it is. Nothing loops and nothing moves on load. Under `prefers-reduced-motion` all motion is off and changes simply appear.

## Colors

- **Neutrals:** `ground` is the page, the field behind a merged node and a folded line's band; `surface` is the rail, the cards, the map's field, the inspector, the sheet and every panel; `raised` is hover and the theme switch's track. `hairline` frames cards and separates sections; `rule` frames controls (3:1 on `surface`, as a field's frame must be).
- **Ink:** `ink` for everything you read first; `ink-muted` for a node's number and Repo, field labels, times and where a setting comes from.
- **Accent (`accent`):** selection and action, as the One Accent Rule says. `accent-soft` is the current Project's band in the rail and an open toggle button (`Repos` while it is open).
- **Needs you (`signal`, `signal-edge`, `signal-ink`):** a soft amber, and nothing else is amber-yellow: the `Needs you` badge on a node and in the inspector, and the left edge of a notice and of the `Hide notices` button.
- **Stage hues**, one per Stage, on its icon and its word, never on the card: Waiting `waiting` (amber sienna), Ready `ready` (teal), Stackable `stackable` (magenta), Implementing and PR draft `live` (blue), Verified `verified` (green, a passing Verdict on the head commit), Merged `merged` (the purple GitHub uses), Closed `closed` (taupe), Failed `failed` (red). A Blocker not offered to the loop has none: its word `Blocker` in `ink-muted`, no icon.
- **Failed red (`failed`)** is also a failing Verdict, a refusal, a refused field's frame, serve out of reach and a read that failed: the errata rule (a 4px red left edge on a faint red wash), the Failed node's left edge, and the rate-limit gauge from 90% of a budget and while GitHub is paused.
- **Waiting amber (`waiting`)** is also the rate-limit gauge from 75% of a budget.
- **Harness hues** (`harness-claude`, `harness-codex`, `harness-opencode`): a small dot inside a launch picker's Harness select and before the inspector's review line that names its Reviewer's; anywhere else a Harness is named in words. Any other Harness's dot is `ink-muted`.
- **Repos have no colour.** A node names its Repo in words after its number.

Every text pair meets WCAG AA, light and dark: 4.5:1 for text on `surface` and `ground` (every Stage word does), 3:1 for a control's frame and the icons. `.agents/skills/verify-nico-agent/contrast.mjs` checks every token in `app.css`. Every colour is a token here and in `app.css`, and nothing hard-codes a hex.

## Typography

The platform's own sans (`ui-sans-serif`, `system-ui`, then the usual fallbacks): familiar, readable and nothing to download. Tabular figures are on everywhere (`font-variant-numeric: tabular-nums`), so times line up. Section heads are sentence case in 600, never all caps.

- `title` (20px, 600): the Project's name in the header.
- `head` (18px, 600): the inspector's title; a Repo panel's name is 16px 600.
- `node-title` (15px, 600, 20px lines): a node's title, two lines at most, then an ellipsis; the whole title is its accessible name and its hover tip.
- `body` and `strong` (14px): form text, the inspector's sections, Stage words in the inspector, history rows.
- `small` (13px): a node's number, Repo, Stage row and agent row; the legend; a notice's line under its head.
- `mono` (13px): the Asking pane, the one monospace on the Board (a terminal's screen reads only in its own grid), and commands in `code`.

**The Phone Field Exception.** Under 720px, the text inside a field (`field-phone`) is 16px, so iOS never zooms the page into it.

**The Right Column Rule.** Every time on the page (Source read, PRs checked, restarted at, Verdict at, paused until) is `HH:MM`, plus the date when it isn't today, and sits at the right where it is in a row.

## Layout

A 4px base; spacing steps 4, 8, 12, 16 and 24. On desktop the page gutter is 24px; on phone 16px.

**Desktop (720px and wider):**

1. **Rail** (220px, `surface`, a hairline on its right, sticky to the window's height): the `n` logo and `nico-agent`; then `Projects`, a link per Project (a Repo with none being its own, named by its slug), its count of Repos under its name when it holds more than its own, the current one on `accent-soft` with a 3px accent edge; at its foot the GitHub rate-limit gauge (once a tick has read it) and the Light / Dark / System switch.
2. **Header:** the Project's name (`title`) over one `ink-muted` line, "N Repos · Source read HH:MM · PRs checked HH:MM", the oldest of its Repos'; at the right `Refresh` and, in the Map view, `Repos`. Under it the views, `Map` and `Roadmap`, as tabs on a hairline, the current one in `ink` on a 2px accent underline. The URL's hash holds the Project and the view, so a link opens it and back and forward work.
3. **Work area:** the map fills the width. Opening a node puts the 400px inspector at its right; pressing `Repos` puts a 340px column there instead, the Project's defaults (unless it is a Repo's own: its name, "Defaults for its Repos, where they set none", then Room, Switches and Settings, folded), a panel per Repo, and `Add a Repo` at its foot. Opening a node while Repos is open puts the inspector in its place, and closing it brings Repos back. The map keeps its pan and zoom throughout, and pans an opened node into view beside the inspector, so the inspector never covers it. Beside a map taller than the window, the inspector stays in view.

**Phone (under 720px):**

- 16px gutters and no horizontal scroll, anywhere, with the sheet open or closed. Every button and field is at least 44px tall.
- The rail becomes a bar at the top: the logo (the name read out, not shown), the gauge and the theme switch. The header's first line is a native `<select>` named `Project`, full width; the read times, `Refresh` and `Repos` under it; then the two views as full-width tabs.
- The map starts fitted to the viewport width at 60vh tall and still pans and zooms within its own box. Fitted, a vertical swipe on it scrolls the page past it and a sideways one pans it; pinched in, every drag pans it. Its zoom buttons sit at its top, clear of the notices. The Repos column follows below it.
- The inspector becomes a bottom sheet: up to 85vh, its head sticky with a grip, `Close` and the title, scrolling inside, closed by `Close`, Escape or a swipe down.

**The No Scroll Rule.** At 360px wide, nothing is wider than the viewport. Long titles wrap to two lines on nodes and wrap whole in the inspector.

## Elevation & Depth

Mostly flat. Cards, panels, the rail and the inspector are framed by a hairline and lifted by one faint 1px shadow (`--shadow`). Only what floats over the work has a soft shadow (`--shadow-pop`): the notices, the rate-limit panel, tips and the bottom sheet. The map's field carries a faint dot grid, so it reads as a surface that pans. No glass, no gradients beyond that grid.

## Shapes

Cards and panels are rounded 8px, controls 6px, the bottom sheet 12px at its top, badges and chips are pills.

**Node** (248px wide, 108px tall, a row taller with an agent or a line), a `surface` card with a hairline frame, hovering to `rule`:

1. The title (`node-title`), up to two lines.
2. `#number` in `ink`, then `· repo` when the Project has more than one Repo and `· research` for a research issue, in `ink-muted`, ellipsized; at the right `Needs you` when it needs you: an Implementer Asking, its faux-nico blocked, a Failed Dispatch, a review given up on or stopped, a Verified PR.
3. The Stage: its icon (below) and its word in 600, both in its hue; at the right `PR <n>` and `draft` when it is one, in `ink-muted`.
4. While it has either, in `ink-muted`, ellipsized: its agent's state, `Asking · claude` (in `ink`, 600), `Working · codex`, `Idle · claude` (the Harness of the agent at work: its Reviewer's while that one works alone), from herdr or, for Asking, the tick's record; then, after ` · `, where its review stands while PR draft (`reviewing`, `review off`, `review gave up`, …), or while Waiting why, without its own key (`waits on acme/web#1 to close`), or who it is assigned to when that keeps it from Ready (`assigned to @someone`, or `unassigned` in a Repo with `mine` on).

The open node keeps its white card and takes the accent as a doubled frame. A Failed node has a 4px `failed` left edge. A merged node (7 days after its merge, unless hidden) sits back on `ground` with a dashed frame, its text still full contrast.

**Stage icons** (14px, in the Stage's hue, always beside the word): Waiting a dashed ring, Ready a ring, Stackable a ring with a centre dot, Implementing a half-filled disc, PR draft and Merged a disc, Verified a double ring, Closed a struck ring, Failed a ✕.

**Edges:** dagre lays them out left to right, Blockers left, the issues they block right, each a polyline with a small open arrowhead at its end.

- `blocker`: a 1.5px solid `ink-muted` line, Blocker to blocked.
- `stack`: a 1.5px dashed `accent` line, from the issue whose PR it sits on to the Stacked one.

A legend at the map's foot names them, `Blocks` and `Stacked on`, beside each line, while the map has one (hidden on a phone). Beside it `Zoom out`, `Zoom in` and `Fit`, a joined group of quiet buttons; at the map's bottom left, while it holds a merged issue, "Hide merged", or "Show N merged" once they are hidden, remembered in this browser for every map.

**Notices (needs you without a node):** stacked over the page's bottom right corner (across its foot on a phone), at most half the window tall and scrolling inside past that, each a white card with a hairline frame and a 4px `signal-edge` left edge, and a × that dismisses it for this page load; the next load shows it again. Under the stack `Hide notices` folds it to `Show N notices` for the page load. One notice per item: its kind (`strong`: `Check`, `Install`, `Paused`, `Blocked`), its name, then its line under them in `ink-muted`. GitHub paused: `Paused GitHub`, then `until HH:MM`. An agent of the loop's own that herdr reports blocked and has no node (a quality-scan, the morning agent): `Blocked <agent>`, then `HH:MM`. A failing Readiness check: `Check <repo>:`, then what it says with its help under it, both wrapped, never ellipsized: the help is the fix. A failed or refused Install the same way: `Install <repo>:`, its output's last line, and the command that runs it again. Nothing shows when nothing needs you. The Board never sums these up into counters or a dashboard, and never shows the Morning summary.

**Inspector and sheet:** a bar with the issue's `#number` link (`#number repo` when the Project has more than one Repo, `· research` after it) and `Close`; the title (`head`); a line with the Stage icon and word, `Agent asking` / `working` / `idle` when it has one, and `Needs you` at its right. Then sections separated by hairlines, each under a sentence-case `strong` head, the next useful action first:

1. **Asking**, while the Dispatch is Asking (see Answer, under Components).
2. For a Waiting issue, why it waits, whole.
3. **Failure** when the Dispatch Failed: the error on the errata rule, then the step it stopped at; for one the Reviewer kept failing, "The Reviewer failed it N rounds running; the Findings and Rulings are in its Evidence", then what ends it.
4. **Pull request**: `Open PR <n>` (and `(draft)`), a `button` once Verified with "Review and merge it on GitHub." under it, a `button-quiet` otherwise; "merged HH:MM" at its right once merged; "No PR yet." without one. Merging stays on GitHub.
5. **Review**: where the review stands, after its Reviewer's Harness dot when it names it, unless a Verdict on the head says it; while the review is off (with no Verdict on the head), stopped or given up on, a `button-quiet` "Review now" at the line's right, reading "Starting…" and disabled while it runs, its refusal inline under it, kept while the tick tries again after a start that failed; then the Verdict: `pass` or `fail` in its colour, the sha, the time at the right, then the findings wrapped at a 70-character measure.
6. **Evidence**: `Open Evidence` (`button-quiet`, the issue's folder under `/bucket/`), "N heads · N files" at its right.
7. **Assigned**, while a Source read holds the issue: each assignee by name, the user as "you", or "Unassigned" in `ink-muted`; an issue no one has, before its Dispatch, has a `button-quiet` "Assign to me" at its right, reading "Assigning…" and disabled while it runs, its refusal inline under it; an issue someone else has offers none.
8. **Restarts**, a disclosure with its count, folded but open on a Failed Dispatch: rows of time, then reason, then who.

An issue with no Dispatch says "Not dispatched yet: no restarts, Verdict or Evidence." under its PR. Opening the inspector moves focus to its title; closing it (Close or Escape) returns focus to the node that opened it. The inspector shows real data and supported actions only: there is no Open agent action and no merge button.

## Components

- **Controls**, one set for every form on the Board, styled once in `app.css`: a field (its label above it in sentence case, `ink-muted`, or beside it in a row), a native select, a text or number input (`input`: `surface`, a 1px `rule` frame, rounded 6px), a toggle (a 40×22 pill, `accent` when on, `raised` when off), `button` (`accent` fill, the form's one action) and `button-quiet` (`surface`, a `rule` frame), and every other button. One look for each state: hover takes a field's frame to `ink` (a button's fill a step darker, a quiet one's to `raised`); focus is the 2px `focus` ring; disabled is `ink-muted` text on `raised` with a `hairline` frame, never an opacity; refused is the field framed 2px in `failed` until its next save. Under 720px every field and button is at least 44px tall, a toggle's target 44px around it, and field text 16px (the Phone Field Exception). Every form holds the No Scroll Rule at 360px.
- **Launch picker:** one component for the Dispatch form, the Implementer and the Reviewer: Harness across, its dot inside its select in the Harness's hue, then Model and Effort side by side; in a row of three where it has 480px. Model and Effort are native selects of what the Harness lists, and text fields where it takes any (placeholder `default`).
- **Folded sections:** in a Repo's panel Dispatch, Readiness, Room, Switches, Settings and Install, and in a Project's defaults Room, Switches and Settings, each fold (a native disclosure) to one line on a `ground` band rounded 6px, 40px tall (44px on a phone): a drawn chevron, its head in `strong`, and at its right in `ink-muted` what is set, whole, wrapping under itself when long: `3 to dispatch`, `2 of 6 pass`, `3 · 2 in flight`, `7 of 9 on`, `Implementer claude · opus · high`, `Installed a1b2c3d`. A section holding a refusal or a failing state (a failing check, a failed Install) opens by itself; which sections the user opened is remembered in this browser per panel, the ones that opened by themselves are not.
- **Tips:** a field label whose name doesn't say what the setting does (each Switch) carries a one-sentence tip: the label underlined dotted in `ink-muted`, and on hover, after 400ms, a 240px card under it. Hover only: the sentence says what the loop does, never what the field takes.
- **Saving:** a field that saves on change (a select, a toggle; a text or number field on Enter and on leaving it, Escape putting back what is set) stays fully legible while it saves. Beside it, where its chip sits, "Saving…" in `ink-muted`, then "Saved" in `ink` for two seconds, then the chip again; "Saved" is heard through a polite live region. A refusal goes on the errata rule under its section, and the field goes back to what is set, framed in `failed`.
- **Where a setting comes from:** one chip beside the setting, quieter than its control: `from Project` or `default` in `ink-muted`, unframed, while it is taken; `set here` in `ink`, a hairline pill, once the Repo (or the Project) sets it, with a drawn × whose accessible name is "Use the Project's <Setting>" (or "Use the default <Setting>"), which removes its own.
- **Repo panel:** a card per Repo in the Repos column, its slug as its head when the Project holds more than its own, then, once it is checked, who its agents post as in `ink-muted` ("Agents post as <the bot>", or "PRs and comments are posted as you" and an "Install the App" link), then its Dispatch form, its one action, then Readiness, Room, Switches, Settings and Install, each folded, and Remove at its foot.
- **Readiness:** folded under how many checks pass, open by itself while one fails: each failing check on the errata rule, what it says in `strong` and its help in `body`; then the passing ones in `ink-muted`, and one `ink-muted` line with the time the results last changed.
- **Install:** folded under how the last one went; its field "Install command" (emptied, removed; a refusal inline under it); then the last Install: one `ink-muted` line "Installed <sha> at HH:MM", or on the errata rule "Failed at HH:MM" in `strong`, its output as printed, wrapped, and the command that runs it again, which opens the section by itself.
- **Switches:** folded under how many are on. Opened, nine rows (answer, dispatch, flip, gardening, mine as "Only issues assigned to me", quality_scan, restart, review, stack), each its name as a field label, its chip, and a toggle on the right.
- **Room:** folded under the room and, for a Repo, its Dispatches In flight; a row like a switch's, "Room" and its chip on the left and a number input on the right, then, for a Repo, one `ink-muted` line counting its Dispatches In flight. A refused value appears inline under it, and the input goes back to the room set.
- **Settings:** folded under the Implementer's launch and, on a line under it, the Reviewer's ("Reviewer: not the Implementer's" while nothing sets it): the Implementer and the Reviewer, each its name as `strong` with its chip, then the launch picker; the Reviewer's Harness select opens on "Not the Implementer's", the rule serve follows while nothing sets a Reviewer, Model and Effort disabled on "default" and its dot hollow, with an `ink-muted` line under the picker naming what the rule picks for each Implementer (offered only where removing this layer's Reviewer reaches the rule, so not under a Project that sets one); then Base and, for a Repo, Project as text inputs, Project offering the Projects there are and, while the Repo is in one, a `button-quiet` "Leave <name>" beside it.
- **Remove:** a `button-quiet` "Remove <slug>…" at a Repo panel's foot, which asks once more ("Its clone stays") before it removes; a refusal appears inline under it.
- **Add a Repo:** a card at the Repos column's foot, and in the empty Board: Repo, its clone and its Project as text inputs in a row (stacked on a phone), then a `button` "Add". Its Project shows once added.
- **Answer:** the inspector's first section while its Dispatch is Asking, headed `Asking`: the Implementer's pane as herdr reads it, whole and unwrapped, in `mono` on `ground` in a hairline frame rounded 6px, at most 24em tall (30vh on a phone, so the pane, its options and the keys share the sheet's first screen), scrolling inside its own box sideways and down, and starting scrolled to its foot, where a dialog is; its trailing spaces and runs of blank rows left out. Under it a `button-quiet` per numbered option the pane shows (its last run of lines `1.`, `2.`, …), the digit then what it says, whole and wrapping, full width; then a row of `button-quiet` keys, ↑ ↓ Tab Enter Esc, each at least 44px wide; then "Answer in words", a text input with a `button` "Send" at its right. A key or option sends at once; the pane is read again after each answer and on each change. A refusal, or a pane herdr could not read, goes on the errata rule under it. Every key and option is 44px tall on a phone, and only the pane's box scrolls sideways.
- **Dispatch form:** first in a Repo's panel, folded under how many issues it offers ("3 to dispatch", or "Nothing to dispatch") and open by itself on a refusal: a native select for the issue (Ready, Stackable and Gardening only, `#number title`), then the launch picker, then two `ink-muted` lines: where the picker starts ("Starts on the last launch used in this Repo", or "Starts on the Implementer's launch in Settings" before any), and who will review it ("Reviewed on codex, not the Implementer's Harness", "…, as Settings sets it", or "Not reviewed: review is off for this Repo"), then a `button` "Dispatch". A refusal appears inline under the button on the errata rule with the error in `strong` and the help lines in `body`; one of an issue no one has, in a Repo with `mine` on, has a `button-quiet` "Assign to me" under it, as in the inspector.
- **Refresh:** a `button-quiet` in the header. It reads "Refreshing…" and is disabled while the POST runs; a refusal goes under it, on the errata rule. The read times update when it answers.
- **Repos:** a `button-quiet` in the header, beside Refresh, in the Map view; `aria-expanded`, on `accent-soft` with an accent frame while the column is open; closed on each page load.
- **Roadmap:** in place of the map, every open issue of the Project's Repos not labelled `ready-for-agent`, read-only, for seeing where things stand. One `surface` field rounded 8px, at full size, scrolling inside when the Roadmap is wider or taller (60vh on a phone); in it a lane per label, left to right, `needs-triage`, `needs-info`, `ready-for-human`, `wontfix`, then `no label`, each a `ground` frame around its issues stacked in a column, its name in `ink-muted` 600 on the frame's top line; an issue goes in the first lane its labels match, and an empty lane isn't drawn. Each issue is a card of the map's width, its title then its number and Repo, without the Stage row (84px tall), framed in the accent when open. Each Blocker's arrow is the map's `blocker` line, leaving the side of its node facing the issue it blocks and running along the gutter beside its lane. Opening a node puts the 400px inspector at the Roadmap's right (the bottom sheet on a phone): its `#number` link and Close over the title, then Labels, Assigned (as the map's inspector's), Description (its body as Markdown, or "No description." in `ink-muted`) and Blocked by and Blocks, each issue a `#number` link and its title, off the Roadmap too; nothing to press but Close. With nothing to show, one `ink-muted` line says so.
- **Rate-limit gauge:** a button at the rail's foot (in the phone's top bar): a 22px ball (a 2px circle) filled from the bottom to the most-used share of every GitHub budget the last tick read (each identity's REST and GraphQL), then that share as `strong` `N%`, both in the gauge's ink: `ink` under 75%, `waiting` from 75%, `failed` from 90%; while GitHub is paused the ball is full `failed` and the share gives way to `Paused` in `failed`. Shape and the number carry it without colour. Hovered with a mouse, or clicked or tapped (till clicked again, Escape or a click elsewhere), it opens a 320px card over it (under it, between the gutters, on a phone): `GitHub rate limits`, `Paused` in `failed` with "until HH:MM" at the right while it is, then per identity, on a hairline, its name in 600 (`You`, `Bot`) and its CLI in `ink-muted` (`· gh`, `· ghbot`), and per budget two rows: its name (`REST`, `GraphQL`) in `ink-muted` and "**used** / limit" at the right; "N left" and "resets HH:MM · in N min" in `ink-muted`.
- **Theme switch:** a three-segment control (Light / Dark / System) on a `raised` track, the active segment a white (`surface`) lifted pill.

## States

- **Loading:** "Reading nico-agent…" in `ink-muted` until the first status answers; "Reading the map…", "Reading the Roadmap…", "Reading the Dispatch…" in their places. Words, never a spinner alone.
- **Empty:** with no Repo, "No Repo yet" (`title`), what a Repo gives you and how to add one, on the page or with `nico-agent repo add <owner/name> --path <clone>`, then the Add a Repo card. An empty map or Roadmap says why in one `ink-muted` line.
- **Unknown data:** a title no read holds is "Title not read" in `ink-muted`; times not read yet say so ("Source not read yet", "PRs not checked yet"); a Blocker outside the loop is `Blocker`, never a Stage.
- **Disconnected or failed:** serve out of reach is an errata banner over the header ("Lost nico-agent serve; reconnecting.", or the refusal), with "Showing what was last read." while the page holds a read; a map or Roadmap that fails to refresh keeps the one it has, with "Showing the last map read." and why over it; one with nothing cached says "Could not read the map." and why.
- **Paused Source:** the `Paused GitHub` notice and the gauge's `Paused`; the cached work stays as it was read.

## Do's and Don'ts

- **Do** say every state in words, and let colour and icons repeat it.
- **Do** keep the accent for selection and action, amber for needs you, and each Stage hue for its Stage; a token here and in `app.css`, never a hex in a component.
- **Do** put the next useful action first in the inspector, and the secondary detail in a labelled disclosure.
- **Do** keep settings behind `Repos`, and fold what is set once and left, saying what is set on the folded line.
- **Do** say a save happened beside the field; never grey a field out while it saves.
- **Don't** add counters, progress summaries, KPI tiles or a global dashboard; needs you stays on its issue, or in a notice when it has none.
- **Don't** show an action the app does not support (an Open agent button, a merge button), or a state it does not know (a "Loop running" light).
- **Don't** colour Repos, tint cards with their Stage, or ask the reader to learn a legend of shapes.
- **Don't** add mascots, bounce or confetti, and no monospace beyond the Asking pane and commands.
- **Don't** pad toward airiness: six nodes in two chains read at 1440×900 without scrolling the page.
