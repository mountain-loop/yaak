/**
 * Simple heuristic to detect if a string likely contains JSON/JSONC comments.
 * Checks for // and /* patterns that are NOT inside double-quoted strings.
 * Used for UI hints only — doesn't need to be perfect.
 */
export function textLikelyContainsJsonComments(text: string): boolean {
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '"') {
        inString = false;
      } else if (ch === '\\') {
        i++; // skip escaped char
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '/' && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === '/' || next === '*') {
        return true;
      }
    }
  }
  return false;
}
