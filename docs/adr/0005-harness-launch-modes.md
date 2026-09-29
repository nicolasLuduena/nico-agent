# Two Launch modes; opencode2 is launched by command and configured via its state

claude and codex are started with `herdr agent start --kind`, passing model and
Effort as CLI flags. opencode2 (pre-release) has no herdr kind and no model or
Effort flag on its TUI, so it is run directly in the pane with the model in
`OPENCODE_CONFIG_CONTENT` and `--standalone`, then named with `herdr agent
rename`. Because opencode2's saved per-model variant in
`~/.local/state/opencode/model.json` overrides config, nico-agent writes the
chosen Effort into that file before launching; this deliberately changes the
user's saved default for that model. Sigils are per-Harness config, not code,
and are confirmed by a live spike before implementation. opencode v1 and pi
were dropped.
