---
version: 1
slug: "src-app-main-tsx"
primary_target: "src/app/main.tsx"
related_targets: ["src/app/lead-panel.tsx","src/app/lead-menu.tsx","src/app/lead-drawer.tsx","src/app/app.css","src/app/index.html"]
---

# The app: the Lead panel and the Repos

Scope: the React app at `/` (`src/app/`): a header (the brand, the Lead and Stats pages, the Questions count, the Lead menu), the Lead panel (its bar, the notices, the Questions list, the conversation with question and Proposal cards, the drawer, the composer) on the left, and the page's own column on the right (the Repos on the Lead page, the charts on the Stats page). `serve`'s `/api` behind it runs the CLI (ADR-0006) and is not a surface. Mode: Operate.

Audience and job: one developer keeps the app open all day and talks to the Lead in it. They read what the Lead says, answer what it asks, approve or decline what it proposes, and glance right to see the work in their Repos.

Constraints: CLI parity (the app adds no action of its own); GLOSSARY.md vocabulary; light and dark from the system scheme, both at WCAG AA; no external assets; one stylesheet of DESIGN.md tokens, no CSS framework; client tests cover state logic, not markup.

User red lines: anything that feels unpolished or busy; sci-fi costume; external assets; a composer that loses the draft or a conversation that yanks the user's scroll.

## Direction contract

THESIS: A calm, polished, clean app in the spirit of Apple's website, conversation first: the conversation with the Lead is the centre, the work a glance away.

OWN-WORLD: Soft grey ground, white panels with 18px corners, generous whitespace, the system face, one accent (Apple blue) for the primary action, focus, a switch on and what waits on the user, and one colour per Stage. Pill controls, quiet until hovered. Subtle motion only.

STORY: The user writes or talks to the Lead as equals, sees its replies arrive without losing their place, answers its questions where they are, and glances right at the Repos.

FIRST VIEWPORT: On a wide screen, the translucent header, then the Lead panel (the wider column) beside the right column's panel. At 900px and below, one column with the Lead panel first.

FORM: An Apple-like two-column shell. Code-led.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict and DESIGN.md.
