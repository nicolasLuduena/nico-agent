---
version: 1
slug: "src-web-ts"
primary_target: "src/web.ts"
related_targets: []
---

# Board

Scope: the web Board (`/`), plus the pages that share its shell (batch forms, results, confirm close). Mode: Operate.

Audience and job: one developer keeps the Board open all day as a monitor. They glance at it for Stage changes and blocked agents, then dispatch, launch reviews, and Close in short bursts.

Constraints: CLI parity; CONTEXT.md vocabulary; light and dark; no external assets; existing row markup is pinned by tests.

User red lines: sci-fi costume (HUD chrome, neon glow, scanlines), anything harder to scan than before, external assets.

## Direction contract

THESIS: The In-flight work drawn as a particle-detector event display, with each Dispatch as a track. This replaces the category default of a status table with colored pills.

OWN-WORLD: The dark display field (#0a0d12) is a fixed instrument canvas in both schemes, with grey detector geometry: tracker rings, segmented ECAL/HCAL bands, and muon stations. Stage palette: Implementing amber, PR ready ECAL green, Review launched blue, Failed red. Agent blocked is magenta, the highlight. Dispatch buttons are amber, the color that starts a track. Hairline rules, 3–6px corners, system sans, and monospace only for keys, branches, and launch triples.

STORY: The user sees at a glance how far each Dispatch has reached and what is blocked, hovers a track to find its row, and acts in the row.

FIRST VIEWPORT: A full-width event display: a 400px transverse view on the left, and a readout on the right with the explanatory sentence, Stage legend keys with counts, Agent blocked, and the Sampled time. Below it: the action bar, then In flight rows, whose Stage is shown as a legend key.

FORM: Particle Detector Event Display, pinned by the user (no concept-seed roll). Code-led: no image generation is available. Signature move: tracks reaching their Stage radius, with hover-linked rows.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
