# Readiness checks

Each Repo's Readiness checks say what will break it before the loop hits it: its clone, a fetch that
asks nothing, `.evidence/` ignored and a verification skill on its Base's tip, the skills its steps'
prompts name for their Harness, and the GitHub App on it. They run when serve starts, on Refresh and
after a write to the Repo's or its Project's settings, never on a plain tick, and stop nothing. Each
failing one is a `Check` row in the needs-you strip and an errata block in the tab's Readiness
section, with its help; once the user does what the help says, the next run passes it.

## Sub-features

- `checks-status` `status --json` and `GET /api/status` show per Repo `checks: {at, results: [{name, ok, said, help}]}`, in the order clone, fetch, evidence, verification, skills, bot; `checks.json` holds the same.
- `checks-refresh` Refresh (CLI or button) runs them for every Repo; a Repo added by `repo add` has none until then.
- `checks-strip` each failing one is a `Check <slug>: <said>` row in `region "Needs you"`, its help under it.
- `checks-panel` the tab's `region "Readiness"` shows each failing one with its help, the passing ones folded under `N of M pass`, and `Unchanged since <time>`.
- `checks-settings-write` a PATCH of the Repo's settings or switches checks it again: with Review off, the Reviewer's `verdict` skill is no longer asked for.
- `checks-flip` a fixed one passes on the next run, and `at` moves only when a result changed.
- `checks-fetch-base` the evidence and verification checks read the Base's tip after fetching it, so a fix pushed from elsewhere passes on Refresh.

## How to get to it (user POV)

- Read the needs-you strip or a Repo's tab on the page, after serve starts or a Refresh.
- Run `nico-agent status --json` and read `repos[].checks`.
- Change a setting or switch on the tab; the Repo is checked again.

## Driving it with control-nico-agent

Preconditions:

- A fresh run; `doctor` passes; `. "$($C env)"`; `R` the run dir (`dirname "$CONFIG_DIR"` up to
  `.../<VERIFY_RUN_ID>`, i.e. `${VERIFY_RUN_ROOT:-${TMPDIR:-/tmp}/verify-nico-agent}/$VERIFY_RUN_ID`).
- `$C run -- repo add verify/fixture --path "$FIXTURE_CLONE" --json` (no `seed issues`: its
  dispatches would crowd the strip).
- `E=.evidence/<issue>/checks; mkdir -p "$E"`; `$C state > "$E/state.before.txt"`; `: > "$OUTSIDE_LOG"`.

- **Refresh.** Run `$C run --evidence "$E/01-refresh" -- refresh --json`: exit `0`. Run
  `$C run --evidence "$E/02-status" -- status --json`: `repos[0].checks.results` is, in order,
  `clone` ok (`<clone> is a clone of verify/fixture`), `fetch` ok (`<clone> fetches from origin
  without asking`), `evidence` failing (`.evidence/ is not ignored on main`), `verification` failing
  (`main has no verification skill under .agents/skills/verify-*/`), `skills` failing (`no implement
  skill for claude, the Implementer's Harness; no research skill for claude, ...; no verdict skill
  for codex, the Reviewer's Harness`, help `Install implement in one of ~/.claude/skills,
  <clone>/.claude/skills; ...`), `bot` failing (`could not check the GitHub App on verify/fixture:
  \`ghbot api /installation/repositories\` failed: ...`); each failing one has a `help`, each ok one
  `help` null. `$OUTSIDE_LOG` has `gh api user --jq .login` lines and one `ghbot api
  /installation/repositories ...` (git is real, on the run's repos, so not in it).
- **Page.** Run `$C page --evidence "$E/03-page" --expect "Readiness"`: `region "Needs you"` has a
  `Check verify/fixture:` row for each of the four failing checks, its help under what it says;
  `region "Readiness"` has the four on the errata rule, a `group` reading `2 of 6 pass` and `Unchanged since
  <time>`.
- **Settings write.** Install the two skills the help names, as the user would, in the scratch HOME:
  `for s in implement research; do mkdir -p "$R/home/.claude/skills/$s" && echo "---" > "$R/home/.claude/skills/$s/SKILL.md"; done`.
  `: > "$OUTSIDE_LOG"`; run `$C http --evidence "$E/05-review-off" PATCH /api/repo/verify/fixture/switches '{"review":false}'`:
  HTTP `200`; `$OUTSIDE_LOG` is one `ghbot api /installation/repositories ...` line. Run
  `$C run --evidence "$E/06-status-after-patch" -- status --json`: `skills` is ok (`each skill a
  step names is installed for its Harness`), and `at` is now.
- **Fix pushed elsewhere.** Push `.evidence/` ignored to `main` from another clone:
  `P=$R/tmp/push; HOME=$R/home git clone -q https://github.com/verify/fixture.git "$P" && printf '.evidence/\n' > "$P/.gitignore" && HOME=$R/home git -C "$P" add .gitignore && HOME=$R/home git -C "$P" commit -qm "Ignore .evidence/" && HOME=$R/home git -C "$P" push -q origin HEAD:main`.
  `git -C "$FIXTURE_CLONE" rev-parse origin/main` is still the old tip. Run
  `$C page --evidence "$E/08-refresh" --click "button=Refresh" --gone ".evidence/ is not ignored on main"`:
  `ok` for both steps; `.requests.txt` has `POST /api/refresh -> 200`; the strip keeps the
  verification and bot rows only; a `group` reading `4 of 6 pass`. `git -C "$FIXTURE_CLONE" rev-parse origin/main`
  is now the pushed commit: the check fetched the Base first.
- **Proof.** `$C run --evidence "$E/09-status-end" -- status --json`: `evidence` ok (`.evidence/ is
  ignored on main`). `$C state > "$E/state.after.txt"`, diff it against `state.before.txt`:
  `checks.json` changed and `config.toml` gained `switches = { review = false }`. Copy
  `$OUTSIDE_LOG` to `$E/outside.log`.

## Gotchas

- In a run `ghbot` is a stub that fails, so the bot check always fails with `gh auth login`'s text;
  that is the check working, not a broken run.
- The scratch HOME has no skills, and its `~/` is what the skills check reads: install them under
  `$R/home`, never your own `~/.claude/skills`.
- serve checks at start, before any Repo exists in a fresh run, so `checks.json` is `{}` until a
  Refresh or a settings write; `repo add` alone checks nothing.
- Pushing to the fixture's origin needs the scratch `HOME`: its `.gitconfig` is what rewrites the
  github.com URL to the run's bare repo.
