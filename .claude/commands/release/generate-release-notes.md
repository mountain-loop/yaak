---
description: Ship a Yaak release (notes are generated from changelog items)
---

Release notes are NOT written by hand anymore. They are generated from the
changelog release items on yaak.app when a release ships. Never edit GitHub
release bodies directly — the changelog items are the single source of truth.

Terminology: a "changelog release" is the draft on yaak.app (managed via the
yaak MCP release_* tools). A "GitHub release" is the artifact record CI
creates; you only ever publish its draft, never write its notes.

## Release process

1. **Keep the draft changelog release current** (yaak MCP): as user-facing PRs
   merge, add items with `release_add_item` — link the feedback post and/or PR
   and titles derive automatically. Only MERGED changes; open PRs must wait.
   CLI changes are included with a "CLI:" title prefix. Internal tooling and
   dependency bumps never get items. Check state with `release_get <version>`
   (items show which beta they shipped in, or "pending").

2. **Tag the release** (`v<version>` or `v<version>-beta.N`). CI builds
   artifacts, creates a DRAFT GitHub release, and publishes the CLI to npm at
   the same version.

3. **Publish the draft GitHub release** (the only GitHub step — this is when
   binaries go public). Leave the body empty and the prerelease flag as-is;
   both are handled next.

4. **Ship via the yaak MCP**:
   - Beta: `release_ship_beta <version>` — writes the GitHub pre-release notes
     from that beta's items, sets the prerelease flag, moves linked feedback
     posts to released_beta with featured comments, and stamps items.
   - Stable: `release_publish <version>` — writes full notes with the
     changelog link, marks the GitHub release as a full release, makes the
     yaak.app changelog page live, and moves linked posts to released.

Both ship commands verify the GitHub release exists first and are safe to
re-run (already-shipped posts and items are skipped).
