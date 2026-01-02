---
description: Generate formatted release notes for Yaak releases
allowed-tools: Bash(git tag:*)
---

Generate formatted release notes for Yaak releases by analyzing git history and pull request descriptions.

## What to do

1. Identifies the version tag and previous version
2. Retrieves all commits between versions 
   - If the version is a beta version, it retrieves commits between the beta version and previous beta version
   - If the version is a stable version, it retrieves commits between the stable version and the previous stable version
3. Fetches PR descriptions for linked issues to find:
   - Feedback URLs (feedback.yaak.app)
   - Additional context and descriptions
   - Installation links for plugins
4. Formats the release notes using the standard Yaak format:
   - Changelog badge at the top
   - Bulleted list of changes with PR links
   - Feedback links where available
   - Full changelog comparison link at the bottom

## Output Format

The skill generates markdown-formatted release notes following this structure:

```markdown
[![Changelog](https://img.shields.io/badge/Changelog-VERSION-blue)](https://yaak.app/changelog/VERSION)

- Feature/fix description in by @username [#123](https://github.com/mountain-loop/yaak/pull/123)
- [Linked feedback item](https://feedback.yaak.app/p/item) by @username in [#456](https://github.com/mountain-loop/yaak/pull/456)
- A simple item that doesn't have a feedback or PR link

**Full Changelog**: https://github.com/mountain-loop/yaak/compare/vPREV...vCURRENT
```

**IMPORTANT**: Always add a blank lines around the markdown code fence and output the markdown code block last
**IMPORTANT**: PRs by `@gschier` should not mention the @username
