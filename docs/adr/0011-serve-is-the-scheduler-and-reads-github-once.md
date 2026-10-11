# serve is the Scheduler, and the one reader of GitHub

Amends ADR-0009 and ADR-0010, which have `advance` run by a systemd user timer
as the floor that keeps Specs moving. That timer and `serve` both read GitHub
on the user's own `gh` budget, and together with the Board's polling they spent
it within the hour, leaving the user's `gh` rate-limited too. So the timer is
gone: `serve` runs `advance` every 10 minutes, and reads GitHub for the Board,
the Lead's `board` tool and `advance` through one cache, kept a minute and
dropped after anything nico-agent does through it. Where the bot's GitHub App
is installed, it reads as the bot, whose rate limit is its own. (_Amended by
ADR-0015: `serve` reads GitHub only in a Sync, and the app and the Lead's
`board` tool read its Local state._)

## Consequences

- No Spec moves while `serve` is down; `nico-agent advance` by hand still works.
- A dispatch, Close or Queue change typed in a terminal runs in its own process,
  so `serve`'s Board may show it up to a minute late.
