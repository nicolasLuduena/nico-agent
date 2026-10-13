#!/usr/bin/env bash
# Install (or re-install, or remove) the systemd user service that runs the
# loop, `nico-agent serve`: a tick at start and every tick_minutes after.
#
#   scripts/install-service.sh            install, asking before each change
#   scripts/install-service.sh --yes      install without asking
#   scripts/install-service.sh --remove   stop the service and delete its unit
#
# Safe to run again: the unit has a fixed name, so a re-run rewrites the same
# file (only if it changed) and restarts serve once. For serve to start at
# boot, not at your first login, enable lingering: loginctl enable-linger $USER
#
# It also enables Ollama's service and pulls the model the Wikis' `ask`
# embeds with, `[wiki] embed_model` in config.toml; --remove leaves Ollama be.
#
# Overrides: NICO_AGENT_BIN (the binary to run), XDG_CONFIG_HOME (where the
# unit goes), MISE_DATA_DIR / XDG_DATA_HOME (where mise's shims are).
set -euo pipefail

NAME=nico-agent
yes=0
remove=0
for arg in "$@"; do
  case "$arg" in
    -y | --yes) yes=1 ;;
    --remove) remove=1 ;;
    -h | --help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

unit_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
service_file="$unit_dir/$NAME.service"

# confirm "question": yes with --yes, otherwise a y/N prompt (EOF means no).
confirm() {
  [[ $yes -eq 1 ]] && return 0
  local reply=""
  printf '%s [y/N] ' "$1" >&2
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

if [[ $remove -eq 1 ]]; then
  if [[ ! -e "$service_file" ]]; then
    echo "nothing to remove: no $NAME.service in $unit_dir" >&2
    exit 0
  fi
  confirm "Stop $NAME.service and delete it from $unit_dir?" || { echo "left as is" >&2; exit 0; }
  systemctl --user disable --now "$NAME.service" || true
  rm -f "$service_file"
  systemctl --user daemon-reload
  echo "removed $NAME.service" >&2
  exit 0
fi

bin="${NICO_AGENT_BIN:-$(command -v nico-agent || echo "$HOME/.local/bin/nico-agent")}"
[[ -x "$bin" ]] || echo "warning: $bin is not an executable yet; install it with: cargo install --path . --root ~/.local" >&2
shims="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/shims"

# A service gets no shell's mise activation: a `gh` wrapper that runs
# `mise x gh -- gh` finds itself again and loops forever, hanging serve on its
# first gh call. mise's shims first on PATH make gh, git and herdr resolve to
# the real binaries.
service=$(cat <<EOF
[Unit]
Description=nico-agent serve: the loop

[Service]
Type=simple
Environment="PATH=$shims:$(dirname "$bin"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$bin serve
Restart=always
RestartSec=5s

[Install]
WantedBy=default.target
EOF
)

# same FILE CONTENT: FILE already holds CONTENT (plus the trailing newline).
same() { [[ -f "$1" ]] && [[ "$(cat "$1")" == "$2" ]]; }

if same "$service_file" "$service"; then
  echo "unit unchanged in $unit_dir" >&2
else
  echo "will write $service_file:" >&2
  printf '\n%s\n\n' "$service" >&2
  if ! confirm "Write this unit?"; then
    echo "left as is" >&2
    exit 0
  fi
  mkdir -p "$unit_dir"
  printf '%s\n' "$service" >"$service_file"
  systemctl --user daemon-reload
  echo "wrote $NAME.service" >&2
fi

if confirm "Enable and (re)start $NAME.service?"; then
  systemctl --user enable "$NAME.service"
  systemctl --user restart "$NAME.service"
  echo "serve is running; check it with: journalctl --user -u $NAME.service" >&2
else
  echo "service not enabled; run: systemctl --user enable --now $NAME.service" >&2
fi
# `ask` embeds through Ollama: it must answer after a reboot, with the model pulled.
config="$HOME/.config/nico-agent/config.toml"
embed_model=$(sed -n '/^[[:space:]]*embed_model[[:space:]]*=/{s/^[^"]*"\([^"]*\)".*/\1/p;q}' "$config" 2>/dev/null || true)
embed_model=${embed_model:-nomic-embed-text}
if ! command -v ollama >/dev/null; then
  echo "warning: ollama is not installed, so the Wikis' ask cannot search; install it and run this again" >&2
elif confirm "Enable ollama.service and pull $embed_model, for the Wikis' ask?"; then
  # The user's own unit if they have one, else the system's the package installs.
  if systemctl --user cat ollama.service >/dev/null 2>&1; then
    systemctl --user enable --now ollama.service
  else
    sudo systemctl enable --now ollama.service
  fi
  pulled=0
  for _ in 1 2 3 4 5; do
    if ollama pull "$embed_model"; then pulled=1 && break; fi
    sleep 2 # a service just started takes a moment to answer
  done
  [[ $pulled -eq 1 ]] || echo "warning: could not pull $embed_model; once Ollama answers, run: ollama pull $embed_model" >&2
else
  echo "Ollama left as is; ask needs: ollama pull $embed_model" >&2
fi
echo "for serve to start at boot, not at your first login, run: loginctl enable-linger ${USER:-$(id -un)}" >&2
