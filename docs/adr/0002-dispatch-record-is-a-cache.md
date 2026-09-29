# The local Dispatch record is a cache, reconciled on read

nico-agent keeps one record per Dispatch in a locked local state file
(workspace, tab and pane ids, harness, model, effort, failed step). We could
have derived everything from herdr and the Sources by naming convention, but
that loses the harness/model/effort and the failed step, which the CLI needs to
resume a Dispatch. herdr and the Sources stay authoritative: a record whose
workspace is gone shows as such rather than being trusted. The record exists
only on this machine, so In flight is per-machine; the Claim (ADR-0007) is what
other people see.
