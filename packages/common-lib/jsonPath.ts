/** Literal steps into a JSON response, distinct from JSONPath operators. */
export type JsonPathSegment =
  | { readonly kind: "key"; readonly key: string }
  | { readonly kind: "index"; readonly index: number };

const PATH_SEGMENT = /^(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\[(0|[1-9]\d*)\]|\[("(?:[^"\\]|\\.)*")\])/;

/**
 * Parse a single location with JSON-quoted keys (`$.a[0]["b.c"]`). Other
 * JSONPath expressions belong to the filter engine, not to the breadcrumb trail.
 */
export function jsonPathToSegments(path: string): JsonPathSegment[] | null {
  let rest = path.trim();
  if (!rest.startsWith("$")) return null;
  rest = rest.slice(1);

  const segments: JsonPathSegment[] = [];
  while (rest.length > 0) {
    const match = PATH_SEGMENT.exec(rest);
    if (match == null) return null;
    const [whole, bareKey, index, quotedKey] = match;
    if (bareKey != null) {
      if (bareKey === "$") return null; // The library's root operator, not a literal key.
      segments.push({ kind: "key", key: bareKey });
    } else if (index != null) {
      const value = Number(index);
      if (!Number.isSafeInteger(value)) return null;
      segments.push({ kind: "index", index: value });
    } else if (quotedKey != null) {
      try {
        segments.push({ kind: "key", key: JSON.parse(quotedKey) as string });
      } catch {
        return null;
      }
    }
    rest = rest.slice(whole.length);
  }
  return segments;
}
