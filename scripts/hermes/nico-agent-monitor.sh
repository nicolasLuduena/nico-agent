#!/usr/bin/env bash
# Hermes monitor script for the nico-agent Scheduler (see docs/hermes-scheduler.md).
#
# Each cron tick Hermes runs this before its agent: it runs `nico-agent advance`
# and prints the advance rows, each Repo's room and candidates, and the Held
# Specs. Hermes hashes the output and wakes the agent only when it changed, so
# the output carries no timestamps, except a 10-minute tick while some Repo has
# room and candidates: then the agent must wake every tick to time its
# proposals (30 minutes to Away, 1 hour after "later").
#
# Installed to ~/.hermes/scripts/ by scripts/hermes/setup.sh; Hermes cannot
# edit it. A non-zero exit is a monitor ERROR Hermes reports, never a change.
set -euo pipefail

bin="${NICO_AGENT_BIN:-$(command -v nico-agent || echo "$HOME/.local/bin/nico-agent")}"

# `advance` exits 1 when a row failed; those rows are news, not a broken monitor.
advance=$("$bin" advance --json) || true
board=$("$bin" --json)

jq -e '.specs' >/dev/null <<<"$advance" || { echo "nico-agent advance printed no report:" >&2; echo "$advance" >&2; exit 1; }

echo "advance:"
jq -r '.specs[] | "  \(.spec) \(.result) \(.issue) \(.reason)"' <<<"$advance"
jq -r '.errors[]? | "  error \(.repo): \(.error)"' <<<"$advance"

echo "rooms:"
jq -r '.rooms[]? | "  \(.repo) room=\(.room) candidates=\([.candidates[].spec] | join(","))"' <<<"$board"

echo "held:"
jq -r '.specs[]? | select(.held) | "  \(.spec) on \(.held.issue): \(.held.reason)"' <<<"$board"

if jq -e 'any(.rooms[]?; .room > 0 and (.candidates | length) > 0)' >/dev/null <<<"$board"; then
  minute=$(date +%M)
  echo "room open, tick $(date +%Y-%m-%dT%H):$(printf '%02d' $((10#$minute / 10 * 10)))"
fi
