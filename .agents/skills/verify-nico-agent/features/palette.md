# The page's colours

One component system in Light, Dark and System: neutral surfaces, hairline frames, one selection
accent (the open node, the current Project and view, links, focus, the primary button), and a hue
per Stage on its icon and its word, always beside the word. Needs you is a soft amber badge that says
`Needs you`, on a node, in the inspector and at the head of the notices; nothing else is amber-yellow. A Harness has a hue only
as a dot in each launch picker's Harness select and before the inspector's review line that names its Reviewer's. Repos have no colours: a node names its Repo in words.
Every text pair meets WCAG AA in both themes, and no state is told by colour alone.

## Sub-features

- `palette-stage` each node's Stage word and its icon take its Stage's hue (Ready teal, Waiting amber sienna, Stackable magenta, Implementing and PR draft blue, Verified green, Merged purple, Closed taupe, Failed red); the card itself stays white (`surface`), a merged one dashed on `ground`; the node's accessible name is unchanged.
- `palette-accent` the open node is framed in the accent, the current Project's link is on `accent-soft`, the current view's tab is underlined in it, and each form's one action is filled with it.
- `palette-needs` a node that needs you carries the `Needs you` badge; the notices are white cards with a hairline frame under one `Needs you` badge.
- `palette-harness` each launch picker's Harness select shows a dot in the picked Harness's hue (claude clay, codex green, opencode violet): the Dispatch form's and, in Settings, the Implementer's and the Reviewer's.
- `palette-dark` the same in Dark, from its own tokens.
- `palette-aa` every text token in `web/src/app.css` meets 4.5:1 on `surface` and `ground`, light and dark, and a control's frame (`rule`) 3:1 on `surface`.

## How to get to it (user POV)

- Open the page on a Project: the map, the notices and the inspector show the colours.
- Open `Repos`, then a Repo's `Settings`: the Implementer's and the Reviewer's Harness.
- Pick `Dark` in the theme switch, or a browser whose system scheme is dark.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project verify --json`;
  `$C run -- repo add verify/second --path "$SECOND_CLONE" --project verify --json`; `$C seed issues`;
  `$C seed issues second`; `$C seed dispatch 7 pr`;
  `$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`, and the same for `verify/second`.
- `E=.evidence/<issue>/palette`; `$C state > "$E/state.before.txt"`.

- **Desk, light.** Run `$C page --evidence "$E/01-desk-light" --width 1440 --click "button~#1 fixture, Verify: a Ready issue"`.
  The screenshot: `#1 fixture` (Ready) with teal `Ready` beside a ring, framed in the accent and `[pressed]`,
  `#1 second` with amber sienna `Waiting`, `#6` magenta `Stackable`, `#7` blue `PR draft`; every card white; the
  rail's `verify` on its accent-soft band; the inspector beside the map. The snapshot names nodes as before
  (`#1 fixture, Verify: a Ready issue, Ready`).
- **Harnesses.** Run `$C page --evidence "$E/03-harnesses" --width 1440 --click "button=Repos" --within "region=verify/fixture" --click "region=Settings" --expect "Reviewer"`:
  `combobox "Implementer Harness"` on `claude` and `combobox "Reviewer Harness"` on `Not the Implementer's` (nothing
  sets a Reviewer); the screenshot has a clay dot inside the first and a hollow one inside the second.
- **Dark and phone.** The same `01` page with `--scheme dark` (`06-desk-dark`), `--width 390` (`07-phone-light`) and
  `--width 390 --scheme dark` (`08-phone-dark`): the same hues from their dark tokens; `.view.txt` `page 390px wide in a 390px window`.
- **AA.** Run `node .agents/skills/verify-nico-agent/contrast.mjs web/src/app.css > "$E/contrast.txt"`: every line `ok`,
  ending `all pass`.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff: outside calls only, `herdr agent list` from the page asking
  for #7's Agent states, and no file changed; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- Colour is in the screenshot, not the ARIA snapshot: the snapshot proves the names are unchanged, the `.png` the hues.
- `seed dispatch` does not start an agent (herdr is stubbed), so no node names an agent at work in a run, and no
  review names its Reviewer's Harness on the inspector's review line: the pickers show the Harness hues.
