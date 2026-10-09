# Claiming is the only write nico-agent makes to a Source

On dispatch nico-agent assigns the issue to the user (as the human `gh` session
or the Linear API key's owner) and changes nothing else: no labels, no state
moves. Ready already excludes issues assigned to others, so the Claim is what
keeps a collaborator from picking the same issue. Moving issues through
workflow states is left to Linear's GitHub integration and to the agents. A
failed Claim is a warning, not a failed Dispatch.

The Lead (ADR-0010) writes to Sources through its own `gh` and Linear tools,
as the user's delegate; that is the Lead acting, not nico-agent, which still
only Claims.
