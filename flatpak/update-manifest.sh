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
MANIFEST="$SCRIPT_DIR/app.yaak.desktop.yml"
METAINFO="$SCRIPT_DIR/app.yaak.desktop.metainfo.xml"

if [ $# -lt 1 ]; then
    echo "Usage: $0 <version-tag>"
    echo "Example: $0 v2026.2.0"
    exit 1
fi

VERSION_TAG="$1"
VERSION="${VERSION_TAG#v}"
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

# Use Python for reliable YAML-like replacement (avoids sed edge cases)
python3 << PYEOF
import re

with open("$MANIFEST", "r") as f:
    content = f.read()

# Replace x86_64 source block
content = re.sub(
    r'(dest-filename: yaak\.deb\n\s+url: )https://.*?\.deb(\n\s+sha256: )"[^"]*"(\n\s+only-arches:\n\s+- x86_64)',
    rf'\g<1>${BASE_URL}/${DEB_AMD64}\2"${SHA_AMD64}"\3',
    content,
)

# Replace aarch64 source block
content = re.sub(
    r'(dest-filename: yaak\.deb\n\s+url: )https://.*?\.deb(\n\s+sha256: )"[^"]*"(\n\s+only-arches:\n\s+- aarch64)',
    rf'\g<1>${BASE_URL}/${DEB_ARM64}\2"${SHA_ARM64}"\3',
    content,
)

with open("$MANIFEST", "w") as f:
    f.write(content)

print("  Manifest updated.")
PYEOF

echo "Updating metainfo: $METAINFO"

TODAY=$(date +%Y-%m-%d)

python3 << PYEOF
import re

with open("$METAINFO", "r") as f:
    content = f.read()

release_entry = f'  <releases>\n    <release version="${VERSION}" date="${TODAY}" />'

# Replace existing <releases> block opening (add new release at the top)
content = re.sub(
    r'  <releases>\n(\s+<release )?',
    release_entry + '\n    <release ' if '<release ' in content else release_entry + '\n',
    content,
    count=1,
)

with open("$METAINFO", "w") as f:
    f.write(content)

print("  Metainfo updated.")
PYEOF

echo ""
echo "Done! Review the changes:"
echo "  $MANIFEST"
echo "  $METAINFO"
