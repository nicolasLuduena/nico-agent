# Partners talk; the Lead acts

Extends [ADR-0010](0010-lead-acts-within-standing-orders.md) and
[ADR-0013](0013-front-voice-talks-lead-acts.md). Everything the user said went
to the Lead, so reviewing one PR or thinking out loud about an idea cost the
Lead's turns, filled its context with what it does not need for managing the
work, and left the user interrupted by every other Repo's news (#190). So the
app gets tabs beside the Lead's, each holding a Partner: an agent the user
talks with apart from the Lead, about one PR (a Review partner) or one Repo (an
Idea partner).

A Partner is a herdr agent, started like an Implementer or a Reviewer on the
Harness, model, Effort and Launch mode the user picks, in its own herdr
workspace: a worktree on the PR's head branch for a Review partner, a worktree
of the Repo on its default branch for an Idea partner. It talks with the user in its own
Thread, a file per Partner in the config directory in the Conversation's entry
shape; the user's messages are typed into its pane, and it replies through a
`say` scoped to that Thread.

A Partner may:

- **Read** the code in its worktree and run it there (tests included), and, for
  a Review partner, the PR's title, description and diff.
- **Talk** in its own Thread.
- **Hand off**: draft a summary of what the user and it settled, which the
  user approves before it is sent.

A Partner may not:

- **Know the Board.** It gets no orient packet, no Intent, no Standing orders,
  no other Repo, Dispatch or PR, and nothing from the Lead's Inbox reaches it.
- **Act.** Its MCP tools hold no dispatch, queue, answer, review, Close or
  Proposal.
- **Write to a Source.** No push, comment, review or PR; it hands those to
  the Lead.

An approved hand-off reaches the Lead the way a typed message does: nico-agent
appends it to the Lead's Conversation as a user message, through the path
`say --raw` already uses, so it arrives in the Lead's Inbox with a Nudge. It is
the user's message because the user approved it; the Lead treats it as
anything else the user says, and acts on it within its Standing orders or
proposes. Until a hand-off, the Lead hears nothing from a Partner, and the
Thread never enters its Inbox or orient packet.

On the Board, ADR-0010 therefore holds by construction, as it does for the
Front voice: the Lead is still the one agent that acts there, and a Partner's
way to change anything is the user's own words in the Lead's Conversation.
Source writes are another matter. Unlike the Front voice, a Partner has a shell
in its worktree, which it needs to read and run the code, and with it `git` and
`gh`. Nothing in nico-agent stops it pushing or commenting; only its skill
does, the same trade ADR-0010 makes for the Lead's shell.

Each tab has its own Front voice (ADR-0013), parameterised by its hand-off
target: the Lead in the Lead's tab, the tab's Partner in a Partner's tab. A
Front voice in a Partner's tab writes into that Partner's Thread, never into
the Lead's Conversation; only the Partner's hand-off does that.

## Considered Options

- **Talk through PRs and ideas with the Lead.** What the user does today:
  costs the Lead's turns and context, and every other Repo interrupts.
- **Give a Partner the Lead's tools behind its skill.** It could file the Spec
  or post the review comment itself, but a prompt does not stop an action, and
  two agents acting on the Board undo the one-actor rule of ADR-0010.
- **Copy the whole Thread into the Lead's Conversation.** The Lead would read
  every exchange it was spared; a summary the user approved carries only what
  was settled.
- **Send the hand-off without the user's approval.** Quicker, but it would let
  a Partner speak to the Lead in the user's name.
