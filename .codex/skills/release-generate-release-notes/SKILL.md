---
name: release-generate-release-notes
description: Generate Yaak release notes from git history and PR metadata, including feedback links and full changelog compare links. Use when asked to run or replace the old Claude generate-release-notes command.
---

# Generate Release Notes

Generate formatted markdown release notes for a Yaak tag.

## Workflow

1. Determine target tag.
2. Determine previous comparable tag:
   - Beta tag: compare against previous beta (if the root version is the same) or stable tag.
   - Stable tag: compare against previous stable tag.
3. Collect commits in range:
   - `git log --oneline <prev_tag>..<target_tag>`
4. For linked PRs, fetch metadata:
   - `gh pr view <PR_NUMBER> --json number,title,body,author,url`
5. Extract useful details:
   - Feedback URLs (`feedback.yaak.app`)
   - Plugin install links or other notable context
6. Format notes using Yaak style:
   - Changelog badge at top
   - Bulleted items with PR links where available
   - Feedback links where available
   - Full changelog compare link at bottom

## Formatting Rules

- Wrap final notes in a markdown code fence.
- Keep a blank line before and after the code fence.
- Output the markdown code block last.
- Do not append `by @gschier` for PRs authored by `@gschier`.

## Release Creation Prompt

After producing notes, ask whether to create a draft GitHub release.

If confirmed and release does not yet exist, run:

`gh release create <tag> --draft --prerelease --title "Release <version_without_v>" --notes '<release notes>'`

If a draft release for the tag already exists, update it instead:

`gh release edit <tag> --title "Release <version_without_v>" --notes-file <path_to_notes>`

Use title format `Release <version_without_v>`, e.g. `v2026.2.1-beta.1` -> `Release 2026.2.1-beta.1`.
