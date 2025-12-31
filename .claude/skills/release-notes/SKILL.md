---
name: Yaak:generate-release-notes
description: Generate formatted release notes for Yaak releases by analyzing git history and pull request descriptions
---

# Release Notes Generator

Generate formatted release notes for Yaak releases by analyzing git history and pull request descriptions.

## Usage

You can invoke this skill by:
1. Providing a version number: "Generate release notes for 2025.10.0-beta.6"
2. Using "latest" to generate notes for the most recent tag

## What this skill does

1. Identifies the version tag and previous version
2. Retrieves all commits between versions
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

- Feature/fix description in [#123](https://github.com/mountain-loop/yaak/pull/123)
  - Additional context if needed
- [Linked feedback item](https://feedback.yaak.app/p/item) in [#456](https://github.com/mountain-loop/yaak/pull/456)

**Full Changelog**: https://github.com/mountain-loop/yaak/compare/vPREV...vCURRENT
```

**IMPORTANT**: Always add a blank line after the closing ``` markdown fence before any explanatory text.

## Requirements

- Git repository must be available
- GitHub CLI (`gh`) must be installed and authenticated
- Version tags should follow the format: `v2025.10.0-beta.X`
