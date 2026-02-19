#!/usr/bin/env bash
#
# Generate offline dependency source files for Flatpak builds.
#
# Prerequisites:
#   pip install flatpak-node-generator tomlkit aiohttp
#   Clone https://github.com/flatpak/flatpak-builder-tools (for cargo generator)
#
# Usage:
#   ./flatpak/generate-sources.sh <flathub-repo-path>
#   ./flatpak/generate-sources.sh ../flathub-repo

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <flathub-repo-path>"
    echo "Example: $0 ../flathub-repo"
    exit 1
fi

FLATHUB_REPO="$(cd "$1" && pwd)"

python3 "$SCRIPT_DIR/flatpak-builder-tools/cargo/flatpak-cargo-generator.py" \
  -o "$FLATHUB_REPO/cargo-sources.json" "$REPO_ROOT/Cargo.lock"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

cp "$REPO_ROOT/package-lock.json" "$TMPDIR/package-lock.json"
cp "$REPO_ROOT/package.json" "$TMPDIR/package.json"

node "$SCRIPT_DIR/fix-lockfile.mjs" "$TMPDIR/package-lock.json"

node -e "
  const fs = require('fs');
  const p = process.argv[1];
  const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
  for (const [name, info] of Object.entries(d.packages || {})) {
    if (name && (info.link || !info.resolved)) delete d.packages[name];
  }
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
" "$TMPDIR/package-lock.json"

flatpak-node-generator --no-requests-cache \
  -o "$FLATHUB_REPO/node-sources.json" npm "$TMPDIR/package-lock.json"
