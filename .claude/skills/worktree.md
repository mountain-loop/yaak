# Worktree Management Skill

## Creating Worktrees

When creating git worktrees for this project, ALWAYS use the path format:
```
../yaak-worktrees/<NAME>
```

For example:
- `git worktree add ../yaak-worktrees/feature-auth`
- `git worktree add ../yaak-worktrees/bugfix-login`
- `git worktree add ../yaak-worktrees/refactor-api`

## What Happens Automatically

The post-checkout hook will automatically:
1. Create `.env.local` with unique ports (YAAK_DEV_PORT and YAAK_PLUGIN_MCP_SERVER_PORT)
2. Copy gitignored editor config folders (.zed, .idea, etc.)
3. Run `npm install && npm run bootstrap`

## Deleting Worktrees

```bash
git worktree remove ../yaak-worktrees/<NAME>
```

## Port Assignments

- Main worktree: 1420 (Vite), 64343 (MCP)
- First worktree: 1421, 64344
- Second worktree: 1422, 64345
- etc.

Each worktree can run `npm run app-dev` simultaneously without conflicts.
