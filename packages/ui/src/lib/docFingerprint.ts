import { md5 } from "js-md5";

/** How much of each end and the middle to hash */
const SAMPLE_CHARS = 512;

/**
 * Identifies a document, so a cached editor state is never restored onto different content.
 *
 * Hashing the whole document costs about 4 ms per megabyte and is paid on every editor update
 * as well as on restore, which is a lot of work for a document nobody can edit.
 *
 * `exact` decides how much certainty that buys. Editable documents get a full hash, because a
 * collision there would restore undo history belonging to other content and let an undo write
 * nonsense into the body. Read-only documents get a sampled one: they hold the megabyte-sized
 * responses this exists for, their history can never be applied, and the worst a collision can
 * do is put a fold or the cursor in the wrong place.
 *
 * Sampling still pins the exact length plus three windows, so a colliding pair has to agree on
 * all four and differ only in between. Documents small enough to hash outright still are.
 */
export function docFingerprint(text: string, { exact }: { exact: boolean }): string {
  if (exact || text.length <= SAMPLE_CHARS * 3) {
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
