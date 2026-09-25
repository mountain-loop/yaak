/*
 * A template tag closes at `]}`, but a quoted argument is allowed to contain `]}` of its own —
 * the printer in `crates/yaak-templates` emits `${[ fn(a='x]}y') ]}` verbatim. Scanning to the
 * first `]}` would cut that tag in half, so the pattern below skips over quoted strings.
 *
 * It mirrors the Lezer grammar in `components/core/Editor/twig/twig.grammar`: a terminated
 * `'…'` (where `\` escapes whatever follows it) is consumed whole, and an unterminated quote is
 * just another character, so a half-typed tag still closes at the next `]}` instead of
 * swallowing the rest of the document.
 */

/** A terminated single-quoted string, with `\` escaping the next character. */
const STRING = String.raw`'(?:[^\\']|\\[\s\S])*'`;

/** A `'` that doesn't open a terminated string. Kept separate so the two never overlap. */
const LONE_QUOTE = String.raw`'(?!(?:[^\\']|\\[\s\S])*')`;

/** Anything that can't close the tag: a `]` with no `}` after it, or any other plain character. */
const OTHER = String.raw`](?!})|[^'\]]`;

const TAG_BODY = `(?:${STRING}|${LONE_QUOTE}|${OTHER})*`;

/**
 * Matches an entire template tag, with group 1 holding its inner content (not trimmed).
 *
 * This is a global regex, so only use it with `String.replace` or `String.matchAll`, which
 * don't leave `lastIndex` behind.
 */
export const TEMPLATE_TAG_REGEX = new RegExp(String.raw`\$\{\[(${TAG_BODY})]}`, "g");
