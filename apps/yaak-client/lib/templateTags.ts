/*
 * Finding template tags in text.
 *
 * A tag closes at `]}`, but a quoted argument is allowed to contain `]}` of its own — the
 * printer in `crates/yaak-templates` emits `${[ fn(a='x]}y') ]}` verbatim — so the scan has to
 * step over quoted strings. It mirrors the Lezer grammar in
 * `components/core/Editor/twig/twig.grammar`: a terminated `'…'` (where `\` escapes whatever
 * follows it) is consumed whole, and an unterminated quote is just another character, so a
 * half-typed tag still closes at the next `]}` instead of swallowing the rest of the document.
 *
 * This was a regex until CodeQL flagged it (js/polynomial-redos): matching an unterminated
 * quote needed a negative lookahead that rescanned to the end of the input at every unpaired
 * quote, which is quadratic on text an attacker picks. The scan below is linear instead — see
 * the notes on `closingQuoteTable` and on the dead-end set in `findTemplateTags` for why.
 */

const QUOTE = 0x27; // '
const BACKSLASH = 0x5c; // \
const CLOSE_BRACKET = 0x5d; // ]
const CLOSE_BRACE = 0x7d; // }

/** The `${[`…`]}` bounds of one tag, and what sits between them. */
export interface TemplateTagMatch {
  /** Index of the `$` that opens the tag. */
  start: number;
  /** Index just past the closing `]}`. */
  end: number;
  /** Everything between `${[` and `]}`, not trimmed. */
  inner: string;
}

/**
 * For every index `i`, the index of the `'` that closes a string whose body starts at `i`, or
 * `-1` when nothing does.
 *
 * Built right to left in a single pass, which is the trick that replaces the regex lookahead:
 * whether a quote opens a terminated string depends only on the text after it, so the answer
 * can be computed once for every position instead of re-derived at each quote. Skipping a
 * string of any length then costs one lookup.
 */
function closingQuoteTable(text: string): Int32Array {
  // Two extra slots so a `\` in the last position can read past the end and find `-1`
  const table = new Int32Array(text.length + 2).fill(-1);
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text.charCodeAt(i);
    // A backslash escapes whatever follows it, including a quote
    const next = c === BACKSLASH ? table[i + 2] : table[i + 1];
    table[i] = c === QUOTE ? i : (next ?? -1);
  }
  return table;
}

/**
 * Finds every template tag in `text`, in order and without overlaps.
 *
 * A `${[` with no `]}` after it isn't a tag, and neither is a `${[` nested inside a tag body —
 * both are ordinary content, same as the regex this replaced treated them.
 */
export function findTemplateTags(text: string): TemplateTagMatch[] {
  const matches: TemplateTagMatch[] = [];

  // Both built only once a scan actually needs them, so short values allocate nothing
  let closingQuotes: Int32Array | null = null;

  /*
   * Body positions a previous scan already ran off the end of the text from. Where a scan ends
   * up depends only on where it starts, so a scan that walks into one of these would repeat
   * that same walk and fail the same way, and can stop right there.
   *
   * That bound is what keeps the whole pass linear: every position enters this set at most
   * once, and every step of every scan either visits a position for the first time or ends
   * that scan.
   */
  let deadEnds: Set<number> | null = null;

  let searchFrom = 0;
  while (searchFrom < text.length) {
    const start = text.indexOf("${[", searchFrom);
    if (start < 0) break;

    const visited: number[] = [];
    let end = -1;
    let i = start + 3;
    while (i < text.length) {
      if (deadEnds?.has(i)) break;
      visited.push(i);

      const c = text.charCodeAt(i);
      if (c === QUOTE) {
        closingQuotes ??= closingQuoteTable(text);
        const close = closingQuotes[i + 1] ?? -1;
        // An unterminated quote is an ordinary character, so only step over a closed string
        i = close < 0 ? i + 1 : close + 1;
        continue;
      }

      if (c === CLOSE_BRACKET && text.charCodeAt(i + 1) === CLOSE_BRACE) {
        end = i + 2;
        break;
      }

      i += 1;
    }

    if (end < 0) {
      // Not a tag. Resume past the opener: a real tag may start inside a string this scan
      // stepped over.
      deadEnds ??= new Set();
      for (const position of visited) deadEnds.add(position);
      searchFrom = start + 3;
      continue;
    }

    matches.push({ start, end, inner: text.slice(start + 3, end - 2) });
    searchFrom = end;
  }

  return matches;
}

/** Rewrites every template tag in `text` with whatever `replace` returns for it. */
export function replaceTemplateTags(
  text: string,
  replace: (match: TemplateTagMatch) => string,
): string {
  const matches = findTemplateTags(text);
  if (matches.length === 0) return text;

  let result = "";
  let copiedTo = 0;
  for (const match of matches) {
    result += text.slice(copiedTo, match.start) + replace(match);
    copiedTo = match.end;
  }

  return result + text.slice(copiedTo);
}
