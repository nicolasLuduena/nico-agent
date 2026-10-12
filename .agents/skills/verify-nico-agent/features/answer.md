# Answer an Asking Implementer

`answer` is how the user, or a faux-nico, unblocks an Implementer that herdr reports Asking: it
types the text into the Implementer's pane through herdr, then records it on the Dispatch beside
the question it answers. A run never reaches herdr, so an answer is driven to the moment it is typed
(the `herdr agent prompt` call in `outside.log`, the text one argument as given) and to its
refusals; recording it needs the prompt to land, which `cargo test` covers.

## Sub-features

- `answer-usage` no `--text`, an empty one, `--text` followed by `--by` (alone or as `--by=...`), an author other than user or faux-nico, or an unknown flag is exit 2 with the usage.
- `answer-dash-text` a text starting with `--` is the answer, as `--text "--force is fine"` and as `--text=--force is fine`.
- `answer-no-dispatch` an issue with no live Dispatch is exit 1.
- `answer-not-asking` a live Dispatch whose Implementer is not Asking is exit 1.
- `answer-typed` an answer, by the user or `--by faux-nico`, is typed as `herdr agent prompt <implementer> <text> --wait --until working --timeout 30000`; with herdr stubbed that is exit 1 and nothing is recorded.

## How to get to it (user POV)

- The user sees an Asking in `nico-agent status` or the page's needs-you strip and runs
  `nico-agent answer <issue> --text <text>`.
- A faux-nico, started on an Asking in a Repo with `Faux-nico answers` on, runs
  `nico-agent answer <issue> --text <text> --by faux-nico`.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `E=.evidence/<issue>/answer`; `mkdir -p "$E"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`.
- `$C seed dispatch 7 asking` (its Implementer `impl-fixture-7`) and `$C seed dispatch 9 pr`.
- `$C state > "$E/state.before.txt"`.

- **Usage.** Each exit `2` with `help` the usage `` Run `nico-agent answer <issue> --text <text> [--by faux-nico]` ... ``:
  `answer verify/fixture#7 --json` (`--evidence "$E/01-no-text"`) `--text is required`;
  `answer verify/fixture#7 --text "" --json` (`02-empty`), `answer verify/fixture#7 --text --by faux-nico --json`
  (`03-then-by`) and `answer verify/fixture#7 --text --by=faux-nico --json` (`04-then-by-joined`)
  `--text needs a value`; `answer verify/fixture#7 --text "Keep it." --by bob --json` (`05-bob`)
  `` `bob` is not an author: user or faux-nico ``; `answer verify/fixture#7 --txt "Keep it." --json`
  (`06-unknown-flag`) `` unknown flag --txt for `answer` ``.
- **No Dispatch.** Run `$C run --evidence "$E/07-no-dispatch" -- answer verify/fixture#8 --text "Keep it." --json`.
  Exit `1`, `error` `verify/fixture#8 has no live Dispatch`.
- **Not Asking.** Run `$C run --evidence "$E/08-not-asking" -- answer verify/fixture#9 --text "Keep it." --json`.
  Exit `1`, `error` `verify/fixture#9 is not Asking`.
  `$C state` still matches `state.before.txt`: no refusal wrote anything or called out.
- **Typed.** Run `$C run --evidence "$E/09-typed" -- answer verify/fixture#7 --text "Keep it." --json`,
  then with `--by faux-nico` (`10-faux-nico`). Each exit `1`,
  `` `herdr agent prompt` failed: verify_stub: herdr is a stub in this verification run ``.
- **Text starting with `--`.** Run `$C run --evidence "$E/11-dash-text" -- answer verify/fixture#7 --text "--force is fine" --json`
  and `$C run --evidence "$E/12-dash-text-joined" -- answer verify/fixture#7 "--text=--force is fine here" --json`.
  Each exit `1` with the same herdr stub error, not exit `2`.
- **Proof.** `$C state > "$E/state.after.txt"`; its diff from `state.before.txt` is four outside
  calls, in order: `herdr agent prompt impl-fixture-7 Keep\ it. --wait --until working --timeout 30000`
  twice, then `herdr agent prompt impl-fixture-7 --force\ is\ fine ...` and `... --force\ is\ fine\ here ...`;
  `dispatches.json` is unchanged. Copy `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- Nothing is recorded in a run: the herdr stub refuses the prompt, so `answers` stays empty and the
  same answer again is typed again, not `already recorded (no-op)`.
- `outside.log` quotes each argument shell-style: `--force\ is\ fine` is one argument, the text as
  given. Real herdr takes it as `<TEXT>`; `-- <text>` would be refused (`unknown option`).
- `status` between steps calls `gh api user` and `herdr agent list`, which then show in the diff.
