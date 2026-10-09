---
name: nico-agent
description: A localhost app, polished and sure of itself in the spirit of Apple's website, in iris on a cool blue-tinted ground: the Lead panel with the conversation filling most of the window, the Repos beside it, in a designed Light theme (the default) and a designed Dark one.
colors:
  ground: "#eff2fd"
  surface: "#ffffff"
  raised: "#f3f5fe"
  fill: "#e5eaf9"
  fill-hover: "#d8dff4"
  rule: "#dbdfec"
  edge: "#787f99"
  ink: "#131728"
  ink-muted: "#555d75"
  accent: "#2e58e2"
  accent-hover: "#2145cf"
  accent-ink: "#ffffff"
  accent-soft: "#dae8ff"
  link: "#2d54d3"
  focus: "#2e58e2"
  implementing: "#a44200"
  pr-ready: "#037138"
  review-launched: "#7a38bf"
  failed: "#c21725"
  unknown: "#555d75"
  blocked: "#bf008a"
  blocked-ink: "#ffffff"
  ground-dark: "#070a13"
  surface-dark: "#131722"
  raised-dark: "#1e2231"
  fill-dark: "#282d3d"
  fill-hover-dark: "#33384b"
  rule-dark: "#292d3b"
  edge-dark: "#81889f"
  ink-dark: "#f1f3f9"
  ink-muted-dark: "#aeb4c7"
  accent-dark: "#2e58e2"
  accent-soft-dark: "#213261"
  link-dark: "#83b0ff"
  focus-dark: "#83b0ff"
  implementing-dark: "#f9a63e"
  pr-ready-dark: "#52d982"
  review-launched-dark: "#c29afb"
  failed-dark: "#ff7d7c"
  unknown-dark: "#aeb4c7"
  blocked-dark: "#fe75c9"
  blocked-ink-dark: "#111524"
typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.035em"
  display-narrow:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "28px"
    fontWeight: 700
  heading:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-0.03em"
  brand:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "19px"
    fontWeight: 700
    letterSpacing: "-0.03em"
  lead:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "-0.016em"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.011em"
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  control:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  small:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  byline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "12px"
    fontWeight: 700
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "13px"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "22px"
  pill: "980px"
  bar: "3px"
  key: "2px"
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
    padding: "0 1rem"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.fill-hover}"
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-ink}"
    rounded: "{rounded.pill}"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  button-talk:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.pill}"
    height: "54px"
  bubble-user:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
  card-waiting:
    backgroundColor: "{colors.raised}"
    rounded: "{rounded.lg}"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
---

# Design System: nico-agent

## Overview

**Creative North Star: "A Confident Desk"**

The app is where the user talks to the Lead all day. It should feel finished and sure of itself, in the spirit of Apple's website: calm surfaces carrying a few decisive moments, in colour rather than grey. Every neutral carries the accent's hue, so the ground reads as a cool, faintly blue daylight and the panels as white paper on it; the type does the talking: large, heavy titles with tight tracking, the Lead's words set larger than everything around them, and numbers you can read from across a desk. One accent, iris, fills what to press and marks what waits on the user; its soft tone carries the user's own words and where they are; each Stage wears its own hue as a tinted pill, and an agent waiting is the one filled magenta badge.

The page is a shell of two columns under a translucent header. The Lead panel, holding the conversation with the Lead, takes most of the window; the right column belongs to the page: the Repos on the Lead page, the charts on the Stats page. Each column is one rounded panel on the ground, as tall as it needs and no taller (the Lead panel fills the window).

**Key Characteristics:**
- A cool, blue-tinted ground, white panels with large (22px) corners, no borders around them; every grey is tinted toward the accent.
- A bold type scale on the system face: 32px/700 titles, 24px/700 for the Lead, 17px for the Lead's words, 14px/600 controls. Steps are obvious; weight carries hierarchy.
- One accent, iris, filling only the primary action, a switch turned on, the talk button while it records, and marking focus and what waits on the user. Its text form names the Lead and carries links; its soft tone is the user's bubble and the current page. Issue titles and quiet buttons are ink.
- One colour per Stage, used only to name that Stage, as its text on a pill tinted with it.
- Two designed themes, Light (the default) and Dark, chosen in the header (Light, Dark or System); both pass WCAG AA.
- Pill-shaped controls with weight; disabled controls go flat grey, never pastel.
- Motion that settles: arrivals ease out on an exponential curve; nothing loops.

## Themes

The header's theme toggle sets `data-theme="light"` or `"dark"` on the page's root; System shows whichever the system prefers and follows it as it changes. Light is the default. The choice is remembered in the browser (`nico-agent.theme`), and a small script in `index.html`'s head sets the theme before the first paint, so a reload never flashes the wrong one.

The two themes are designed, not derived. Light is white panels on a pale, blue-tinted ground (#eff2fd), with waiting cards on the raised tone and toasts white, lifted by a deep navy shadow. Dark is midnight navy panels (#131722) on a near-black navy ground (#070a13), with waiting cards, toasts and popovers lifted to #1e2231 so they read as raised objects, not holes. Stage hues, links and errors take lighter values in Dark, and tinted pills and tiles take more of their hue (16% against Light's 11%) so they still read on the dark surface. The accent fill stays the same iris in both because white on it reads at 5.8:1; the focus ring and links use a lighter iris in Dark, and the soft tone darkens to a deep indigo (#213261) under light ink.

## Colors

Tinted neutrals (every one at the accent's hue, 272° in OKLCH), one iris accent with a soft tone, and five Stage hues. Light values are listed first; dark values carry `-dark`. A tinted pill or tile is its hue mixed into the surface at `--tint` (11% Light, 16% Dark).

### Primary
- **Accent** (accent, hover accent-hover, text accent-ink): the brand mark, the one filled control of any group (Send, Approve, Save, Start, Send to the Lead), a switch turned on, the talk button while it records, the dot of a working agent, the ring of a card waiting on the user (a toast), the dot and faint ring and tint of an open question's or Proposal's line, the count of what waits, and the dot on a drawer tab with an unsaved edit. Disabled, a primary button goes to the fill with muted ink.
- **Accent soft** (accent-soft): the user's message bubble and the current page in the header. Ink, muted ink and link all read on it at 4.5:1.
- **Link** (link): the accent's text form. Links in running text ("PR #111"), the Lead's name over its messages, the current page's name, the "asks" and "Proposes" notes on a toast, "Open" on a line in the conversation, the In flight total, and the Stats charts' bars.
- **Focus** (focus): the focus ring and a focused field's border. The accent in Light, the link's lighter iris in Dark, so it reads at 3:1 on every surface.

### Stage hues
One colour per Stage, so a Stage is recognisable wherever it appears. Each is used only for its Stage: its name and dot on a pill tinted with it, never for anything else.
- **Implementing** (implementing): orange. The notices borrow it, being the hue of "in progress, look when you can": their dots, and their strip, faintly tinted with it; and the Lead's context meter past its threshold, its fill and its pill tinted like the strip, beside the notice that says a restart is safe.
- **PR ready** (pr-ready): green. Also the dot of a "done" agent.
- **Review launched** (review-launched): violet, kept apart from the accent's iris.
- **Failed** (failed): red. Also error text, Held on a Repo, Close on hover, and the dot of a failed Proposal's line.
- **Unknown** (unknown): grey, for a Stage nico-agent cannot read.

### Attention
- **Agent blocked** (blocked / blocked-ink): magenta, the one filled badge, for an agent waiting on the user: Agent blocked, "1 Asking" on a Repo, the Asking total and its tinted tile, and the tinted box around an Asking Implementer's question.

### Neutral
- **Ground** (ground): the page behind the panels, a pale blue in Light and a near-black navy in Dark.
- **Surface** (surface): the panels and text fields.
- **Raised** (raised): what sits on a panel as an object: waiting cards, the Repos totals, the composer's field, and in Dark the popovers.
- **Fill / Fill hover** (fill, fill-hover): default buttons, the selected tab's track, the theme toggle's track, chips.
- **Rule** (rule): hairlines between parts of a panel. Decorative only.
- **Edge** (edge): the boundary of a control the user must find: text fields, the composer, the choice pills, the switch's off track. It reads at 3:1 on surface and raised.
- **Ink / Ink muted** (ink, ink-muted): text and secondary text.

### Contrast
Every text pair is checked against WCAG AA (4.5:1) in both themes: ink, muted ink, link and each Stage hue on surface, raised, fill and ground; each Stage hue and ink on its own tinted pill; ink, muted ink and each total's hue on its tinted tile; ink, muted ink and link on the accent's soft tone; muted ink and failed on fill hover (except failed on Dark's fill hover, which no control produces: a hovered Repo row uses the fill); white on the accent (5.8:1) and its hover; blocked-ink on blocked. Control boundaries (edge), the focus ring and the accent as a graphic pass 3:1.

### Named Rules
**The One Accent Rule.** Iris is the only colour that asks to be pressed or looked at, and it fills only the primary action of its group; never two in one group. Its soft tone marks where the user is and what they said, never an action. Issue titles, page links other than the current one, and quiet buttons are ink, so iris keeps its meaning.

**The Stage Owns Its Hue Rule.** Orange, green, violet, red and grey mean Implementing, PR ready, Review launched, Failed and unknown wherever a Stage is shown. Their only other uses are listed above.

**The Magenta Means Waiting Rule.** Magenta marks an agent waiting on the user, and nothing else.

## Typography

**Body Font:** system-ui (San Francisco on a Mac), with -apple-system, Segoe UI, Roboto, sans-serif. No font is loaded.
**Mono Font:** ui-monospace, with SFMono-Regular, Menlo, monospace.

**Character:** one system face, tightened as it grows (-0.011em for body to -0.035em for display), hierarchy from size and from weights 400, 600 and 700. Tabular numerals throughout.

### Hierarchy
- **Display** (700, 32px, 1.1; 28px under 560px): the right column's title (Repos, Stats), the Repos totals' numbers, and the empty conversation's "Talk to the Lead".
- **Heading** (700, 24px): the Lead panel's "Lead" (hidden under 560px, where the header's page names it).
- **Brand** (700, 19px): the "nico-agent" wordmark.
- **Lead** (400, 17px, 1.55): the Lead's messages, and an open question (at 600). The Lead's voice is the largest running text on the page. A Repo's name is 17px/600, its owner at 400 in muted ink.
- **Body** (400, 16px, 1.5): the user's messages, Proposals' reasons, fields (16px so a phone does not zoom).
- **Title** (500 to 700, 15px): issue titles in the Repos, the page links, the talk button.
- **Control** (600, 14px): buttons, switches' labels.
- **Small** (13px): bylines, notices' help, outcomes, ledes in the drawer, the Repos' group names and summaries, Stage names.
- **Context meter** (600, 12px, tabular figures): "Context 62%" in muted ink beside a 2.5rem hairline meter, after the Lead panel's "Lead"; past the threshold it turns to ink on a faint orange pill with an orange fill.
- **Byline name** (700, 12px to 13px): "You" and "Lead"; "Heard" and "You answered" over a transcript or answer.
- **Mono** (13px; 12px for chips, an Asking question, an Implementer's live line and the Lead's launch): issue numbers, branches, actions, a Proposal's Source write, code.

## Layout

- **Header:** 56px, sticky, translucent (the ground at 78% in Light, 72% in Dark, with a 20px blur and 180% saturation), a hairline under it. The brand (a 26px iris squircle with a drawn prompt, then the wordmark), then the pages (**Lead**, **Stats**) as pill links, the current one on the accent's soft tone in link iris, then at the far end the Questions count, the theme toggle, and the Lead's button.
- **Shell:** a grid of the Lead panel (the rest of the width) and the right column (20 to 30rem; 20 to 36rem on the Stats page, for a bar a day), 1.5rem apart and from the edges, at most 150rem wide, under the header. On a 1920px window the Lead panel takes about 70% of it. The Lead panel fills the window's height; the right column's panel is as tall as its content and scrolls within the window's height.
- **Lead panel:** a column of the bar (Lead and its context meter, the Voice switch, Research, the drawer's button), the notices when there are any, the conversation (which scrolls) or the drawer, and the composer, which stays at the foot.
- **Narrow window (900px and below):** one column, the Lead panel first and as tall as the window, then the right column. Under 560px the wordmark, the Lead panel's "Lead" and the word "Questions" hide (each keeps its accessible name; the brand's mark stays, at 24px), the Lead's button truncates, the talk button narrows to 5.5rem, the Research box spans the panel less 1rem each side, and the context meter shows only its figure ("86%").
- **Pages:** `#/` is the Lead page, `#/stats` the Stats page; the Lead panel and the toasts stay on both.
- **Toasts:** fixed at the bottom right of every page, over the right column, 26rem wide at most (the window less 1rem each side under 560px).

## Elevation & Depth

Flat by tone: panels sit on the ground, raised objects sit on panels one step lighter (Dark) or on the raised tone (Light). Light's shadows are a deep navy (`--shade`, rgb 19 23 60), never neutral black. The only shadows are on the toasts (a short lift, 0 4px 16px), on the boxes a button opens (the Lead menu and the Research box), a soft lift (0 12px 40px at 12%, plus a 2px contact shadow) that in Dark becomes a deeper shadow with a rule-coloured ring, and the small lift of the picked segment in the theme toggle and the drawer's tabs.

## Shapes

Panels 22px (xl); toasts, an unfolded line, the Repos totals and the popovers 16px (lg); fields, selects, the Source write and an Asking question 12px (md); chips, inline code and the focus ring 8px (sm); buttons, page links, the composer's field, the talk button, the theme toggle and Agent blocked are pills. The user's bubble is 22px with an 8px corner toward its sender. Chart bars are 3px at the top; the chart key's swatches 2px. Dots are 7 to 9px circles. Dividers are 1px hairlines.

## Motion

Short and settling. A new card or an expanded Repo arrives in 280ms with an 8px lift, a toast in 320ms with a 12px lift and a 2% scale, on `cubic-bezier(0.16, 1, 0.3, 1)`; the Lead menu and the Research box drop in over 220ms with a 6px drop and a 2% scale; the switch's knob and a Repo's chevron ease out over 240ms; colours ease over 160 to 240ms. A pressed button sinks to 97%. Nothing loops or pulses. Under `prefers-reduced-motion` every animation and transition is off.

## Components

### Buttons
- **Default:** a fill pill, 36px tall, 14px/600. Hover deepens the fill; pressing sinks it. Disabled is the fill with muted ink, never a faded colour.
- **Primary (Send, Approve, Save, Start, Send to the Lead):** an accent pill with white text; hover darkens it.
- **Quiet (Research, Intent & orders):** ink text, no fill until hovered or open.
- **Close / Stop:** a default pill whose text turns failed red on hover.
- **Choices on a question:** surface pills with an edge ring that darkens to ink on hover.

### Header
- **Theme toggle:** a segmented control (a fill track) holding three drawn icons (sun, moon, display) for Light, Dark and System; the picked one sits raised on the track (surface in Light, fill hover in Dark). Each is a button with its name and `aria-pressed`.
- **The Lead's button:** a fill pill naming where the Lead stands as an Agent State ("Lead working", in ink at 600, after its dot, which carries a soft accent halo while working) or, not running, its status beside a dashed dot. It opens the Lead menu: the launch the Lead runs on, the Harness, Model and Effort selects, Start (or Restart) in the accent and Stop. Opening it moves focus into it; Escape, a click elsewhere or focus leaving it closes it, Escape returning focus to the button.

### Questions count and toasts
- **Count:** a quiet pill reading **Questions** with the number of open questions and Proposals and Asking Implementers in a round badge: on fill at zero, the accent while anything waits. It collapses or expands the toasts; they start expanded, and a new item expands them again.
- **Toasts:** every open question and Proposal of the Lead's, each a toast stacked at the bottom right of every page, oldest nearest the corner, 0.75rem apart. A toast is a waiting card on the popover tone (the surface in Light, raised in Dark), ringed 1.5px in the accent, with a short lift (0 4px 16px) that fits inside the stack's padding; Source writes are at most 8rem tall. Past about 34rem (55% of the window on a phone) the stack scrolls, opening at the corner, a toast scrolled past its top fading out rather than being cut. Each is answered, approved or declined right on it; an answer takes its toast off at once (it comes back, with why, if it was not sent), and an item answered or decided anywhere (the chat, the CLI, by voice) leaves. Answered from the keyboard, focus passes to the next toast, or to the conversation once none is left. A new toast is announced politely; those there on load are not.
- **Asking Implementer toasts:** after the Lead's, one per Asking Implementer: its issue in mono and "Implementer asks" (with its Spec) in magenta, the issue's title in 600, its screen in the mono box tinted and edged magenta that its Repo row shows (10rem tall at most), the screen's numbered choices as buttons ("1. Yes"), each sending its number, and a free-text answer. It is ringed 1.5px in magenta, like Agent blocked, not the accent. Sent, it leaves at once; refused (the Implementer stopped Asking), it stays with the CLI's message in failed red; once the Implementer stops Asking, whoever answered, it leaves.

### Repos pane
The Lead page's right column: under its **Repos** title, the totals across every Repo (In flight, Asking, Held) as three raised tiles with 32px/700 numbers, muted at zero; above it a tile takes its hue, as its number on the tile tinted with it: In flight in link iris, Asking in magenta, Held in failed red. Then a row per configured Repo in config order, divided by hairlines. A row is a full-width button, 56px tall: a chevron (turning a quarter while open), the Repo's name at 17px/600 after its owner in muted ink, and at its end the summary in 13px/600: "Manual" as an ink pill on fill for a manual Repo (the Scheduler starts nothing there, so the mark stays quiet, not a warning), "Gardening" (then "Gardener finished") as an ink pill on fill while the Repo has a Gardener, "2 In flight", "1 Asking" as the magenta pill, "Held" in failed red, "Could not load" in failed red, "3 to dispatch", or "Idle". Clicking it, or Enter or Space on it, expands it in place, and which Repos are expanded is remembered in the browser across reloads. Expanded, it lists under 13px/600 muted group names (headings): **Gardener**, the Repo's Gardener with its Agent State and a link to each PR it was started for (or "every PR that needs it"), then what it is doing as the same muted mono line as an Implementer's, read through the same peek; an Asking one says to answer it on its toast, and a finished one says "Finished" for ten seconds before the row drops it; **In flight**, each Dispatch's issue (its number in mono, its title in ink) with its Stage, its Implementer's Agent State and its PR link, then what the Implementer is doing as one muted 12px mono line, ellipsized: the last meaningful line of its screen, read from herdr every few seconds while the Repo is expanded and the page is shown, and nothing when it cannot be read; and an Asking Implementer's question in a mono box tinted and edged magenta; **Held**, each Held Spec with its reason; **Starts next**, each running Spec's next issue with the Spec it belongs to; **To dispatch**, its Ready and Stackable issues (a Stackable one marked so in muted text); and **Queue**, the Repo's Queue numbered in start order. The Board's actions sit on these rows: "Dispatch…" on an issue to dispatch, and on a Dispatch "Launch review…" once its PR is linked and no Reviewer was started, as quiet ink buttons, then Close as the default pill. Dispatch and Launch review open the launch form under the row, a raised box (Base or Stack on, Harness, model and Effort as selects, Base or Stack on labelled 13px/600 beside its own, then the submit as the group's one filled control); Close of a Dispatch with no PR yet first asks to confirm, in place. An action's failure shows under its issue with the CLI's message in failed red and its help in muted text; what it did shows once the Board is read again. A Repo whose read failed says why in failed red. The pane reads the Board on load and on every Board-changed event, through `serve`'s one-minute cache; a Board that cannot be read at all, or a rate-limited GitHub, shows in the notices.

### Stats charts
The Stats page's right column: under its **Stats** title, the window as a segmented control (**7 days**, **30 days**, **90 days**: a fill track, the chosen one raised on it) and, with more than one Repo, a select of **All Repos** or one Repo in mono. Then two charts, **PRs merged** and **Issues defined**, each its title (15px/700) with the window's total in heading type (24px/700) on the right, and a bar a day over an edge-coloured baseline, the busiest day's count muted above the scale and the first and last days below, in 12px. A day's count is a link-iris bar (ink while hovered, at most 1.75rem wide, at least 3px tall) as tall as its share of the busiest day; a day with none is a short 1px muted dash on the baseline, lower than any bar; a day with no data, before nico-agent was counting, is a column the full height hatched with fine muted lines, so it never reads as zero. Every day's bar carries its words ("Sep 29: 1 PR merged", "Sep 27: no data") as its tooltip and for a screen reader. Under the charts a muted line says the counts are the PRs and issues nico-agent has seen, not the Repos' full history, and since when, then a small key of the three kinds of day. The charts are `nico-agent stats --json`, read on load, on a new window or Repo (a Repo picked is counted by `--repo`), and on each conversation entry and Board change; the bars are the accent's text form, and no Stage's colour is used.

### Notices
The one quiet place for warnings, under the Lead panel's bar: serve unreachable, the Board unreadable or GitHub rate limited, the Lead not running or failed (with where to start it), the Lead's launch warnings, and voice failing. A strip faintly tinted with Implementing's orange (70% of `--tint`); each warning is a line of 14px/600 ink after an 8px orange dot, its help below it in muted 13px, aligned with the text. It shows only while something is wrong.

### Conversation
- The conversation runs the Lead panel's width: each entry up to 62rem, the Lead's messages on the left and the user's on the right edge, so a big window is filled, not a centred strip.
- The Lead's messages sit on the surface, unboxed, left, at 17px, under **Lead** in link iris; the user's are a bubble in the accent's soft tone on the right at 16px, at most 48rem or 80% of the panel. Each leads with its byline: who (700), the time, then a muted note ("sending…", "spoke", "corrects", "corrected below").
- A spoken message shows the Scribe's text beside what was heard, under a "Heard" label, side by side while two 11rem columns fit.
- A superseded message keeps its card, its text muted and struck through.
- Empty, the conversation centres **Talk to the Lead** in display type over one line of help.
- The conversation follows new entries only while the user is at its end; reading back, it stays put. A message the user writes or speaks brings it to its end; answering a question where it is does not.

### Question and Proposal lines
- In the conversation, in its place in time, a question or Proposal is one line: a 14px row ringed by a hairline (a pill; 16px corners where it wraps on a phone), an 8px dot, **Lead** asked or proposed, the time, then the question, or the Proposal's action as inline code and its reason, ellipsized, and at its end where it stands at 600.
- **Open:** the dot in the accent, the row faintly tinted with it and ringed in it at 40%, and **Open** in link iris at 700. Clicking it expands the toasts and brings its toast forward, focused.
- **Decided:** a muted-ink dot; **You answered** and the answer (what was heard, when spoken and different), **Approved** and what the action did, **Declined** in muted ink with the reason in quotes, or **Failed** in red (its dot too) with why. Clicking it unfolds the line to everything it carries, wrapped, and folds it again.
- A toast's question is set at 17px/600; its choices are surface pills with an edge, then a free-text field and Answer. A Proposal's toast names its action as inline code, or the Source write as a mono box, then the reason, then Approve (primary) and Decline, which opens an optional reason field.

### Composer
At the Lead panel's foot, always. The text field (a raised pill, 54px tall, edged, taking the focus colour and a soft focus halo while focused, with Send inside it at its end) and the **Talk** button (a 54px ink pill with surface text and a drawn microphone, at least 8.5rem wide) sit side by side, the same height. Enter sends, Shift+Enter breaks the line; the draft is the composer's own, so arriving entries never touch it. Talk is held or tapped (see `docs/voice.md`); while it records it fills with the accent and wears a soft accent halo. Above the row, the talk status shows only during a conversation by voice: a dot (filled while someone is heard, outlined while the Lead thinks), **Listening**, **Thinking** or **Speaking** at 700, a muted note or what is heard in italic, and Stop or End.

### Research box
"Research" drops a box from the Lead bar over the conversation, as wide as the panel allows (26rem at most), raised like the Lead's controls: the question (Enter sends, Shift+Enter a new line), an optional Repo, a muted line saying the Lead writes the issue, and Send to the Lead (primary) and Cancel. Its labels are 13px/600 ink. Opening it focuses the question; Escape, Cancel, a click elsewhere or focus leaving it closes it with the draft kept; sending closes it, and the message shows in the conversation like any other.

### Drawer
"Intent & orders" swaps the conversation for the drawer; the composer stays. Tabs (Intent, Notes, Standing orders) are a segmented control: a fill track, the selected tab raised on it; one with an unsaved edit carries a 6px accent dot. The arrow keys, Home and End move between them. Intent and Notes are a Markdown textarea on the raised tone that fills the tab, with a foot of status, Revert and Save (primary). A change made meanwhile shows above the textarea as a waiting card with Keep my edit and Use this instead. Standing orders are rows of switches divided by hairlines, each order's name at 700 with what it lets the Lead do in muted text.

### Switches
Apple's toggle: 40×24, a white 18px knob; off, the fill with a 1.5px edge ring (so it reads at 3:1); on, the accent.

### Stage and Agent State
- **Stage:** its name at 13px/600 in its hue, after a 7px dot of the same hue, on a pill tinted with it.
- **Agent State:** an 8px dot and "role state" in muted 13px text: filled accent with a soft halo while working, outlined while idle, filled green when done, dashed when unknown. Agent blocked is a magenta pill with its text in blocked-ink.

### Icons
Drawn inline as SVG with a currentColor stroke and round caps and joins (the theme toggle's sun, moon and display; the microphone; the chevron; the branch mark). No icon font, emoji or Unicode glyph stands in for one.

### Browser surfaces
Text selection is the accent at 28%; the caret is the accent; scrollbars are thin and edge-coloured; link underlines sit 0.18em below the text; `color-scheme` follows the theme so native selects and scrollbars match it.

## Do's and Don'ts

### Do:
- **Do** fill only each group's primary action with the accent, and keep issue titles and quiet buttons in ink.
- **Do** let size and weight carry hierarchy: the display steps (32, 24, 17) are the system's strongest moves; use them for titles and the Lead's voice, not for decoration.
- **Do** check every new colour in both themes: text at 4.5:1, control boundaries and focus at 3:1, including text on a tint.
- **Do** keep every neutral on the accent's hue; a pure grey reads as a hole in this palette.
- **Do** design each theme on its own terms; raise objects in Dark rather than sinking them.
- **Do** keep the composer at the Lead panel's foot and leave the user's scroll alone while they read back.
- **Do** put every warning in the notices, quiet and together.
- **Do** gate every animation and transition behind `prefers-reduced-motion`.

### Don't:
- **Don't** add a second accent, gradients (beyond the toasts' fade at their top as they scroll), glow or decorative illustration. Colour comes from roles (the accent, its soft tone, the Stage and waiting hues as tints), not decoration.
- **Don't** mark a card with a coloured stripe down one side; a toast is ringed all round.
- **Don't** fade a disabled primary to a pastel of the accent.
- **Don't** box things inside a panel with borders when space and a hairline will do.
- **Don't** add looping or attention-seeking motion.
- **Don't** load external fonts, images or icon sets.
- **Don't** use magenta for anything but an agent waiting on the user.
