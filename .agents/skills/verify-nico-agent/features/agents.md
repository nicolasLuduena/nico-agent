# An In-flight issue's agents

Each live agent of a Dispatch has a row on its node, the Implementer then the Reviewer: its Agent
state's dot and its role, what the state means on hover and focus and in its accessible name
(`Implementer, working`). A row opens that agent's panel in place of the issue's (the bottom sheet on
a phone): its role, its Agent state in words, a link back to the issue's panel and Close, then `Chat` and
`Screen`. Chat, shown first, is the conversation its Harness keeps, streamed from `GET
/api/agent/<issue>/<role>/transcript` while the panel is open: claude's transcript under `~/.claude/projects/`,
opencode's session through `opencode2 api`, each entry wrapped, a reply appearing as it lands, no polling for it;
while there is none to read, Chat shows the screen whole under `No chat to read: <why>. Its screen:`. The screen
is its last 200 lines from `GET /api/agent/<issue>/<role>`, which reads `herdr agent read <agent> --source recent
--lines 200` and nothing of GitHub; herdr scrolls an alternate screen (Claude's, codex's) only while its
agent is idle, and refuses `agent_not_idle` otherwise, so then it reads `--source visible`, the screen. The panel reads again about every 3 s while it is open and the
page visible; a failed read keeps the last screen under `Last read HH:MM · <why>`. An Asking
Implementer is answered under its screen (answer.md). The open panel is in the URL's hash
(`#<project>/<issue>/<role>`).

## Sub-features

- `agents-chat-route` `GET /api/agent/<issue>/<role>/transcript` is a stream: `event: session` naming the session, then `event: entries` (`{entries: [{role, text, usage?}]}`, roles user, assistant, thinking, tool, result, progress) each with `id: <session> <place>`, a line once whole and never twice; `event: missing` with why while there is none to read (no session yet, a read that fails, a Harness whose chat is not read); resumed past `Last-Event-ID` or `?after=`; refused as the screen is. claude: the run HOME's newest `~/.claude/projects/<worktree, each non-alphanumeric a dash>/*.jsonl` from a byte offset; opencode: `opencode2 api GET /api/session?directory=<worktree>&...` then its messages, past the last finished one by opencode's cursor. No herdr, no `gh`.
- `agents-chat` the panel opens on `group "Show"` with `button "Chat" [pressed]` and `log "The <Role>'s chat"`: `› ` before the user's, `▸ ` before a tool call, `⎿ ` before its result, each entry wrapped (the page no wider than the window); a reply appended to the transcript shows in the open panel; `.requests.txt` one `GET .../transcript -> 200` while the screen is read every 3 s.
- `agents-chat-fallback` with no chat to read, Chat shows `No chat to read: <why>. Its screen:` and the screen's box; `button "Screen"` shows the screen whatever the chat holds.
- `agents-route` `GET /api/agent/<issue>/implementer|reviewer` answers `{agent, screen}` with the last 200 lines, or `{agent, unread}` with herdr's reason when its read fails; `409` for an issue with no live Dispatch, a role with no agent herdr lists, or herdr's list failing (its error); `400` for another role. One `herdr agent list`, then one `herdr agent read`, and no `gh`.
- `agents-rows` a node with a working Reviewer and an idle Implementer has `button "Implementer, idle: finished its turn"` and `button "Reviewer, working"` under its own button, which no longer names an agent; an agent herdr no longer lists has no row; hover or focus shows what the dot means; dots in light and dark.
- `agents-open` a row opens `region "<Role>"`: `link "#<n> <title>"`, `button "Close"`, `heading "<Role>"`, its state in `strong`, then the screen; the other row switches to its agent; the link opens the issue's panel; focus on the title.
- `agents-poll` the screen is read about every 3 s while the panel is open, and not once it closes.
- `agents-failed` a read that fails after one that worked keeps the screen under `Last read HH:MM · <why>` on the errata rule; one that never worked says `Not read yet · <why>`.
- `agents-asking` an Asking Implementer's issue panel says it is asking and has `link "Answer it in its panel"`, which opens its agent panel with `region "Answer"` under the screen (answer.md).
- `agents-link` back and forward open and close the agent panel, and `#<project>/<issue>/<role>` opens it directly.
- `agents-phone` at 390px the panel is the bottom sheet, the state a word in its head, the page no wider than the window: only the screen's box scrolls sideways.

## How to get to it (user POV)

- On the Board, on a desk or a phone: an agent's row on its node; or, while it is Asking, `Answer it in its panel` in its issue's panel.
- A shared or bookmarked link `http://127.0.0.1:<port>/#<project>/<issue>/<role>`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`; `E=.evidence/<issue>/agents`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`; `$C seed issues`; `$C seed dispatch 10 pr`;
  `$C seed dispatch 7 asking` (its Implementer `impl-fixture-7`). `$C state > "$E/state.before.txt"`.

- **Refused, herdr a stub.** `$C http --evidence "$E/01-route-stubbed" GET /api/agent/verify%2Ffixture%2310/implementer`:
  `409` `` `herdr agent list` failed: verify_stub: herdr is a stub in this verification run ``;
  `GET /api/agent/verify%2Ffixture%2310/faux-nico` (`02-route-role`) `400` `faux-nico is not a role: implementer or reviewer`;
  `GET /api/agent/verify%2Ffixture%238/implementer` (`03-route-no-dispatch`) `409` `verify/fixture#8 has no live Dispatch`.
- **A Reviewer at work.** `$C seed reviewer 10`; `$C http --evidence "$E/04-review" POST /api/review '{"issue":"verify/fixture#10"}'`:
  `200`, its Reviewer `rev-fixture-10` started; herdr now lists it working and `impl-fixture-10` idle, and reads
  `rev-fixture-10`'s screen, 240 numbered lines.
- **The reads.** `$C http --evidence "$E/05-route-reviewer" GET /api/agent/verify%2Ffixture%2310/reviewer`: `200`,
  `agent` `rev-fixture-10`, `screen` its lines 41 to 240; `.../implementer` (`06-route-unread`) `200`, `agent`
  `impl-fixture-10`, `unread` `` `herdr agent read` failed: verify_stub: ... ``. `$OUTSIDE_LOG` gains
  `herdr agent read rev-fixture-10 --source recent --lines 200` and no `gh`.
- **Rows.** `$C page --evidence "$E/07-rows-light-1440" --width 1440 --expect "seeded Dispatch 10"` and `--scheme dark`
  (`08-rows-dark-1440`): `button "#10, Verify: seeded Dispatch 10, PR draft, PR 110 draft, reviewing"`, then
  `button "Implementer, idle: finished its turn"` and `button "Reviewer, working"`; `#7` has none (herdr's list lacks
  `impl-fixture-7`). The screenshot: a grey ring before `Implementer`, a green disc before `Reviewer`.
  `$C page --evidence "$E/09-tip" --width 1440 --click "button=Reviewer, working" --press Escape`: Escape closes the
  panel and gives focus back to the row, and `.view.png` shows `Working` in a small card under it.
- **Open, switch, back to the issue.** `$C page --evidence "$E/10-open-light-1440" --width 1440 --click "button=Reviewer, working" --expect "line 240"`:
  `region "Reviewer"` with `link "#10 Verify: seeded Dispatch 10"`, `button "Close"`, `heading "Reviewer"`, `strong: Working`,
  the screen's lines 41 to 240; `.view.txt` `at /#verify%2Ffixture/verify%2Ffixture%2310/reviewer`, `focus on h2 "Reviewer"`;
  `.requests.txt` `GET /api/agent/verify%2Ffixture%2310/reviewer -> 200`. Then the same with
  `--click "button=Implementer, idle: finished its turn" --expect "Not read yet"` (`11-switch`): `region "Implementer"`,
  `` Not read yet · `herdr agent read` failed: ... `` on the errata rule; then `--click "link=#10 Verify: seeded Dispatch 10" --expect "Pull request"`
  (`12-to-issue`): the issue's `region "Verify: seeded Dispatch 10"`, `.view.txt` `at /#verify%2Ffixture/verify%2Ffixture%2310`.
- **Phone.** `$C page --evidence "$E/13-phone-dark-390" --width 390 --scheme dark --click "button=Reviewer, working" --expect "line 240"`
  and `--scheme light` (`14-phone-light-390`): the sheet over the map's foot, `strong: Working` in its head; `.view.txt`
  `page 390px wide in a 390px window`.
- **Reads while open, none once closed.** `n0=$(grep -c 'agent read rev-fixture-10' "$OUTSIDE_LOG")`;
  `$C page --evidence "$E/15-poll" --width 1440 --click "button=Reviewer, working" --wait 7 --click "button=Close" --wait 9`;
  `grep -c 'agent read rev-fixture-10' "$OUTSIDE_LOG"` is `n0` plus 3 (the first read and two 3 s later), not plus 6:
  none after Close. `.requests.txt` has those 3 `GET /api/agent/...` and no more.
- **A failed read.** `(sleep 8; $C seed reviewer none) &` then
  `$C page --evidence "$E/16-failed-dark-1440" --width 1440 --scheme dark --click "button=Reviewer, working" --expect "line 240" --wait 10 --expect "Last read"`:
  `` Last read <HH:MM> · `herdr agent list` failed: verify_stub: ... `` on the errata rule over the screen, still
  holding line 240; the head `Not known: herdr could not be read`; `.requests.txt` `-> 200`s, then `-> 409`s.
- **Asking, from the issue's panel.** herdr is all a stub again: `#7`'s Implementer is Asking by the tick's record,
  its row `button "Implementer, asking you something"`. `$C page --evidence "$E/17-asking-history" --width 1440 --click "button~#7, Verify" --expect "Answer it in its panel" --click "link=Answer it in its panel" --expect "Not read yet" --history back --expect "Answer it in its panel" --history back --gone "Answer it in its panel" --history forward --history forward --expect "Not read yet"`:
  the issue's `region "Asking"` with `The Implementer is asking you something: Should the fixture keep its README? …`
  and the link; the agent panel with `region "Answer"` (its keys and `textbox "Answer in words"`); `.view.txt`
  `at /#verify%2Ffixture/verify%2Ffixture%237/implementer`.
- **Deep link.** `$C page --evidence "$E/18-deep-link" --width 1440 --hash "#verify%2Ffixture/verify%2Ffixture%237/implementer" --expect "Not read yet"`:
  `region "Implementer"` open on load, focus on its title.
- **Proof.** `$C state > "$E/state.after.txt"`; its diff from `state.before.txt`: `dispatches.json`, its `#10` holding the
  Reviewer `04-review` started, and outside calls only (`herdr agent list`, `herdr agent read ... --source recent --lines 200`,
  the Reviewer's start); no `gh` from a read. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

- **Chat, none to read.** `$C http --evidence "$E/19-chat-missing" --for 2 GET /api/agent/verify%2Ffixture%2310/implementer/transcript`:
  `200`, `event: missing`, `claude keeps no session for <run dir>/worktrees/fixture-10 yet`. `$C page --evidence "$E/20-chat-fallback" --width 1440 --click "button=Implementer, idle: finished its turn" --expect "No chat to read"`:
  `button "Chat" [pressed]`, `No chat to read: claude keeps no session for ... yet. Its screen:` over `Not read yet · ...`.
- **Chat, claude's.** `$C seed transcript 10 claude`; `$C http --evidence "$E/21-chat-route" --for 2 GET /api/agent/verify%2Ffixture%2310/implementer/transcript`:
  `event: session` `{"session":"verify-session-10"}`, then `id: verify-session-10 1048`, `event: entries`: the user's prompt,
  `thinking` `Read the issue first.`, `tool` `Bash {"command":"gh issue view 10"}`, `result` `Verify: seeded Dispatch 10`,
  the long reply, each of claude's with its `usage`; no `attachment`. `(sleep 2; $C seed transcript 10 more) &` then the same with
  `--for 4` (`22-chat-live`): one more `entries` event, `Landed live, reply 1` alone, its id `verify-session-10 1158`. With
  `--header 'Last-Event-ID: verify-session-10 1048'` (`23-chat-resume`): `session`, then only `Landed live, reply 1`.
- **Chat in the panel.** `(sleep 8; $C seed transcript 10 more) &` then
  `$C page --evidence "$E/24-chat-light-1440" --width 1440 --click "button=Implementer, idle: finished its turn" --expect "Landed live, reply 1" --expect "Landed live, reply 2"`:
  `log "The Implementer's chat"` with `› Implement verify/fixture#10 ...`, `▸ Bash ...`, `⎿ Verify: seeded Dispatch 10`, the long reply wrapped
  in the box, and reply 2 landing without a reload; `.requests.txt` one `GET /api/agent/verify%2Ffixture%2310/implementer/transcript -> 200`.
  `--scheme dark` (`25-chat-dark-1440`) and at `--width 390` (`26-chat-phone-390`, `page 390px wide in a 390px window`). Then
  `--click "button=Screen" --expect "Not read yet"` after opening it (`27-screen`): `button "Screen" [pressed]` and the screen's errata.
- **Chat, opencode's.** `$C seed transcript 10 opencode` (its Implementer now opencode's); `$C http --evidence "$E/28-opencode-route" --for 2 GET /api/agent/verify%2Ffixture%2310/implementer/transcript`:
  `session` `ses_verify10`, `id: ses_verify10 msg_3`, the same turns (no `system`), its `tokens` as the reply's `usage`.
  `(sleep 1.5; $C seed transcript 10 more) &` then `--header 'Last-Event-ID: ses_verify10 msg_3' --for 3` (`29-opencode-resume`): only
  `Landed live, reply 1` as `ses_verify10 msg_4`. `$OUTSIDE_LOG` gains `opencode2 api GET /api/session?directory=...` and
  `opencode2 api GET /api/session/ses_verify10/message?cursor=eyJpZCI6Im1zZ18zIiwib3JkZXIiOiJhc2MiLCJkaXJlY3Rpb24iOiJuZXh0In0&limit=100`
  (`{"id":"msg_3","order":"asc","direction":"next"}`), and no `gh`.

## Gotchas

- `seed transcript <n> opencode` makes the Dispatch's Implementer opencode's for the rest of the run; drive claude's first.
- `$C http --for` reads a stream for that many seconds, then hangs up, as a closed panel does.

- `seed reviewer <n>` lists only `impl-fixture-<n>` and `rev-fixture-<n>`: any other live Dispatch's Implementer is
  gone from herdr while it is on, so its row is not drawn. `seed reviewer none` puts herdr back to a stub, whose list
  fails: every agent's Agent state is then unknown, its row a dashed ring, except an Asking one by the tick's record.
- `seed reviewer none` forgets the Reviewer's start: seeding it again lists no Reviewer until the next start.
- A run never ticks on its own, so the Agent states are herdr's at each status read, not a tick's.
- The screen's reads are the panel's own fetches, not the event stream: they show in `.requests.txt` and `$OUTSIDE_LOG`
  every 3 s while it is open.
- Hidden pages are not driven here: Chromium in `page` is always visible. The panel stops reading on
  `visibilitychange` to hidden, by its code; drive a hidden tab by hand to see it.
