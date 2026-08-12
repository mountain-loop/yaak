import { md5 } from "js-md5";

/** How much of each end and the middle to hash */
const SAMPLE_CHARS = 512;

/**
 * A cheap stand-in for hashing a whole document.
 *
 * The editor caches undo history, folds and selection in sessionStorage, keyed by a hash of
 * the document so a stale entry is never restored onto different content. Hashing the whole
 * document costs about 4 ms per megabyte, and it is paid on every editor update as well as on
 * restore, which is a lot of work to protect a fold position.
 *
 * Sampling the ends and the middle alongside the exact length is enough: two different
 * documents would have to agree on length and all three samples to collide, and the cost of a
 * collision is a fold or cursor landing where it doesn't belong. Documents small enough to
 * hash outright still are.
 */
export function docFingerprint(text: string): string {
  if (text.length <= SAMPLE_CHARS * 3) {
    return `${text.length}:${md5(text)}`;
  }

  const middle = Math.floor((text.length - SAMPLE_CHARS) / 2);
  return [
    text.length,
    md5(text.slice(0, SAMPLE_CHARS)),
    md5(text.slice(middle, middle + SAMPLE_CHARS)),
    md5(text.slice(-SAMPLE_CHARS)),
  ].join(":");
}
