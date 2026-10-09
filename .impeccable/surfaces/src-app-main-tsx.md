---
version: 1
slug: "src-app-main-tsx"
primary_target: "src/app/main.tsx"
related_targets: ["src/app/lead-panel.tsx","src/app/lead-drawer.tsx","src/app/app.css","src/app/index.html"]
---

# The app: Lead panel and Board

Scope: the React app at `/` (`src/app/`): the Lead panel (head, Conversation, question and Proposal cards, drawer, composer) beside the Board (event display, action bar, In flight, Repo sections with Spec groups and room readouts, launch and batch forms, Advance now and Refresh harnesses reports, issue cards). `serve`'s `/api` behind it runs the CLI (ADR-0006) and is not a surface. Mode: Operate.

Audience and job: one developer keeps the app open all day as a monitor. They glance at the Board for Stage changes and Agent blocked and at the panel for what the Lead said, asked or proposes. Then they answer, approve or decline, dispatch, launch reviews, and Close in short bursts.

Constraints: CLI parity (the app adds no action of its own); GLOSSARY.md vocabulary; light and dark from the system scheme; no external assets; one stylesheet of DESIGN.md tokens, no CSS framework; client tests cover state logic, not markup.

User red lines: sci-fi costume (HUD chrome, neon glow, scanlines), anything harder to scan than a plain status table, external assets, a chat bolted onto a list (the panel is part of the instrument's quiet surface, not a messenger skin).

## Direction contract

THESIS: The In-flight work drawn as a particle-detector event display, with each Dispatch as a track, beside the Conversation with the Lead. This replaces the category default of a status table with coloured pills and a chat sidebar with bubbles.

OWN-WORLD: The dark display field (#0a0d12) is a fixed instrument canvas in both schemes, with grey detector geometry: tracker rings, segmented ECAL/HCAL bands, and muon stations. Stage palette: Implementing amber, PR ready ECAL green, Review launched blue, Failed red. Agent blocked is magenta, the highlight. Dispatch buttons are amber, the colour that starts a track; a decision in the Lead panel (Approve, Save, a switch on) is filled ink, and what waits on one carries a 2px ink rule. Hairline rules, 3–6px corners, system sans, and monospace only for keys, branches, launch triples and code.

STORY: The user sees at a glance how far each Dispatch has reached and which agent is Asking, hovers a track to find its row, and acts in the row; on the left they read what the Lead says and decide what it asks or proposes in one click.

FIRST VIEWPORT: On a wide screen, the Lead panel (20–26rem, sticky, window-tall) on the left: its head (Lead, the drawer button, Agent state and launch triple, Harness pickers with Start/Stop), the Conversation kept at its end, and the composer. On the right, the event display (a transverse view of at most 460px beside the readout: the explanatory sentence, Stage legend keys with counts, Agent blocked, the Sampled time), then the action bar and the In flight rows. Below 1100px the panel stacks above the Board.

FORM: Particle Detector Event Display, pinned by the user (no concept-seed roll), with the Lead panel as a flat operational column of hairline-divided cards. Code-led: no image generation is available. Signature move: tracks reaching their Stage radius, with hover-linked rows.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
