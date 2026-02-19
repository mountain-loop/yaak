---
name: worktree-management
description: Manage Yaak git worktrees using the standard ../yaak-worktrees/<NAME> layout, including creation, removal, and expected automatic setup behavior and port assignments.
---

# Worktree Management

Use the Yaak-standard worktree path layout and lifecycle commands.

## Path Convention

Always create worktrees under:

`../yaak-worktrees/<NAME>`

Examples:
- `git worktree add ../yaak-worktrees/feature-auth`
- `git worktree add ../yaak-worktrees/bugfix-login`
- `git worktree add ../yaak-worktrees/refactor-api`

## Automatic Setup After Checkout

Project git hooks automatically:
1. Create `.env.local` with unique `YAAK_DEV_PORT` and `YAAK_PLUGIN_MCP_SERVER_PORT`
2. Copy gitignored editor config folders
3. Run `npm install && npm run bootstrap`

## Remove Worktree

`git worktree remove ../yaak-worktrees/<NAME>`

## Port Pattern

- Main worktree: Vite `1420`, MCP `64343`
- First extra worktree: `1421`, `64344`
- Second extra worktree: `1422`, `64345`
- Continue incrementally for additional worktrees
