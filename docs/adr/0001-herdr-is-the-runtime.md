# herdr is the runtime; nico-agent owns no processes

nico-agent never spawns or supervises coding agents. Every Dispatch is a herdr
worktree workspace with named tabs, and agents are started, prompted and
observed through the `herdr` CLI. That keeps the agents in the terminal
multiplexer the user already watches, lets them take over any pane by hand, and
means nico-agent can crash or restart without affecting running work. herdr
becomes a hard dependency: its naming rules (unique live agent names, workspace
labels) shape ours.
