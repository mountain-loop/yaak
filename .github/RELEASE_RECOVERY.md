# Recovering desktop release uploads

The desktop workflow retries Tauri builds/uploads three times after the initial attempt.
The CEF tarball and Windows machine-wide uploads also get three retries, using
`--clobber` on each attempt. Exhausted retries still fail the job.

For seven days, each matrix job retains its finished installers, updater archives
and signatures in an Actions artifact named
`release-TAG-PLATFORM-RUNTIME-ARCH-RUN_ID-attempt-ATTEMPT`. Bundles are snapshotted
after Tauri, even on upload failure, and again after the additional bundles.
The first snapshot protects the regular Windows installer/signature from being
overwritten by the machine-wide build. No raw app tree or signing material is retained.
If a build failed, the artifact may be incomplete; its presence does not certify success.

To recover without rebuilding:

1. Use the run's Actions page, or
   `gh run download RUN_ID --repo mountain-loop/yaak --name ARTIFACT_NAME --dir recovery`.
   Select the exact tag, platform, runtime, architecture and run attempt. Check
   `provenance.json` against the tag's commit SHA and run's build/signing/notarization
   logs. Verify the listed SHA-256 hashes before uploading. Keep the original files
   and signatures together; do not rename or re-sign them. Retained filenames match
   release asset names, including Tauri's architecture suffix on macOS updater archives.
2. Inspect the existing release assets (including their upload state and size). A
   GitHub failed upload can leave a zero-byte `starter` asset. Tauri's initial asset
   deletion is outside its retry loop, so retries may still fail on that stale name.
   With release-owner approval, upload only the missing or failed asset using
   `gh release upload TAG recovery/EXACT_ASSET_NAME --repo mountain-loop/yaak --clobber`.
   This replaces any same-name starter asset. Retry this command if needed, then
   verify the remote size/hash. Do not upload `provenance.json` as a release asset.
3. Handle `latest.json` separately. Tauri may fail before merging this job's updater
   entry; a retained installer alone does not complete updater recovery. Download
   the current release manifest and preserve every other platform entry and release
   metadata. Compare against all intended WRY matrix outputs, then merge only the
   missing/corrected entry with its exact archive URL and matching retained signature.
   Review the complete manifest before replacing it. Never replace it with a partial
   matrix manifest or use the machine-wide installer as the user updater. CEF has no
   updater entry. Leave publication to the release owner.

This retention only applies to runs using this workflow change. It cannot recover
files from an earlier runner that has already been discarded, or change a running
release attempt. A failed upload remains a failed workflow even if retention succeeds.
