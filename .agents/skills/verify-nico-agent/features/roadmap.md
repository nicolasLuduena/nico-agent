# The Roadmap

A Project's second view, the `Roadmap` tab beside `Map`, at `#<project>/roadmap`: every open issue
of its Repos not labelled `ready-for-agent`, as each Source read last kept it, in a lane per label left
to right (`NEEDS-TRIAGE`, `NEEDS-INFO`, `READY-FOR-HUMAN`, `WONTFIX`, then `NO LABEL`; an issue in the
first its labels match; an empty lane not drawn), with an arrow from each open Blocker on it to the issue
it blocks. Opening a node shows a read-only panel: its title and `#number` link, labels, assignees, body
as Markdown, and "Blocked by" and "Blocks", off the Roadmap too. It asks no Source and writes nothing:
with GitHub unreachable it shows the last read. `GET /api/roadmap/<project>` answers it.

## Sub-features

- `roadmap-api` `GET /api/roadmap/<project>` answers `lanes`, `nodes` (each with `key`, `repo`, `title`, `url`, `lane`, `labels`, `assignees`, `body`, `blocked_by`, `blocks`) and `edges` (`kind` `blocker`); a name that is no Project is a 404.
- `roadmap-view` `link "Roadmap"` opens `region "Roadmap of <project>"`, a button per node named `#<n>, <title>, <lane>`.
- `roadmap-panel` a node opens `region "<title>"`, its `#<n>` link over the title, with Labels, Assigned, Description, Blocked by and Blocks; nothing to press but `button "Close"` and links.
- `roadmap-last-read` with GitHub unreachable, a refresh keeps the Roadmap as last read.
- `roadmap-phone` under 720px the Roadmap scrolls inside its field and the panel is a bottom sheet.

## How to get to it (user POV)

- Serve's page: pick the Project, then the `Roadmap` tab under its header; or open `#<project>/roadmap`.
- `GET /api/roadmap/<project>` with curl, the name percent-encoded.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`.
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json`;
  `$C http PATCH /api/repo/verify/fixture/switches '{"dispatch":false}'`, so the refresh below starts nothing; `$C seed issues`.
- `E=.evidence/<issue>/roadmap`; `$C state > "$E/state.before.txt"`.

- **The route.** Run `$C http --evidence "$E/01-roadmap-api" GET /api/roadmap/verify%2Ffixture`: HTTP `200`;
  `lanes` `["needs-triage","needs-info","no label"]`; `nodes` `#2` (`no label`, `blocks` `#30`), `#9`
  (`no label`, `blocks` `#6`, a Ready issue off the Roadmap), `#30` (`needs-triage`, `labels`
  `["needs-triage","bug"]`, `assignees` `verify-nico` as `you` and `someone-else`, its Markdown `body`,
  `blocked_by` `#2`, `blocks` `#31`) and `#31` (`needs-info`, `blocked_by` `#30`); no `ready-for-agent`
  issue; `edges` `#2` to `#30` and `#30` to `#31`. Run `$C http --evidence "$E/02-no-project" GET /api/roadmap/nope`:
  HTTP `404`, `nope is not a Project`.
- **The view.** Run `$C page --evidence "$E/03-roadmap-link" --click "link=Roadmap" --expect "Verify: needs triage"`.
  The address ends `#verify%2Ffixture/roadmap`; `link "Roadmap"` is the current one; `region "Roadmap of verify/fixture"`
  has `button "#30, Verify: needs triage, needs-triage"`, `#31, Verify: needs info, needs-info`, `#2, Verify: not labelled, no label`
  and `#9, Verify: a Blocker in review, no label`. The screenshot draws the lanes `NEEDS-TRIAGE`, `NEEDS-INFO`
  and `NO LABEL` left to right, an arrow from `#30` straight into `#31`, and one from `#2` over the lanes into `#30`'s
  right side. `.requests.txt` has `GET /api/roadmap/verify%2Ffixture -> 200` and no write.
- **A node.** Run `$C page --evidence "$E/04-panel" --hash "#verify%2Ffixture/roadmap" --expect "herdr server stop" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~#30, Verify: needs triage"`.
  The node is `[pressed]`; `region "Verify: needs triage"` holds `link "#30"`, Labels `needs-triage, bug`,
  Assigned `you, someone-else`, Description with `Why` in bold, the list `keep it`, `drop it`, `README.md` as
  code and `link "https://example.com/spec"`, Blocked by `link "#2"` `Verify: not labelled`, Blocks
  `link "#31"` `Verify: needs info`; its only button is `Close`. `.requests.txt` has no write.
- **Phone.** Run `$C page --evidence "$E/05-phone" --width 390 --hash "#verify%2Ffixture/roadmap" --expect "herdr server stop" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~Dismiss" --click "button~#9, Verify"`:
  `.view.txt` says the page is no wider than the window; the panel is a sheet at the bottom of the screenshot.
- **Last read.** Run `$C run --evidence "$E/06-refresh" -- refresh --json` (the `gh` stub fails every read), then
  `$C http --evidence "$E/07-after-refresh" GET /api/roadmap/verify%2Ffixture`: the same body as `01-roadmap-api`.
- **Proof.** `$C state > "$E/state.after.txt"`; the diff holds only the refresh's outside calls. Copy `$OUTSIDE_LOG` to `$E/outside.log`: only the refresh's `gh` and `ghbot` calls
  and `herdr agent list`, none from the Roadmap.

## Gotchas

- `seed issues` keeps `#9`, `#30` and `#31` in the read's `open` list only: they are not in `issues`,
  so the map and `status` don't show them, as a GitHub read keeps them.
- The Readiness checks' five toasts arrive a moment after the page loads and cover the panel on a
  desktop and the Roadmap on a phone: `--expect` the last one's text, then dismiss each before clicking a node.
- A node's button names its lane by its label (`needs-triage`); the frame shows it in capitals.
