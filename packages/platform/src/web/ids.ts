/**
 * Random ids that do not need a secure context.
 *
 * `crypto.randomUUID` exists only on HTTPS and localhost, so a tab opened at
 * `http://some-host:1424` — a self-hosted instance reached from another machine —
 * throws on it before anything renders. `crypto.getRandomValues` carries no such
 * restriction, and nothing here needs UUID semantics: these ids identify a tab and
 * a stream within one page, and only have to not collide with each other.
 */
export function randomId(bytes = 8): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
