# Mine: only issues assigned to you, and Assign to me

A Repo's `mine` Switch, "Only issues assigned to me" on the page, makes only the issues assigned to
the user Ready: an unassigned `ready-for-agent` issue stays on the map as Waiting, its node's fourth
row reading `unassigned` (one someone else has reads `assigned to @someone`), its panel saying why in
the words a hand Dispatch of it is refused with. `/api/status` and `/api/map` carry each issue's
assignees, the user marked `you`; the node panel lists them under Assigned, and an issue no one has
offers "Assign to me", which assigns it on GitHub (or Linear) and keeps the user among its
assignees in the Repo's last read, so it turns Ready at once without a Refresh. A refused or paused
assign is refused inline and changes nothing.

## Sub-features

- `mine-switch` the Switches section has `switch "Only issues assigned to me"`, off by default, with its chip and undo like every switch; turning it on writes `switches = { mine = true }` and reads `6 of 9 on`.
- `mine-ready` with `mine` on, `status`'s `ready` lists only issues assigned to the user (`#5`); `#1` and Stackable `#6`, unassigned, are in no list.
- `mine-map` `/api/map` gives every issue node its `assignees` (`[{name, you}]`; null for a Blocker no read holds) and an unassigned one in a `mine` Repo `stage` `Waiting`, `waits` the refusal's words and `assignee_holds` true; the node's fourth row reads `unassigned`, `#4`'s `assigned to @someone-else`.
- `mine-refused` `dispatch` (and `POST /api/dispatch`) of an unassigned issue in a `mine` Repo: exit `1` (HTTP `409`), `<key> is not assigned to you, and <repo> takes only issues assigned to you`, help `Assign it to yourself, or turn \`mine\` off for <repo>`; the Dispatch form shows it with a `button "Assign to me"` under it.
- `mine-panel` the node panel's `heading "Assigned"`: `you` for the user, each other assignee by name, `Unassigned` with `button "Assign to me"` for an issue no one has; none for someone else's.
- `mine-assign` `button "Assign to me"` sends `POST /api/assign {"issue": <key>}`: `gh issue edit <n> --repo <slug> --add-assignee @me`, the kept read gains the user, and the node turns Ready with the panel reading `you`, without a Refresh.
- `mine-assign-refused` an assign of someone else's issue is `409` (`<key> is assigned to <them>`); one while GitHub is paused is refused inline under the button, asking GitHub nothing.

## How to get to it (user POV)

- Open the page, open a Repo's `Switches` section and toggle `Only issues assigned to me`.
- Click a node on the map: its panel's Assigned section, and `Assign to me` for an issue no one has.
- Dispatch an unassigned issue from the Dispatch form (one still listed from before the switch
  turned on), `nico-agent dispatch <key>`, or `POST /api/dispatch`.
- From a script: `POST /api/assign` with `{"issue": "<key>"}`; `GET /api/status` and
  `GET /api/map/<project>` for the assignees.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues` (`#5` is
  assigned to the user, `#4` to `someone-else`, the rest to no one); `$C seed assign answers`.
- `E=.evidence/<issue>/mine`; `$C state > "$E/state.before.txt"`.

- **Turn it on, then dispatch.** Run `$C page --evidence "$E/01-switch-on-then-dispatch" --within "region=verify/fixture" --click "region=Dispatch" --click "region=Switches" --expect "5 of 9 on" --click "switch=Only issues assigned to me" --expect "Saved" --expect "6 of 9 on" --within "region=Dispatch" --click "button=Dispatch" --expect "turn" --expect "Assign to me"`.
  `.requests.txt` has `PATCH /api/repo/verify/fixture {"switches":{"mine":true}} -> 200`, then
  `POST /api/dispatch {"issue":"verify/fixture#1",...} -> 409`; the ARIA snapshot has an `alert`
  `verify/fixture#1 is not assigned to you, and verify/fixture takes only issues assigned to you`,
  `Assign it to yourself, or turn mine off for verify/fixture`, and `button "Assign to me"` under
  it; the refetched form's Issue now lists `#5` alone.
- **The row, four ways.** Run `$C page --evidence "$E/02-switches-desk-light" --width 1280 --scheme light --within "region=verify/fixture" --click "region=Switches" --expect "Only issues assigned to me"`,
  and the same as `03-switches-desk-dark` (`--scheme dark`), `04-switches-phone-light` and
  `05-switches-phone-dark` (`--width 390`). Each: `switch "Only issues assigned to me" [checked]`
  after `set here` and `button "Use the default Only issues assigned to me"`; the toggle stays at
  the row's right, the chip under the name where it does not fit beside it.
- **Status.** Run `$C run --evidence "$E/06-status" -- status --json`. `ready` is `#5` alone, with
  `assignees` `[{"name":"verify-nico","you":true}]`; `stackable` and `waiting` are empty.
- **Map.** Run `$C http --evidence "$E/07-map" GET /api/map/verify%2Ffixture`. `#1`, `#3` and `#6`:
  `stage` `Waiting`, `assignees` `[]`, `assignee_holds` true, `waits` `<key> is not assigned to you,
  and verify/fixture takes only issues assigned to you`; `#4`: `assignees`
  `[{"name":"someone-else","you":false}]`, `waits` `verify/fixture#4 is assigned to someone-else`;
  `#5` `Ready`; Blocker `#9` `assignees` null.
- **Refused.** Run `$C run --evidence "$E/08-dispatch-refused" -- dispatch verify/fixture#1 --json`:
  exit `1`, the error and help above. Run `$C http --evidence "$E/09-api-dispatch-refused" POST /api/dispatch '{"issue":"verify/fixture#6"}'`: HTTP `409`, the same for `#6`.
- **Someone else's.** Run `$C page --evidence "$E/10-panel-someone-else" --click "button~#4, Verify: assigned to someone else" --expect "someone-else"`:
  `heading "Assigned"` then `paragraph: someone-else`, no `button "Assign to me"`. Run `$C http --evidence "$E/11-api-assign-theirs" POST /api/assign '{"issue":"verify/fixture#4"}'`:
  HTTP `409`, `verify/fixture#4 is assigned to someone-else`, help `Take it from them on GitHub or
  Linear: nico-agent assigns you only an issue no one has`.
- **The sheet.** Run `$C page --evidence "$E/12-panel-phone-unassigned" --width 390 --click "button~#1, Verify: a Ready issue" --expect "Assign to me"`:
  the bottom sheet reads Assigned, `Unassigned` and `Assign to me` on one row, then why it waits.
- **Assign to me.** `: > "$OUTSIDE_LOG"`; run `$C page --evidence "$E/13-assigned-from-panel" --click "button~#1, Verify: a Ready issue" --expect "Unassigned" --click "button=Assign to me" --gone "Assign to me" --expect "you"`.
  `.requests.txt` has `POST /api/assign {"issue":"verify/fixture#1"} -> 200` and no
  `POST /api/refresh`; the ARIA snapshot has `button "#1, Verify: a Ready issue, Ready"` and the
  panel's `paragraph: you`; `$OUTSIDE_LOG` holds only `gh issue edit 1 --repo verify/fixture --add-assignee @me`.
  Run `$C run --evidence "$E/14-status-after" -- status --json`: `ready` is `#1` and `#5`, each
  `you`.
- **Paused.** `$C drift pause`; `: > "$OUTSIDE_LOG"`; run `$C page --evidence "$E/15-assign-paused" --click "button~#6, Verify: stacks on #9 PR" --click "button=Assign to me" --expect "could not assign"`.
  `POST /api/assign {"issue":"verify/fixture#6"} -> 409`; an `alert` under the button: `could not
  assign verify/fixture#6 to you: GitHub rate limit exceeded; nico-agent asks it again at <time>`,
  `Assign it to yourself on GitHub or Linear, or try again once it answers`; `$OUTSIDE_LOG` is empty.
- **Proof.** `$C state > "$E/state.after.txt"` and the diff: `config.toml` gained
  `switches = { mine = true }`, `issues/verify/fixture.json` changed (`#1`'s `assignees`
  `["verify-nico"]`, `#6`'s still `[]`), `pauses.json` appeared; copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- The gh stub fails every call until `seed assign answers`; without it, Assign to me is refused
  with `gh auth login`'s message, as it is for a user never signed in.
- The node rows read `unassigned` in lowercase: `--gone "Unassigned"` waits on the panel's word
  and on those rows too, and times out. Wait on `--gone "Assign to me"`.
- The Dispatch form lists only what is Ready, so its `mine` refusal shows only for an issue picked
  before the switch turned on: dispatch in the same `page` as the toggle, within 10 seconds, before
  the page's next refetch drops the issue from the form.
- In a `mine` Repo the assignee comes before the Blockers: `#3` reads `unassigned`, not `waits on #1`.
- The pause lasts an hour and survives everything but cleanup: drive it last.
