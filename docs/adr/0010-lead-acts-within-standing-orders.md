# The Lead acts within Standing orders; its state lives in nico-agent

Supersedes ADR-0009's "no agent dispatches". One agent, the Lead, gets reach
over the whole Board: it dispatches, launches Reviewers, answers Implementers,
Closes Dispatches and queues Specs, and it chooses which Spec continues. The
user sets Standing orders saying which of those it may do unasked; anything
else becomes a Proposal the user approves or declines, and nico-agent runs the
approved action itself. ADR-0009's Queue and the `advance` timer stay as the
mechanical floor: running Specs keep moving when the Lead is down, and
`advance` Nudges the Lead on every run. (_Amended by ADR-0011: `serve` runs
`advance` now, not a timer._)

The Lead runs as a herdr agent on any Harness (ADR-0001 holds: nico-agent owns
no process), from a home directory nico-agent writes with the Lead's skill, and
it talks to nico-agent through an MCP server that `nico-agent serve` exposes
over streamable HTTP. The user talks to the Lead through nico-agent's own web
app and CLI; the Lead answers through a `say` tool. A chat service is no longer
in the loop. (_Amended by ADR-0013: by voice, the user talks to a front voice
that answers conversation itself and hands the rest to the Lead; it reads and
hands off, and never acts._)

## Why this is safe enough where Hermes was not

Hermes (ADR-0008) failed for reasons this design removes, not for having
reach. Its state lived in the agent's memory, so the protocol could not be
tested and drifted; here the conversation, the Inbox cursor, open questions
and Proposals are files in the config directory, testable, inspectable, and
kept across a Lead restart or a change of Harness. Its proposals went over a
third-party channel that silently broke; here delivery is nico-agent's own
server. Its reach was a skill's promise; here each tool is a typed, tested
command that checks the Standing order it falls under and refuses with `help`
saying to propose instead, and a Proposal is executed by nico-agent on the
user's click, so a refusal cannot be routed around through the tool.

## What is not enforced

The Lead has a shell: the user chose not to close it off from the world. What
it can do with `gh`, `git` or `herdr` directly (write Specs and tickets, label
issues, comment, type into a pane) is governed by its skill, not by nico-agent.
Those Source writes are the Lead acting as the user's delegate through its own
tools; ADR-0007 stays true of nico-agent itself. We accept that over an agent
that cannot run the grill → Spec → tickets flow the user wants it to drive.

## Write Proposals

With the `write` order off, the Lead proposes a Spec and its tickets as a
write Proposal: the Markdown and the Repo whose Source it goes to. Approving
one is the exception to "nico-agent runs the approved action": nico-agent
records the decision and hands the text to the Lead's Inbox, and the Lead
writes it with its own shell, through the same to-spec and to-tickets path
it takes with the order on. nico-agent still writes nothing to a Source
(ADR-0007); declining writes nothing at all.

The weekly retro uses the same kind of Proposal for each environment change
it suggests: the ticket the Lead would file, proposed whatever the `write`
order says, so nothing reaches a Repo from a retro without the user's
approval. The change itself lands through an Implementer's PR on that
ticket, never by the Lead editing the user's clone.

## Considered Options

- **An advisor that only proposes.** Everything waits for a click; too slow for
  an agent meant to keep work moving while the user is away.
- **Claude Agent SDK in-process.** One vendor, nico-agent would own and
  supervise a process against ADR-0001, and the user could not take the Lead
  over by hand in herdr.
- **A stdio MCP server per Harness, as `nico-agent mcp` was.** The conversation
  must live in one place that the web app, the CLI and the Lead all reach; a
  server spawned by the Lead's pane would be a second process with its own
  state, which is what broke Hermes.
