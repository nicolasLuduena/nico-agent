# A map per Project

The page's `Project` select has an option per Project; a Repo that names none is a Project of its
own, named by its slug, and its page is as it was before Projects. A Project shows its map, the union of its
Repos' issues with Blocker edges across them, then the Project's defaults (Room, Switches and
Settings, each folded to a line), each chipped `default` until the Project sets it and editable
there, then one panel per Repo with its Dispatch form, then Readiness, Room, Switches, Settings,
Libraries and Install, each folded to a line, and Remove. A default set on the Project reaches every Repo that does not set
it. With more than one Repo, each node names its Repo after its number; a Blocker outside the
Project stays a node with no Stage. A Waiting node says why under its Stage and in its panel: an
issue whose Blocker is in another Repo of its Project waits on it to close and, when that Repo
has an Install, on that Install to run after the close; it is never stacked on it. `GET
/api/map/<project>` answers the map, the name percent-decoded.

## Sub-features

- `project-tabs-own` a Repo with no Project has its own option and map, named by its slug; a Blocker in another Repo is a node by its whole key with no Stage.
- `project-tabs-join` typing a Project in a Repo's `combobox "Project"` moves the page to that Project; `PATCH /api/repo/<slug> {"project": ...}` does the same from outside.
- `project-tabs-map-api` `GET /api/map/<project>` answers every Repo's nodes, each with `repo`, a Blocker edge across Repos, and an outside Blocker with `repo` and `stage` null; a Repo inside a Project has no map of its own (404).
- `project-tabs-map-page` `region "Map of <project>"` names each node `#<n> <repo name>, <title>, <Stage>`, a Waiting one followed by why it waits, an outside Blocker by its whole key.
- `project-tabs-waits` a Waiting node's `waits` in `GET /api/map/<project>` and `status`'s `waiting[].reason` say `<key> waits on <blocker> to close`; its panel shows the sentence whole.
- `project-tabs-install-wait` a closed Blocker in another Repo of the Project with an `install` keeps its edge and the issue Waiting (`... waits on <blocker> to be installed in <repo>`, and `dispatch` refused with it) until `nico-agent install <repo>` runs after the close: then the issue is Ready and the edge gone. A Blocker's Repo with no `install`, or one in another Project, is resolved on close.
- `project-tabs-defaults` `region "<project>"`, headed `Defaults for its Repos, where they set none`, holds the Project's `spinbutton "Room"`, switches and settings, each chipped `default` until set, then `set here` with `button "Use the default <Setting>"`; a change sends `PATCH /api/project/<name>`.
- `project-tabs-reach` a default set on the Project shows in each Repo's panel chipped `from Project`, except where the Repo sets its own, which offers `button "Use the Project's <Setting>"`.
- `project-tabs-phone` under 720px `combobox "Project"` is the row's first line, full width.
- `project-tabs-asking` an Asking node of a Repo in a Project ends `needs you`, and its panel is titled `#<n> <repo name>`.

## How to get to it (user POV)

- Put Repos in a Project: the page's `Project` field in a Repo's Settings, `Add a Repo` with its
  Project, `nico-agent repo add --project`, `PATCH /api/repo/<slug>`, or `project = "<name>"` in
  `config.toml` by hand.
- Open serve's page and pick the Project in the `Project` select.
- `GET /api/map/<project>` with curl, the name percent-encoded.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`, the same for verify/second
  with `$SECOND_CLONE`; `$C seed issues` and `$C seed issues second`.
- `E=.evidence/<issue>/project-tabs`; `$C state > "$E/state.before.txt"`.

- **Own Projects.** Run `$C page --evidence "$E/01-own-projects" --select "Project=verify/second"`.
  `combobox "Project"` has `option "verify/fixture"` and `option "verify/second" [selected]`; `region
  "Map of verify/second"` has `#1, Verify: waits on fixture #1, Waiting, waits on verify/fixture#1 to
  close`, `#2, Verify: waits on an outside issue, Waiting, waits on verify/outside#7 to close`, `#3,
  Verify: waits on fixture #20 installed, Ready` (its Blocker closed, in another Project),
  `verify/fixture#1, Verify: a Ready issue, Blocker` and `verify/outside#7, Verify: an outside
  Blocker, Blocker`; one `region "verify/second"` panel, no Project's defaults.
- **Join on the page.** Run `$C page --evidence "$E/02-join-on-page" --within "region=verify/fixture" --click "region=Settings" --click "combobox=Project" --type verify --press Tab --expect "Defaults for its Repos"`.
  `option "verify" [selected]` beside `option "verify/second"`; `region "verify"` above `region
  "verify/fixture"`; `.requests.txt` has `PATCH /api/repo/verify/fixture {"project":"verify"} ->
  200`, then `GET /api/status` and `GET /api/map/verify`, and no second `GET
  /api/map/verify%2Ffixture` (that Project is gone). `.console.txt` is empty.
- **Join through the route.** Run `$C http --evidence "$E/03-join-second" PATCH /api/repo/verify/second '{"project":"verify"}'`: HTTP `200`.
- **The map.** Run `$C http --evidence "$E/04-map-api" GET /api/map/verify`: HTTP `200`; nodes
  `verify/fixture#1` (`repo` `verify/fixture`, `Ready`), `#3`, `#4`, `#5`, `#6`, `#9` of
  verify/fixture, `verify/outside#7` (`repo` null, `stage` null), `verify/second#1` and `#2`
  (`repo` `verify/second`, `Waiting`, `waits` `verify/second#1 waits on verify/fixture#1 to close`
  and `... on verify/outside#7 to close`) and `#3` (`Ready`: verify/fixture has no Install, so a
  closed Blocker there is resolved); `edges` include `{"from":"verify/fixture#1","kind":"blocker","to":"verify/second#1"}`
  and `{"from":"verify/outside#7","kind":"blocker","to":"verify/second#2"}`. Run `$C http --evidence "$E/05-old-map" GET /api/map/verify%2Fsecond`:
  HTTP `404`, `verify/second is not a Project`, help `Ask for a Project /api/status lists`.
- **A Repo's own room.** Run `$C http --evidence "$E/06-second-own-room" PATCH /api/repo/verify/second '{"room":2}'`: `room` `{"from":"repo","value":2}`.
- **The Project.** Run `$C page --evidence "$E/07-project-tab" --expect "Defaults for its Repos" --within "region=verify" --click "region=Room" --within "region=verify/fixture" --click "region=Room" --within "region=verify/second" --click "region=Room"`.
  `option "verify" [selected]`, the only Project, then `option "Libraries"`; `region "Map of verify"` names nodes `#1 fixture, Verify: a Ready
  issue, Ready`, `#1 second, Verify: waits on fixture #1, Waiting, waits on verify/fixture#1 to
  close` and `verify/outside#7, Verify: an outside Blocker, Blocker`; the screenshot draws the edge
  from `#1 fixture` to `#1 second`, and `waits on verify/fixture#1 to close` under `#1 second`'s
  Stage.
  `region "verify"` has `text: default` beside `spinbutton "Room": "3"`; `region "verify/fixture"`
  `text: default`, `"3"`; `region "verify/second"` `text: set here` with `button "Use the default Room"`, `"2"`.
- **Edit the Project's defaults.** Run `$C page --evidence "$E/08-edit-defaults" --click "region=Room" --click "spinbutton=Room" --press Control+a --type 5 --press Tab --click "region=Switches" --click "switch=Review" --within "region=verify/fixture" --click "region=Room" --click "region=Switches" --within "region=verify/second" --click "region=Room" --click "region=Switches"`.
  `.requests.txt` has `PATCH /api/project/verify {"room":5} -> 200` and `PATCH /api/project/verify
  {"switches":{"review":false}} -> 200`, each followed by `GET /api/status`. `region "verify"` has
  `button "Use the default Room"`, `"5"`, and `button "Use the default Review"` beside an unchecked
  `switch "Review"`; `region "verify/fixture"` has `text: from Project` beside `"5"`, and beside
  `switch "Review"` unchecked; `region "verify/second"` keeps `button "Use the
  Project's Room"`, `"2"`, and has `text: from Project` beside `switch "Review"`, unchecked.
- **Phone.** Run `$C page --evidence "$E/09-phone" --width 390`: `combobox "Project"`
  with `option "verify" [selected]`, its own full-width line in the screenshot.
- **An Asking node.** Run `$C seed dispatch 12 asking`, then `$C page --evidence "$E/10-asking-open" --click "button~#12 fixture, Verify: seeded Dispatch 12"`.
  `option "verify" [selected]`; the node `#12 fixture, Verify: seeded Dispatch 12, Implementing, needs you` is
  `[pressed]`; `region "Verify: seeded Dispatch 12 #12 fixture"`; `.requests.txt` has `GET
  /api/node/verify%2Ffixture%2312 -> 200`.
- **Status.** Run `$C run --evidence "$E/11-status" -- status --json`: `projects[0]` is `verify`
  with `defaults` `{"room":5,"switches":{"review":false}}` and `room` `{"from":"project","value":5}`;
  verify/fixture's `room` `{"from":"project","value":5}`, verify/second's `{"from":"repo","value":2}`,
  both `switches.review` `{"from":"project","value":false}`.
- **Waits on an Install.** Run `$C http --evidence "$E/12-set-install" PATCH /api/repo/verify/fixture '{"install":"echo installed"}'`:
  HTTP `200`. `$C run --evidence "$E/13-status-waits-install" -- status --json`: verify/second's
  `waiting` adds `verify/second#3 waits on verify/fixture#20 to be installed in verify/fixture`, its
  `ready` is `[]`. `$C http --evidence "$E/14-map-waits-install" GET /api/map/verify`: `verify/second#3`
  is `Waiting` with that `waits`; `verify/fixture#20` is a node (`repo` `verify/fixture`, `title`
  `Verify: a closed Blocker`, `stage` null); `edges` include `{"from":"verify/fixture#20","kind":"blocker","to":"verify/second#3"}`.
  `$C run --evidence "$E/15-dispatch-refused" -- dispatch verify/second#3 --json`: exit `1`,
  `verify/second#3 is not Ready`, `help[0]` the same sentence.
- **On the page.** Run `$C page --evidence "$E/16-page-waits-install" --click "button~#3 second" --expect "verify/second#3 waits on verify/fixture#20 to be installed in verify/fixture"`.
  The node is `#3 second, Verify: waits on fixture #20 installed, Waiting, waits on
  verify/fixture#20 to be installed in verify/fixture`, its panel `region "Verify: waits on fixture
  #20 installed #3 second"` has the sentence as a paragraph; the screenshot draws the edge from
  `#20 fixture` to `#3 second`.
- **Installed.** Run `$C run --evidence "$E/17-install" -- install verify/fixture --json`: exit `0`,
  `installed` `verify/fixture at <sha>`; `installs.json`'s `last.at` is after the Blocker's
  `closed_at` (the seed's read time). `$C run --evidence "$E/18-status-ready" -- status --json`:
  verify/second's `ready` is `verify/second#3`, `waiting` `#1` and `#2`. `$C http --evidence "$E/19-map-ready" GET /api/map/verify`:
  `verify/second#3` `Ready` with no `waits`, no edge to it, no `verify/fixture#20` node. `$C page --evidence "$E/20-page-ready"`:
  `#3 second, Verify: waits on fixture #20 installed, Ready`.
- **Proof.** `$C state > "$E/state.after.txt"`; the diff shows `config.toml` gaining `project =
  "verify"` under both Repos, `room = 2` under verify/second, `install = "echo installed"` under
  verify/fixture and `[projects.verify]` with `room = 5` and `switches = { review = false }`, the
  seeded Dispatch, and `installs.json`. Copy `$OUTSIDE_LOG` to `$E/outside.log`: only `herdr agent
  list` (the open page with a live Dispatch) and `ghbot api /installation/repositories ...` (the
  Readiness checks after a settings write and the Install). Every `.console.txt` is empty.

## Gotchas

- `seed issues second` caches verify/second's issues; without it verify/second's map is
  empty and `Source not read yet`.
- An option is a Project with a Repo: a `[projects.<name>]` no Repo names has none.
- The Project's defaults come first on its page and share their control names with each Repo's: a
  bare `--click` reaches the Project's. Use `--within "region=<slug>"` for a Repo's, and for its
  `combobox "Project"`: a bare one reaches the `Project` select above the map.
- Room, Switches and Settings are folded to one line (`<n> of 10 on` for the switches), in each
  panel of each new browser: `--click "region=Switches"` opens the first (the Project's); a Repo's
  needs `--within "region=<slug>"` before it.
- The Room input keeps its value as typed: select it (`Control+a`) before typing, and leave it
  (`Tab`) to send it.
- The map field is as tall as the column beside it; with several Repo panels the `Fit` button is
  far down the page.
- A node's line under its Stage is cut to the node's width (`waits on verify/fixture#20 to b…`):
  `--expect` reads the text drawn, so expect the whole sentence in the node's panel, or read the
  node's name in the ARIA snapshot.
- `seed issues second` dates verify/fixture#20's close at the read: an Install run after the seed
  is after the close.
