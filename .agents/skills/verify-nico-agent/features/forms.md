# The panel's forms

A Repo's panel opens with its Dispatch form; its Readiness, Room, Switches, Settings, Libraries and
Install each fold to one line saying what is set (a Project's defaults fold Room, Switches and
Settings the same way). A section opens by itself while it holds a refusal or a failing state, and
the sections the user opened are remembered in the browser per Repo. A field that saves on change
stays legible while it saves: beside it `Saving…`, then `Saved` for two seconds, then the chip
saying where the setting comes from (`from Project`, `default`, or `set here` with a × that removes
the Repo's own). A text or number field saves on Enter and on leaving it; Escape puts back what is
set. A refusal goes under its section, the field put back and marked invalid. On a phone every
field is 16px and at least 44px tall, and nothing is wider than the window.

## Sub-features

- `forms-order` `region "<slug>"` holds, in order, `region "Dispatch"` (never folded), `region "Readiness"`, `"Room"`, `"Switches"`, `"Settings"`, `"Libraries"`, `"Install"`, then `button "Remove <slug>…"`; each folded `group` reads its head and what is set: `2 of 6 pass`, `3 · 0 in flight`, `4 of 9 on`, `Implementer claude`, `None linked`, `None`.
- `forms-alarm` a section with a failing state opens by itself (Readiness while a check fails), and so does one whose save was refused.
- `forms-remember` a section opened by the user is open again after a reload in the same browser, for that Repo only; one that opened by itself is not remembered; a browser whose storage throws still opens and closes them.
- `forms-saving` a toggle or field held on its way to serve shows `Saving…` beside it and stays enabled; once serve answers, a `status` reads `Saved`, then the chip `set here` with `button "Use the default <Setting>"`.
- `forms-enter` a text field saves on Enter (one PATCH, `Saved`), and on leaving it; Enter in the Dispatch form's model field submits nothing.
- `forms-escape` Escape in a changed text field puts back what is set and sends nothing.
- `forms-refused` a refused value shows its `alert` under the section, the field back to what is set.
- `forms-chip` a setting taken reads `from Project` or `default`; one the Repo sets reads `set here`.
- `forms-phone` at 390px and 360px, with every section open, the page is no wider than the window.

## How to get to it (user POV)

- Open the page, pick a Repo's (or a Project's) tab, and click a folded line in its panel to open it.
- Change a select or a toggle; type in a text or number field and press Enter, or leave it, or press Escape to back out.
- Reload the page in the same browser: the sections opened stay open.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`;
  `$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`.
- `E=.evidence/<issue>/forms`; `$C state > "$E/state.before.txt"`; `S="$E/browser.json"` (one browser across the steps that say so).

- **Order.** Run `$C page --evidence "$E/01-order" --expect "Readiness"`. Within `region "verify/fixture"`:
  `region "Dispatch"` with `button "Dispatch"`, then `region "Readiness"` open (its `group` reads `Readiness 2 of 6 pass`
  and holds the failing checks' `.evidence/ is not ignored on main` and the verification skill's, then
  `list "Passing"`), then folded
  `group`s `Room 3 · 0 in flight`, `Switches 4 of 9 on`, `Settings Implementer claude`, `Libraries None linked`,
  `Install None`, and `button "Remove verify/fixture…"` last; no `spinbutton "Room"` (folded).
- **Remembered.** Run `$C page --evidence "$E/02-open" --storage "$S" --click "region=Room" --expect "in flight; each Dispatch"`,
  then `$C page --evidence "$E/03-reloaded" --storage "$S" --expect "in flight; each Dispatch"`: the second browser,
  reloading the first, shows `spinbutton "Room"` with no click; `$C page --evidence "$E/04-fresh" --expect "Readiness"`, a
  new browser, has no `spinbutton "Room"`. `$C page --evidence "$E/05-no-storage" --storage none --click "region=Room" --expect "in flight; each Dispatch"`:
  it opens, and `.console.txt` is empty.
- **Saving.** Run `$C page --evidence "$E/06-saving" --click "region=Switches" --hold 20 --click "switch=Review" --expect "Saving…"`:
  the screenshot shows `Saving…` beside `Review` at full ink and the toggle enabled; `.requests.txt` has no PATCH (held).
- **Saved.** Run `$C page --evidence "$E/07-saved" --click "region=Switches" --click "switch=Review" --expect "Saved"`:
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"switches":{"review":false}} -> 200`; the snapshot has
  `status: Saved` beside `switch "Review"`. Then `$C page --evidence "$E/08-set-here" --click "region=Switches" --expect "set here"`:
  `text: Review`, `text: set here` and `button "Use the default Review"`; `text: Stack`, `text: default`.
- **Enter.** Run `$C page --evidence "$E/09-enter" --click "region=Settings" --click "textbox=Base" --type dev --press Enter --expect "Saved"`:
  one `PATCH ... {"base":"dev"} -> 200`; `config.toml` has `base = "dev"`.
- **Escape.** Run `$C page --evidence "$E/10-escape" --click "region=Settings" --click "textbox=Base" --press Control+a --type nope --press Escape --press Tab --wait 1`:
  `textbox "Base"` holding `text: dev` and no PATCH in `.requests.txt`; `config.toml` still `base = "dev"`.
- **Enter in the Dispatch form.** Run `$C page --evidence "$E/14-dispatch-enter" --within "region=Dispatch" --click "combobox=Harness" --press ArrowDown --press Enter --click "textbox=Model" --type gpt-5 --press Enter --wait 1`:
  codex takes any model, so `textbox "Model"` (placeholder `default`) holds `gpt-5`, and `.requests.txt` has no `POST /api/dispatch`.
- **Refused.** Run `$C page --evidence "$E/11-refused" --click "region=Room" --click "spinbutton=Room" --press Control+a --type 0 --press Enter --expect "room is a whole number of at least 1, not 0"`:
  `PATCH ... {"room":0} -> 400`; `region "Room"` open with an `alert` under it and `spinbutton "Room" [invalid]: "3"`.
- **Opens by itself.** The `Readiness` of step 1 was open with no click (its checks fail in the run).
- **Phone.** Run `$C page --evidence "$E/12-phone" --width 390 --click "region=Settings" --click "region=Switches" --click "region=Room"` and
  the same at `--width 360` (`13-phone-360`): `.view.txt` says `page 390px wide in a 390px window` (`360` in `360`).
- **Proof.** `$C state > "$E/state.after.txt"` and the diff (`base = "dev"`, `review = false`); copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- Each `page` is a new browser: a section opened in one call is folded in the next unless both pass the same `--storage FILE`.
- `--click "region=<Section>"` clicks the middle of the section: while folded that is its line, which opens it; once
  open it lands on whatever is in the middle. Click a section's line once per browser.
- `--hold` holds every later write until the browser closes, so a held PATCH never reaches serve: prove the save with
  a call without it.
- `Saved` lasts two seconds: `--expect "Saved"` straight after the action, not after a `--wait`.
- `Saving…` is hidden from screen readers (only `Saved` is announced), so it is in the screenshot, not the snapshot.
- A refusal leaves `Failed to load resource: ... 400` in `.console.txt`: the browser's line for the 400, not the page's.
- The snapshot puts a text field's value on the line under it (`textbox "Base":` then `text: dev`).
