# The CLI follows AXI, and dispatch is idempotent

The CLI covers everything the web app does and is meant to be driven by agents
as much as by the user, so it follows AXI (https://axi.md): TOON output (with
`--json` as an escape hatch), the Board as the no-argument home view with
`help[]` next steps, structured errors on stdout with exit codes 0/1/2, no
interactive prompts. Mutations are idempotent: re-running `dispatch` with the
same arguments returns the existing Dispatch, or resumes it from its failed
step. That replaces a separate retry command, and a partly failed Dispatch is
kept rather than rolled back so its panes can be inspected.
