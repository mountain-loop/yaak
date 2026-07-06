/**
 * Extract `:name`-style path placeholders from a URL string.
 *
 * A placeholder is `:` followed by one-or-more characters that are not `/`, `?`,
 * `#`, or `:`. The `:` boundary means a placeholder ends where a literal colon
 * starts in the same segment, e.g. `/tasks/:id:increment-importance` yields one
 * placeholder `:id` and `:increment-importance` is literal text.
 *
 * Only `:` that sits at the start of a `/`-delimited segment counts — `/abc:def`
 * has no placeholders. Returned names include the leading colon.
 */
export function extractPathPlaceholders(url: string): string[] {
  return Array.from(url.matchAll(/\/(:[^/?#:]+)/g)).map((m) => m[1] ?? "");
}
