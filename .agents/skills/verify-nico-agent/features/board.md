# The Board's workspace

The page is one workspace in Light and Dark: the Projects in a rail on the left (a bar and a
`Project` select on a phone), the Project's header with its read times, Refresh and Repos, the Map and
Roadmap tabs, and the work under them. Each map node is a card that leads with the issue's title
(two lines, the whole of it in its name and on hover), then its number and Repo, then its Stage in words
beside its icon and its PR, and, while it has one, its agent's state in words (`Asking · claude`,
`Working · codex`) and its line. Opening a node puts the inspector beside the map (a bottom sheet on a
phone) with the next useful action first: the Asking pane and its answers, a Failure, then the PR (a
primary `Open PR <n>` once Verified, merged on GitHub), the review and Verdict, Evidence, who it is
assigned to, and its restarts folded (open on a Failed Dispatch). The Repo and Project controls stay
behind `Repos`, secondary to the work. Changing a view or opening Repos asks the Source nothing.

## Sub-features

- `board-rail` the rail lists each Project as a link, the shown one carrying `aria-current="page"` (the ARIA snapshot does not print it: the header's `heading "<name>"` names the shown Project), with the theme switch and, once a tick read it, the rate-limit gauge at its foot; the gauge's panel opens over it.
- `board-node` a node's card shows its title first, then `#<n> · <repo>` (and `· research`), its Stage word beside its icon, its PR, `Needs you` on what needs you, and a row for its agent's state and its line; its accessible name is `#<n>[ <repo>], <title>, <Stage>, …` as before.
- `board-edges` a Blocker is a solid line, a Stacked dispatch a dashed accent line, each with an arrow, named in the legend at the map's foot (`Blocks`, `Stacked on`) while the map has one.
- `board-zoom` `button "Zoom out"`, `"Zoom in"` and `"Fit"` zoom about the field's middle and fit it again; a drag pans, Ctrl and the wheel or a pinch zoom; the zoom group shows the scale (`N%`); on a phone in a bar under the field, off the nodes.
- `board-inspector` a node opens `region "<title>"` beside the map, its `#<n>` link and `button "Close"` over the title, then the Stage, the agent's state and `Needs you`; focus moves to the title, and Close or Escape returns it to the node.
- `board-verified` a Verified node's inspector has `link "Open PR <n>"` as the primary button and `Review and merge it on GitHub.`, then the Verdict and `link "Open Evidence"`.
- `board-failed` a Failed node's inspector has `heading "Failure"` before the PR, and its `Restarts` open.
- `board-asking` an Asking node's inspector opens on `region "Asking"`, its keys and `Answer in words` (answer.md).
- `board-repos` `button "Repos"` (`[expanded]`) shows `region "Repos"` in the inspector's place: the Project's defaults, each Repo's panel and `region "Add a Repo"`; opening a node puts the inspector there, closing it brings Repos back; on the Roadmap `Repos` opens the Map with the column.
- `board-notices` the notices stack scrolls inside at half the window; `button "Hide notices"` folds it to `Show <n> notices` for the page load.
- `board-stale` while serve or a map read fails, the cached map stays with `Showing the last map read. <why>` over it; with nothing cached, `Could not read the map.` and why.
- `board-empty` with no Repo, `region "No Repo yet"` says how to add one and holds `region "Add a Repo"`.

## How to get to it (user POV)

- Open `http://127.0.0.1:<port>/`, on the desk (1440×900) or a phone (390×844); pick a Project in the rail or the select.
- Click a node, then Close it or press Escape; press `Repos`; press the zoom buttons or Fit.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`; `E=.evidence/<issue>/board`; `mkdir -p "$E"`.
- **Empty.** Run `$C page --evidence "$E/01-empty-light-1440" --width 1440 --expect "No Repo yet"`: `region "No Repo yet"` with
  `region "Add a Repo"`, no `navigation "Projects"`.
- Then `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --project verify --json`, the same for
  `verify/second` with `"$SECOND_CLONE"`; `$C seed issues chain`; `$C seed issues second`; `$C seed dispatch 7 asking`,
  `10 pr`, `11 pr` and `12 stacked` (each `> "$E/seed<n>.json"`); a pass Verdict on #10's head and a fail with
  findings on #11's (verdict-bucket.md, rulings.md); `$C seed rate-limit` with `gh.near.json` and `ghbot.near.json`
  (rate-gauge.md); `$C run --evidence "$E/00-refresh" -- refresh --json`. `$C state > "$E/state.before.txt"`.

- **Map, light and dark.** Run `$C page --evidence "$E/02-map-light-1440" --width 1440 --expect "seeded Dispatch 10"`
  and the same `--scheme dark` (`03-map-dark-1440`): `navigation "Projects"` has
  `link "verify"`, and `heading "verify"` (the shown Project); `heading "verify"`, `2 Repos · Source read <time> · PRs not checked yet`; node buttons
  `#10 fixture, Verify: seeded Dispatch 10, Verified, PR 110 draft, needs you`, `#11 fixture, …, Failed, PR 111 draft, needs you`,
  `#7 fixture, …, Implementing, agent asking on claude, needs you`, `#12 fixture, …, PR draft, PR 112 draft, review retrying`; the
  screenshot shows titles first, the Stage words in their hues, `Needs you` badges, the #9 to #12 line dashed, the legend.
- **Inspectors.** Run `$C page --evidence "$E/04-inspector-Verified-light-1440" --width 1440 --click "button~#10 fixture, Verify: seeded" --expect "Pull request"`:
  `region "Verify: seeded Dispatch 10"` with `link "#10 fixture"`, `button "Close"`, `strong: Verified`, `Needs you`,
  `link "Open PR 110 (draft)"`, `Review and merge it on GitHub.`, `heading "Review"` then `pass <sha7> <time>`,
  `link "Open Evidence"`; `.view.txt` `focus on h2 "Verify: seeded Dispatch 10"`. The same for `#7` `--scheme dark`
  (`04-inspector-Asking-dark-1440`): `Agent asking`, then `region "Asking"` first, its keys and `textbox "Answer in words"`;
  and `#11` (`04-inspector-Failed-light-1440`): `heading "Failure"` before `heading "Pull request"`, `Restarts` open.
  `.requests.txt` has only `GET`s.
- **Close and Escape.** Run `$C page --evidence "$E/11-escape" --width 1440 --click "button~#10 fixture, Verify: seeded" --press Escape`:
  no inspector, `.view.txt` `focus on button "Verify: seeded Dispatch 10 …"`.
- **Repos.** Run `$C page --evidence "$E/07-repos-light-1440" --width 1440 --click "button=Repos" --expect "Defaults for its Repos"`:
  `button "Repos" [expanded]`, `region "Repos"` with `region "verify"`, `region "verify/fixture"`, `region "verify/second"`
  and `region "Add a Repo"`; `.requests.txt` has no write and no call that reads the Source.
- **Roadmap.** Run `$C page --evidence "$E/08-roadmap-dark-1440" --width 1440 --scheme dark --click "link=Roadmap" --click "button~#30 fixture" --expect "Description"`:
  `.view.txt` `at /#verify/roadmap`, `region "Verify: needs triage"` with Labels, Assigned, Description, Blocked by and Blocks.
- **Gauge.** Run `$C page --evidence "$E/09-gauge-light-1440" --width 1440 --click "button~GitHub rate limits" --expect "Bot · ghbot"`
  and `--width 390 --scheme dark` (`10-gauge-dark-390`): the panel over the rail's foot, between the gutters on a phone.
- **Phone.** Run `$C page --evidence "$E/05-phone-light-390" --width 390` and
  `$C page --evidence "$E/06-phone-sheet-dark-390" --width 390 --scheme dark --click "button~#7 fixture, Verify: seeded" --expect "Answer in words"`:
  `combobox "Project"`, no `navigation "Projects"`; the sheet with `button "Close"` and the keys, each 44px; `.view.txt` `page 390px wide in a 390px window`.
- **Read only.** `$C state > "$E/state.reads.txt"`; `diff "$E/state.before.txt" "$E/state.reads.txt" > "$E/state.reads.diff"`:
  outside calls only; no view, Repos press, inspector, Roadmap or gauge wrote a file.
- **Switch Projects.** `$C http --evidence "$E/15-leave" PATCH /api/repo/verify/second '{"project":null}'`, then
  `$C page --evidence "$E/16-switch-back" --width 1440 --click "link=verify/second" --expect "Verify: waits on fixture #1" --history back --expect "seeded Dispatch 10"`:
  `navigation "Projects"` has `link "verify"` and `link "verify/second"`; `.view.txt` `at /` after back, `link "verify"`, and `heading "verify"` (the shown Project).
  `--width 390 --select "Project=verify/second"` (`17-switch-phone`) does the same from the select.
- **Zoom.** Run `$C page --evidence "$E/12-zoom" --width 1440 --click "button=Zoom in" --click "button=Zoom in" --click "button=Fit"`: the screenshot fitted again.
- **Unreachable.** `$C tunnel start`, then `$C page --tunnel --evidence "$E/13-unreachable" --width 1440 --mode 502 --expect "Lost nico-agent serve"`:
  the errata banner `Lost nico-agent serve; reconnecting. Showing what was last read.` over the header, the map and its nodes still
  shown, with `Showing the last map read.` over it. `--mode pass` after.
- **Paused.** `$C drift pause`, `$C run -- refresh --json`, then `$C page --evidence "$E/14-paused-light-1440" --width 1440 --expect "Paused"`:
  the notice `Paused GitHub until <time>` and the gauge's `Paused`.
- **Proof.** `$C state > "$E/state.after.txt"`, its diff from `state.before.txt` in `$E/state.diff`: outside calls, and the
  recipe's own writes: `config.toml`'s verify/second without `project` (`15-leave`) and its `bucket.url` (`tunnel start`),
  and the pause and `dispatches.json` from `14`'s refresh; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- The two Repos' failing Readiness checks are two `Check` notices in the band between the views and the map; the map takes the height left under them, so nothing is covered.
- A node's name starts with its number, and in a Project of two Repos its Repo: click `button~#10 fixture, Verify`, as
  `button~#7, ` would match `verify/outside#7, …` too.
- With herdr stubbed no agent is seen working; the Asking comes from the tick's record, so the agent row reads `Asking`.
- `seed issues chain` has many unlinked issues: the map packs them in a grid across the field, beside the chains, and never fits below 87% (titles stay legible); what does not fit pans inside the field, the page itself not scrolling. The zoom group shows the scale (`N%`).
