# nico-agent

A localhost web app and CLI for dispatching coding agents onto
`ready-for-agent` issues. You pick the issue, harness, model and effort;
nico-agent opens a herdr worktree workspace, starts the implementer (and
later a reviewer) in named tabs, and sends the harness-specific skill call.

# GitHub identity

Work done by coding agents must be visibly attributed to the bot account
`nicolasluduena-coding-agent[bot]`.

`ghbot` is a local wrapper that runs `gh` with a GitHub App installation
token. Its source lives in this repo: `bin/ghbot` and `bin/gh-bot-token`,
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

### Issue tracker

Issues live in GitHub Issues for `nicolasLuduena/nico-agent` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage labels, unchanged: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
