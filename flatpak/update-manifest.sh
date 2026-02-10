#!/usr/bin/env bash
#
# Update the Flatpak manifest with URLs and SHA256 hashes for a given release.
#
# Usage:
#   ./flatpak/update-manifest.sh v2026.2.0
#
# This script:
#   1. Downloads the x86_64 and aarch64 .deb files from the GitHub release
#   2. Computes their SHA256 checksums
#   3. Updates the manifest YAML with the correct URLs and hashes
#   4. Updates the metainfo.xml with a new <release> entry

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
BASE_URL="https://github.com/$REPO/releases/download/$VERSION_TAG"

DEB_AMD64="yaak_${VERSION}_amd64.deb"
DEB_ARM64="yaak_${VERSION}_arm64.deb"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Downloading $DEB_AMD64..."
curl -fSL "$BASE_URL/$DEB_AMD64" -o "$TMPDIR/$DEB_AMD64"
SHA_AMD64=$(sha256sum "$TMPDIR/$DEB_AMD64" | cut -d' ' -f1)
echo "  SHA256: $SHA_AMD64"

echo "Downloading $DEB_ARM64..."
curl -fSL "$BASE_URL/$DEB_ARM64" -o "$TMPDIR/$DEB_ARM64"
SHA_ARM64=$(sha256sum "$TMPDIR/$DEB_ARM64" | cut -d' ' -f1)
echo "  SHA256: $SHA_ARM64"

echo ""
echo "Updating manifest: $MANIFEST"

# Update URLs by matching the arch-specific deb filename
sed -i "s|url: .*amd64\.deb|url: $BASE_URL/$DEB_AMD64|" "$MANIFEST"
sed -i "s|url: .*arm64\.deb|url: $BASE_URL/$DEB_ARM64|" "$MANIFEST"

# Update SHA256 hashes by finding the current ones and replacing
OLD_SHA_AMD64=$(grep -A2 "amd64\.deb" "$MANIFEST" | grep sha256 | sed 's/.*"\(.*\)"/\1/')
OLD_SHA_ARM64=$(grep -A2 "arm64\.deb" "$MANIFEST" | grep sha256 | sed 's/.*"\(.*\)"/\1/')

sed -i "s|$OLD_SHA_AMD64|$SHA_AMD64|" "$MANIFEST"
sed -i "s|$OLD_SHA_ARM64|$SHA_ARM64|" "$MANIFEST"

echo "  Manifest updated."

echo "Updating metainfo: $METAINFO"

TODAY=$(date +%Y-%m-%d)

# Insert new release entry after <releases>
sed -i "s|  <releases>|  <releases>\n    <release version=\"$VERSION\" date=\"$TODAY\" />|" "$METAINFO"

echo "  Metainfo updated."

echo ""
echo "Done! Review the changes:"
echo "  $MANIFEST"
echo "  $METAINFO"
