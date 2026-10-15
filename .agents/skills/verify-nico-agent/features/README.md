# nico-agent verification map

The maintained source for verifying nico-agent's user-facing behaviour: its CLI and serve's page. Pick the feature files the change touches from the list below and use each as the recipe; its first paragraph says what it covers. [`REFERENCE.md`](./REFERENCE.md) has the fixtures and the stable handles.

## Conventions

- `export VERIFY_RUN_ID=<issue>`, `C=.agents/skills/verify-nico-agent/control-nico-agent`, from the repo root. A fresh run per feature: `$C cleanup; $C launch --no-build` (plain `launch` the first time), then `$C doctor` passes and `. "$($C env)"`. The scratch config has no Repo until the recipe adds one; serve has ticked once, with none.
- Make the feature's evidence folder first: `E=.evidence/<issue>/<feature>; mkdir -p "$E"`, `<feature>` being the file's name without `.md`.
- Every command is literal: keep flag names and quoted values unchanged. CLI through `$C run [--evidence PREFIX] -- <args>`, always with `--json` (the plain output is not a contract); `/api` through `$C http`, with the JSON body the page sends; the page through `$C page`, by ARIA role and accessible name (`ROLE~NAME` only where the name carries a time). Outside state changes only through `$C seed` and `$C drift`; read it through `$C state`.
- Issue numbers: 1 to 6 from `seed issues`, verify/second's 1 to 3 from `seed issues second`, above 6 for `seed dispatch` (not 20).
- Proof: `.cmd` and output per invocation; `state` before and after and their diff (empty for a read, or only the outside calls the feature names; the written file plus a second view of it for a mutation); for the page, the ARIA snapshot, the screenshot and `.requests.txt`; a copy of `outside.log` in every feature folder. Report an unreachable path with the attempted command and the unmet precondition; never report a skipped entry point as verified through a different path.

## Feature file shape

An H1 title, one paragraph on the user-visible behaviour, then exactly four H2 sections in this order: `Sub-features` (short IDs, one line each), `How to get to it (user POV)` (every entry point), `Driving it with control-nico-agent` (starts with `Preconditions:`, then labelled bullets pairing each user action with an exact command and observable result), `Gotchas`. Name only user paths, stable handles, required state, commands and observable proof; no implementation details.

## Features

- [Add, remove and list Repos](./repos.md)
- [Projects](./projects.md)
- [Status](./status.md)
- [Dispatch's refusals](./dispatch-refusals.md)
- [Verdict recording to the Bucket](./verdict-bucket.md)
- [The page's tabs and strip](./page-tabs-strip.md)
- [A tab and a map per Project](./project-tabs.md)
- [A Dispatch the Reviewer kept failing](./rulings.md)
- [Where each PR's review stands](./review.md)
- [Settings](./settings.md)
- [Switches](./switches.md)
- [Mine: only issues assigned to you, and Assign to me](./mine.md)
- [Room](./room.md)
- [Readiness checks](./checks.md)
- [Install](./install.md)
- [Refresh](./refresh.md)
- [Answer an Asking Implementer](./answer.md)
- [Live updates](./live-updates.md)
- [The Morning summary on the page](./morning.md)
- [Build a Repo's Wiki](./wiki-build.md)
- [Serve Wikis to agents through the MCP](./wiki-mcp.md)
- [Read a Wiki on its page](./wiki-view.md)
- [Define the names a Wiki's text uses, as Terms](./wiki-terms.md)
- [Update a Wiki and see what is Stale](./wiki-update.md)
- [Set up Wikis from the page](./wiki-settings.md)
- [Wiki builds from the loop](./wiki-runs.md)
- [Update, Rebuild and Continue a Wiki from the page](./wiki-buttons.md)
- [A Wiki build's progress on the page](./wiki-progress.md)
- [Library Wikis](./library-wikis.md)
- [Libraries on the page](./library-links.md)
- [The panel's forms](./forms.md)
- [The page's colours](./palette.md)
- [Requests from other sites](./foreign-requests.md)

Not yet mapped (drive by hand, then add a file): the faux-nico, gardening and quality-scan triggers, the map's node layout beyond what the tabs and project-tabs files assert, the morning agent writing `morning.md` (off in a run: set `morning.enabled = true` and `hour` to the current one to drive it), the theme switch, `serve` restarting Dispatches after a reboot, and everything that needs a live herdr or GitHub: `cargo test` covers those through the fake World.
