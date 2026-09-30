#!/usr/bin/env bash
# Build nico-agent into a single binary and install it into ~/.local/bin.
set -euo pipefail

cd "$(dirname "$0")/.."
dest="${NICO_AGENT_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$dest"
bun install --frozen-lockfile
bun build --compile src/main.ts --outfile "$dest/nico-agent"
echo "installed $dest/nico-agent ($("$dest/nico-agent" --version))" >&2
