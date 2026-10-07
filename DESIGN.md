---
name: nico-agent
description: A localhost Board where every In-flight Dispatch is a track on a particle-detector event display.
colors:
  display-field: "#0a0d12"
  display-ink: "#dfe4eb"
  display-ink-bright: "#f2f4f7"
  display-ink-muted: "#7d8796"
  display-geometry: "#303b4a"
  display-rule: "#1a212b"
  implementing-signal: "#f5a524"
  pr-ready-signal: "#3bd47b"
  review-signal: "#52b5ff"
  failed-signal: "#ff5757"
  blocked-signal: "#ff4fd6"
  unknown-signal: "#6b7584"
  implementing: "#c06a00"
  implementing-ink: "#8f4f00"
  pr-ready: "#10874a"
  pr-ready-ink: "#0b6b3a"
  review: "#1c6dd0"
  review-ink: "#1756a6"
  failed: "#d1262b"
  failed-ink: "#b01e22"
  blocked: "#b5129a"
  unknown: "#8a94a2"
  fire: "#f2a516"
  fire-hover: "#ffb52e"
  fire-ink: "#211400"
  ground: "#f3f5f8"
  panel: "#ffffff"
  panel-raised: "#eef1f5"
  rule: "#dce1e8"
  rule-strong: "#c2c9d3"
  ink: "#11151b"
  ink-muted: "#566170"
  link: "#1d5bb8"
  ground-dark: "#06080b"
  panel-dark: "#0b0f14"
  panel-raised-dark: "#11161d"
  rule-dark: "#19202a"
  rule-strong-dark: "#283240"
  ink-dark: "#e3e7ed"
  ink-muted-dark: "#8d97a6"
  link-dark: "#84b6ff"
  failed-ink-dark: "#ff6b6b"
  blocked-ink-dark: "#1a0015"
typography:
  brand:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 700
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 500
  readout:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    fontFeature: "tnum"
  lede:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.4
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    letterSpacing: "-0.005em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  control:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 650
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
  display-label:
    fontFamily: "system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 600
rounded:
  hairline: "1px"
  sm: "3px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2.5rem"
components:
  button:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 0.6rem"
    height: "28px"
  button-fire:
    backgroundColor: "{colors.fire}"
    textColor: "{colors.fire-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 0.6rem"
    height: "28px"
  button-fire-hover:
    backgroundColor: "{colors.fire-hover}"
    textColor: "{colors.fire-ink}"
  button-review:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.review-ink}"
    rounded: "{rounded.md}"
    height: "28px"
  button-close:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.md}"
    height: "28px"
  button-close-hover:
    textColor: "{colors.failed-ink}"
  select:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 0.3rem"
    height: "28px"
  chip:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.mono}"
    rounded: "{rounded.sm}"
    padding: "0 0.4rem"
    height: "20px"
  agent-blocked:
    backgroundColor: "{colors.blocked}"
    textColor: "{colors.panel}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 0.45rem"
    height: "20px"
  count:
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 0.35rem"
    height: "18px"
  section-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.lg}"
  section-header:
    backgroundColor: "{colors.panel-raised}"
    typography: "{typography.title}"
    padding: "0.65rem 1rem"
  event-display:
    backgroundColor: "{colors.display-field}"
    textColor: "{colors.display-ink}"
    rounded: "{rounded.lg}"
    padding: "1.5rem 2rem 1.5rem 1.5rem"
---

# Design System: nico-agent

## Overview

**Creative North Star: "The Event Display"**

The Board reads In-flight work the way a particle physicist reads a collision: a detector seen end-on, with one track per Dispatch leaving the vertex and reaching as far out as its Stage. Implementing stops inside the tracker, PR ready deposits a tower in the electromagnetic calorimeter, Review launched punches through to the muon stations, and Failed ends in a burst. The display is for reading at a glance; the rows below it are where the user acts, and the two are linked by hover.

Everything outside the display is a quiet operational surface: system sans, hairline rules, 3 to 6px corners, flat panels, and colour that only ever means Stage, Agent blocked, or "start a track". The instrument is literal geometry, not costume. There is no HUD chrome, no neon glow, no scanlines, and nothing loops.

The surface is dense, monitor-grade, and built for a tab left open all day. It must stay at least as scannable as a plain status table.

**Key Characteristics:**
- A fixed dark instrument canvas (the display field) in both colour schemes.
- One hue per Stage, shared by track, legend key, and row.
- Magenta reserved for Agent blocked; amber fill reserved for starting a track.
- System sans for UI; monospace only for identifiers.
- Hairline rules, small radii, flat surfaces, a single authored motion.

## Colors

A neutral blue-grey operational palette around one fixed dark instrument, with four Stage hues, one attention hue, and one action hue.

### Primary
- **Ignition Amber** (fire, hover fire-hover, text fire-ink): the fill of a button that starts a track, meaning Dispatch and the Retry of a failed Dispatch. Also used, as Implementing amber, for the caret, checkbox accent, text selection tint, and the trail in the brand glyph.

### Secondary
Stage hues. Each appears in three places for one Dispatch: its track, its legend key in the readout, and the Stage key on its row. Light-scheme rows use the stronger UI value and its `-ink` text variant; the dark scheme uses the signal value for both.
- **Tracker Amber** (implementing / implementing-ink; signal implementing-signal): Implementing. Also colours warnings.
- **Calorimeter Green** (pr-ready / pr-ready-ink; signal pr-ready-signal): PR ready, the ECAL deposit, and the "done" agent dot.
- **Muon Blue** (review / review-ink; signal review-signal): Review launched, the muon hits, and the outlined Launch review button.
- **Burst Red** (failed / failed-ink; dark failed-ink-dark; signal failed-signal): Failed, error text, and the hover state of Close.
- **Unknown Grey** (unknown; signal unknown-signal): a Stage nico-agent cannot read. On the display the track is dashed.

### Tertiary
- **Attention Magenta** (blocked; dark uses blocked-signal with blocked-ink-dark text): Agent blocked only. The ring at a track's tip, the track label, the readout's Agent blocked line, and the one filled badge in the rows.

### Neutral
- **Display Field** (display-field): the event display's canvas. Identical in light and dark.
- **Display Inks** (display-ink, display-ink-bright, display-ink-muted): readout text, lede and counts, and the subdetector key and Sampled time.
- **Detector Geometry** (display-geometry, display-rule): tracker rings and readout hairlines. The ECAL and HCAL bands are this grey mixed toward green (34%) and blue (28%); muon stations are a lighter slate.
- **Ground / Panel / Raised** (ground, panel, panel-raised and their `-dark` counterparts): page, section body, and section headers, hovered rows, and default buttons.
- **Rules** (rule, rule-strong and `-dark`): hairline dividers, and control and count borders.
- **Ink** (ink, ink-muted and `-dark`): text and secondary text.
- **Link** (link, link-dark): links and the focus ring.

### Named Rules
**The Fixed Instrument Rule.** The display field stays #0a0d12 in both schemes, and inside it the Stage hues are always the signal values. Only the page around it changes with the scheme.

**The Stage Owns Its Hue Rule.** Amber, green, blue, and red mean Implementing, PR ready, Review launched, and Failed, in that order, everywhere they appear. A Stage nico-agent cannot read is grey, dashed on its track.

**The Magenta Means Waiting Rule.** Magenta marks an agent waiting on the user, and nothing else.

**The Amber Starts a Track Rule.** A filled amber button starts a track: Dispatch, or Retry of a failed Dispatch. Review actions, including a review's Retry, are outlined in Muon Blue. Close is muted and turns red on hover.

## Typography

**Body Font:** system-ui (with -apple-system, Segoe UI, Roboto, sans-serif)
**Label/Mono Font:** ui-monospace (with SFMono-Regular, Menlo, monospace)

**Character:** One plain system sans with tabular numerals, carrying hierarchy through weight (400 to 700) rather than size. Monospace appears only where the text is an identifier.

### Hierarchy
- **Brand** (700, 18px, -0.015em): the nico-agent wordmark beside its glyph.
- **Headline** (500, 18px): the page title, in muted ink after a "/" separator.
- **Readout** (600, 18px, tabular): counts in the event display's legend.
- **Lede** (400, 15px, 1.4, max 34ch): the one explanatory sentence in the readout.
- **Title** (650, 14px, -0.005em): section headings (Repo slug, In flight).
- **Body** (400, 14px, 1.45, tabular): issue titles and page text.
- **Control** (500, 13px): buttons and selects. Filled amber buttons use 600.
- **Label** (650, 12px): Stage keys, Stackable and PR open sub-headings, counts. Plain 12px for field labels and agent states.
- **Mono** (12px): issue numbers and keys, Base branches, the harness · model · effort launch triple, herdr workspace names, and code.
- **Display label** (600, 10px; subdetector key 500, 7.5px): track labels and the Tracker/ECAL/HCAL/Muon key inside the SVG. Each label has a display-field halo stroke.

### Named Rules
**The Identifier Rule.** Monospace is only for identifiers: issue keys, branches, launch triples, workspace names, and code. Prose, labels, Stage names, and buttons stay in sans.

## Layout

A single column, max 76rem, centered, with 1.5rem side padding (1rem below 760px). The first viewport is the event display. It is a two-column grid: the transverse view (at most 460px) on the left and the readout on the right, with a 2.5rem gap. Below it is a sticky action bar ("With selected" Dispatch / Review / Close with counts), then the In flight section, then one section per Repo.

Each Repo section groups its rows by Spec: running Specs first, then Held, then candidates, then the rest, each under a heading. Loose issues follow, under "Specs of one" when any Spec heading is above them. A Spec's own rows hang from a 1px rule indented to its title, in sub-issue order.

In-flight rows are a grid of head (checkbox, key and title, Stage key, PR link), meta (chips and agent states), and notes, with actions right-aligned. Ready rows are a single flex line ending in their launch form. Rows are at least 44px tall. Spacing is rem-based and tight: about 0.35rem between controls, 0.6 to 0.75rem between groups, and 1rem section padding and gaps.

Below 760px, the display stacks: the SVG is capped at 300px, the subdetector key is hidden, and the readout sits under it. Row actions and launch forms wrap under the content, indented to the title's start.

### Track Geometry
Each track's angle starts at a home position derived from the issue's hash, so it holds steady across polls. It is then nudged apart from close neighbours (a minimum gap of up to 0.5 rad × 0.85) and kept clear of the ring key's reserved angle, which runs straight down. A Dispatch arriving or leaving moves only the tracks beside it. The bend (its "charge") also comes from the hash and is never straight, and it eases off beyond the tracker. A label that would run off the display edge turns back along its track.

## Elevation & Depth

The system is flat. In the light scheme, section panels and the display carry one faint ambient shadow so they lift off the ground. In the dark scheme there is no shadow, and the display gets a rule-strong hairline frame instead. Depth otherwise comes from tonal steps: ground, panel, and raised panel.

### Shadow Vocabulary
- **Ambient panel** (`box-shadow: 0 1px 2px rgb(17 21 27 / 0.06), 0 4px 14px -6px rgb(17 21 27 / 0.08)`): light scheme only, on sections and the event display.

### Named Rules
**The No Glow Rule.** Emphasis comes from stroke weight, opacity, and hue, never from blur or glow. A lit track thickens to 2.4 while the others drop to 22% opacity, and a blocked tip gets a 1.5px ring.

## Shapes

Corners are small and functional: 3px for chips, counts, inline code, and the blocked badge; 4px for buttons and selects; 6px for sections, batch rows, and the event display. Legend and Stage keys are 1px-radius bars. Dividers are 1px hairlines. The only circles are agent-state dots, the blocked ring, and the detector itself.

## Components

### Buttons
- **Shape:** gently squared (4px), 28px tall, 13px weight 500.
- **Default:** raised panel with a rule-strong border. Hover darkens the border to muted ink. Disabled is 60% opacity.
- **Fire (Dispatch, Retry of a failed Dispatch):** amber fill and border, near-black ink, weight 600. Hover lightens to fire-hover.
- **Review (Launch review, Retry of a failed review):** raised panel with a Muon Blue border and review-ink text. Hover tints the fill 14% blue.
- **Close:** default shape with muted text. Hover turns the text and border red.
- **Focus:** a 2px link-coloured outline with a 2px offset, on every interactive element.

### Chips
- **Style:** monospace 12px, muted ink on raised panel, rule border, 3px corners, 20px line. They carry the launch triple, the Base, and the herdr workspace. The Base chip leads with the branch icon (11px, 0.3rem gap).

### Stage Key (signature)
- On rows, a Stage reads as its track's legend key: a 14×2px bar in the Stage hue followed by the Stage name in 12px/650 in the Stage's ink colour. It is never a filled pill. The readout uses the same key at 16×2px beside a tabular count. Zero counts dim to #5d6776.

### Agent State
- A 7px ring dot plus "role state" in 12px muted text. Working is a filled ink dot, done a filled green dot, idle a muted ring, and unknown a dashed ring. **Blocked** is the one filled badge: a magenta fill, contrasting ink, 650 weight, and 3px corners.

### Icons
- Icons are authored inline SVG in the brand glyph's stroke language: no fill, a `currentColor` stroke (1.2 at 11px), and round caps, so they take their container's ink. The branch mark in the Base chip is the reference.

### Issue Card
- **Trigger:** resting the pointer on any issue or Spec title link for 400ms, or focusing it with the keyboard. It stays while the pointer is on the card, so a long description can be scrolled, and hides 200ms after leaving both, on Escape, or on scroll.
- **Style:** one fixed, raised panel (rule-strong border, 6px corners, a soft drop shadow, the only one besides the Ambient panel), up to 480px wide and 440px tall, placed under the link (or over it near the bottom of the window). 13px body text.
- **Content:** the issue's key in mono and its title at 600; its labels as 11px/600 muted pills; then the start of its description as Markdown (headings at 13px/650, code on panel-2, tables with rule borders), cut at a paragraph after about a screen of text with a 12px/600 "Read the rest" link to the issue. Raw HTML in a description is shown as text and images as their alt text in muted italics, so nothing an issue says can act on the Board. "No description." in muted text when there is none.

### Spec Group and Room Readout
- **Room readout:** right-aligned in a Repo header, a row of slots (10×6px, 1px corners), one per Spec that may run, filled in muted ink while one runs and outlined while free. Beside it, Running, Room, Candidates and Queue in 12px muted labels with 650-weight ink counts, then, while the Queue is not empty, the queued Specs in start order: a compact inline list of Spec keys in ink, each numbered from the head (`1. BLE-30  2. BLE-20`) in muted tabular figures. It wraps under the slug below 760px.
- **Queue controls:** at the right end of a candidate Spec's heading (or a candidate Spec of one's row). Unqueued, a lone **Queue** button. Queued, a 12px/650 ink "Queued n of m" (its place, head first, and the Queue's length), an **Unqueue** button, then ↑ and ↓ buttons to swap it with its neighbour toward the head or the tail; neither shows at its end of the Queue. Each control posts and swaps in the Repo's section alone, keeping open launch forms.
- **Spec state:** a 6.5rem column leading the Spec heading, the same slot glyph plus a 12px/650 label. Running is a filled ink slot in ink; Candidate an outlined slot; Held a dashed Burst Red slot with failed-ink text; Waiting and Not startable a dashed rule-strong slot. It is never a Stage key: Spec states carry no Stage hue except Held, whose reason is error text.
- **Spec heading:** the Spec's key in mono and its title at 600, then one 12px muted note saying what the rules decided (its next issue and Base, why it waits, or the hold's reason in failed-ink).
- **Member line:** an In-flight issue of a Spec, read-only (its row to act on is In flight): muted title, Stage key and PR link. Hovering it lights its track, as an In-flight row does.

### Named Rules
**The Drawn Icon Rule.** Every icon is drawn as inline SVG in the glyph's stroke language. Never use a Unicode glyph, an emoji, or an icon font in place of an icon.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** a panel body with a raised-panel header strip (title plus bordered count).
- **Shadow Strategy:** ambient in light, none in dark (see Elevation).
- **Border:** a 1px rule. Rows are divided by rule hairlines. Hovered or lit rows take the raised panel, and a lit In-flight row also gains a 1px muted-ink bar on its left edge.

### Inputs / Fields
- **Selects:** panel fill, rule-strong border, 4px corners, 28px tall, fixed widths per field (Base 9.5rem, Harness 6.5rem, model 7.5rem, Effort 6rem). On a Ready row they rest with a lighter rule border until the row is hovered or the select is focused.
- **Checkboxes:** 15px, accented in Implementing amber.

### Navigation
- A header line: the brand glyph (a detector end-on with one amber trail) and wordmark, a "/" separator in rule-strong, the page title in muted 18px, and Refresh harnesses pushed right.

### Event Display (signature)
- The display field canvas holds the grey detector geometry: five tracker rings, segmented ECAL and HCAL bands, and two muon stations. The subdetectors are named along the downward radius. Each track is a quadratic path (1.8 stroke, round caps) with a tip dot, an ECAL deposit tower (PR ready), muon hits (Review launched), or a three-line burst (Failed). Its label is the Repo-relative key. Hovering a track lights its row and the reverse, and clicking a track scrolls its row into view and focuses its checkbox.
- **Motion:** this is the system's only authored motion. When a poll shows a track's Stage advanced, its path redraws from the vertex (stroke-dashoffset 1→0, 900ms, cubic-bezier(0.16, 1, 0.3, 1)). It is skipped under prefers-reduced-motion, which also disables every transition. Everything else is a 120 to 160ms colour or opacity transition.

## Do's and Don'ts

### Do:
- **Do** keep the display field #0a0d12 and the signal Stage hues in both colour schemes.
- **Do** show a Stage as its legend key (a 14×2px bar plus coloured label) wherever it appears outside the display.
- **Do** reserve the amber fill for actions that start a track (Dispatch, Retry of a failed Dispatch).
- **Do** use monospace only for issue keys, branches, launch triples, workspace names, and code.
- **Do** keep corners between 3 and 6px and dividers at 1px.
- **Do** derive a track's angle from its issue hash and nudge it clear of neighbours and the ring key, so tracks hold still across polls.
- **Do** gate the track redraw and smooth scroll behind prefers-reduced-motion.

### Don't:
- **Don't** use magenta for anything but Agent blocked.
- **Don't** reuse a Stage hue for a meaning other than its Stage.
- **Don't** add infinite or looping animation. The only authored motion is a track redrawing when its Stage advances.
- **Don't** add HUD chrome, neon glow, or scanlines. The detector is plain grey geometry.
- **Don't** render Stage as a filled pill. The filled badge belongs to Agent blocked alone.
- **Don't** load external fonts, images, or icon sets. Every mark is inline SVG or CSS.
- **Don't** stand a Unicode glyph in for an icon. Draw it as inline SVG with a currentColor stroke and round caps.
