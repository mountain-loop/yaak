/**
 * When a git query that failed is allowed to run again.
 *
 * Nothing here retries on its own; the git queries are polled by window focus and by a
 * long interval. The failures worth pacing are the ones that do not clear up on their
 * own — a sync directory that is not a repository, a repository that was deleted — where
 * every focus event would otherwise re-run the same doomed command.
 */

const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

export function shouldRetryAfterFailure(
  failureCount: number,
  erroredAt: number,
  now: number,
): boolean {
  if (failureCount <= 0) return true;
  const wait = Math.min(RETRY_BASE_MS * 2 ** (failureCount - 1), RETRY_MAX_MS);
  return now - erroredAt >= wait;
}
