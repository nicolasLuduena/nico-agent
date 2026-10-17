# The Project select and what needs you

serve's page shows what needs you where it is. The node of every Implementer Asking, every faux-nico
herdr reports blocked, every Failed Dispatch, every PR whose review was given up on or stopped and
every Verified PR to merge carries a yellow flag and ends `needs you`; its panel has the rest. What
has no node is a yellow toast over the page's bottom right corner, dismissible for the page load: an
agent of the loop's own that herdr reports blocked (a quality-scan, the morning agent), a paused
GitHub, a failing Readiness check (checks.md) and a failed Install (install.md). Nothing sits above
the Project row: one select named Project, at every width, picks a Project (a Repo naming none is its
own, named by its slug); beside it the views (Map, Roadmap), then the read
times and Refresh at the row's right. A Project shows its map, read times, and each Repo's switches
and Dispatch form (see project-tabs for a Project of several Repos). The URL's hash follows the pick,
so back and forward move between Projects. There is no tab row and no Morning summary.

## Sub-features

- `page-empty` with no Repo: the page says `No Repo yet. Add one below, or with nico-agent repo add <owner/name> --path <clone>.`, with no `combobox "Project"` and nothing needing you.
- `select-one-per-project` `combobox "Project"` has an `option` per Project with a Repo, by name, the first selected; on its row `navigation "View"` (`link "Map"`, `link "Roadmap"`), the read times and `button "Refresh"`. No `tablist` and no `region "Morning summary"`.
- `select-pick` picking an option shows that Project's map, read times and controls, and the hash becomes `#<project>`, escaped.
- `select-back` the browser's back button returns to the Project picked before.
- `select-phone` under 720px the select takes its own line, full width; the views, read times and Refresh wrap under it.
- `no-morning` a `morning.md` in the config dir is in `GET /api/status`'s `morning_summary`, and nowhere on the page.
- `needs-no-band` nothing of what needs you is above the Project row: no `region "Needs you"`, with or without items.
- `needs-flag` the node of an Asking Implementer (herdr saying `blocked`, or the Asking a tick recorded), a Failed Dispatch, a review given up on or stopped and a Verified PR ends `needs you`; its panel holds the question (answer.md), the failure (close.md, rulings.md), the review (review.md) or the Verdict.
- `needs-toast-blocked` a blocked Run with no node is a `status` toast `Blocked <agent> <since>` in `list "Needs you"`; a faux-nico's flags its Dispatch's node instead.
- `needs-toast-paused` a paused GitHub is a toast `Paused GitHub until <time>`.
- `needs-toast-dismiss` each toast's `button "Dismiss <its head>"` removes it for this page load; a reload shows it again.
- `needs-open` clicking a flagged node opens its panel (`GET /api/node/<issue>`); an Asking one's with `region "Asking"` first (see answer.md).

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/` (the run's `$URL`) in a browser, on the desk or at phone width.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/page-tabs-strip`.

- **Empty.** Run `$C page --evidence "$E/01-empty" --expect "No Repo yet"`. The ARIA snapshot has
  no `region "Needs you"`, no `list "Needs you"` and no `combobox "Project"`: `main` starts with the paragraph.
- **Two Repos.** Run `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`
  and `$C seed issues`, then `$C page --evidence "$E/02-select"`. `main` starts with `combobox "Project"`, which has `option
  "verify/fixture" [selected]` and `option "verify/second"`; then `navigation "View"` with `link "Map"`
  (`#verify%2Ffixture`) and `link "Roadmap"`; then the paragraph `Source read <time> · PRs not checked yet` and `button "Refresh"`;
  no `tablist`. `region "Map of verify/fixture"` has node buttons `#1, Verify: a Ready issue, Ready`, `#3, Verify: waits
  on #1, Waiting, waits on verify/fixture#1 to close`, `#4, Verify: assigned to someone else,
  Waiting`, `#5, Verify: a Research issue, Ready`, `#6, Verify: stacks on #9 PR, Stackable` and `#9, Verify: a Blocker in review, Blocker`
  (no `#2`: not labelled). The screenshot has the select, `MAP` `ROADMAP` and the read times with Refresh on one row.
- **Pick a Project.** Run `$C page --evidence "$E/03-pick" --select "Project=verify/second" --expect "Source not read yet"`.
  `option "verify/second" [selected]`; `Nothing on this map`; `.view.txt` `at /#verify%2Fsecond`;
  `.requests.txt` has `GET /api/map/verify%2Fsecond -> 200`.
- **Back.** Run `$C page --evidence "$E/04-back" --select "Project=verify/second" --expect "Source not read yet" --history back --expect "Source read"`:
  `option "verify/fixture" [selected]`, its map again, `.view.txt` `at /`.
- **Phone.** Run `$C page --evidence "$E/06-phone" --width 390`. `combobox "Project"` with `option "verify/fixture" [selected]`;
  the screenshot is one column, the select its own full-width line, `MAP` `ROADMAP` and then the read times with Refresh under it.
- **Everything that needs you.** Run `$C run -- dispatch verify/fixture#1 --json` (Failed at worktree),
  `$C seed dispatch 10 pr > "$E/seed10.json"`, `$C run -- verdict verify/fixture#10 pass --sha "$(jq -r .head "$E/seed10.json")" --json`,
  `$C seed dispatch 12 asking`, `$C seed run faux-nico 12`, `$C seed run quality-scan`, `$C seed run morning`
  and `$C drift pause`. Run `$C page --evidence "$E/07-needs" --expect "Paused"`.
  No `region "Needs you"`; `main` starts with `list "Needs you"`, three `status` items in order, each with `button "Dismiss <its head>"`:
  `Blocked quality-scan-fixture <time>`, `Blocked morning <time>` and `Paused GitHub until <time>`, drawn
  over the page's bottom right corner in the screenshot, yellow. Then `combobox "Project"`. The map's node buttons
  `#1, Verify: a Ready issue, Failed, needs you`, `#10, Verify: seeded Dispatch 10, Verified, PR 110 draft, needs you` and
  `#12, Verify: seeded Dispatch 12, Implementing, needs you` end `needs you` (#12 from its recorded Asking and its blocked faux-nico: herdr is a stub); no other does.
- **Dismiss.** Run `$C page --evidence "$E/08-dismiss" --expect "Paused" --click "button~Dismiss"`: `list "Needs you"` has two `status`
  items left, `Blocked morning` and `Paused GitHub`; the one dismissed is back on the next page.
- **Open a flagged node.** Run `$C page --evidence "$E/09-open" --expect "Paused" --click "button~#1, Verify: a Ready issue"`.
  `.requests.txt` has `GET /api/node/verify%2Ffixture%231 -> 200`; the node is `[pressed]` and a `region "Verify: a Ready issue #1"`
  panel replaces the Repo's panel. Then `--click "button~#12, Verify: seeded Dispatch 12"` (`10-open-asking`):
  `GET /api/node/verify%2Ffixture%2312 -> 200`, its panel's first section `region "Asking"`.
- **Phone.** Run `$C page --evidence "$E/11-phone" --width 390 --expect "Paused"`: the toasts across the foot of the
  screen, `page 390px wide in a 390px window`.
- **No Morning summary.** Write `# Morning`, `## Landed` and `- verify/fixture#5 Read once` to
  `"$E/morning.md"`, `$C seed morning "$E/morning.md"`, then `$C http --evidence "$E/12-api-status-morning" GET /api/status`:
  `morning_summary` holds the text. `$C page --evidence "$E/12-no-morning"`: no `Landed`, no `button "Hide"` or `"Show"`.
- **Proof.** Copy `$OUTSIDE_LOG` to `$E/outside.log`. Each `.console.txt` is empty.

## Gotchas

- Times on the page are the browser's local clock (`HH:MM`); match them with `~` or ignore them.
- The page first shows `Reading nico-agent…`; `$C page` waits for it to go before any step.
- A node's flag reads Asking from the Dispatch (or herdr saying `blocked`); with herdr stubbed only a
  seeded `asking` shows. Likewise a blocked Run shows only as `seed run` records it.
- A Verified flag needs a pass Verdict on the PR's current head: after `drift push` it drops to
  `PR draft` and loses it.
- The toasts sit over the page's corner, where a Repo's panel ends: `--click` what is under them
  only after `--click "button~Dismiss"` once per toast, or they time it out.
- With two Repos their ten Readiness toasts stack past the top of the window, so the first
  `button~Dismiss` (verify/fixture's, at the top) is out of reach and times out: dismiss the bottom ones
  first, by name, `--click "button=Dismiss Check verify/second"` five times, then `"button=Dismiss Check
  verify/fixture"` five times.
- `seed issues` caches only `verify/fixture`; `verify/second` stays `Source not read yet`.
- While the page is open with a live Dispatch, serve's event stream asks herdr every 10 seconds:
  expect `herdr agent list` lines in `$OUTSIDE_LOG`.
- Back on a map from the Roadmap view, `.console.txt` holds `IndexSizeError: Failed to execute
  'getStartPositionOfChar'` lines from the map's title fitting: they come from before #365 (the same on db3fc21) and are
  not this feature's; any other line is.
