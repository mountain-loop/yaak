#!/usr/bin/env bash

set -euo pipefail

tag="${1:?usage: verify-release-assets.sh <tag>}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
version="${tag#v}"

expected_assets=(
  "Yaak_${version}_aarch64.dmg"
  "Yaak_${version}_arm64-setup-machine.exe"
  "Yaak_${version}_arm64-setup-machine.exe.sig"
  "Yaak_${version}_arm64-setup.exe"
  "Yaak_${version}_arm64-setup.exe.sig"
  "Yaak_${version}_x64-setup-machine.exe"
  "Yaak_${version}_x64-setup-machine.exe.sig"
  "Yaak_${version}_x64-setup.exe"
  "Yaak_${version}_x64-setup.exe.sig"
  "Yaak_${version}_x64.dmg"
  "Yaak_aarch64.app.tar.gz"
  "Yaak_aarch64.app.tar.gz.sig"
  "Yaak_x64.app.tar.gz"
  "Yaak_x64.app.tar.gz.sig"
  "latest.json"
  "yaak-${version}-1.aarch64.rpm"
  "yaak-${version}-1.aarch64.rpm.sig"
  "yaak-${version}-1.x86_64.rpm"
  "yaak-${version}-1.x86_64.rpm.sig"
  "yaak-cef_${version}_amd64.deb"
  "yaak-cef_${version}_arm64.deb"
  "yaak-cef_${version}_linux_arm64.tar.gz"
  "yaak-cef_${version}_linux_x64.tar.gz"
  "yaak_${version}_aarch64.AppImage"
  "yaak_${version}_aarch64.AppImage.sig"
  "yaak_${version}_amd64.AppImage"
  "yaak_${version}_amd64.AppImage.sig"
  "yaak_${version}_amd64.deb"
  "yaak_${version}_amd64.deb.sig"
  "yaak_${version}_arm64.deb"
  "yaak_${version}_arm64.deb.sig"
)

expected_platforms=(
  darwin-aarch64
  darwin-aarch64-app
  darwin-x86_64
  darwin-x86_64-app
  linux-aarch64
  linux-aarch64-appimage
  linux-aarch64-deb
  linux-aarch64-rpm
  linux-x86_64
  linux-x86_64-appimage
  linux-x86_64-deb
  linux-x86_64-rpm
  windows-aarch64
  windows-aarch64-nsis
  windows-x86_64
  windows-x86_64-nsis
)

compare_sets() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  local missing unexpected

  missing=$(comm -23 \
    <(printf '%s\n' "$expected" | sort -u) \
    <(printf '%s\n' "$actual" | sort -u))
  unexpected=$(comm -13 \
    <(printf '%s\n' "$expected" | sort -u) \
    <(printf '%s\n' "$actual" | sort -u))

  if [[ -n "$missing" || -n "$unexpected" ]]; then
    [[ -z "$missing" ]] || printf 'Missing %s:\n%s\n' "$label" "$missing" >&2
    [[ -z "$unexpected" ]] || printf 'Unexpected %s:\n%s\n' "$label" "$unexpected" >&2
    return 1
  fi
}

releases=$(gh api "repos/${repo}/releases?per_page=100")
matches=$(jq -c --arg tag "$tag" '[.[] | select(.tag_name == $tag)]' <<<"$releases")
match_count=$(jq 'length' <<<"$matches")

if [[ "$match_count" -ne 1 ]]; then
  printf 'Expected exactly one GitHub release for %s, found %s:\n' "$tag" "$match_count" >&2
  jq -r '.[] | "- id=\(.id) draft=\(.draft) url=\(.html_url)"' <<<"$matches" >&2
  exit 1
fi

release=$(jq -c '.[0]' <<<"$matches")
if [[ "${REQUIRE_DRAFT:-true}" == "true" && "$(jq -r '.draft' <<<"$release")" != "true" ]]; then
  printf 'Release %s was published before artifact verification completed\n' "$tag" >&2
  exit 1
fi
if [[ "$(jq -r '.prerelease' <<<"$release")" != "true" ]]; then
  printf 'Release %s must be marked as a prerelease\n' "$tag" >&2
  exit 1
fi

actual_assets=$(jq -r '.assets[].name' <<<"$release")
compare_sets \
  "release assets" \
  "$(printf '%s\n' "${expected_assets[@]}")" \
  "$actual_assets"

invalid_assets=$(jq -r '
  .assets[]
  | select(
      (.size // 0) <= 0
      or ((.digest // "") | startswith("sha256:") | not)
    )
  | .name
' <<<"$release")
if [[ -n "$invalid_assets" ]]; then
  printf 'Assets without a non-empty SHA-256 digest:\n%s\n' "$invalid_assets" >&2
  exit 1
fi

latest_id=$(jq -r '.assets[] | select(.name == "latest.json") | .id' <<<"$release")
latest=$(gh api \
  -H 'Accept: application/octet-stream' \
  "repos/${repo}/releases/assets/${latest_id}")

if [[ "$(jq -r '.version' <<<"$latest")" != "$version" ]]; then
  printf 'latest.json version does not match %s\n' "$version" >&2
  exit 1
fi

actual_platforms=$(jq -r '.platforms | keys[]' <<<"$latest")
compare_sets \
  "updater platforms" \
  "$(printf '%s\n' "${expected_platforms[@]}")" \
  "$actual_platforms"

printf 'Verified %s: %s assets and %s updater platforms\n' \
  "$tag" \
  "$(jq '.assets | length' <<<"$release")" \
  "$(jq '.platforms | length' <<<"$latest")"
