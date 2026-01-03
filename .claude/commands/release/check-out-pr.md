---
description: Review a PR in a new worktree
allowed-tools: Bash(git worktree:*), Bash(gh pr:*)
---

Review a GitHub pull request in a new git worktree.

## Usage

```
/review-pr <PR_NUMBER>
```

## What to do

1. List all open pull requests and ask the user to select one
2. Get PR information using `gh pr view <PR_NUMBER> --json number,headRefName`
3. Extract the branch name from the PR
4. Create a new worktree at `../yaak-worktrees/pr-<PR_NUMBER>` 
   - IMPORTANT: Set a long timeout (600000ms = 10 minutes) for this command as the post-checkout hook runs npm install and bootstrap which can take several minutes
5. Checkout the PR branch in the new worktree using `gh pr checkout <PR_NUMBER>`
6. The post-checkout hook will automatically:
   - Create `.env.local` with unique ports
   - Copy editor config folders
   - Run `npm install && npm run bootstrap`
7. Inform the user:
   - Where the worktree was created
   - What ports were assigned
   - How to access it (cd command)
   - How to run the dev server
   - How to remove the worktree when done

## Example Output

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
