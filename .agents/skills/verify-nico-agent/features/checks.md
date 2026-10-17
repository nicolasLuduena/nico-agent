# Readiness checks

Each Repo's Readiness checks say what will break it before the loop hits it: its clone, a fetch that
asks nothing, `.evidence/` ignored and, while Review is on, a Verification skill on its Base's tip,
the skills its steps' prompts name for their Harness (and the skills each of those calls, one
level deep; claude's installed plugins count for claude), whether the GitHub App is on it (it passes
without, saying its PRs are opened as you; only failing to ask fails), and whether herdr's server
answers its client (after an upgrade a server on the old protocol refuses every call). They run when serve starts, on Refresh and
after a write to the Repo's or its Project's settings, never on a plain tick, and stop nothing. Each
failing one is a `Check` toast over the page's corner and an errata block in the tab's Readiness
section, with its help; once the user does what the help says, the next run passes it.

## Sub-features

- `checks-status` `status --json` and `GET /api/status` show per Repo `checks: {at, results: [{name, ok, said, help}]}`, in the order clone, fetch, evidence, verification (while Review is on), skills, bot, herdr; `checks.json` holds the same.
- `checks-posts-as` `status --json` and `GET /api/status` show per checked Repo `posts_as`, read from its bot check: the bot's login (`nicolasluduena-coding-agent[bot]`) once the App was found on it, else `"you"`; the tab says it under the Repo's head, `PRs and comments are posted as you` with `link "Install the App"`, or `Agents post as <the bot>`.
- `checks-refresh` Refresh (CLI or button) runs them for every Repo; a Repo added by `repo add` has none until then.
- `checks-toast` each failing one is a `status` toast `Check <slug>: <said>` in `list "Needs you"`, its help under it, its `button "Dismiss <its head>"` dropping it for the page load.
- `checks-panel` the tab's `region "Readiness"`, folded to `N of M pass` and open by itself while one fails, shows each failing one with its help, the passing ones as `list "Passing"`, and `Unchanged since <time>`.
- `checks-settings-write` a PATCH of the Repo's settings or switches checks it again: with Review off, the Reviewer's `verdict` skill is no longer asked for, and there is no verification check.
- `checks-called-skills` each skill a prompted skill's `SKILL.md` calls (each name quoted in the clause after `Skill tool`: `with "x"`, `and "x"`, `` with `x` ``, `twice, for "x" and "y"`) is asked for the same Harness, one level deep, said as `no <name> skill for <harness>, <whose> Harness, which <skill> calls`; for claude a plugin's `skills/` in `~/.claude/plugins/installed_plugins.json` counts, and another Harness missing a skill only a claude plugin has adds `; it is installed only as a claude plugin`.
- `checks-flip` a fixed one passes on the next run, and `at` moves only when a result changed.
- `checks-fetch-base` the evidence and verification checks read the Base's tip after fetching it, so a fix pushed from elsewhere passes on Refresh.

## How to get to it (user POV)

- Read the toasts or a Repo's panel on the page, after serve starts or a Refresh.
- Run `nico-agent status --json` and read `repos[].checks`.
- Change a setting or switch on the tab; the Repo is checked again.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`; `R` the run dir (`dirname "$CONFIG_DIR"` up to
  `.../<VERIFY_RUN_ID>`, i.e. `${VERIFY_RUN_ROOT:-${TMPDIR:-/tmp}/verify-nico-agent}/$VERIFY_RUN_ID`).
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json` (no `seed issues`: its
  dispatches would crowd the map).
- `E=.evidence/<issue>/checks; mkdir -p "$E"`; `$C state > "$E/state.before.txt"`; `: > "$OUTSIDE_LOG"`.

- **Refresh.** Run `$C run --evidence "$E/01-refresh" -- refresh --json`: exit `0`. Run
  `$C run --evidence "$E/02-status" -- status --json`: `repos[0].checks.results` is, in order,
  `clone` ok (`<clone> is a clone of verify/fixture`), `fetch` ok (`<clone> fetches from origin
  without asking`), `evidence` failing (`.evidence/ is not ignored on main`), `verification` failing
  (`main has no Verification skill under .agents/skills/verify-*/`), `skills` failing (`no implement
  skill for claude, the Implementer's Harness; no research skill for claude, ...; no verdict skill
  for codex, the Reviewer's Harness`, help `Install implement in one of ~/.claude/skills,
  <clone>/.claude/skills; ...`), `bot` failing (`could not check the GitHub App on verify/fixture:
  \`ghbot api /installation/repositories\` failed: ...`), `herdr` failing (`\`herdr agent list\` failed:
  verify_stub: herdr is a stub in this verification run`, help `Start herdr; after an upgrade,
  \`herdr server stop\` and start it again so the server's protocol matches the client's`); each failing one has a `help`, each ok one
  `help` null. `repos[0].posts_as` is `"you"`: the bot check could not find the App. `$OUTSIDE_LOG` has `gh api user --jq .login` lines, one `ghbot api
  /installation/repositories ...` and one `herdr agent list` (git is real, on the run's repos, so not in it).
- **Page.** Run `$C page --evidence "$E/03-page" --click "button=Repos" --expect "Readiness"`: `list "Needs you"` has a
  `status` toast `Check verify/fixture:` for each of the five failing checks, its help under what it says, each with `button "Dismiss <its head>"`;
  `region "Readiness"` is open by itself, its `group` reading `Readiness 2 of 7 pass`, with the five on the
  errata rule, `list "Passing"` holding the clone and fetch ones, and `Unchanged since <time>`. The `region "verify/fixture"` panel reads `PRs and comments are posted as you. Install the App`, the
  `link "Install the App"` to `https://github.com/apps/nicolasluduena-coding-agent/installations/new`,
  outside the folded Readiness.
- **Settings write.** Install the two skills the help names, as the user would, in the scratch HOME:
  `for s in implement research; do mkdir -p "$R/home/.claude/skills/$s" && echo "---" > "$R/home/.claude/skills/$s/SKILL.md"; done`.
  `: > "$OUTSIDE_LOG"`; run `$C http --evidence "$E/05-review-off" PATCH /api/repo/verify/fixture/switches '{"review":false}'`:
  HTTP `200`; `$OUTSIDE_LOG` is one `ghbot api /installation/repositories ...` line and one `herdr agent list`. Run
  `$C run --evidence "$E/06-status-after-patch" -- status --json`: `skills` is ok (`each skill a
  step names is installed for its Harness`), there is no `verification` check, and `at` is now.
- **Called skill.** Make the implement skill call another:
  `printf -- '---\nname: implement\n---\nCall the Skill tool with "tdd" where possible.\n' > "$R/home/.claude/skills/implement/SKILL.md"`.
  Run `$C run --evidence "$E/07a-refresh-called" -- refresh --json` and
  `$C run --evidence "$E/07b-status-called" -- status --json`: `skills` fails, `no tdd skill for
  claude, the Implementer's Harness, which implement calls`, help `Install tdd in one of
  ~/.claude/skills, <clone>/.claude/skills`.
- **Claude plugin.** Install `tdd` only as a claude plugin:
  `P="$R/home/.claude/plugins/cache/kit/kit/1.0.0"; mkdir -p "$P/skills/tdd" && echo "---" > "$P/skills/tdd/SKILL.md" && printf '{"version":2,"plugins":{"kit@kit":[{"installPath":"%s"}]}}\n' "$P" > "$R/home/.claude/plugins/installed_plugins.json"`.
  `$C run --evidence "$E/07c-refresh-plugin" -- refresh --json`, then
  `$C run --evidence "$E/07d-status-plugin" -- status --json`: `skills` is ok. Copy the two skills
  for codex, `mkdir -p "$R/home/.agents/skills" && cp -r "$R/home/.claude/skills/"{implement,research} "$R/home/.agents/skills/"`,
  and run `$C http --evidence "$E/07e-implementer-codex" PATCH /api/repo/verify/fixture '{"implementer":{"harness":"codex"}}'`
  and `$C run --evidence "$E/07f-status-codex" -- status --json`: `skills` fails, `no tdd skill for
  codex, the Implementer's Harness, which implement calls; it is installed only as a claude plugin`.
  Put it back with `$C http --evidence "$E/07g-implementer-claude" PATCH /api/repo/verify/fixture '{"implementer":null}'`;
  `$C run --evidence "$E/07h-status-claude" -- status --json`: `skills` is ok again.
- **Fix pushed elsewhere.** Push `.evidence/` ignored to `main` from another clone:
  `P=$R/tmp/push; HOME=$R/home git clone -q https://github.com/verify/fixture.git "$P" && printf '.evidence/\n' > "$P/.gitignore" && HOME=$R/home git -C "$P" add .gitignore && HOME=$R/home git -C "$P" commit -qm "Ignore .evidence/" && HOME=$R/home git -C "$P" push -q origin HEAD:main`.
  `git -C "$FIXTURE_CLONE" rev-parse origin/main` is still the old tip. Run
  `$C page --evidence "$E/08-refresh" --click "button=Refresh" --gone ".evidence/ is not ignored on main"`:
  `ok` for both steps; `.requests.txt` has `POST /api/refresh -> 200`; the toasts keep the
  bot and herdr checks only; `region "Readiness"` reads `Readiness 4 of 6 pass`, those two on the errata rule and
  four in `list "Passing"`. `git -C "$FIXTURE_CLONE" rev-parse origin/main`
  is now the pushed commit: the check fetched the Base first.
- **Proof.** `$C run --evidence "$E/09-status-end" -- status --json`: `evidence` ok (`.evidence/ is
  ignored on main`). `$C state > "$E/state.after.txt"`, diff it against `state.before.txt`:
  `checks.json` changed and `config.toml` gained `switches = { review = false }`. Copy
  `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- In a run `ghbot` is a stub that fails, so the bot check always fails with `gh auth login`'s text;
  that is the check working, not a broken run. So `posts_as` is always `"you"`; the bot's side is
  `cargo test`'s (`tests/checks.rs`). The herdr check fails too, with the stub's `verify_stub`.
- The scratch HOME has no skills, and its `~/` is what the skills check reads: install them under
  `$R/home`, never your own `~/.claude/skills`.
- serve checks at start, before any Repo exists in a fresh run, so `checks.json` is `{}` until a
  Refresh or a settings write; `repo add` alone checks nothing.
- Pushing to the fixture's origin needs the scratch `HOME`: its `.gitconfig` is what rewrites the
  github.com URL to the run's bare repo.
