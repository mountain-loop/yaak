---
name: yaak-changelog
description: Create or edit Yaak changelogs. Beta and draft prerelease changelogs live only in the GitHub release body; stable release changelogs live in `src/content/changelog/YYYYMMDD_VERSION/`. Use when Codex needs to update a beta GitHub release body, generate a stable website changelog from beta releases, update `_release.yaml` or `_intro.md`, expand major entries into markdown files, or preserve Yaak's changelog writing style.
---

# Yaak Changelog

Use this skill to create Yaak changelogs in the correct place:

- Beta or draft prerelease changelogs live only on the GitHub release.
- Stable release changelogs live in website files under `src/content/changelog/YYYYMMDD_VERSION/`.

## Workflow

1. Identify the target release.
- If the target tag contains `-beta` or the GitHub release is a draft prerelease, update the GitHub release body only. Do not create or edit `src/content/changelog/` files for beta releases.
- For a new stable changelog, gather all beta release notes for that version since the previous stable release, then create or edit website changelog files.
- Prefer `gh api` or GitHub release pages. If network access is restricted, request permission before querying GitHub.
- Extract PR numbers and `yaak.app/feedback` URLs while fetching. If most bullets do not include PR references, fetch again with a more specific prompt.
- Fetch PR authors when generating or revising release notes. Include contributor attribution for non-`@gschier` PR authors.

2. Parse release bullets.
- Treat each release-note bullet as one changelog entry.
- Skip dependency-only, generated, build-only, test-only, CI-only, and internal maintenance bullets unless they have a clear user-facing impact that can be described in user terms.
- For stable website changelogs, skip bullets prefixed with `[beta-only]`.
- Preserve the entry wording closely. Remove wrapping quotes from titles.
- Map categories to `feature`, `fix`, `improvement`, or `breaking`.
- Convert `#NNN` into `https://github.com/mountain-loop/yaak/pull/NNN`.

3. For beta or draft prerelease changelogs, update the GitHub release.
- Keep the changelog in the GitHub release body. Do not create a website changelog directory.
- Do not add a changelog badge or link to `yaak.app/changelog/VERSION` for beta releases.
- Prefer concise bullets with PR links and feedback links when available.
- When a bullet has a feedback URL, wrap the changelog item text itself in the feedback link, then put the PR link after it. Example: `- [Fixed request history timestamps](https://yaak.app/feedback/posts/request-history-time-stamp) in [#492](https://github.com/mountain-loop/yaak/pull/492)`.
- Append `by [@handle](https://github.com/handle)` to PR-backed bullets authored by external contributors. Do not append `by @gschier` for `@gschier` PRs.
- Include a `**Full Changelog**` comparison link using the previous beta tag when it exists, or the previous stable tag for `beta.1`.
- Use `gh release edit TAG --repo mountain-loop/yaak --notes-file ...` or the GitHub release API to update the draft/prerelease body.
- Stop after verifying the GitHub release body. The website checks below do not apply.

4. For stable website changelogs, create or edit the release directory.
- Path format: `src/content/changelog/YYYYMMDD_VERSION/`.
- For a new release, use today's date for `YYYYMMDD`.
- For an existing release, keep the original directory date.
- Do not create changelog directories for beta releases.

5. Write `_release.yaml`.
- Include `draft`, optional `title`, `summary`, `image`, `youtube`, and `entries`.
- Keep minor items as quick entries without `content`.
- Use `content` only when an entry needs its own markdown section.

```yaml
title: "What's New in 2026.1.0"
summary: "Brief overview of the most important additions and fixes"
draft: true
entries:
  - title: "Request debugging"
    category: feature
    pr: "https://github.com/mountain-loop/yaak/pull/123"
    feedback: "https://feedback.yaak.app/p/request-debugging"
    content: "request-debugging.md"
  - title: "Fix broken cookie clearing"
    category: fix
    pr: "https://github.com/mountain-loop/yaak/pull/124"
```

6. Expand major entries.
- Expand 3 to 6 major items when enough context exists.
- Create slugified markdown files and reference them with `content`.
- Read the related PR before writing expanded content.
- Add emoji prefixes only for expanded entry titles if it helps distinguish major sections.

7. Handle images.
- Reuse screenshots from PRs when they exist.
- Convert GitHub private attachment URLs to `https://github.com/user-attachments/assets/UUID` before upload.
- Upload with `go run cmd/yaakadmin/main.go upload "URL"` when the environment permits it.
- If no real image is available, use a placeholder with real alt text and a caption.

8. Write `_intro.md`.
- Add a short overview paragraph at the top of the release.
- Focus on the major themes across the release instead of repeating every bullet.

9. Follow Yaak writing style.
- Be direct and factual. Avoid hype.
- State what changed and how to use it.
- Keep paragraphs short.
- Use backticks for code symbols, settings, and literal values.
- Use bold sparingly for the most important phrase in a section.

## File Rules

- Beta releases must not create or edit files in `src/content/changelog/`.
- Main files are `_release.yaml` and optional `_intro.md`.
- Expanded entry files are regular markdown files such as `request-debugging.md`.
- `entries[].content` must match an existing markdown filename in the same directory.
- Images for changelog pages live under `static/changelog/VERSION/` when committed to the repo.

## Checks

- For beta releases, verify `gh release view TAG --repo mountain-loop/yaak --json body,tagName,isDraft,isPrerelease` and ensure no website changelog files were created.
- For beta releases, verify feedback-backed bullets use the feedback URL as the link target for the whole item text, not as a separate trailing `Feedback:` link.
- For stable releases, ensure each user-facing source bullet becomes exactly one changelog entry unless it is `[beta-only]` or dependency-only/internal maintenance.
- Ensure most entries include `pr` when the source release notes provide one.
- For stable releases, ensure every referenced `content` file exists.
- If the user wants stable website verification, run the site and inspect `/changelog/VERSION` and `/rss.xml`.
