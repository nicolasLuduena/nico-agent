# Linear issues on the Board

A Repo can claim Linear issues from a team, optionally narrowed by a project
and a label. GitHub issues still appear under that Repo.

```bash
nico-agent repo add bleentr/pdf-diff --path /path/to/pdf-diff --linear-team BLE
nico-agent repo add bleentr/pdf-diff --path /path/to/pdf-diff --linear-team BLE --linear-project 'PDF diff' --linear-label pdf
```

The team selector accepts a key, exact name, or UUID. The project selector
accepts an exact name or UUID. Labels match exact names. Project and label
selectors require `--linear-team`. Re-adding a Repo with a team selector
replaces its selector. Omitting the selector preserves it.

Create a personal API key in Linear's Settings → Security & access with Read
access to the selected team, plus Write access so a Dispatch can Claim the
issue (without it the Claim fails with a warning). Set `LINEAR_API_KEY` in
the environment, or put it in `~/.config/nico-agent/secrets.env` with file mode 600:

```dotenv
LINEAR_API_KEY=your-key
```

The environment takes precedence. If `NICO_AGENT_CONFIG_DIR` or
`XDG_CONFIG_HOME` changes the config directory, put `secrets.env` there.
The key's viewer is the user for the Ready rule.

Linear Ready issues have `ready-for-agent`, state type backlog or unstarted,
no assignee or the viewer as assignee, and every incoming native Blocker
completed or canceled. An issue matching multiple Repos appears under each.
CLI JSON rows include the Repo for Linear issues. Source errors appear beside
issues that loaded successfully.

# Dispatching and reviewing Linear issues

Linear identifiers such as `BLE-27` and Linear issue URLs work wherever an
issue is expected: `dispatch`, `review`, `close` and `show`.

```bash
nico-agent dispatch BLE-27 --harness claude --model opus --effort high
nico-agent dispatch BLE-27 --harness claude --model opus --effort high --repo bleentr/pdf-diff
```

A Linear issue is dispatched into the Repo whose selector claims it. When
several Repos claim it, `--repo` chooses one; without it the dispatch fails
and lists them. On the web Board each Linear row's form names the Repo it
sits under. Linear issues with unresolved Blockers are not dispatched, and
they cannot be stacked.

The worktree branch is the issue's Linear `branchName`, so Linear's GitHub
integration links the PR. The workspace is labelled `<repo>:BLE-27`, the
prompt passes the Linear issue URL, and the Claim assigns the API key's
owner. A failed Claim is a warning.

A PR counts as linked when the issue has a GitHub PR attachment in the
dispatched Repo; its draft/open state is read from GitHub. PRs attached from
other repos don't advance the Stage.

To check the real adapter, configure the selector and key, then run
`nico-agent board --json` or open the web Board.
