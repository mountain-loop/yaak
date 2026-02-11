#!/usr/bin/env bash
#
# Update the Flatpak manifest for a new release.
#
# Usage:
#   ./flatpak/update-manifest.sh v2026.2.0
#
# This script:
#   1. Resolves the git commit for the given tag
#   2. Updates the manifest YAML with the new tag and commit
#   3. Updates the metainfo.xml with a new <release> entry
#   4. Regenerates cargo-sources.json and node-sources.json

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$SCRIPT_DIR/app.yaak.Yaak.yml"
METAINFO="$SCRIPT_DIR/app.yaak.Yaak.metainfo.xml"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <version-tag>"
    echo "Example: $0 v2026.2.0"
    exit 1
fi

VERSION_TAG="$1"
VERSION="${VERSION_TAG#v}"

# Only allow stable releases (skip beta, alpha, rc, etc.)
if [[ "$VERSION" == *-* ]]; then
    echo "Skipping pre-release version '$VERSION_TAG' (only stable releases are published to Flathub)"
    exit 0
fi

REPO="mountain-loop/yaak"

# Resolve the commit hash for this tag
echo "Resolving commit for tag $VERSION_TAG..."
COMMIT=$(git ls-remote "https://github.com/$REPO.git" "refs/tags/$VERSION_TAG" | cut -f1)
if [ -z "$COMMIT" ]; then
    echo "Error: Could not resolve commit for tag '$VERSION_TAG'"
    exit 1
fi
echo "  Commit: $COMMIT"

echo ""
echo "Updating manifest: $MANIFEST"

# Update tag
sed -i "s|tag: v[0-9.]*$|tag: $VERSION_TAG|" "$MANIFEST"

# Update commit
sed -i "s|commit: [0-9a-f]\{40\}|commit: $COMMIT|" "$MANIFEST"

echo "  Manifest updated."

echo "Updating metainfo: $METAINFO"

TODAY=$(date +%Y-%m-%d)

# Insert new release entry after <releases>
sed -i "s|  <releases>|  <releases>\n    <release version=\"$VERSION\" date=\"$TODAY\" />|" "$METAINFO"

echo "  Metainfo updated."

# Regenerate offline dependency sources
echo ""
echo "Regenerating dependency sources..."
bash "$SCRIPT_DIR/generate-sources.sh"

echo ""
echo "Done! Review the changes:"
echo "  $MANIFEST"
echo "  $METAINFO"
echo "  $SCRIPT_DIR/cargo-sources.json"
echo "  $SCRIPT_DIR/node-sources.json"
