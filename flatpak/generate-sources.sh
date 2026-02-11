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

# flatpak-node-generator doesn't handle npm workspace packages (local paths
# without "resolved" or "link" fields). Strip them from a temp copy of the
# lockfile before running the generator.
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

python3 -c "
import json, sys, shutil
with open(sys.argv[1]) as f:
    data = json.load(f)
packages = data.get('packages', {})
to_remove = []
needs_resolve = []
for name, info in packages.items():
    if not name:
        continue
    if info.get('link'):
        continue
    if 'resolved' in info:
        continue
    # No 'resolved' and not a link — local workspace package or nested dep.
    if '/node_modules/' in name:
        # Nested node_modules entry inside a workspace package — needs
        # resolved URL and integrity for flatpak-node-generator.
        needs_resolve.append((name, info))
    else:
        to_remove.append(name)

# Fetch missing resolved/integrity from the npm registry
import urllib.request
_packument_cache = {}
for name, info in needs_resolve:
    pkg = name.split('/node_modules/')[-1]
    version = info.get('version', '')
    if not version:
        to_remove.append(name)
        continue
    if pkg not in _packument_cache:
        url = f'https://registry.npmjs.org/{pkg}'
        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json'})
            with urllib.request.urlopen(req) as resp:
                _packument_cache[pkg] = json.loads(resp.read())
        except Exception as e:
            print(f'Warning: failed to fetch {url}: {e}', file=sys.stderr)
            to_remove.append(name)
            continue
    packument = _packument_cache[pkg]
    ver_info = packument.get('versions', {}).get(version, {})
    dist = ver_info.get('dist', {})
    if dist.get('tarball') and dist.get('integrity'):
        info['resolved'] = dist['tarball']
        info['integrity'] = dist['integrity']
        print(f'Resolved {pkg}@{version}', file=sys.stderr)
    else:
        print(f'Warning: no dist info for {pkg}@{version}, removing', file=sys.stderr)
        to_remove.append(name)

for name in to_remove:
    del packages[name]
with open(sys.argv[2], 'w') as f:
    json.dump(data, f, indent=2)
# Copy package.json so the generator can read the root entry
shutil.copy2(sys.argv[3], sys.argv[4])
print(f'Stripped {len(to_remove)} local workspace packages from lockfile', file=sys.stderr)
" "$REPO_ROOT/package-lock.json" "$TMPDIR/package-lock.json" "$REPO_ROOT/package.json" "$TMPDIR/package.json"

flatpak-node-generator --no-requests-cache -o "$SCRIPT_DIR/node-sources.json" npm "$TMPDIR/package-lock.json"
echo "  Done: flatpak/node-sources.json"

echo ""
echo "Source files generated. Commit them alongside the manifest."
