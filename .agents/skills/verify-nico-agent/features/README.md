# nico-agent verification map

This directory is the maintained source for verifying the user-facing behavior of nico-agent: its
CLI and serve's page. Read the index before driving, then use the matching feature file as the
recipe.

## Baseline preconditions

- `export VERIFY_RUN_ID=<issue>`, `C=.agents/skills/verify-nico-agent/control-nico-agent`, from the
  repo root.
- A fresh run per feature: `$C cleanup; $C launch --no-build` (plain `launch` the first time, to
  build), then `$C doctor` passes and `. "$($C env)"` gives `$FIXTURE_CLONE`, `$SECOND_CLONE`,
  `$CONFIG_DIR`, `$BUCKET`, `$URL` and `$OUTSIDE_LOG`.
- The scratch config has no Repo until the recipe adds one; serve has ticked once, with none.
- Never run the binary with your real `HOME`, and never drive a serve this run did not launch.

## Driving conventions

- Make the feature's evidence folder first: `E=.evidence/<issue>/<feature>; mkdir -p "$E"`, the
  `<feature>` being the file's name without `.md`.
- Treat every command as literal; keep flag names and quoted values unchanged.
- Run CLI actions through `$C run [--evidence PREFIX] -- <args>`, always with `--json`; the plain
  output is not a contract.
- Run `/api` actions through `$C http`, with the JSON body the page sends.
- Run page actions through `$C page`, by ARIA role and accessible name; `ROLE~NAME` only where the
  name carries a time (strip rows).
- Change outside state only through `$C seed` and `$C drift`; read state through `$C state`.
- Use the issue numbers the fixtures give: 1 to 6 from `seed issues`, verify/second's 1 to 3
  from `seed issues second`, above 6 for `seed dispatch` (not 20: `seed issues second`'s closed
  Blocker).
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state: `.cmd` and output per invocation.
- Read-only proof includes `state` before and after and their diff: empty, or only the outside
  calls the feature file names.
- Mutation proof includes the `state` diff showing the written file and a second view of it (`repo
  list`, `status`, the page, the Bucket over `/bucket/`).
- Page proof includes the ARIA snapshot, the screenshot and `.requests.txt`.
- Every feature folder holds a copy of `outside.log`.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior.
It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-nico-agent` starts with `Preconditions:` and uses labeled bullets that
   pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state,
commands, and observable proof.

## Features

- [Add, remove and list Repos](./repos.md) covers `repo add|rm|list` (`--project` too), their
  refusals and no-ops, the Bucket `repo add` makes, and the page's Add a Repo and Remove, through
  `POST /api/repo` and `DELETE /api/repo/<slug>`, refused while a Dispatch is In flight.
- [Projects](./projects.md) covers `projects.<name>` and a Repo's `project` in `config.toml`:
  defaults its Repos inherit, `repo list`'s `project`, `status`'s `projects` and `{value, from}`
  per setting, the page's effective Room and switches, and a bad Project refused at its line.
- [Status](./status.md) covers `status` and `GET /api/status` from a fresh cache (an issue waiting
  on its Blocker with why), a Source that refuses, a stale cache, a paused GitHub, Dispatches with
  their Stage, and blocked Runs.
- [Dispatch's refusals](./dispatch-refusals.md) covers every refusal of `dispatch`, `POST
  /api/dispatch` and the page's Dispatch form, down to a Ready issue failing at its first herdr step,
  and its Claim while GitHub is paused.
- [Verdict recording to the Bucket](./verdict-bucket.md) covers `verdict` pass and fail, its
  refusals, the Bucket commits on a PR head and a Verdict, `/bucket/` and the node panel's Evidence
  links.
- [The page's tabs and strip](./page-tabs-strip.md) covers the tabs of Repos each its own Project
  (click, keys, phone select) and the needs-you strip's Asking, Blocked, Failed, Review, Verified
  and Paused rows (its Check rows are in [checks.md](./checks.md)).
- [A tab and a map per Project](./project-tabs.md) covers a Project of two Repos on the page: one
  tab, `GET /api/map/<project>` with nodes from both, each naming its Repo, a Blocker edge across
  them and an outside Blocker with no Stage, a Waiting node saying why, an issue waiting on a
  Blocker in another Repo to close and then on that Repo's Install, the Project's defaults
  edited on the tab reaching every Repo that does not set its own, the phone select and a strip row
  opening the Project's tab.
- [Where each PR's review stands](./review.md) covers `review` in `status` and the page: the node's
  line under a PR draft Stage, the panel's Review section, and the strip's Review row for a review
  given up on.
- [Settings](./settings.md) covers the Settings section of a Repo's tab (Implementer and Reviewer
  launches, Base, Project), each setting's `default`/`project` tag and its Use the default (or the
  Project's), `PATCH /api/repo/<slug>` and `PATCH /api/project/<name>`, their refusals, and a launch
  set on the page surviving a restart of serve.
- [Switches](./switches.md) covers `PATCH /api/repo/<slug>/switches`, the page's toggles, what is
  written to `config.toml`, and the loop obeying a switch turned off.
- [Room](./room.md) covers `PATCH /api/repo/<slug>` with `{room}`, the page's Room input and its
  in-flight line, what is written to `config.toml`, and the loop filling a raised room.
- [Readiness checks](./checks.md) covers each Repo's checks (clone, fetch, `.evidence/` ignored,
  verification skill, skills, GitHub App) in `status`, `checks.json`, the needs-you strip's Check
  rows and the tab's Readiness section; run on Refresh and after a settings write, and flipping
  once the user fixes what one says.
- [Install](./install.md) covers a Repo's `install` command set on its tab or by `PATCH`, refused
  for a Project, `nico-agent install` pulling fast-forward and running it, its refusals off the Base
  or with tracked changes, a failed one, one at a time with one more queued, the tick starting the
  queued one, and the strip's Install row and the tab's Install section.
- [Refresh](./refresh.md) covers the page's Refresh button, `POST /api/refresh` and `nico-agent
  refresh`, and what the tick it runs does, down to a Stacked dispatch whose PR below merged or
  closed unmerged.
- [Answer an Asking Implementer](./answer.md) covers `answer`, its refusals, a text starting with
  `--`, and the answer typed through herdr (stubbed, so not recorded in a run).
- [Live updates](./live-updates.md) covers `GET /api/events` (`changed`, and a keepalive otherwise),
  the page left open behind the tunnel, its reconnecting after the stream is lost, and the
  signed-out line when Access's session lapses.
- [The Morning summary on the page](./morning.md) covers `morning.md` shown first on the page, its
  Hide and Show, hidden remembered in the browser across a reload until `morning.md` changes, and
  a browser whose storage throws.
- [Build a Repo's Wiki](./wiki-build.md) covers `wiki build` and its refusals, a failed call
  failing the build with why in `wikis.json`, each call a read-only `opencode2 run`, the Wiki
  landing in the Bucket in one commit, a claim failing a check (an Explainer's arrow to no
  step too) sent back up to 3 rounds in the same session, kept once corrected and dropped as a Gap when not, and the build ending by
  embedding the Wiki through Ollama, or saying it could not.
- [Serve Wikis to agents through the MCP](./wiki-mcp.md) covers `mcp` on stdio: the handshake,
  `tools/list`, `wikis`, `find_component`, `get_component`, `read_anchor` and `ask` on a built
  Wiki, the lines read at the Wiki's commit after the Base moved, `--wiki` limiting what it serves,
  tool errors it goes on answering after, `ask` saying search is unavailable without Ollama and
  answering for real with it, nothing written but `ask`'s embeddings, the server added to
  Claude Code, and each Harness started with it as faux-nico and the morning agent are, calling a
  wiki tool with no question in its pane, and an Implementer given a linked Library version's Wiki
  calling `find_component` on it.
- [Read a Wiki on its page](./wiki-view.md) covers `GET /wiki/<id>` answering the app,
  `GET /api/wikis` and `GET /api/wiki/<id>`, a Project tab's Wiki view listing its Wikis, each
  Wiki's page (`/wiki/<id>#<component>`): its masthead, the Component tree, the Component's trail,
  Interpretations as one list with their kinds and quiet Anchor citations, the Relationship diagram
  and the Explainer clicked through, sub-Components, Gaps and Next, an old Board link and an
  unknown id, back and forward, search, the outline, the sheets, light and dark at desk and phone
  width, through the tunnel, and a real Wiki seeded with `seed wiki`.
- [Update a Wiki and see what is Stale](./wiki-update.md) covers `wiki build --update` asking only
  about the part a changed file is in and dividing again only the part an added file sits under,
  the rest copied in place, and an Interpretation whose file changed on the Base marked `stale` in
  `GET /api/wiki/<id>` and the MCP's `get_component`, with the page's commits behind and Stale
  count, until an Update asks it again (a kept parent's, until a build from scratch).
- [Set up Wikis from the page](./wiki-settings.md) covers the Wiki view's `Wiki settings` sheet
  and `PATCH /api/wiki/settings`: the launch, hour, budget and embedding model of every Wiki, the
  model a select or free text by Harness, `[wiki]` written with its comments kept, refusals inline
  and by PATCH, `wiki_settings` in `GET /api/status`, a real build on claude and on codex, and
  what a real build on the default launch divides and writes.
- [Wiki builds from the loop](./wiki-runs.md) covers the `wiki` switch queueing a build at the next
  refresh, the build's start failing at herdr and its Run closed failed, `status`'s `wikis`, and
  the daily check of a Repo's Base: unmoved, moved (`drift base`) and once a day.
- [Update, Rebuild and Continue a Wiki from the page](./wiki-buttons.md) covers a Wiki's page's masthead:
  build state (`BUILDING`, `QUEUED`, `Last build failed`) and its Update, Rebuild and Continue
  buttons, each `POST /api/wiki/<id>/update|rebuild|continue` queueing its build first even with
  the switch off, `GET /api/wikis`' `state`, `pane`, `why`, `budget` and `calls`, `wiki build
  --continue` asking only the budget Gaps at the Wiki's commit, and the refusals.
- [A Wiki build's progress on the page](./wiki-progress.md) covers `wiki/<folder>/progress.json`
  while a build runs and gone after, `progress` in `status`'s `wikis` and `GET /api/wikis` only
  while its Run is open, the page's calls, depth, parts, Gaps and the parts asked now (two at once)
  moving without a Refresh on a desk and a phone (`seed pace`), and a Wiki never built listed and headed while
  its first build waits, runs or failed.
- [Library Wikis](./library-wikis.md) covers a Library version linked or added in `config.toml`
  queued at the next refresh, built once at its tag (`drift tag`) from a bare clone in the config
  dir reused across versions, covering only its subfolder, an unknown tag failing with why, never
  queued again once built, served by `status`, `/api/wikis`, `/api/wiki/<id>` and the MCP, and a
  bad entry refused at its line.
- [Libraries on the page](./library-links.md) covers a Repo's Libraries section linking and
  unlinking versions through `PATCH /api/repo/<slug>`, queued at once, the Libraries tab adding and
  removing the versions no Repo links (`POST /api/libraries`, `DELETE /api/libraries/<id>`, the
  Wiki's removal one Bucket commit), the refusal of a linked one, and the Wiki view listing
  linked Library Wikis beside the Repos'.
- [Requests from other sites](./foreign-requests.md) covers the 403 serve answers a foreign or
  missing `Host` and a foreign or `null` `Origin` on a write, and the page, `localhost` and the
  tunnel answered as before.

Not yet mapped (drive by hand, then add a file): the faux-nico, gardening and quality-scan
triggers, the map's node layout beyond what the tabs and project-tabs files assert, the morning agent writing `morning.md` (off in a run: set `morning.enabled = true` and `hour` to the current one to drive it), the theme switch, `serve` restarting Dispatches after a reboot, and everything that needs a live
herdr or GitHub (an Implementer started, a Reviewer started, a PR flipped to ready): `cargo test`
covers those through the fake World.
