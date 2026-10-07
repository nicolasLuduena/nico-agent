#!/usr/bin/env bash
# Install (or re-install, or remove) the systemd user timer that runs
# `nico-agent advance` every 10 minutes. See docs/scheduler-timer.md.
#
#   scripts/install-timer.sh            install, asking before each change
#   scripts/install-timer.sh --yes      install without asking
#   scripts/install-timer.sh --remove   disable the timer and delete its units
#
# Safe to run again: the units have fixed names, so a re-run rewrites the same
# two files (only if they changed) and leaves one timer.
#
# Overrides: NICO_AGENT_BIN (the binary to run), XDG_CONFIG_HOME (where the
# units go), MISE_DATA_DIR / XDG_DATA_HOME (where mise's shims are).
set -euo pipefail

NAME=nico-agent-advance
yes=0
remove=0
for arg in "$@"; do
  case "$arg" in
    -y | --yes) yes=1 ;;
    --remove) remove=1 ;;
    -h | --help)
      sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
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
timer_file="$unit_dir/$NAME.timer"

# confirm "question": yes with --yes, otherwise a y/N prompt (EOF means no).
confirm() {
  [[ $yes -eq 1 ]] && return 0
  local reply=""
  printf '%s [y/N] ' "$1" >&2
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

if [[ $remove -eq 1 ]]; then
  if [[ ! -e "$service_file" && ! -e "$timer_file" ]]; then
    echo "nothing to remove: no $NAME units in $unit_dir" >&2
    exit 0
  fi
  confirm "Disable $NAME.timer and delete its units from $unit_dir?" || { echo "left as is" >&2; exit 0; }
  systemctl --user disable --now "$NAME.timer" || true
  rm -f "$service_file" "$timer_file"
  systemctl --user daemon-reload
  echo "removed $NAME.timer and $NAME.service" >&2
  exit 0
fi

bin="${NICO_AGENT_BIN:-$(command -v nico-agent || echo "$HOME/.local/bin/nico-agent")}"
[[ -x "$bin" ]] || echo "warning: $bin is not an executable yet; install it with scripts/install.sh" >&2
shims="${MISE_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/mise}/shims"

# Under systemd there is no shell mise activation. A `gh` wrapper that calls
# `mise x gh -- gh` then finds itself again and loops forever, hanging
# `advance`. mise's shims first on PATH make `gh` resolve to the real binary.
service=$(cat <<EOF
[Unit]
Description=nico-agent advance: move running Specs along and start queued ones

[Service]
Type=oneshot
Environment="PATH=$shims:$(dirname "$bin"):$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
ExecStart=$bin advance
TimeoutStartSec=9min
EOF
)

timer=$(cat <<EOF
[Unit]
Description=Run nico-agent advance every 10 minutes

[Timer]
OnCalendar=*:0/10
AccuracySec=1min
Unit=$NAME.service

[Install]
WantedBy=timers.target
EOF
)

# same FILE CONTENT: FILE already holds CONTENT (plus the trailing newline).
same() { [[ -f "$1" ]] && [[ "$(cat "$1")" == "$2" ]]; }

if same "$service_file" "$service" && same "$timer_file" "$timer"; then
  echo "units unchanged in $unit_dir" >&2
else
  echo "will write $service_file and $timer_file:" >&2
  printf '\n%s\n\n%s\n\n' "$service" "$timer" >&2
  if ! confirm "Write these units?"; then
    echo "left as is" >&2
    exit 0
  fi
  mkdir -p "$unit_dir"
  printf '%s\n' "$service" >"$service_file"
  printf '%s\n' "$timer" >"$timer_file"
  systemctl --user daemon-reload
  echo "wrote $NAME.service and $NAME.timer" >&2
fi

if confirm "Enable and start $NAME.timer (runs advance every 10 minutes)?"; then
  systemctl --user enable --now "$NAME.timer"
  echo "enabled $NAME.timer; check it with: systemctl --user list-timers $NAME.timer" >&2
else
  echo "timer not enabled; run: systemctl --user enable --now $NAME.timer" >&2
fi
