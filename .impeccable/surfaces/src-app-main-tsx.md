---
version: 1
slug: "src-app-main-tsx"
primary_target: "src/app/main.tsx"
related_targets: ["src/app/lead-panel.tsx","src/app/lead-menu.tsx","src/app/lead-drawer.tsx","src/app/app.css","src/app/index.html"]
---

# The app: the Lead panel and the Repos

Scope: the React app at `/` (`src/app/`): a header (the brand, the Lead and Stats pages, the Questions count, the Lead menu), the Lead panel (its bar, the notices, the conversation with a line for each question and Proposal, the drawer, the composer) on the left, the page's own column on the right (the Repos on the Lead page, the charts on the Stats page), and the Questions list as toasts at the bottom right of every page. `serve`'s `/api` behind it runs the CLI (ADR-0006) and is not a surface. Mode: Operate.

Audience and job: one developer keeps the app open all day and talks to the Lead in it. They read what the Lead says, answer what it asks, approve or decline what it proposes, and glance right to see the work in their Repos.

Constraints: CLI parity (the app adds no action of its own); GLOSSARY.md vocabulary; two designed themes, Light (the default) and Dark, picked in the header (Light, Dark or System) and remembered without a flash, both at WCAG AA; no external assets; one stylesheet of DESIGN.md tokens, no CSS framework; client tests cover state logic, not markup.

User red lines: anything that feels unpolished or busy; sci-fi costume; external assets; a composer that loses the draft or a conversation that yanks the user's scroll.

## Direction contract

THESIS: A polished, bold, clean app in the spirit of Apple's website, conversation first: the conversation with the Lead is the centre, the work a glance away.

OWN-WORLD: Soft grey ground, panels with 22px corners, generous whitespace, the system face at a bold scale (32/24/17px, weights to 700), one accent (Apple blue) used sparingly for the primary action, focus, a switch on and what waits on the user, and one colour per Stage. Pill controls with weight. Motion that settles, never loops.

STORY: The user writes or talks to the Lead as equals, sees its replies arrive without losing their place, answers its questions where they are, and glances right at the Repos.

FIRST VIEWPORT: On a wide screen, the translucent header, then the Lead panel (the wider column) beside the right column's panel. At 900px and below, one column with the Lead panel first.

FORM: An Apple-like two-column shell. Code-led.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict and DESIGN.md.
