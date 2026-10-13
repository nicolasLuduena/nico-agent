# A tab and a map per Project

The page has one tab per Project; a Repo that names none is a Project of its own, named by its
slug, and its tab is as it was before Projects. A Project's tab is its map, the union of its
Repos' issues with Blocker edges across them, then the Project's defaults, each tagged `default`
until the Project sets it and editable there, then one panel per Repo with its Readiness, Dispatch form,
room, switches, settings, Install and Remove. A default set on the tab reaches every Repo that does not set
it. With more than one Repo, each node names its Repo after its number; a Blocker outside the
Project stays a node with no Stage. `GET /api/map/<project>` answers the map, the name
percent-decoded.

## Sub-features

- `project-tabs-own` a Repo with no Project has its own tab and map, named by its slug; a Blocker in another Repo is a node by its whole key with no Stage.
- `project-tabs-join` typing a Project in a Repo's `combobox "Project"` moves the page to that Project's tab; `PATCH /api/repo/<slug> {"project": ...}` does the same from outside.
- `project-tabs-map-api` `GET /api/map/<project>` answers every Repo's nodes, each with `repo`, a Blocker edge across Repos, and an outside Blocker with `repo` and `stage` null; a Repo inside a Project has no map of its own (404).
- `project-tabs-map-page` `region "Map of <project>"` names each node `#<n> <repo name>, <title>, <Stage>`, an outside Blocker by its whole key.
- `project-tabs-defaults` `region "<project>"`, headed `Defaults for its Repos, where they set none`, holds the Project's `spinbutton "Room"`, switches and settings, each `default` until set, then `button "Use the default <Setting>"`; a change sends `PATCH /api/project/<name>`.
- `project-tabs-reach` a default set on the tab shows in each Repo's panel tagged `project`, except where the Repo sets its own, which offers `button "Use the Project's <Setting>"`.
- `project-tabs-phone` under 720px the tabs are `combobox "Project"`.
- `project-tabs-strip` a strip row of a Repo in a Project opens the Project's tab with the node's panel, titled `#<n> <repo name>`.

## How to get to it (user POV)

- Put Repos in a Project: the page's `Project` field in a Repo's Settings, `Add a Repo` with its
  Project, `nico-agent repo add --project`, `PATCH /api/repo/<slug>`, or `project = "<name>"` in
  `config.toml` by hand.
- Open serve's page and pick the Project's tab (or the `Project` select on a phone).
- `GET /api/map/<project>` with curl, the name percent-encoded.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, the same for verify/second
  with `$SECOND_CLONE`; `$C seed issues` and `$C seed issues second`.
- `E=.evidence/<issue>/project-tabs`; `$C state > "$E/state.before.txt"`.

- **Own Projects.** Run `$C page --evidence "$E/01-own-projects" --click "tab=verify/second"`.
  `tablist "Projects"` has `tab "verify/fixture"` and `tab "verify/second" [selected]`; `region
  "Map of verify/second"` has `#1, Verify: waits on fixture #1, Waiting`, `#2, Verify: waits on an
  outside issue, Waiting`, `verify/fixture#1, Verify: a Ready issue, Blocker` and
  `verify/outside#7, Verify: an outside Blocker, Blocker`; one `region "verify/second"` panel, no
  Project's defaults.
- **Join on the page.** Run `$C page --evidence "$E/02-join-on-page" --click "tab=verify/fixture" --click "combobox=Project" --type verify --press Tab --expect "Defaults for its Repos"`.
  `tab "verify" [selected]` beside `tab "verify/second"`; `region "verify"` above `region
  "verify/fixture"`; `.requests.txt` has `PATCH /api/repo/verify/fixture {"project":"verify"} ->
  200`, then `GET /api/status` and `GET /api/map/verify`, and no second `GET
  /api/map/verify%2Ffixture` (that Project is gone). `.console.txt` is empty.
- **Join through the route.** Run `$C http --evidence "$E/03-join-second" PATCH /api/repo/verify/second '{"project":"verify"}'`: HTTP `200`.
- **The map.** Run `$C http --evidence "$E/04-map-api" GET /api/map/verify`: HTTP `200`; nodes
  `verify/fixture#1` (`repo` `verify/fixture`, `Ready`), `#3`, `#4`, `#5`, `#6`, `#9` of
  verify/fixture, `verify/outside#7` (`repo` null, `stage` null), and `verify/second#1` and `#2`
  (`repo` `verify/second`, `Waiting`); `edges` include `{"from":"verify/fixture#1","kind":"blocker","to":"verify/second#1"}`
  and `{"from":"verify/outside#7","kind":"blocker","to":"verify/second#2"}`. Run `$C http --evidence "$E/05-old-map" GET /api/map/verify%2Fsecond`:
  HTTP `404`, `verify/second is not a Project`, help `Ask for a Project /api/status lists`.
- **A Repo's own room.** Run `$C http --evidence "$E/06-second-own-room" PATCH /api/repo/verify/second '{"room":2}'`: `room` `{"from":"repo","value":2}`.
- **The tab.** Run `$C page --evidence "$E/07-project-tab" --expect "Defaults for its Repos"`.
  `tab "verify" [selected]` alone; `region "Map of verify"` names nodes `#1 fixture, Verify: a Ready
  issue, Ready`, `#1 second, Verify: waits on fixture #1, Waiting` and `verify/outside#7, Verify:
  an outside Blocker, Blocker`; the screenshot draws the edge from `#1 fixture` to `#1 second`.
  `region "verify"` has `text: Room default`, `spinbutton "Room": "3"`; `region "verify/fixture"`
  `text: Room default`, `"3"`; `region "verify/second"` `button "Use the default Room"`, `"2"`.
- **Edit the Project's defaults.** Run `$C page --evidence "$E/08-edit-defaults" --click "spinbutton=Room" --press Control+a --type 5 --press Tab --click "region=Switches" --click "switch=Review" --within "region=verify/fixture" --click "region=Switches" --within "region=verify/second" --click "region=Switches"`.
  `.requests.txt` has `PATCH /api/project/verify {"room":5} -> 200` and `PATCH /api/project/verify
  {"switches":{"review":false}} -> 200`, each followed by `GET /api/status`. `region "verify"` has
  `button "Use the default Room"`, `"5"`, and `button "Use the default Review"` beside an unchecked
  `switch "Review"`; `region "verify/fixture"` has `text: Room project`, `"5"`, `text: Review
  project` and `switch "Review"` unchecked; `region "verify/second"` keeps `button "Use the
  Project's Room"`, `"2"`, and has `text: Review project`, unchecked.
- **Phone.** Run `$C page --evidence "$E/09-phone" --width 390`: no `tablist`; `combobox "Project"`
  with `option "verify" [selected]`.
- **From the strip.** Run `$C seed dispatch 12 asking`, then `$C page --evidence "$E/10-strip-open" --click "button~Asking verify/fixture #12"`.
  `tab "verify" [selected]`; the node `#12 fixture, Verify: seeded Dispatch 12, Implementing` is
  `[pressed]`; `region "Verify: seeded Dispatch 12 #12 fixture"`; `.requests.txt` has `GET
  /api/node/verify%2Ffixture%2312 -> 200`.
- **Status.** Run `$C run --evidence "$E/11-status" -- status --json`: `projects[0]` is `verify`
  with `defaults` `{"room":5,"switches":{"review":false}}` and `room` `{"from":"project","value":5}`;
  verify/fixture's `room` `{"from":"project","value":5}`, verify/second's `{"from":"repo","value":2}`,
  both `switches.review` `{"from":"project","value":false}`.
- **Proof.** `$C state > "$E/state.after.txt"`; the diff shows `config.toml` gaining `project =
  "verify"` under both Repos, `room = 2` under verify/second and `[projects.verify]` with `room =
  5` and `switches = { review = false }`, and the seeded Dispatch. Copy `$OUTSIDE_LOG` to
  `$E/outside.log`: only `herdr agent list` (the open page with a live Dispatch). Every
  `.console.txt` is empty.

## Gotchas

- `seed issues second` caches verify/second's issues; without it verify/second's tab and map are
  empty and `Source not read yet`.
- A tab is a Project with a Repo: a `[projects.<name>]` no Repo names has none.
- The Project's defaults come first on its tab and share their control names with each Repo's: a
  bare `--click` reaches the Project's. Use `--within "region=<slug>"` for a Repo's.
- The switches are folded to `<n> of 8 on`, in each panel: `--click "region=Switches"` opens the
  first (the Project's); a Repo's needs `--within "region=<slug>"` before it.
- The Room input keeps its value as typed: select it (`Control+a`) before typing, and leave it
  (`Tab`) to send it.
- The map field is as tall as the column beside it; with several Repo panels the `Fit` button is
  far down the page.
