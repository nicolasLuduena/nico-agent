# nico-agent verification map

Pick the feature files the change touches from the list below; each is a recipe for the Drive loop in [`SKILL.md`](../SKILL.md), and its first paragraph says what it covers. [`REFERENCE.md`](./REFERENCE.md) has the fixtures and the stable handles.

## Feature file shape

An H1 title, one paragraph on the user-visible behaviour, then exactly four H2 sections in this order: `Sub-features` (short IDs, one line each), `How to get to it (user POV)` (every entry point), `Driving it with control-nico-agent` (starts with `Preconditions:`, then labelled bullets pairing each user action with an exact command and observable result), `Gotchas`. Write only user paths, stable handles, required state, commands and observable Evidence.

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
- [GitHub rate-limit gauge](./rate-gauge.md)
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

Not yet mapped (drive by hand, then add a file): the faux-nico, gardening and quality-scan triggers, the map's node layout beyond what the tabs and project-tabs files assert, the morning agent writing `morning.md` (off in a run: set `morning.enabled = true` and `hour` to the current one to drive it), the theme switch, `serve` restarting Dispatches after a reboot, the notification once 3 ticks in a row fail and once one works again (a run ticks every 600 minutes), `scripts/install-service.sh` and the unit it writes (`tests/install_service.rs` covers it; drive it with `systemctl` stubbed on `PATH` and a scratch `HOME`), and everything that needs a live herdr or GitHub: `cargo test` covers those through the fake World.
