# A Spec runs several Implementers, each stacked on its own Blockers' PR

Supersedes ADR-0008's "a Stack per Spec" and its one Implementer per Spec, which
ADR-0009 kept. A Spec built one issue at a time even when its issues were
independent: nicolasLuduena/nico-agent#134 was Ready with no Blockers, yet
waited behind #133 because both belonged to #132. Raising the number of Specs
per Repo does not help when the work is inside one Spec.

So a Spec may run several Implementers at once. On each run, `advance` starts
every startable issue of a running Spec, in sub-issue order, up to the Repo's
`maxImplementersPerSpec` (default 5) less the Spec's issues already In flight.
An issue is startable once each of its Blockers is closed or done within the
Spec (closed, or with a PR); a Blocker in another Spec still makes it wait for
that Blocker to close, as a Stack never mixes Specs. Each started issue:

- stacks on the head branch of its Blockers' one open PR;
- or, when its Blockers' open PRs are in one Stack, on the top of them, which
  has every one of them below it;
- or starts from the Base (the Repo's `base`, else origin's default branch)
  when none of its Blockers has an open PR.

An issue whose Blockers' open PRs top more than one Stack waits until they
merge down to one, and the Board says why: starting it on either branch would
build on a base missing a Blocker's work.

Unchanged: the Repo's room still counts running Specs, not Implementers; a
queued Spec takes one slot however many of its first issues start; a Failed
Dispatch still Holds its Spec, and a failure stops further starts in that Spec
in the same run.

## Consequences

- A Spec becomes a tree of PRs rather than one Stack, so PRs within a Spec can
  overlap and conflict, and a PR stacked on a Blocker's PR needs rebasing and
  retargeting once that PR merges. The Gardener (#146) takes that on; until it
  lands, the user does.
- The Spec rules return a list of next issues and of waiting issues, each with
  its reason, and `advance` reports a row per issue it starts.

## Considered Options

- **Keep one Stack per Spec and stack every parallel issue on its top.** Each
  issue would carry its siblings' unrelated work, and a sibling's rework would
  ripple through every PR above it.
- **Predict which issues touch the same files and serialise those.** An agent
  guessing is less trustworthy than a rule (ADR-0008), and conflicts are cheaper
  to resolve than to predict.
