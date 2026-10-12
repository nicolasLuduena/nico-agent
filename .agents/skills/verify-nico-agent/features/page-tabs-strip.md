# The page's tabs and strip

serve's page opens on the needs-you strip, across Repos: every Implementer Asking (with its
question), every Failed Dispatch, every PR whose review was given up on or stopped, every Verified PR to merge, and a paused GitHub; "Nothing needs
you" when there is none. Under it, one tab per Repo shows that Repo's map, read times, switches and
Dispatch form; arrow keys move between tabs, and at phone width the tabs become one select named
Repo. A strip row opens its Repo's tab with the node's panel.

## Sub-features

- `page-empty` with no Repo: the strip says `Nothing needs you` and the page says `No Repo yet. Add one with nico-agent repo add <owner/name> --path <clone>.`
- `tabs-one-per-repo` `tablist "Repos"` has a `tab` per Repo in config order, the first selected, its `tabpanel` named after it.
- `tabs-click` clicking a tab selects it and shows that Repo's map, read times and controls.
- `tabs-keys` ArrowRight, ArrowLeft, Home and End move the selection (wrapping) and focus.
- `tabs-phone` under 720px the tablist is replaced by `combobox "Repo"` with an option per Repo.
- `strip-asking` an Asking Implementer is a row `Asking <repo> #<n> <question> <since>`.
- `strip-failed` a Failed Dispatch is a row `Failed <repo> #<n> <title> <updated>`.
- `strip-review` a review given up on or stopped is a row `Review <repo> #<n> <where it stands>: review it by hand with nico-agent verdict ...` (see review.md).
- `strip-verified` a Verified PR is a row `Verified <repo> #<n> <title> <verdict time>`.
- `strip-paused` a paused GitHub is a row `Paused GitHub until <time>`, with nothing to open.
- `strip-open` clicking a row selects its Repo's tab and opens that node's panel (`GET /api/node/<issue>`).

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/` (the run's `$URL`) in a browser, on the desk or at phone width.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/page-tabs-strip`.

- **Empty.** Run `$C page --evidence "$E/01-empty" --expect "No Repo yet"`. The ARIA snapshot has
  `region "Needs you"` with `paragraph: Nothing needs you` and no `tablist`.
- **Two Repos.** Run `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, `$C run -- repo add verify/second --path "$SECOND_CLONE" --json`
  and `$C seed issues`, then `$C page --evidence "$E/02-tabs"`. `tablist "Repos"` has `tab
  "verify/fixture" [selected]` and `tab "verify/second"`; `tabpanel "verify/fixture"` holds `region
  "Map of verify/fixture"` with node buttons `#1, Verify: a Ready issue, Ready`, `#3, Verify: waits
  on #1, Waiting`, `#4, Verify: assigned to someone else, Waiting`, `#5, Verify: a Research issue,
  Ready`, `#6, Verify: stacks on #9 PR, Stackable` and `#9, Verify: a Blocker in review, Blocker`
  (no `#2`: not labelled); the paragraph reads `Source read <time> · PRs not checked yet`.
- **Click a tab.** Run `$C page --evidence "$E/03-click" --click "tab=verify/second" --expect "Source not read yet"`.
  `tab "verify/second" [selected]`; `tabpanel "verify/second"` with `Nothing on this map`;
  `.requests.txt` has `GET /api/map/verify/second -> 200`.
- **Keys.** Run `$C page --evidence "$E/04-keys" --click "tab=verify/fixture" --press ArrowRight`:
  `tab "verify/second" [selected]`. Then `--click "tab=verify/second" --press ArrowRight`
  (`05-keys-wrap`): `tab "verify/fixture" [selected]`.
- **Phone.** Run `$C page --evidence "$E/06-phone" --width 390`. No `tablist`; `combobox "Repo"`
  with `option "verify/fixture" [selected]` and `option "verify/second"`; the screenshot is one column.
- **Fill the strip.** Run `$C run -- dispatch verify/fixture#1 --json` (Failed at worktree),
  `$C seed dispatch 10 pr > "$E/seed10.json"`, `$C run -- verdict verify/fixture#10 pass --sha "$(jq -r .head "$E/seed10.json")" --json`,
  `$C seed dispatch 12 asking` and `$C drift pause`. Run `$C page --evidence "$E/07-strip"`.
  `region "Needs you"` lists, in order: `button "Asking verify/fixture #12 Should the fixture keep its README? (seeded by verify-nico-agent) <time>"`,
  `button "Failed verify/fixture #1 Verify: a Ready issue <time>"`, `button "Verified verify/fixture #10 Verify: seeded Dispatch 10 <time>"`,
  and `listitem: Paused GitHub until <time>`. The map's nodes `#1`, `#10` end `needs you`.
- **Open a row.** Run `$C page --evidence "$E/08-open" --click "button~Failed verify/fixture #1"`.
  `.requests.txt` has `GET /api/node/verify%2Ffixture%231 -> 200`; the map's `#1` node is
  `[pressed]` and a `region "Verify: a Ready issue #1"` panel replaces the switches.
- **Proof.** Copy `$OUTSIDE_LOG` to `$E/outside.log`. Each `.console.txt` is empty.

## Gotchas

- Times on the page are the browser's local clock (`HH:MM`); match them with `~` or ignore them.
- The page first shows `Reading nico-agent…`; `$C page` waits for it to go before any step.
- The strip reads Asking from the Dispatch (or herdr saying `blocked`); with herdr stubbed only a
  seeded `asking` shows.
- A Verified row needs a pass Verdict on the PR's current head: after `drift push` it drops to
  `PR draft` and leaves the strip.
- `seed issues` caches only `verify/fixture`; `verify/second` stays `Source not read yet`.
- While the page is open with a live Dispatch, serve's event stream asks herdr every 10 seconds:
  expect `herdr agent list` lines in `$OUTSIDE_LOG`.
