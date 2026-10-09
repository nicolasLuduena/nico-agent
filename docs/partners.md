# Partners

A Partner is an agent you talk with in its own tab of the app, apart from the
Lead (ADR-0014): the **Review** tab holds the Review partner, the **Ideas** tab
the Idea partner, one each. It knows nothing of the Board, other Repos or the
Standing orders, and reaches the Lead only when you hand it off.

## Starting one

In its tab, pick the Repo and the Harness, model and Effort (the form starts on
your last launch), and press Start. nico-agent fetches the Repo's clone,
creates a herdr worktree workspace on its default branch, starts the agent in a
`partner` tab as the herdr agent `partner-review` or `partner-idea`, and
prompts it with the Partner skill, written to
`~/.config/nico-agent/partners/<tab>/SKILL.md` beside its MCP config. The same
from a shell:

```sh
nico-agent partner start idea --repo acme/api --harness claude --model opus --effort high
nico-agent partner list
```

A start while it runs is a no-op, a failed one resumes from its step, and a
start in another Repo or launch is refused until you end it.

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

## Ending one

**End** in the tab, or `nico-agent partner end <tab>`, removes the Partner's
worktree and workspace, which stops its agent. Its Thread's file stays.
