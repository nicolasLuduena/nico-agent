# The page's colours

Every Stage has its own hue on its ring, its Stage word and a light tint of its node; in a Project
of more than one Repo, every Repo has a line colour, by its order in the Project (its Repos by
slug), shown as a square before its name on a node, on its toasts and before its
Wiki in the Wiki view, and as a 3px rule across the top of its panel; every Harness has a hue, shown
as a diamond in each launch picker's Harness select, before the node panel's review line that names its
Reviewer's, and as the agent at work on a node. Yellow stays only for what needs you, and each Stage still reads by its ring alone.
Light and Dark each have their own tokens, and every pair meets WCAG AA.

## Sub-features

- `palette-stage` each node's Stage word and ring take its Stage's hue (Ready teal, Waiting amber sienna, Stackable magenta, Implementing and PR draft blue, Verified green, Merged purple, Closed taupe, Failed red), its fill a tint of it; the node's accessible name is unchanged.
- `palette-repo` in a Project of two Repos, each node's number is followed by its Repo's square, its panel has a rule in the same colour on top, its toasts carry the square, and the Wiki view's row of its Wiki too; a Project of one Repo has none.
- `palette-reload` a Repo's colour is the same after a reload.
- `palette-harness` each launch picker's Harness select shows a diamond in the picked Harness's hue (claude clay, codex green, opencode violet): the Dispatch form's and, in Settings, the Implementer's and the Reviewer's.
- `palette-dark` the same in Dark, from its own tokens.
- `palette-aa` every hue in `web/src/app.css` meets AA on `surface`, `ground` and a node's tint, light and dark.

## How to get to it (user POV)

- Open the page on a Project: the map, the toasts and the panels show the colours.
- Open a Repo's `Settings`: the Implementer's and the Reviewer's Harness.
- Pick `Dark` in the theme switch, or a browser whose system scheme is dark.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project verify --json`;
  `$C run -- repo add verify/second --path "$SECOND_CLONE" --project verify --json`; `$C seed issues`;
  `$C seed issues second`; `$C seed dispatch 7 pr`;
  `$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`, and the same for `verify/second`.
- `E=.evidence/<issue>/palette`; `$C state > "$E/state.before.txt"`; `S="$E/browser.json"`.

- **Desk, light.** Run `$C page --evidence "$E/01-desk-light" --width 1440 --storage "$S" --expect "Defaults for its Repos"`.
  The screenshot: `#1 fixture` (Ready) with a blue square (`line-1`) before `fixture` and teal `Ready` on a
  teal-tinted node, `#1 second` (Waiting) with a rose square (`line-2`) and amber sienna `Waiting`, `#6` magenta
  `Stackable`, `#7` blue `PR draft`; `region "verify/fixture"` with a blue rule on top, `region "verify/second"`
  a rose one; the `CHECK verify/fixture:` toasts with the blue square, `verify/second:` with the rose
  one; the Dispatch form's `combobox "Harness"` on `claude` with a clay diamond. The snapshot names nodes as
  before (`#1 fixture, Verify: a Ready issue, Ready`).
- **Reload.** Run `$C page --evidence "$E/02-reloaded" --width 1440 --storage "$S" --expect "Defaults for its Repos"`;
  `magick compare -metric AE "$E/01-desk-light.view.png" "$E/02-reloaded.view.png" null:` counts only the pixels
  of the read times, if any; the squares and rules are where and as they were.
- **Harnesses.** Run `$C page --evidence "$E/03-harnesses" --width 1440 --within "region=verify/fixture" --click "region=Settings" --expect "Reviewer"`:
  `combobox "Implementer Harness"` on `claude` and `combobox "Reviewer Harness"` on `codex`; the screenshot has a clay
  diamond inside the first and a green one inside the second.
- **Wiki view.** Run `$C page --evidence "$E/04-wiki" --width 1440 --hash "#verify/wiki" --expect "Wiki settings"`:
  with no Wiki built, the commands per Repo; then `$C run -- wiki build verify/fixture --json` (it fails in the run,
  its first build listed) and `$C page --evidence "$E/05-wiki-row" --width 1440 --hash "#verify/wiki" --expect "verify/fixture"`:
  `link "verify/fixture"` with the blue square before it.
- **Dark and phone.** The same page with `--scheme dark` (`06-desk-dark`), `--width 390` (`07-phone-light`) and
  `--width 390 --scheme dark` (`08-phone-dark`): the same hues from their `-dark` twins, the toasts' squares framed
  in black on the yellow; `.view.txt` `page 390px wide in a 390px window`.
- **AA.** Run `node .evidence/<issue>/palette/contrast.mjs web/src/app.css > "$E/contrast.txt"` (the script in this
  feature's Evidence of #365, which reads every token from `app.css`): every line `ok`, ending `all pass`.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff (the Wiki build's files only); copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- Colour is in the screenshot, not the ARIA snapshot: the snapshot proves the names are unchanged, the `.png` the hues.
- A Project of one Repo has no line colours: add both Repos to one Project first.
- `seed dispatch` does not start an agent (herdr is stubbed), so no node shows an agent's diamond in a run, and no
  review names its Reviewer's Harness on the node panel's review line: the pickers show the Harness hues.
- The read times move with the clock: compare reloads within the same minute, or count only their pixels.
