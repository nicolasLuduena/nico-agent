# Room

Each Repo has a room: how many Dispatches it may have In flight at once, a draft PR's included; 3
unless set. The page shows it in the Repo's panel in its `Room` section above the switches, folded to
`<room> · <n> in flight`, as a number input with the Repo's Dispatches not Closed counted under it
and tagged `default` or `from Project` while the Repo does not set it and `set here` once it does,
and writes a change to `config.toml` through `PATCH /api/repo/<slug>`, keeping the
rest of the file as written; "Use the default" (or "Use the Project's") removes the Repo's own. The
loop fills the new room from its next tick on.

## Sub-features

- `room-patch` `PATCH` with `{"room": n}` writes `room = n` in the Repo's panelle and answers the Repo's settings, `room` `{"value": n, "from": "repo"}`.
- `room-bad-value` `0`, `-1`, `1.5`, `"5"`, `{}`, a key that is no setting beside room, or a body not JSON is 400, writing nothing.
- `room-unknown-repo` a slug that is not a Repo is 409, with the `repo add` to run.
- `room-page-set` on the page, a new value in `spinbutton "Room"` is sent on Enter or blur and shown from the answer.
- `room-page-refused` a refused value shows its error inline under the input, which goes back to the room set and is marked invalid.
- `room-in-flight` under the input, "<n> in flight; each Dispatch holds its room until its PR merges or closes"; the folded line reads `<room> · <n> in flight`.
- `room-obeyed` with the room full, a refresh tick dispatches nothing; raised, it dispatches into the room freed.

## How to get to it (user POV)

- Open the page, pick a Repo's Project in the rail, open `Repos`, then its `Room` section (above Switches), and change `Room`; press Enter or leave the field.
- From a script: `PATCH /api/repo/<owner/name>` with `{"room": n}`.
- By hand: edit `repos."<slug>".room` in `config.toml` (`repo list` shows it).

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`; `$C seed dispatch 7 pr`
  (one Dispatch In flight).
- `E=.evidence/<issue>/room`; `$C state > "$E/state.before.txt"`.

- **Set it.** Run `$C http --evidence "$E/01-set" PATCH /api/repo/verify/fixture '{"room":5}'`.
  HTTP `200`, `slug` `verify/fixture` and `room` `{"from":"repo","value":5}` among the Repo's
  settings; `config.toml`'s `[repos."verify/fixture"]` gains `room = 5`.
- **Refusals.** Each of `'{"room":0}'`, `'{"room":-1}'`, `'{"room":1.5}'`, `'{"room":"5"}'`, `'{}'`,
  `'{"room":2,"rom":2}'` and `'not json'` (`02` to `08`): HTTP `400`, e.g. `room is a whole number
  of at least 1, not 0` with `help` `room is how many Dispatches the Repo may have In flight at
  once, a whole number of at least 1`; `{} sets nothing` and `` `rom` is not a setting the page
  sets `` with `help` `Settings: implementer, reviewer, room, base, project, install, switches; null takes
  the Project's or the default` (none for not JSON). On `/api/repo/other/repo` with `'{"room":2}'` (`09-unknown-repo`): `409`,
  `other/repo is not a configured Repo`. `config.toml` is byte for byte unchanged by each.
- **On the page.** Run `$C page --evidence "$E/10-page" --click "button=Repos" --expect "Room 5 · 1 in flight" --click "region=Room" --expect "1 in flight; each Dispatch holds its room until its PR merges or closes"`.
  The ARIA snapshot has `set here`, `button "Use the default Room"`, `spinbutton "Room": "5"` and that paragraph under it.
- **Set it on the page.** Run `$C page --evidence "$E/11-page-set" --click "button=Repos" --click "region=Room" --click "spinbutton=Room" --press Control+a --press 2 --press Enter --wait 2`.
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"room":2} -> 200`; the snapshot has
  `spinbutton "Room": "2"`; `cp "$CONFIG_DIR/config.toml" "$E/11-page-set.config.toml"` has `room = 2`.
- **Refused on the page.** Run `$C page --evidence "$E/12-page-refused" --click "button=Repos" --click "region=Room" --click "spinbutton=Room" --press Control+a --press 0 --press Tab --expect "room is a whole number of at least 1, not 0"`.
  `.requests.txt` has `PATCH ... {"room":0} -> 400`; the snapshot has `spinbutton "Room" [invalid]: "2"` and an
  `alert` with the error and help; `config.toml` still has `room = 2`.
- **Obeyed.** `PATCH ... '{"room":1}'` (`13-room-1`); `: > "$OUTSIDE_LOG"`; `$C http --evidence "$E/14-refresh-full" POST /api/refresh`.
  `$OUTSIDE_LOG` has no `herdr worktree create`: #7 fills the room. Then `'{"room":2}'` (`15-room-2`)
  and `$C http --evidence "$E/16-refresh-raised" POST /api/refresh`: `actions` has
  `verify/fixture#1 failed at worktree: ...` and `$OUTSIDE_LOG` one `herdr worktree create`, for #1
  only. `$C page --evidence "$E/17-page-after" --click "button=Repos" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "region=Room" --expect "2 in flight; each Dispatch holds its room"`: the Failed #1 holds its room too (the folded line reads `2 · 2 in flight`).
- **Second view.** `$C run --evidence "$E/18-list" -- repo list --json`: `room` is 2.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- Each refresh ticks: with GitHub and herdr stubbed, #7's PR and Reviewer fail in `actions` every
  time; read only the `dispatched` and `failed at` lines.
- A Dispatch that fails holds its room until Closed, so "in flight" counts it; a lowered room stops
  nothing already in flight.
- `--press Control+a` before the digits, or they are typed after the value already in the field.
- Room is folded to `<room> · <n> in flight`: `--click "region=Room"` opens it first, or the
  `spinbutton` is hidden and its click times out (it opens by itself only on a refusal).
