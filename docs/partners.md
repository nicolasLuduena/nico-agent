# Partners

A Partner is an agent you talk with in its own tab of the app, apart from the
Lead (ADR-0014): the **Review** tab holds the Review partner, the **Ideas** tab
the Idea partner, one each. It knows nothing of the Board, other Repos or the
Standing orders, and reaches the Lead only when you hand it off.

## Starting one

In its tab, pick what it works on and the Harness, model and Effort (the form
starts on your last launch), and press Start: the Review tab takes an open PR,
picked from the Repos' open PRs or pasted by its URL; the Ideas tab takes a
Repo, listed from the config (`/api/repos`, as `nico-agent repo list --json`
prints it) so it shows at once however slow the Board is, or a local folder.
For a PR, nico-agent fetches the Repo's clone; then it creates a herdr
worktree workspace, starts the agent in a `partner` tab as the herdr agent
`partner-review` or `partner-idea`, and prompts it with the Partner skill,
written to
`~/.config/nico-agent/partners/<tab>/SKILL.md` beside its MCP config. The same
from a shell:

```sh
nico-agent partner prs
nico-agent partner start review --pr https://github.com/acme/api/pull/12 --harness claude --model opus --effort high
nico-agent partner start idea --repo acme/api --harness claude --model opus --effort high
nico-agent partner start idea --folder ~/ideas/new-thing --harness claude --model opus --effort high
nico-agent partner list
```

A start while it runs is a no-op, a failed one resumes from its step, and a
start on another PR, Repo or launch is refused until you end it.

## Reviewing a PR

The Review partner's worktree is a local `partner/review-…` branch at the tip
of the PR's head branch: the head branch itself is usually checked out in its
Implementer's worktree already, and git checks a branch out in one worktree
only. The PR's title, description and base are read from GitHub once, when it
starts, into `partners/review/PR.md`, which its prompt names. Both the
checkout and the diff are the PR as it was then: end the Partner and start it
again to review later pushes. A fork's PR
can't be reviewed, since its head is not on the Repo's origin.

The tab shows the PR's diff beside the Thread, read from the checkout with
`git diff origin/<base>...HEAD`, so it costs no GitHub call. Click a file's
path to quote it into your message, click a line to quote it, or drag over
lines of a hunk to quote the range; a quote names the path and line numbers
and carries the lines as a diff.

```sh
nico-agent partner diff review
```

The Review partner may read and run the code, but never pushes, comments,
approves or merges: its MCP server offers no such tool, and its skill forbids
doing it through its shell. Anything of that kind goes to the Lead in a
Hand-off.

## The Thread

What you write is kept in the Partner's Thread, a file under
`~/.config/nico-agent/threads/`, and typed into its pane. The Partner replies
through its own MCP server, `serve`'s `/mcp/partner/<tab>`, which offers only
`say`, `hand_off` and `thread`: no Board read and no action. The tab streams
the Thread as the Lead's panel streams the Conversation, and it survives a
reload and a `serve` restart.

```sh
nico-agent partner say review "What does retry.ts do?"
nico-agent partner log review
```

## Handing off

Ask the Partner for a hand-off (the tab's **Draft a hand-off** button does).
It drafts a summary into the Thread; edit it there if you like, and press
**Hand to the Lead**. Only then does anything reach the Lead: the summary is
appended to its Conversation as your message, starting `Hand-off from the
Review partner (acme/api):`, and the Lead is Nudged.

```sh
nico-agent partner hand-off review 4 --text "Edited summary"
```

## The Idea partner

The Idea partner helps you think a problem through in the Repo you picked. It
reads the code and may run it and its tests, but its skill (the idea role,
after the shared Partner skill) tells it never to edit a file, commit, push or
open an issue or PR: once the idea is handed off, the Lead does that. Its
`hand_off` takes four parts, so its draft is what the Lead turns into a Spec:

```markdown
## Problem
## Approach
## Ruled out
## Open questions
```

Ruled out and Open questions are lists, and read `None.` when empty. The
Ideas tab's **Draft a hand-off** button asks for those parts.

The Idea partner is local first: exploring an idea needs nothing from the
remote, so it starts with the network down. Its worktree starts from the
clone's current default branch as the clone has it, with no fetch:
`origin/HEAD`, else the checked-out branch, else `main`. Run `git fetch` in the
clone first if you want the latest. Pick **Local folder…** (or pass
`--folder`) for an idea with no Repo yet: any directory under your home, read
in place with no worktree; the Partner never changes it.

## Ending one

**End** in the tab, or `nico-agent partner end <tab>`, removes the Partner's
worktree and workspace, which stops its agent. Its Thread's file stays, and so
does a local folder: only its workspace is closed.
