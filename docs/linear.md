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
access to the selected team. Set `LINEAR_API_KEY` in the environment, or put
it in `~/.config/nico-agent/secrets.env` with file mode 600:

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

Linear identifiers such as `BLE-27` and Linear issue URLs are recognized.
Dispatch and review support follows in issue #14. Linear Board rows link to
the issue without a Dispatch form until then.

To check the real adapter, configure the selector and key, then run
`nico-agent board --json` or open the web Board.
