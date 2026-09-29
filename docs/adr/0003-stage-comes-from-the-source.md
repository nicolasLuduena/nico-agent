# The Stage comes from the Source, not from herdr's Agent state

A Dispatch's Stage (Implementing → PR ready → Review launched) is decided only
by whether a PR is linked to the issue: GitHub's closing references, or for
Linear a PR attachment in the dispatched Repo. herdr's Agent state is shown next
to it but never interpreted, because herdr's `done` means "idle with output the
user hasn't seen" and resets when viewed, not "task finished". "Launch review"
unlocks as soon as a PR is linked, even while the Implementer still works.
