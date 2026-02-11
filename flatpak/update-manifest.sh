#!/usr/bin/env bash
#
# Update the Flatpak manifest for a new release.
#
# Usage:
#   ./flatpak/update-manifest.sh v2026.2.0
#
# This script:
#   1. Updates the git tag and commit in the manifest
#   2. Regenerates cargo-sources.json and node-sources.json from the tagged lockfiles

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$SCRIPT_DIR/app.yaak.Yaak.yml"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <version-tag>"
    echo "Example: $0 v2026.2.0"
    exit 1
fi

VERSION_TAG="$1"
VERSION="${VERSION_TAG#v}"

if [[ "$VERSION" == *-* ]]; then
    echo "Skipping pre-release version '$VERSION_TAG' (only stable releases are published to Flathub)"
    exit 0
fi

REPO="mountain-loop/yaak"
COMMIT=$(git ls-remote "https://github.com/$REPO.git" "refs/tags/$VERSION_TAG" | cut -f1)

if [ -z "$COMMIT" ]; then
    echo "Error: Could not resolve commit for tag $VERSION_TAG"
    exit 1
fi

echo "Tag: $VERSION_TAG"
echo "Commit: $COMMIT"

# Update git tag and commit in the manifest
sed -i "s|tag: v.*|tag: $VERSION_TAG|" "$MANIFEST"
sed -i "s|commit: .*|commit: $COMMIT|" "$MANIFEST"
echo "Updated manifest tag and commit."

# Regenerate offline dependency sources from the tagged lockfiles
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Fetching lockfiles from $VERSION_TAG..."
curl -fsSL "https://raw.githubusercontent.com/$REPO/$VERSION_TAG/Cargo.lock" -o "$TMPDIR/Cargo.lock"
curl -fsSL "https://raw.githubusercontent.com/$REPO/$VERSION_TAG/package-lock.json" -o "$TMPDIR/package-lock.json"
curl -fsSL "https://raw.githubusercontent.com/$REPO/$VERSION_TAG/package.json" -o "$TMPDIR/package.json"

echo "Generating cargo-sources.json..."
python3 "$SCRIPT_DIR/flatpak-builder-tools/cargo/flatpak-cargo-generator.py" \
  -o "$SCRIPT_DIR/cargo-sources.json" "$TMPDIR/Cargo.lock"

echo "Generating node-sources.json..."
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
  -o "$SCRIPT_DIR/node-sources.json" npm "$TMPDIR/package-lock.json"

echo ""
echo "Done! Review the changes:"
echo "  $MANIFEST"
echo "  $SCRIPT_DIR/cargo-sources.json"
echo "  $SCRIPT_DIR/node-sources.json"
