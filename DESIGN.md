---
name: nico-agent
description: A localhost app, calm and clean in the spirit of Apple's website: the Lead panel with the conversation on the left, the Repos on the right.
colors:
  ground: "#f5f5f7"
  surface: "#ffffff"
  fill: "#e8e8ed"
  fill-hover: "#dcdce1"
  rule: "#d2d2d7"
  ink: "#1d1d1f"
  ink-muted: "#636366"
  accent: "#0071e3"
  accent-hover: "#0068d6"
  accent-ink: "#ffffff"
  link: "#0066cc"
  implementing: "#b25000"
  pr-ready: "#1a7f37"
  review-launched: "#5856d6"
  failed: "#bf0011"
  unknown: "#636366"
  blocked: "#b4009e"
  blocked-ink: "#ffffff"
  ground-dark: "#000000"
  surface-dark: "#161617"
  fill-dark: "#2c2c2e"
  fill-hover-dark: "#3a3a3c"
  rule-dark: "#38383a"
  ink-dark: "#f5f5f7"
  ink-muted-dark: "#a1a1a6"
  link-dark: "#2997ff"
  implementing-dark: "#ff9f0a"
  pr-ready-dark: "#30d158"
  review-launched-dark: "#8e8cff"
  failed-dark: "#ff6961"
  unknown-dark: "#98989d"
  blocked-dark: "#ff6fd8"
  blocked-ink-dark: "#1d1d1f"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: "-0.01em"
  brand:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "21px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  heading:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  control:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 500
  small:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  byline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
rounded:
  sm: "6px"
  md: "12px"
  lg: "18px"
  pill: "980px"
spacing:
  xs: "0.35rem"
  sm: "0.6rem"
  md: "1rem"
  lg: "1.5rem"
components:
  button:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.pill}"
    padding: "0 0.9rem"
    height: "32px"
  button-hover:
    backgroundColor: "{colors.fill-hover}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.link}"
    rounded: "{rounded.pill}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
---

# Design System: nico-agent

## Overview

**Creative North Star: "A Quiet Desk"**

The app is where the user talks to the Lead all day. It should feel finished and calm, in the spirit of Apple's website: light surfaces on a soft grey ground, generous whitespace, one accent, the system typeface, and motion so subtle it is felt more than seen. Nothing competes with the conversation; the work around it is a glance away.

The page is a shell of two columns under a translucent header. The Lead panel, holding the conversation with the Lead, takes the left and wider column; the right column belongs to the page: the Repos on the Lead page, the charts on the Stats page. Each column is one rounded panel on the ground.

**Key Characteristics:**
- Soft grey ground, white panels with large (18px) corners, no borders around them.
- One accent, Apple blue, for the primary action, focus, a switch turned on, the talk button while it records, and what waits on the user.
- One colour per Stage, used only to name that Stage.
- System type throughout; monospace only for identifiers.
- Pill-shaped controls, quiet until hovered.
- Subtle motion: things arrive with a short fade and lift; nothing loops.
- Light and dark follow the system; both pass WCAG AA for text.

## Colors

A neutral grey palette, one blue accent, and five Stage hues. Light values are listed first; dark values carry `-dark`.

### Primary
- **Accent** (accent, hover accent-hover, text accent-ink): the one filled control on any surface (Send, Start, Approve, Save), the focus ring, a switch turned on, the talk button while it records, the dot of a working agent, and the 3px edge of a card waiting on the user. The same blue in both schemes; its fill carries white text at 4.7:1.
- **Link** (link, link-dark): links and quiet text buttons ("Intent & orders"). It is the accent's text form, darkened in light and lightened in dark to read at AA.

### Stage hues
One colour per Stage, so a Stage is recognisable wherever it appears. Each is used only for its Stage name and dot, never for anything else.
- **Implementing** (implementing, implementing-dark): orange. The notices' dot and tint borrow it, being the hue of "in progress, look when you can".
- **PR ready** (pr-ready, pr-ready-dark): green. Also the dot of a "done" agent.
- **Review launched** (review-launched, review-launched-dark): indigo, kept apart from the accent's blue.
- **Failed** (failed, failed-dark): red. Also error text, and Close on hover.
- **Unknown** (unknown, unknown-dark): grey, for a Stage nico-agent cannot read.

### Attention
- **Agent blocked** (blocked / blocked-ink, and `-dark`): magenta, the one filled badge, for an agent waiting on the user and nothing else.

### Neutral
- **Ground** (ground): the page behind the panels.
- **Surface** (surface): the panels, the header's menu, and text fields.
- **Fill / Fill hover** (fill, fill-hover): default buttons, the selected page in the header, the user's message bubble, chips.
- **Rule** (rule): hairlines inside a panel and field borders.
- **Ink / Ink muted** (ink, ink-muted): text and secondary text. Muted ink reads at AA on ground, surface and fill in both schemes.

### Contrast
Every text pair is checked against WCAG AA (4.5:1) in both schemes: ink, muted ink, link and each Stage hue on surface; muted ink and link on fill; white on the accent and its hover; failed on fill. The accent itself as a graphic (dots, focus ring, edges) needs 3:1 and has it.

### Named Rules
**The One Accent Rule.** Blue is the only colour that asks to be pressed or looked at. It fills only the primary action of its group: Send in the composer, Approve on a Proposal, Save in the drawer, Start in the Lead menu; never two in one group.

**The Stage Owns Its Hue Rule.** Orange, green, indigo, red and grey mean Implementing, PR ready, Review launched, Failed and unknown wherever a Stage is shown. Their only other uses are the ones listed above: orange for the notices, green for a done agent, red for errors and Close on hover.

**The Magenta Means Waiting Rule.** Magenta marks an agent waiting on the user, and nothing else.

## Typography

**Body Font:** system-ui (San Francisco on a Mac), with -apple-system, Segoe UI, Roboto, sans-serif.
**Mono Font:** ui-monospace, with SFMono-Regular, Menlo, monospace.

**Character:** one system face, slightly tightened (-0.01em, -0.02em for headings), hierarchy from size and weight 400 to 600. Tabular numerals throughout.

### Hierarchy
- **Brand** (600, 17px): the "nico-agent" wordmark in the header.
- **Title** (600, 21px): the right column's heading (Repos, Stats).
- **Heading** (600, 17px): the Lead panel's "Lead".
- **Body** (400, 15px, 1.47): messages, questions, Proposals.
- **Control** (500, 14px): buttons, page links, switches' labels.
- **Small** (400, 13px; 14px for the right column's lede): notices, help, outcomes, the drawer's ledes, raw transcripts.
- **Byline** (12px): who and when on a card, "You" or "Lead" at 600.
- **Label** (600, 11px, uppercase, 0.04em): "Heard" and "You answered" over a transcript or answer.
- **Mono** (13px; 12px in the Lead menu): issue keys, branches, the harness · model · effort launch, code.

## Layout

- **Header:** 52px, sticky, translucent (the ground at 80% in light, black at 72% in dark, with a 20px blur and 180% saturation), a hairline under it. The brand, then the pages (**Lead**, **Stats**) as pill links, the current one on fill, then at the far end the Questions count and the Lead's button.
- **Shell:** a grid of the Lead panel (the rest of the width) and the right column (20 to 28rem), 1.5rem apart and 1.5rem from the edges, at most 88rem wide, filling the window under the header. Each column is a panel.
- **Lead panel:** a column of the bar (Lead, the Voice switch, the drawer's button), the notices when there are any, the Questions list when it holds anything and is shown, the conversation (which scrolls) or the drawer, and the composer, which stays at the foot.
- **Narrow window (900px and below):** one column, the Lead panel first and as tall as the window, then the right column below it. Under 560px the brand hides, the talk button narrows to 5.5rem beside the text field, and fields use 16px text so a phone does not zoom.
- **Pages:** `#/` is the Lead page, `#/stats` the Stats page; the Lead panel stays on both.

## Elevation & Depth

Flat. Panels sit on the ground by tone alone. The only shadow is the Lead menu's, a soft lift (0 4px 24px at 8%, with a 1px contact shadow) that in dark becomes a deeper shadow with a rule-coloured ring.

## Shapes

Panels 18px; the Lead menu 16px; question and Proposal cards and the user's bubble 14 to 18px; fields 12px (the composer's 22px); selects 10px; chips 6px; buttons, page links, the talk button (48px tall) and Agent blocked are pills. Dots are 6 to 8px circles. Dividers are 1px hairlines.

## Motion

Subtle and short. A new card arrives with a 240ms fade and a 6px lift; the Lead menu appears with a 200ms fade and a 4px drop; colours and switches ease over 160 to 200ms on `cubic-bezier(0.25, 0.1, 0.25, 1)`. Nothing loops or pulses. Under `prefers-reduced-motion` every animation and transition is off.

## Components

### Buttons
- **Default:** a fill pill, 32px tall, 14px/500. Hover deepens the fill. Disabled is 45% opacity.
- **Primary (Send, Start, Approve, Save):** an accent pill with white text; hover darkens it.
- **Quiet ("Intent & orders"):** link-coloured text, no fill until hovered.
- **Close / Stop:** a default pill whose text turns failed red on hover.

### Header and the Lead menu
- The Lead's button at the header's end shows where the Lead stands as an Agent State ("Lead idle", "Lead working") or, not running, its status ("Lead not running", "Lead Failed at agent start") beside a dashed dot; why it failed shows in the notices. It opens the Lead menu below it: the launch the Lead runs on, the Harness, Model and Effort selects with their labels, and Start (or Restart) in the accent and Stop. Opening it moves focus into it; Escape, a click elsewhere or focus leaving it closes it, Escape returning focus to the button.

### Questions count and list
- **Count:** in the header on every page, a quiet pill reading **Questions** with the number of open questions and Proposals in a small round badge: on fill at zero, filled with the accent while anything waits on the user. It shows or hides the list.
- **List:** under the Lead panel's bar, every open question and Proposal of the Lead's, oldest first, as the same waiting cards the conversation shows (Source writes at most 8rem tall), at most 40% of the panel and scrolling on its own, a hairline under it. Each is answered, approved or declined right there; an answer takes its question off at once (it comes back, with why, if it was not sent). An answered or decided item leaves the list and stays in the conversation, focus passing to the next item. Clicking an item away from its controls, or its quiet **Show in conversation**, closes the drawer and scrolls the conversation to the card, which takes focus and an accent ring until focus moves on.

### Notices
The one quiet place for warnings, under the Lead panel's bar: serve unreachable, the Lead not running or failed (with where to start it), the Lead's launch warnings, and voice failing (the service down, the microphone blocked). A strip tinted 8% Implementing orange, each line a small orange dot, the warning in ink and its help in muted ink, 13px. It shows only while something is wrong.

### Conversation
- The Lead's messages sit on the surface, unboxed, left; the user's are a fill bubble (18px corners) on the right. Each leads with its byline: who, the time, then a muted note ("sending…", "spoke", "asks", "corrects", "corrected below").
- A spoken message shows the Scribe's text beside what was heard, under a "Heard" label, side by side while two 11rem columns fit.
- A superseded message keeps its card, its text muted and struck through.
- The conversation follows new entries only while the user is at its end; reading back, it stays put. A message the user writes or speaks brings it to its end; answering a question where it is does not.

### Question and Proposal cards
- **Open:** a card on the ground, 14px corners, with a 3px accent edge on its left (an inset shadow, so nothing moves when it goes). A question's choices are default pills, then a free-text field and Answer. A Proposal shows its action as code, or the Source write in a scrolling box at most 16rem tall, then the reason, then Approve (primary) and Decline, which opens an optional reason field.
- **Decided:** the edge goes; the byline ends in Approved, Declined (muted) or Failed (red).

### Composer
At the Lead panel's foot, always. The text field (a 22px-cornered box on the ground, which takes the accent's border while focused, with Send inside it at its end) and the **Talk** button (a 48px fill pill with a drawn microphone, at least 8.5rem wide) sit side by side as equals. Enter sends, Shift+Enter breaks the line; the draft is the composer's own, so arriving entries never touch it. Talk is held or tapped (see `docs/voice.md`); while it records it fills with the accent. Above the row, the talk status shows only during a conversation by voice: a dot (filled while someone is heard, outlined while the Lead thinks), **Listening**, **Thinking** or **Speaking**, a muted note or what is heard in italic, and Stop or End.

### Drawer
"Intent & orders" swaps the conversation for the drawer; the composer stays. Tabs (Intent, Notes, Standing orders) are pills, the selected one on fill; one with an unsaved edit carries a 6px accent dot. The arrow keys, Home and End move between them. Intent and Notes are a Markdown textarea that fills the tab, with a foot of status, Revert and Save (primary). A change made meanwhile shows above the textarea as a waiting card with Keep my edit and Use this instead. Standing orders are rows of switches divided by hairlines, each with what it lets the Lead do in muted text.

### Switches
Apple's toggle: 36×22, a white 18px knob, the fill when off and the accent when on.

### Stage and Agent State
- **Stage:** its name at 12px/600 in its hue, after a 6px dot of the same hue.
- **Agent State:** an 8px dot and "role state" in muted 13px text: filled accent while working, outlined while idle, filled green when done, dashed when unknown. Agent blocked is a magenta pill with its text in blocked-ink.

### Icons
Drawn inline as SVG with a currentColor stroke and round caps. No icon font, emoji or Unicode glyph stands in for one.

## Do's and Don'ts

### Do:
- **Do** fill only each group's primary action with the accent.
- **Do** use a Stage's hue to name that Stage, and otherwise only where Stage hues lists it.
- **Do** keep the composer at the Lead panel's foot and leave the user's scroll alone while they read back.
- **Do** put every warning in the notices, quiet and together.
- **Do** check every new text colour against its background in both schemes (AA, 4.5:1).
- **Do** gate every animation and transition behind `prefers-reduced-motion`.

### Don't:
- **Don't** add a second accent, gradients, glow or decorative illustration.
- **Don't** box things inside a panel with borders when space and a hairline will do.
- **Don't** add looping or attention-seeking motion.
- **Don't** load external fonts, images or icon sets.
- **Don't** use magenta for anything but Agent blocked.
