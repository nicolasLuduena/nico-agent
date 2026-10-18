# Answer an Asking Implementer

`answer` is how the user, or a faux-nico, unblocks an Implementer that herdr reports Asking: in
words, typed as given into the Implementer's pane through herdr and submitted, or in keys, pressed
there as a choice dialog takes them; either is recorded on the Dispatch beside the question it
answers. A text may start with `--`, as an answer about a command line does. On the Board, the
Implementer's agent panel (agents.md), opened from its node row or from `Answer it in its panel` in
the issue's panel, shows its chat and under it, while it is Asking, the question its transcript asks
and a button per option (claude's AskUserQuestion; opencode's question form or permission request,
from its server), or, with no chat or a dialog the chat asks none of (a permission prompt, several
questions at once: the screen is read for it then), per numbered option the screen shows; the keys ↑ ↓ Tab Enter Esc,
and a text box with Send, each running `POST /api/answer`, which is `answer`. An opencode option is
`answer --reply <id> --session <session> [--field <key>] --text <value>`, replied through
`opencode2 api POST /api/session/<session>/form|permission/<id>/reply`, not the pane.

## Sub-features

- `answer-usage` neither `--text` nor `--keys`, `--keys` with no key, both, an empty text, `--text` followed by `--by` (alone or as `--by=...`), an author other than user or faux-nico, or an unknown flag is exit 2 with the usage.
- `answer-dash-text` a text starting with `--` is the answer, as `--text "--force is fine"` and as `--text=--force is fine`.
- `answer-no-dispatch` an issue with no live Dispatch is exit 1.
- `answer-not-asking` a live Dispatch whose Implementer is not Asking is exit 1.
- `answer-typed` an answer, by the user or `--by faux-nico`, is typed as `herdr agent prompt <implementer> <text> --wait --until working --timeout 30000`.
- `answer-keys` `--keys <key>...` (herdr's key names: `up`, `down`, `tab`, `enter`, `esc`, a digit) is sent as `herdr agent send-keys <implementer> <key>...` and recorded with the keys as its text, each time.
- `answer-reply` `--reply <id> --session <session>` answers an opencode Implementer's form (`--field <key>`, body `{"answer":{<key>:<text>}}`) or permission (`--text once|always|reject`, body `{"decision":...}`) through `opencode2 api POST .../reply`, recorded with `--text`; to a claude Implementer, without `--session`, with `--keys`, or a permission reply not one of the three, exit 2 and nothing sent.
- `answer-route` `POST /api/answer {issue, text}`, `{issue, keys}` or `{issue, text, reply, session, field}` runs `answer`: 200 with its answer; a refusal 409 (400 for a bad body), as `{error, help}`.
- `answer-screen` `GET /api/agent/<issue>/implementer` is the Implementer's screen: herdr refuses its last 200 lines (`--source recent --lines 200`, `agent_not_idle`) while a Claude asks, so it is `herdr agent read --source visible`'s (agents.md); `GET /api/node/<issue>` holds no pane, Asking or not, and reads no screen.
- `answer-board` the issue's panel of an Asking Dispatch has `region "Asking"` first, saying so with its question, and `link "Answer it in its panel"`; the Implementer's agent panel, kept as the map takes a change elsewhere (a half-typed answer stays), has under its chat `region "Answer"`: the question, `group "Options"` with a `button "<n> <option>"` per option the transcript's question offers (the screen's numbered ones while the chat asks none it can pick), `group "Keys"` (`button "Up"`, `"Down"`, `"Tab"`, `"Enter"`, `"Esc"`), `textbox "Answer in words"` and `button "Send"`. The chat shows each answer taken (the screen, read again, while it stands in). A refusal, or a screen herdr cannot read, is on the errata rule. At 360px nothing but the screen's box is wider than the window.

## How to get to it (user POV)

- The user sees an Asking in `nico-agent status` or as a flagged node on the page and runs
  `nico-agent answer <issue> --text <text>`, or `--keys <key>...` for a choice dialog.
- A faux-nico, started on an Asking in a Repo with `Faux-nico answers` on, runs
  `nico-agent answer <issue> --text <text> --by faux-nico`.
- On the Board, on a desk or a phone: the flagged node's `Implementer` row, or `Answer it in its panel` in its issue's panel, opens the Implementer's agent panel; an option, a key, or words and Send answer it.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/answer`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C seed dispatch 7 asking` (its Implementer `impl-fixture-7`), `$C seed dispatch 11 asking`
  (`impl-fixture-11`) and `$C seed dispatch 9 pr`.
- `$C state > "$E/state.before.txt"`.

- **Usage.** Each exit `2` with `help` the usage `` Run `nico-agent answer <issue> --text <text>|--keys <key>... [--by faux-nico]` ... ``:
  `answer verify/fixture#7 --json` (`--evidence "$E/01-no-text"`) `--text or --keys is required`;
  `answer verify/fixture#7 --text "" --json` (`02-empty`), `answer verify/fixture#7 --text --by faux-nico --json`
  (`03-then-by`) and `answer verify/fixture#7 --text --by=faux-nico --json` (`04-then-by-joined`)
  `--text needs a value`; `answer verify/fixture#7 --text "Keep it." --by bob --json` (`05-bob`)
  `` `bob` is not an author: user or faux-nico ``; `answer verify/fixture#7 --txt "Keep it." --json`
  (`06-unknown-flag`) `` unknown flag --txt for `answer` ``; `answer verify/fixture#7 --keys --json`
  (`06b-no-key`) `--keys needs a key`; `answer verify/fixture#7 --keys enter --text "Keep it." --json`
  (`06c-both`) `give --text or --keys, not both`.
- **No Dispatch.** Run `$C run --evidence "$E/07-no-dispatch" -- answer verify/fixture#8 --text "Keep it." --json`.
  Exit `1`, `error` `verify/fixture#8 has no live Dispatch`.
- **Not Asking.** Run `$C run --evidence "$E/08-not-asking" -- answer verify/fixture#9 --text "Keep it." --json`.
  Exit `1`, `error` `verify/fixture#9 is not Asking`.
  `$C state`'s diff from `state.before.txt` is one `herdr agent list` (a Dispatch not recorded Asking is looked up in
  herdr first): no refusal wrote anything.
- **Typed.** Run `$C run --evidence "$E/09-typed" -- answer verify/fixture#7 --text "Keep it." --json`,
  then with `--by faux-nico` (`10-faux-nico`). Each exit `1`,
  `` `herdr agent prompt` failed: verify_stub: herdr is a stub in this verification run ``.
- **Text starting with `--`.** Run `$C run --evidence "$E/11-dash-text" -- answer verify/fixture#7 --text "--force is fine" --json`
  and `$C run --evidence "$E/12-dash-text-joined" -- answer verify/fixture#7 "--text=--force is fine here" --json`.
  Each exit `1` with the same herdr stub error, not exit `2`.
- **Keys.** Run `$C run --evidence "$E/13-keys" -- answer verify/fixture#7 --keys down enter --json`.
  Exit `1`, `` `herdr agent send-keys` failed: verify_stub: herdr is a stub in this verification run ``.
- **The route.** `$C http --evidence "$E/14-route-not-asking" POST /api/answer '{"issue":"verify/fixture#9","keys":["enter"]}'`
  is `409` `verify/fixture#9 is not Asking`; `'{"issue":"verify/fixture#8","text":"Keep it."}'`
  (`15-route-no-dispatch`) `409` `verify/fixture#8 has no live Dispatch`; `'{"issue":"verify/fixture#7","keys":"enter"}'`
  (`16-route-bad-keys`) `400` `keys is a list of key names, not "enter"`; `'{"issue":"verify/fixture#7","keys":["enter","--by","faux-nico"]}'`
  (`16b-route-flag-key`) `400` too, no key being a flag of `answer`; `'{"issue":"verify/fixture#11","keys":["enter"]}'`
  (`17-route-herdr`) `409` with the send-keys stub error.
- **The screen, unread.** `$C http --evidence "$E/18-screen-11" GET /api/agent/verify%2Ffixture%2311/implementer` is
  `409` `` `herdr agent list` failed: verify_stub: ... ``; `GET /api/node/verify%2Ffixture%2311` (`19-node-11`) has
  neither `pane` nor `pane_error`.
- **The Board, refused.** `$C page --evidence "$E/20-board-refused" --width 360 --click "button~#11, Verify" --click "link=Answer it in its panel" --expect "Not read yet" --click "button=Enter" --expect "send-keys failed"`:
  the agent panel's head says `Asking you something`, its read's error on the errata rule (`Not read yet · ...`), then
  `region "Answer"` with the keys and the text box, then the send-keys refusal on the errata rule under them;
  `.requests.txt` has `POST /api/answer {"issue":"verify/fixture#11","keys":["enter"]} -> 409`; `.view.txt` says the page
  is 360px wide in a 360px window.
- **Proof.** Before the dialog: `$C state > "$E/state.after.txt"`; its diff from `state.before.txt` is outside calls only:
  `herdr agent list` (a Dispatch not recorded Asking is looked up in herdr first; herdr refusing,
  what it records stands), `herdr agent prompt impl-fixture-7 Keep\ it. --wait --until working --timeout 30000` twice, the
  two `--force` texts, `herdr agent send-keys impl-fixture-7 down enter`, then the route's and the
  page's `herdr agent send-keys impl-fixture-11 enter`, and no `herdr agent read` (herdr's list fails first),
  among the `herdr agent list` lines serve's status, its event stream and the screen's reads make;
  `dispatches.json` is unchanged. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

- **A Claude Asking.** Needs herdr and Claude Code on the machine (else stop here, and report the
  Board's own bullets below unreached for want of them). `$C seed dialog 7`: a real Claude, the
  Implementer `impl-fixture-7`, Asking two questions in a choice dialog in a herdr tab of its own;
  from now on the run reaches the real herdr for its list of agents and for what is asked of
  `impl-fixture-7` alone. `E=.evidence/<issue>/answer-board`; `mkdir -p "$E"`;
  `$C state > "$E/state.before.txt"`.
- **The screen.** `$C http --evidence "$E/00-screen" GET /api/agent/verify%2Ffixture%237/implementer`: `screen` holds
  the dialog: its tabs (`☐ Node tint  ☐ Sections  ✔ Submit`), the question, `❯ 1. Faint tint`, `2. No tint`,
  `3. Type something.`, `4. Chat about this`.
- **Opened from the node.** `$C page --evidence "$E/01-desk-light-asking" --width 1280 --scheme light --click "button=Implementer, asking you something" --expect "Should map nodes carry a tint of their Stage hue?"`:
  the node ends `needs you`; `region "Implementer"` holds the chat (AskUserQuestion `Running`; two questions, so the screen is read for the options), then `region "Answer"` with `button "1 Faint tint"` to `button "4 Chat about this"`;
  `.view.txt` says focus is on the panel's title.
- **An option.** The same, then `--click "button=1 Faint tint" --expect "Should the panel's sections start folded?"`
  (`02-desk-light-picked-1`): `POST /api/answer {"issue":"verify/fixture#7","keys":["1"]} -> 200`, and the
  screen, read again, shows Claude's second question.
- **Phone, dark, a key at a time.** `--width 360 --scheme dark`: open the Implementer's row (`03-phone-dark-asking`),
  then `--click "button=Down" --expect "❯ 2. Open"` (`04-phone-dark-down`), each `.view.txt` 360px wide in
  a 360px window, focus kept on the key. Then `--width 360 --scheme light`, open the row,
  `--expect "❯ 2. Open" --click "button=Enter" --expect "Ready to submit your answers?"` (`05-phone-light-enter`).
- **Submitted.** `--width 1280 --scheme dark`: open the row, `--click "button=1 Submit answers" --gone "Ready to submit your answers?" --wait 6`
  (`06-desk-dark-submitted`): the screen shows Claude's one-sentence reply with both answers.
- **In words.** `--width 360 --scheme dark`: open the row, `--click "textbox=Answer in words" --type "Thanks. Reply with the one word: done" --press Enter --expect "Reply with the one word: done" --wait 12`
  (`07-phone-dark-words`): `POST /api/answer {"issue":"verify/fixture#7","text":"..."} -> 200`, the screen
  shows Claude's `done`, and focus is back on the input after the reload.
- **A change elsewhere.** `E=.evidence/<issue>/map-live`; with `(sleep 8; $C seed dispatch 13 pr) &`
  running, `$C page --evidence "$E/01-typing-while-a-dispatch-lands" --click "button=Implementer, asking you something" --expect "Answer in words" --click "textbox=Answer in words" --type "half-typed answer" --expect "Verify: seeded Dispatch 13"`:
  the map draws #13 at the next `changed`, and `.aria.txt` still has `textbox "Answer in words": half-typed answer`.
- **Its proof.** `E=.evidence/<issue>/answer-board`; `$C state > "$E/state.after.txt"`; its diff from `$E/state.before.txt` changes
  `dispatches.json`, whose `answers` on `verify/fixture#7` hold (read the file: `state` prints it as a hash) one per answer (`1`, `down`, `enter`, `1`, the
  text), each `by` `user`, and the outside calls `herdr agent send-keys impl-fixture-7 ...` and
  `herdr agent prompt impl-fixture-7 ...`. Copy `$OUTSIDE_LOG` to `$E/outside.log`. Then
  `$C seed dialog none`.

## Gotchas

- With herdr stubbed the prompt and the keys are refused, so an answer is exit 1, `answers` stays
  empty and the same answer again is typed again, not `already recorded (no-op)`. Recording an
  answer needs herdr to take it: `cargo test`, or `seed herdr` with a real agent.
- `outside.log` quotes each argument shell-style: `--force\ is\ fine` is one argument, the text as
  given.
- `status` between steps calls `gh api user` and `herdr agent list`, which then show in the diff.
- A run never ticks on its own, so a Dispatch stays Asking by its record after its dialog is answered:
  the Implementer's row and panel keep Asking, and the Answer section, showing the screen as it is now,
  until a tick (Refresh) sees herdr report the agent working or idle.
- `--gone` on a question fails once the dialog's review screen quotes it; wait for what replaces
  the question instead.
- A real Claude moves on with each key: drive the steps in order, once; `$C seed dialog none`,
  then `$C seed dialog 7`, starts over.
- `seed dialog` takes about half a minute (Claude starting, trusting the run's folder, then
  asking), and its tab sits in the herdr workspace the run is driven from until `seed dialog
  none` or `cleanup` closes it.
