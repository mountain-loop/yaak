---
description: Review a PR in a new worktree
allowed-tools: Bash(git worktree:*), Bash(gh pr:*), Bash(git branch:*)
---

Check out a GitHub pull request for review.

## Usage

```
/check-out-pr <PR_NUMBER>
```

## What to do

1. If no PR number is provided, list all open pull requests and ask the user to select one
2. Get PR information using `gh pr view <PR_NUMBER> --json number,headRefName`
3. **Ask the user** whether they want to:
   - **A) Check out in current directory** — simple `gh pr checkout <PR_NUMBER>`
   - **B) Create a new worktree** — isolated copy at `../yaak-worktrees/pr-<PR_NUMBER>`
4. Follow the appropriate path below

## Option A: Check out in current directory

1. Run `gh pr checkout <PR_NUMBER>`
2. Inform the user which branch they're now on

## Option B: Create a new worktree

1. Create a new worktree at `../yaak-worktrees/pr-<PR_NUMBER>` using `git worktree add` with a timeout of at least 300000ms (5 minutes) since the post-checkout hook runs a bootstrap script
2. Checkout the PR branch in the new worktree using `gh pr checkout <PR_NUMBER>`
3. The post-checkout hook will automatically:
   - Create `.env.local` with unique ports
   - Copy editor config folders
   - Run `npm install && npm run bootstrap`
4. Inform the user:
   - Where the worktree was created
   - What ports were assigned
   - How to access it (cd command)
   - How to run the dev server
   - How to remove the worktree when done

### Example worktree output

```
Created worktree for PR #123 at ../yaak-worktrees/pr-123
Branch: feature-auth
Ports: Vite (1421), MCP (64344)

To start working:
  cd ../yaak-worktrees/pr-123
  npm run app-dev

To remove when done:
  git worktree remove ../yaak-worktrees/pr-123
```

## Error Handling

- If the PR doesn't exist, show a helpful error
- If the worktree already exists, inform the user and ask if they want to remove and recreate it
- If `gh` CLI is not available, inform the user to install it
