#!/usr/bin/env bash
#
# Generate offline dependency source files for Flatpak builds.
#
# Prerequisites:
#   pip install flatpak-node-generator tomlkit aiohttp
#   Clone https://github.com/flatpak/flatpak-builder-tools (for cargo generator)
#
# Usage:
#   ./flatpak/generate-sources.sh
#
# This script generates:
#   flatpak/cargo-sources.json  - Cargo crate sources from Cargo.lock
#   flatpak/node-sources.json   - npm package sources from package-lock.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check for flatpak-cargo-generator.py
CARGO_GENERATOR=""
if command -v flatpak-cargo-generator.py &>/dev/null; then
    CARGO_GENERATOR="flatpak-cargo-generator.py"
elif [ -f "$SCRIPT_DIR/flatpak-builder-tools/cargo/flatpak-cargo-generator.py" ]; then
    CARGO_GENERATOR="python3 $SCRIPT_DIR/flatpak-builder-tools/cargo/flatpak-cargo-generator.py"
else
    echo "Error: flatpak-cargo-generator.py not found."
    echo "Either install it in PATH or clone flatpak-builder-tools:"
    echo "  cd $SCRIPT_DIR && git clone https://github.com/flatpak/flatpak-builder-tools"
    exit 1
fi

# Check for flatpak-node-generator
if ! command -v flatpak-node-generator &>/dev/null; then
    echo "Error: flatpak-node-generator not found."
    echo "Install it with: pip install flatpak-node-generator"
    exit 1
fi

echo "Generating cargo-sources.json..."
$CARGO_GENERATOR -o "$SCRIPT_DIR/cargo-sources.json" "$REPO_ROOT/Cargo.lock"
echo "  Done: flatpak/cargo-sources.json"

echo "Generating node-sources.json..."

# npm sometimes omits `resolved` and `integrity` fields from the lockfile for
# nested dependencies inside workspace packages. flatpak-node-generator needs
# these fields to know which tarballs to download. We fix the lockfile in a temp
# copy before running the generator.
#
# We also strip workspace link entries (no download needed for local packages).
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

cp "$REPO_ROOT/package-lock.json" "$TMPDIR/package-lock.json"
cp "$REPO_ROOT/package.json" "$TMPDIR/package.json"

# Add missing resolved/integrity fields
node "$SCRIPT_DIR/fix-lockfile.mjs" "$TMPDIR/package-lock.json"

# Strip workspace link entries (flatpak-node-generator doesn't handle them)
node -e "
  const fs = require('fs');
  const p = process.argv[1];
  const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const packages = data.packages || {};
  for (const [name, info] of Object.entries(packages)) {
    if (!name) continue;
    if (info.link || (!info.resolved && !name.includes('node_modules/'))) {
      delete packages[name];
    }
  }
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
" "$TMPDIR/package-lock.json"

flatpak-node-generator --no-requests-cache -o "$SCRIPT_DIR/node-sources.json" npm "$TMPDIR/package-lock.json"
echo "  Done: flatpak/node-sources.json"

echo ""
echo "Source files generated. Commit them alongside the manifest."
