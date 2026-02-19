---
name: release-check-out-pr
description: Check out a GitHub pull request for review in this repo, either in the current directory or in a new isolated worktree at ../yaak-worktrees/pr-<PR_NUMBER>. Use when asked to run or replace the old Claude check-out-pr command.
---

# Check Out PR

Check out a PR by number and let the user choose between current-directory checkout and isolated worktree checkout.

## Workflow

1. Confirm `gh` CLI is available.
2. If no PR number is provided, list open PRs (`gh pr list`) and ask the user to choose one.
3. Read PR metadata:
   - `gh pr view <PR_NUMBER> --json number,headRefName`
4. Ask the user to choose:
   - Option A: check out in the current directory
   - Option B: create a new worktree at `../yaak-worktrees/pr-<PR_NUMBER>`

## Option A: Current Directory

1. Run:
   - `gh pr checkout <PR_NUMBER>`
2. Report the checked-out branch.

## Option B: New Worktree

1. Use path:
   - `../yaak-worktrees/pr-<PR_NUMBER>`
2. Create the worktree with a timeout of at least 5 minutes because checkout hooks run bootstrap.
3. In the new worktree, run:
   - `gh pr checkout <PR_NUMBER>`
4. Report:
   - Worktree path
   - Assigned ports from `.env.local` if present
   - How to start work:
     - `cd ../yaak-worktrees/pr-<PR_NUMBER>`
     - `npm run app-dev`
   - How to remove when done:
     - `git worktree remove ../yaak-worktrees/pr-<PR_NUMBER>`

## Error Handling

- If PR does not exist, show a clear error.
- If worktree already exists, ask whether to reuse it or remove/recreate it.
- If `gh` is missing, instruct the user to install/authenticate it.
