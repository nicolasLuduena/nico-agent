# The Projects rail, the Project chooser and what needs you

serve's page shows what needs you where it is. The node of every Implementer Asking, every faux-nico
herdr reports blocked, every Failed Dispatch, every PR whose review was given up on or stopped and
every Verified PR to merge carries a `Needs you` badge and its name ends `needs you`; its inspector has
the rest. What has no node is a notice in a band between the views and the work, in the page's flow,
dismissible for the page load, the band foldable with `Hide notices`: an agent of the loop's own that herdr reports
blocked (a quality-scan, the morning agent), a paused GitHub, a Repo's failing Readiness checks (one notice per Repo, checks.md) and a
failed Install (install.md). On the desk a rail on the left lists the Projects as links (a Repo naming
none is its own, named by its slug), the current one marked; on a phone the rail is a bar at the top and
the Project is chosen in a select named Project in the header. The header names the Project, its Repos
and its read times, with Refresh and Repos at its right, and the views (Map, Roadmap) as tabs under it.
The URL's hash follows the pick, so back and forward move between Projects. There is no Morning summary.

## Sub-features

- `page-empty` with no Repo: `region "No Repo yet"` says how to add one, on the page or with `nico-agent repo add <owner/name> --path <clone>`, and holds `region "Add a Repo"`; no `navigation "Projects"`, no `combobox "Project"` and nothing needing you.
- `rail-one-per-project` `navigation "Projects"` has a `link` per Project with a Repo, by name, the shown one carrying `aria-current="page"` (the ARIA snapshot does not print it: the header's `heading "<name>"` names the shown Project) (the first, with no hash); `heading` the Project's name, the paragraph `<n> Repos · Source read <time> · PRs checked <time>`, `button "Refresh"` and `button "Repos"`, then `navigation "View"` (`link "Map"`, `link "Roadmap"`). No `tablist` and no `region "Morning summary"`.
- `rail-pick` following a Project's link shows its map and read times, and the hash becomes `#<project>`, escaped, the view kept.
- `rail-back` the browser's back button returns to the Project picked before.
- `select-phone` under 720px the rail is a bar (the logo, the gauge, the theme switch) and `combobox "Project"`, an `option` per Project, takes its own full-width line in the header; the read times, Refresh and Repos, then the views as two tabs, under it.
- `no-morning` a `morning.md` in the config dir is in `GET /api/status`'s `morning_summary`, and nowhere on the page.
- `needs-no-band` nothing of what needs you is above the header: no `region "Needs you"`, with or without items; `list "Needs you"` comes after `navigation "View"`.
- `needs-flag` the node of an Asking Implementer (herdr saying `blocked`, or the Asking a tick recorded), a Failed Dispatch, a review given up on or stopped and a Verified PR carries `Needs you` and its name ends `needs you`; its inspector holds the question (answer.md), the failure (close.md, rulings.md), the review (review.md) or the Verdict.
- `needs-toast-blocked` a blocked Run with no node is a `status` notice `Blocked <agent> <since>` in `list "Needs you"`; a faux-nico's flags its Dispatch's node instead.
- `needs-toast-paused` a paused GitHub is a notice `Paused GitHub until <time>`.
- `needs-toast-dismiss` each notice's `button "Dismiss <kind> <repo or name>"` (`Dismiss Blocked verify/fixture` for a quality-scan, `Dismiss Blocked morning`, `Dismiss Paused GitHub`) removes it for this page load; a reload shows it again. `button "Hide notices"` folds the band to `button "Show <n> notices"` for the page load.
- `needs-open` clicking a flagged node opens its inspector (`GET /api/node/<issue>`); an Asking one's with `region "Asking"` first (see answer.md).

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/` (the run's `$URL`) in a browser, on the desk or at phone width.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/page-tabs-strip`.

- **Empty.** Run `$C page --evidence "$E/01-empty" --expect "No Repo yet"`. The ARIA snapshot has
  no `list "Needs you"`, no `navigation "Projects"` and no `combobox "Project"`: `main` holds `region "No Repo yet"`
  with its paragraph and `region "Add a Repo"`.
- **Two Repos.** Run `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`
  and `$C seed issues`, then `$C page --evidence "$E/02-select"`. `navigation "Projects"` has `link "verify/fixture"`, and `heading "verify/fixture"` (the shown Project)
  and `link "verify/second"`; `main` has `heading "verify/fixture"`, the paragraph `1 Repo · Source read <time> · PRs not checked yet`,
  `button "Refresh"`, `button "Repos"`, then `navigation "View"` with `link "Map"` (`#verify%2Ffixture`) and `link "Roadmap"`;
  no `tablist`. `region "Map of verify/fixture"` has node buttons `#1, Verify: a Ready issue, Ready`, `#3, Verify: waits
  on #1, Waiting, waits on verify/fixture#1 to close`, `#4, Verify: assigned to someone else,
  Waiting, assigned to @someone-else`, `#5, Verify: a Research issue, Ready`, `#6, Verify: stacks on #9 PR, Stackable` and `#9, Verify: a Blocker in review, Blocker`
  (no `#2`: not labelled). The screenshot has the rail on the left, the Project's name over its read times, Refresh and
  Repos at the right, and the Map and Roadmap tabs under them.
- **Pick a Project.** Run `$C page --evidence "$E/03-pick" --click "link=verify/second" --expect "Source not read yet"`.
  `link "verify/second"`, and `heading "verify/second"` (the shown Project); `Nothing on this map`; `.view.txt` `at /#verify%2Fsecond`;
  `.requests.txt` has `GET /api/map/verify%2Fsecond -> 200`.
- **Back.** Run `$C page --evidence "$E/04-back" --click "link=verify/second" --expect "Source not read yet" --history back --expect "Source read"`:
  `link "verify/fixture"`, and `heading "verify/fixture"` (the shown Project), its map again, `.view.txt` `at /`.
- **Phone.** Run `$C page --evidence "$E/06-phone" --width 390`. `combobox "Project"` with `option "verify/fixture" [selected]`;
  no `navigation "Projects"`; the screenshot is one column under the top bar, the select its own full-width line, the read
  times, Refresh and Repos, then the Map and Roadmap tabs under it.
- **Everything that needs you.** Run `$C run -- dispatch verify/fixture#1 --json` (Failed at worktree),
  `$C seed dispatch 10 pr > "$E/seed10.json"`, `$C run -- verdict verify/fixture#10 pass --sha "$(jq -r .head "$E/seed10.json")" --json`,
  `$C seed dispatch 12 asking`, `$C seed run faux-nico 12`, `$C seed run quality-scan`, `$C seed run morning`
  and `$C drift pause`. Run `$C page --evidence "$E/07-needs" --expect "Paused"`.
  No `region "Needs you"`; after the Project's `heading` and `navigation "View"`, `list "Needs you"` holds three `status`
  items in order, each with its `button "Dismiss <kind> <repo or name>"`: `Blocked quality-scan-fixture <time>`, `Blocked morning <time>`
  and `Paused GitHub until <time>`, drawn in the band above the map in the screenshot, each a white card with a hairline
  frame, between the `Needs you` badge and `button "Hide notices"`. The map's node buttons
  `#1, Verify: a Ready issue, Failed, needs you`, `#10, Verify: seeded Dispatch 10, Verified, PR 110 draft, needs you` and
  `#12, Verify: seeded Dispatch 12, Implementing, agent asking on claude, needs you` end `needs you` (#12 from its recorded Asking and its blocked faux-nico: herdr is a stub); no other does.
- **Dismiss.** Run `$C page --evidence "$E/08-dismiss" --expect "Paused" --click "button~Dismiss"`: `list "Needs you"` has two `status`
  items left, `Blocked morning` and `Paused GitHub`; the one dismissed is back on the next page.
- **Open a flagged node.** Run `$C page --evidence "$E/09-open" --expect "Paused" --click "button~#1, Verify: a Ready issue"`.
  `.requests.txt` has `GET /api/node/verify%2Ffixture%231 -> 200`; the node is `[pressed]` and a `region "Verify: a Ready issue"`
  inspector opens beside the map. Then `--click "button~#12, Verify: seeded Dispatch 12"` (`10-open-asking`):
  `GET /api/node/verify%2Ffixture%2312 -> 200`, its inspector's first section `region "Asking"`.
- **Phone.** Run `$C page --evidence "$E/11-phone" --width 390 --expect "Paused"`: the notices in the band above the map,
  full width, `page 390px wide in a 390px window`.
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
- The notices sit in the page's flow, between the views and the work: they cover nothing, and the band scrolls
  inside past a third of the window's height.
- `seed issues` caches only `verify/fixture`; `verify/second` stays `Source not read yet`.
- While the page is open with a live Dispatch, serve's event stream asks herdr every 10 seconds:
  expect `herdr agent list` lines in `$OUTSIDE_LOG`.
