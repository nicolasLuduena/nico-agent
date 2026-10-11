# nico-agent

The rebuild of nico-agent as one Rust binary, on branch `loop`: a localhost
loop that works `ready-for-agent` issues overnight on herdr. Read
`PRODUCT.md` (what it is and why) and `GLOSSARY.md` (the words to use) before
changing anything. The work is cut in spec #230 (`gh issue view 230`) and its
sub-issues; branch from `loop` and open PRs against it.

The TypeScript build on branch `main` is reference, not code to reuse: read
it with `git show main:<path>` for call shapes and edge cases.

## The one seam

Everything outside the process (herdr, git, `gh`, Linear, notifications, the
clock, timers, HTTP) is reached through the `World` trait in `src/world.rs`,
and nothing else. A new outside call is a new `World` method with its real
implementation and its `FakeWorld` twin in `tests/common/fake_world.rs`,
recording the call as the command it stands for.

Tests drive the library entry `run` as the CLI would, through `setup()` and
`cli()` in `tests/common/mod.rs`, and assert on three things only: the
command's JSON, `world.calls()`, and the files in the config directory. The
loop's tick is driven by `t.tick()`, which returns its lines; `serve` by
`cli(&["serve"])` after setting `world.timer_runs`, its log read with
`world.logged()`.

CI (`.github/workflows/ci.yml`) runs `cargo test` and
`cargo clippy --all-targets -- -D warnings` on every pull request; run both
before opening one.

# GitHub identity

Work done by coding agents must be visibly attributed to the bot account
`nicolasluduena-coding-agent[bot]`.

`ghbot` is a local wrapper that runs `gh` with a GitHub App installation
token. Its source lives on branch `main`: `bin/ghbot` and `bin/gh-bot-token`,
symlinked into `~/.local/bin`. Credentials stay outside the repo in
`~/.config/gh-bot/` (template: `bin/gh-bot.config.env.example`). Never commit
the config, the private key, or the token cache.

Use `ghbot ...` instead of `gh ...` for:

- **Opening pull requests**: `ghbot pr create ...`
- **Issue comments, PR comments, and PR review replies** posted on your own
  initiative

Read-only calls (`gh pr view`, `gh issue view`, ...) and anything a human is
directing interactively through their own `gh` stay on the normal `gh`
session. Pushes use the normal git credentials.

Every body posted through `ghbot` (PR descriptions included) ends with a
fingerprint line naming the model that wrote it, exactly in this shape
(blank line before it):

```
_Posted by Claude Opus 5.5 (`claude-opus-5-5`) via Claude Code._
```

Substitute your own model name, model id, and tool. `ghbot` refuses a body
without this line.

Every commit an agent makes carries the bot as co-author, as the last
trailer block of the message:

```
Co-authored-by: nicolasluduena-coding-agent[bot] <324920906+nicolasluduena-coding-agent[bot]@users.noreply.github.com>
```

Keep any co-author trailer your own tool adds as well.

## Agent skills

- **Issue tracker**: GitHub Issues for `nicolasLuduena/nico-agent`, via `gh`.
- **Triage labels**: the five canonical ones, unchanged: `needs-triage`,
  `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- **Domain docs**: single-context, `GLOSSARY.md` at the repo root.
