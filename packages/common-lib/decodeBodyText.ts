/**
 * The charset a content type names, as `TextDecoder` calls it (`windows-1252` for
 * `iso-8859-1`), or null when it names none or one `TextDecoder` doesn't know.
 */
export function contentTypeCharset(contentType: string | null): string | null {
  const label = contentType?.match(/;\s*charset\s*=\s*"?([^";\s]+)"?/i)?.[1];
  if (label == null) return null;
  try {
    return new TextDecoder(label).encoding;
  } catch {
    return null;
  }
}

/**
 * The bytes as UTF-8, or null when they aren't valid UTF-8. A truncated body may end partway
 * through a character, so up to three trailing bytes are dropped before giving up on it.
 */
export function strictUtf8Text(bytes: Uint8Array, truncated = false): string | null {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const maxTrim = truncated ? Math.min(3, bytes.length) : 0;
  for (let trim = 0; trim <= maxTrim; trim++) {
    try {
      return decoder.decode(bytes.subarray(0, bytes.length - trim));
    } catch {
      // Try again without the last byte
    }
  }
  return null;
}

/**
 * A body's text in the charset its content type names. Without one it is UTF-8, unless the
 * bytes aren't valid UTF-8, when it is windows-1252, as browsers read unlabeled text.
 */
export function decodeBodyText(
  bytes: Uint8Array,
  contentType: string | null,
  { truncated = false }: { truncated?: boolean } = {},
): string {
  const charset = contentTypeCharset(contentType);
  if (charset != null) return new TextDecoder(charset).decode(bytes);
  return strictUtf8Text(bytes, truncated) ?? new TextDecoder("windows-1252").decode(bytes);
}
