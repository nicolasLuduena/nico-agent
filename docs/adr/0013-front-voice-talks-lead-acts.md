# The Front voice talks; the Lead acts

Amends [ADR-0010](0010-lead-acts-within-standing-orders.md). Talking to the
Lead by voice waited on the Scribe and on a whole Lead turn before anything was
said back, even for "say that again"
(`docs/research/fluent-voice-with-the-lead.md`, #181). So a Front voice in
`serve` now holds the spoken conversation in front of the unchanged Lead: it
answers small talk itself and hands anything that needs judgment or action to
the Lead.

The Front voice has exactly two capabilities:

- **Read**: the last Conversation entries, the Lead's orient packet, a Board
  snapshot, and, while the user reviews a PR with it, that PR's title,
  description and diff.
- **Hand off**: write the user's message into the Conversation through the
  path `say --raw` already uses, so the Lead gets it in its Inbox with a Nudge,
  as a typed message.

It gets no shell, no MCP server and no tool that acts. ADR-0010 therefore holds
by construction, not by a prompt: only the Lead acts on the Board, within its
Standing orders, and a request to dispatch, answer, merge or request changes
reaches the Lead as the user's own words. (_Amended by ADR-0014: each tab
has its own Front voice, and in a Partner's tab it hands off to that Partner,
into its Thread, not to the Lead._)

It replaces the Scribe. It reads the raw transcript, cleans the user's message
when it hands it off (the raw transcript stays on the entry, as today), and
matches a spoken answer to a question's choices.

Its own lines ("I'll ask the Lead", its answers, what it reads back) are
recorded in the Conversation under their own author, the Front voice, beside
the user, the Lead and nico-agent. The Lead sees them in its orient packet, so
it knows what the user was already told; they are not messages to the Lead and
do not Nudge it, or every spoken line would cost a Lead turn again. The
Lead's Voice on acknowledgment leaves its skill, since the Front voice now
gives it.

## Considered Options

- **Keep every spoken message going to the Lead and shave each step.** Still
  costs a coding agent's turn for every reply.
- **Give the Front voice the Lead's MCP tools behind a prompt.** Faster to act,
  but a prompt does not stop an action, and two agents acting on the Board
  would undo the one-actor rule of ADR-0010.
- **A speech-to-speech model as the Front voice.** Sends the user's audio off
  the machine, or, run locally, needs CUDA this machine lacks.
