# The page's tabs and what needs you

serve's page shows what needs you where it is. The node of every Implementer Asking, every faux-nico
herdr reports blocked, every Failed Dispatch, every PR whose review was given up on or stopped and
every Verified PR to merge carries a yellow flag and ends `needs you`; its panel has the rest. What
has no node is a yellow toast over the page's bottom right corner, dismissible for the page load: an
agent of the loop's own that herdr reports blocked (a quality-scan, the morning agent), a paused
GitHub, a failing Readiness check (checks.md) and a failed Install (install.md). Nothing sits above
the tabs: one tab per Project (a Repo naming none is its own, named by its slug) shows its map, read
times, and each Repo's switches and Dispatch form (see project-tabs for a Project of several Repos);
arrow keys move between tabs, and at phone width the tabs become one select named Project.

## Sub-features

- `page-empty` with no Repo: the page says `No Repo yet. Add one here, or with nico-agent repo add <owner/name> --path <clone>.`, with no `tablist` and nothing needing you.
- `tabs-one-per-project` `tablist "Projects"` has a `tab` per Project with a Repo, by name, the first selected, its `tabpanel` named after it.
- `tabs-click` clicking a tab selects it and shows that Project's map, read times and controls.
- `tabs-keys` ArrowRight, ArrowLeft, Home and End move the selection (wrapping) and focus.
- `tabs-phone` under 720px the tablist is replaced by `combobox "Project"` with an option per Project.
- `needs-no-band` nothing of what needs you is above the tabs: no `region "Needs you"`, with or without items.
- `needs-flag` the node of an Asking Implementer (herdr saying `blocked`, or the Asking a tick recorded), a Failed Dispatch, a review given up on or stopped and a Verified PR ends `needs you`; its panel holds the question (answer.md), the failure (close.md, rulings.md), the review (review.md) or the Verdict.
- `needs-toast-blocked` a blocked Run with no node is a `status` toast `Blocked <agent> <since>` in `list "Needs you"`; a faux-nico's flags its Dispatch's node instead.
- `needs-toast-paused` a paused GitHub is a toast `Paused GitHub until <time>`.
- `needs-toast-dismiss` each toast's `button "Dismiss"` removes it for this page load; a reload shows it again.
- `needs-open` clicking a flagged node opens its panel (`GET /api/node/<issue>`); an Asking one's with `region "Asking"` first (see answer.md).

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/` (the run's `$URL`) in a browser, on the desk or at phone width.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/page-tabs-strip`.

- **Empty.** Run `$C page --evidence "$E/01-empty" --expect "No Repo yet"`. The ARIA snapshot has
  no `region "Needs you"`, no `list "Needs you"` and no `tablist`: `main` starts with the paragraph.
- **Two Repos.** Run `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`
  and `$C seed issues`, then `$C page --evidence "$E/02-tabs"`. `main` starts with `tablist "Projects"`, which has `tab
  "verify/fixture" [selected]` and `tab "verify/second"`; `tabpanel "verify/fixture"` holds `region
  "Map of verify/fixture"` with node buttons `#1, Verify: a Ready issue, Ready`, `#3, Verify: waits
  on #1, Waiting, waits on verify/fixture#1 to close`, `#4, Verify: assigned to someone else,
  Waiting`, `#5, Verify: a Research issue, Ready`, `#6, Verify: stacks on #9 PR, Stackable` and `#9, Verify: a Blocker in review, Blocker`
  (no `#2`: not labelled); the paragraph reads `Source read <time> · PRs not checked yet`.
- **Click a tab.** Run `$C page --evidence "$E/03-click" --click "tab=verify/second" --expect "Source not read yet"`.
  `tab "verify/second" [selected]`; `tabpanel "verify/second"` with `Nothing on this map`;
  `.requests.txt` has `GET /api/map/verify%2Fsecond -> 200`.
- **Keys.** Run `$C page --evidence "$E/04-keys" --click "tab=verify/fixture" --press ArrowRight`:
  `tab "verify/second" [selected]`. Then `--click "tab=verify/second" --press ArrowRight`
  (`05-keys-wrap`): `tab "Libraries" [selected]`, the last; and `--click "tab=Libraries" --press ArrowRight`
  (`05b-keys-wrap`): `tab "verify/fixture" [selected]`, wrapped to the first.
- **Phone.** Run `$C page --evidence "$E/06-phone" --width 390`. No `tablist`; `combobox "Project"`
  with `option "verify/fixture" [selected]` and `option "verify/second"`; the screenshot is one column.
- **Everything that needs you.** Run `$C run -- dispatch verify/fixture#1 --json` (Failed at worktree),
  `$C seed dispatch 10 pr > "$E/seed10.json"`, `$C run -- verdict verify/fixture#10 pass --sha "$(jq -r .head "$E/seed10.json")" --json`,
  `$C seed dispatch 12 asking`, `$C seed run faux-nico 12`, `$C seed run quality-scan`, `$C seed run morning`
  and `$C drift pause`. Run `$C page --evidence "$E/07-needs" --expect "Paused"`.
  No `region "Needs you"`; `main` starts with `list "Needs you"`, three `status` items in order, each with `button "Dismiss"`:
  `Blocked quality-scan-fixture <time>`, `Blocked morning <time>` and `Paused GitHub until <time>`, drawn
  over the page's bottom right corner in the screenshot, yellow. Then `tablist "Projects"`. The map's node buttons
  `#1, Verify: a Ready issue, Failed, needs you`, `#10, Verify: seeded Dispatch 10, Verified, PR 110 draft, needs you` and
  `#12, Verify: seeded Dispatch 12, Implementing, needs you` end `needs you` (#12 from its recorded Asking and its blocked faux-nico: herdr is a stub); no other does.
- **Dismiss.** Run `$C page --evidence "$E/08-dismiss" --expect "Paused" --click "button=Dismiss"`: `list "Needs you"` has two `status`
  items left, `Blocked morning` and `Paused GitHub`; the one dismissed is back on the next page.
- **Open a flagged node.** Run `$C page --evidence "$E/09-open" --expect "Paused" --click "button~#1, Verify: a Ready issue"`.
  `.requests.txt` has `GET /api/node/verify%2Ffixture%231 -> 200`; the node is `[pressed]` and a `region "Verify: a Ready issue #1"`
  panel replaces the Repo's panel. Then `--click "button~#12, Verify: seeded Dispatch 12"` (`10-open-asking`):
  `GET /api/node/verify%2Ffixture%2312 -> 200`, its panel's first section `region "Asking"`.
- **Phone.** Run `$C page --evidence "$E/11-phone" --width 390 --expect "Paused"`: the toasts across the foot of the
  screen, `page 390px wide in a 390px window`.
- **Proof.** Copy `$OUTSIDE_LOG` to `$E/outside.log`. Each `.console.txt` is empty.

## Gotchas

- Times on the page are the browser's local clock (`HH:MM`); match them with `~` or ignore them.
- The page first shows `Reading nico-agent…`; `$C page` waits for it to go before any step.
- A node's flag reads Asking from the Dispatch (or herdr saying `blocked`); with herdr stubbed only a
  seeded `asking` shows. Likewise a blocked Run shows only as `seed run` records it.
- A Verified flag needs a pass Verdict on the PR's current head: after `drift push` it drops to
  `PR draft` and loses it.
- The toasts sit over the page's corner, where a Repo's panel ends: `--click` what is under them
  only after `--click "button=Dismiss"` once per toast, or they time it out.
- `seed issues` caches only `verify/fixture`; `verify/second` stays `Source not read yet`.
- While the page is open with a live Dispatch, serve's event stream asks herdr every 10 seconds:
  expect `herdr agent list` lines in `$OUTSIDE_LOG`.
- Back on a map from the Libraries tab or the Wiki view, `.console.txt` holds `IndexSizeError: Failed to execute
  'getStartPositionOfChar'` lines from the map's title fitting: they come from before #365 (the same on db3fc21) and are
  not this feature's; any other line is.
