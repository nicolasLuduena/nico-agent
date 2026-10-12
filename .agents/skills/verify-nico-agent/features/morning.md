# The Morning summary on the page

The page's first section is the Morning summary, `morning.md` as the morning agent wrote it, set
as headings, lists and lines. A `Hide` button folds it to one line, the summary's first line that
is not a heading, beside a `Show` button that opens it again. Hidden is remembered in this browser
for that text: a reload keeps it folded, and a `morning.md` that says anything else shows open,
on a reload or live while the page is open. A browser whose storage throws shows it open, and
Hide still folds it until the page is left.

## Sub-features

- `morning-open` with `morning.md` written, `region "Morning summary"` is first in `main`, its headings, lists and lines shown, with `button "Hide"`.
- `morning-hide` `Hide` folds it to the first line that is not a heading and `button "Show"`; the region stays first.
- `morning-reload` a reload in the same browser shows it folded still.
- `morning-show` `Show` opens it, and the browser forgets it was hidden.
- `morning-changed` a `morning.md` with other text shows open, on a reload and live (within the event stream's 10 seconds).
- `morning-no-storage` with `localStorage` throwing, it shows open, Hide and Show still work, and the console has no error.
- `morning-none` with no `morning.md`, there is no Morning section.

## How to get to it (user POV)

- Open the page after the morning agent has written `morning.md` in the config dir, and click
  `Hide`, then `Show`.
- Leave the page open, or reload it, across the next morning's `morning.md`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`. No Repo is needed.
- `E=.evidence/<issue>/morning; mkdir -p "$E"`; `S="$PWD/$E/browser-storage.json"` (absent: a
  browser with nothing stored); `$C state > "$E/state.before.txt"`.
- Write `morning.md` as the morning agent would (it is off in a run):
  `printf '# Morning summary\n\nMorning of 2026-10-12: **1** to merge, 1 to answer\n\n## Merge these\n1. verify/fixture#7\n\n## Answer these\n- verify/fixture#8 Keep the README?\n' > "$CONFIG_DIR/morning.md"`.

- **Open.** Run `$C page --evidence "$E/01-open" --storage "$S" --expect "Merge these"`.
  The ARIA snapshot's `main` starts with `region "Morning summary"`: `heading "Morning summary"`,
  the paragraph `Morning of 2026-10-12:` `strong "1"` `to merge, 1 to answer`, `heading "Merge
  these"` and its list, `heading "Answer these"` and its list, then `button "Hide"`.
- **Hide.** Run `$C page --evidence "$E/02-hide" --storage "$S" --click "button=Hide" --gone "Merge these" --expect "Morning of 2026-10-12"`.
  The region holds only the paragraph `Morning of 2026-10-12: 1 to merge, 1 to answer` and `button
  "Show"`, and is still first. `$S` holds `nico-agent.morning-hidden` with the file's text.
- **Reload.** Run `$C page --evidence "$E/03-reload" --storage "$S" --expect "Morning of 2026-10-12" --gone "Merge these"`.
  Folded as after Hide.
- **Show.** Run `$C page --evidence "$E/04-show" --storage "$S" --click "button=Show" --expect "Merge these"`.
  Open, with `button "Hide"`; `$S` has no `nico-agent.morning-hidden` (copy it to `$E/04-show.storage.json`).
- **Changed, on a reload.** Run `$C page --storage "$S" --click "button=Hide" --gone "Merge these"`
  (`05-hide-again`), then write another text:
  `printf '# Morning summary\n\nMorning of 2026-10-13: **2** to merge, nothing to answer\n\n## Merge these\n1. verify/fixture#7\n2. verify/fixture#9\n' > "$CONFIG_DIR/morning.md"`,
  and run `$C page --evidence "$E/06-changed" --storage "$S" --expect "Morning of 2026-10-13" --expect "verify/fixture#9"`.
  Open, with `button "Hide"`.
- **Changed, live.** Start a write six seconds out, then hide and wait while it lands:
  `(sleep 6; printf '# Morning summary\n\nMorning of 2026-10-14: nothing to merge, nothing to answer\n\n## Notes\n- A quiet night\n' > "$CONFIG_DIR/morning.md") &`
  `$C page --evidence "$E/07-changed-live" --storage "$S" --click "button=Hide" --gone "verify/fixture#9" --wait 18 --expect "A quiet night"`.
  Open, with `button "Hide"`; `.requests.txt` has `GET /api/status` again after `GET /api/events`.
- **No storage.** Run `$C page --evidence "$E/08-no-storage" --storage none --expect "A quiet night" --click "button=Hide" --gone "A quiet night" --expect "Morning of 2026-10-14" --click "button=Show" --expect "A quiet night" --click "button=Hide" --gone "A quiet night"`.
  Every step `ok`; folded at the end; `.console.txt` is empty.
- **Phone.** Run `$C page --evidence "$E/09-phone" --storage "$S" --width 390 --click "button=Hide" --gone "A quiet night"`.
  The screenshot has the line wrapped beside `Show`, and no horizontal scroll.
- **None.** `rm "$CONFIG_DIR/morning.md"`, then run `$C page --evidence "$E/10-none" --storage "$S" --expect "Nothing needs you" --gone "Morning of"`.
  `main` starts with `region "Needs you"`: no Morning section.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff: empty, since the file you wrote is
  gone again; the page writes nothing. Copy `$OUTSIDE_LOG` to `$E/outside.log`: empty.

## Gotchas

- Each `page` is a new browser: without `--storage` a reload forgets the hidden text, and every
  step of this file passes for the wrong reason. Keep one `$S` for the whole recipe.
- `morning.md` is written by hand because the morning agent needs herdr; it stands in for the
  agent's write, as `seed` does for herdr's and GitHub's.
- The live change waits for the event stream's look every 10 seconds: `--wait` past it before the
  `--expect`, whose own timeout is 10 seconds.
- `--gone TEXT` passes at once when the text was never there: pair it with an `--expect` of what
  should show.
