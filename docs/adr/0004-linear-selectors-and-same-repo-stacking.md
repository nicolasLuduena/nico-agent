# Repos claim Linear issues by selector; stacking needs a same-Repo Blocker PR

Linear has no repo field and Linear projects don't map 1:1 to repos (one
project spans several; one issue can have PRs in five). Each Repo therefore
carries a Linear selector (team, plus optional project and/or label) mirroring
what its `docs/agents/issue-tracker.md` already says; an issue matching several
Repos shows under each and the user picks at dispatch. Linear issues use
Linear's own `branchName`, so Linear's GitHub integration links the PR and moves
the issue without nico-agent's help.

An issue is Stackable only when each unresolved Blocker has an open PR in the
*same* Repo, because the new worktree is branched from that PR's head. The
Blocker PR is named in the prompt rather than left for the agent to discover.
