# The user picks which Spec starts through the Queue; no agent dispatches

Supersedes ADR-0008. Choosing which Spec starts when a Repo has room was left
to an LLM Scheduler (Hermes) that proposed a candidate over chat and, after a
timeout, picked one itself. In practice the proposals were never delivered, its
protocol lived in the agent's memory where it could not be tested and drifted,
and the user never wanted an agent choosing work for them on a timeout. So the
choice moves ahead of time, to the user: they fill each Repo's Queue on the
Board, and `advance` starts the head of the Queue whenever that Repo has room,
mechanically and with tests. It never starts a Spec that isn't queued, so an
empty Queue starts nothing.

nico-agent still orders the issues within a Spec, as ADR-0008 decided: a Spec's
next issue, the PR it stacks on, the per-Repo cap and whether a Spec is Held
are rules in nico-agent. "Scheduler" now names `advance` run every 10 minutes
by a systemd user timer, not an agent. No agent has dispatch reach: the MCP
server, the Scheduler skill and `advance --start` are gone, and `advance`
tells the user what needs them through desktop notifications.

ADR-0008's amendment on relaying answers is withdrawn with the agent that did
the relaying. `nico-agent answer` stays as the user's own CLI path to answer an
Asking Implementer, still refused unless that Implementer waits on the user.

The Queue is edited on the web Board only, a deliberate exception to ADR-0006's
"the CLI covers everything the web app does": queuing is the user choosing
work, and no agent should, so the CLI has no command to queue, unqueue or
reorder. The CLI Board still shows each Repo's Queue, head first, read-only
(`rooms[].queue`), so an agent or the user can see what will start next.

## Considered Options

- **Fix the chat channel and keep Hermes.** The judgment is still made at the
  moment a slot frees, by an agent, on a timeout the user didn't want.
- **An LLM advisor that suggests what to queue.** It could come back later,
  without dispatch reach; it isn't needed for the Queue to work.
