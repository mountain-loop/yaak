import { getSearchQuery, type SearchQuery, searchPanelOpen } from "@codemirror/search";
import type { EditorState, Extension, Text } from "@codemirror/state";
import { type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** Matches are counted no further than this, since an exact total stops being useful long before */
export const MAX_COUNT = 9999;

/** What normalizing rewrites: anything outside ASCII, plus the case it folds */
const REWRITTEN = /\P{ASCII}|[A-Z]+/gu;
const REWRITTEN_CASE_SENSITIVE = /\P{ASCII}/gu;

export interface Match {
  from: number;
  to: number;
}

/** A character whose normalized form is a different length, shifting every offset past it */
interface Expansion {
  normFrom: number;
  normTo: number;
  docFrom: number;
  docTo: number;
}

/** A document as SearchCursor compares it, with what's needed to get back to real offsets */
export interface NormalizedDoc {
  text: string;
  expansions: Expansion[];
}

/**
 * Rewrites a document the way SearchCursor does — NFKD, then a case fold unless the search is
 * case-sensitive — in a single pass rather than one call per code point.
 *
 * The cursor spends 90% of its time asking ICU about one character at a time, which is what
 * makes counting matches in a large response slow. Doing it a character at a time still matters
 * for the result, since it keeps NFKD from reordering marks across characters, so the
 * granularity stays and only the repeated work goes: each distinct character is normalized once
 * and the answer reused, and ASCII runs never reach ICU at all.
 */
export function normalizeDoc(text: string, caseSensitive: boolean): NormalizedDoc {
  const rewritten = new Map<string, string>();
  const expansions: Expansion[] = [];
  let shift = 0;

  const normalized = text.replace(
    caseSensitive ? REWRITTEN_CASE_SENSITIVE : REWRITTEN,
    (chunk: string, at: number) => {
      // An ASCII run only ever folds case, which can't change its length
      if (chunk.charCodeAt(0) < 0x80) return chunk.toLowerCase();

      let out = rewritten.get(chunk);
      if (out === undefined) {
        out = chunk.normalize("NFKD");
        if (!caseSensitive) out = out.toLowerCase();
        rewritten.set(chunk, out);
      }

      if (out.length !== chunk.length) {
        expansions.push({
          normFrom: at + shift,
          normTo: at + shift + out.length,
          docFrom: at,
          docTo: at + chunk.length,
        });
        shift += out.length - chunk.length;
      }

      return out;
    },
  );

  return { text: normalized, expansions };
}

/** The query as SearchCursor compares it, which it normalizes whole rather than by character */
export function normalizeSearch(search: string, caseSensitive: boolean): string {
  const normalized = search.normalize("NFKD");
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/** Every occurrence of `needle`, skipping matches that overlap an earlier one */
export function scanNormalized(doc: NormalizedDoc, needle: string): Match[] {
  const matches: Match[] = [];
  if (needle === "") return matches;

  const { text } = doc;
  let pos = text.indexOf(needle);
  while (pos >= 0) {
    let end = pos + needle.length;
    // However the query was cut, a match ends on a whole code point, as the cursor's do
    if (isLowSurrogate(text.charCodeAt(end))) end++;

    matches.push({ from: docStart(doc, pos), to: docEnd(doc, end) });
    if (matches.length > MAX_COUNT) break;

    pos = text.indexOf(needle, resumeAfter(doc, end));
  }

  return matches;
}

/** The same through the query's own cursor, which handles regexps and whole words */
export function scanQuery(state: EditorState, query: SearchQuery): Match[] {
  const matches: Match[] = [];
  const cursor = query.getCursor(state);

  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    matches.push({ from: result.value.from, to: result.value.to });
    if (matches.length > MAX_COUNT) break;
  }

  return matches;
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** The last character expansion beginning at or before `offset`, if there is one */
function expansionAt({ expansions }: NormalizedDoc, offset: number): Expansion | null {
  let low = 0;
  let high = expansions.length - 1;
  let found: Expansion | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (expansions[mid]!.normFrom <= offset) {
      found = expansions[mid]!;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

function docStart(doc: NormalizedDoc, offset: number): number {
  const expansion = expansionAt(doc, offset);
  if (expansion == null) return offset;
  // A match starting inside a character's expansion starts at the character
  return offset < expansion.normTo
    ? expansion.docFrom
    : offset - (expansion.normTo - expansion.docTo);
}

/**
 * Where scanning picks up after a match ending at `offset`.
 *
 * The cursor moves through the document a character at a time, so once a match ends inside a
 * character's expansion the rest of that expansion is behind it — "…" holds three dots but only
 * ever counts as one match of ".".
 */
function resumeAfter(doc: NormalizedDoc, offset: number): number {
  const expansion = expansionAt(doc, offset);
  return expansion != null && offset > expansion.normFrom && offset < expansion.normTo
    ? expansion.normTo
    : offset;
}

function docEnd(doc: NormalizedDoc, offset: number): number {
  const expansion = expansionAt(doc, offset);
  if (expansion == null) return offset;
  if (offset <= expansion.normFrom) return expansion.docFrom;
  // A match ending inside a character's expansion covers the whole character
  return offset < expansion.normTo
    ? expansion.docTo
    : offset - (expansion.normTo - expansion.docTo);
}

/** Position of the match holding the selection, counting from one, or 0 when it isn't on one */
export function currentMatch(matches: Match[], selection: { from: number; to: number }): number {
  let index = 0;
  for (const match of matches) {
    index++;
    if (match.from <= selection.from && match.to >= selection.to) return index;
  }
  return 0;
}

/** The text a plain query looks for, or null when only the cursor can answer it */
export function literalSearch(query: SearchQuery): string | null {
  if (query.regexp || query.wholeWord || query.test != null) return null;
  // Mirrors SearchQuery's own unquoting, which the published type doesn't expose
  return query.literal
    ? query.search
    : query.search.replace(/\\([nrt\\])/g, (_, ch) =>
        ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : "\\",
      );
}

/**
 * Finds the matches for the search panel, keeping the normalized document and the matches it
 * last found, so neither moving the selection nor typing another character starts over.
 */
export class MatchCounter {
  private doc: { doc: Text; caseSensitive: boolean; normalized: NormalizedDoc } | null = null;
  private last: { doc: Text; query: SearchQuery; matches: Match[] } | null = null;

  matches(state: EditorState, query: SearchQuery): Match[] {
    const last = this.last;
    if (last != null && last.doc === state.doc && last.query.eq(query)) {
      return last.matches;
    }

    const matches = this.scan(state, query);
    this.last = { doc: state.doc, query, matches };
    return matches;
  }

  private scan(state: EditorState, query: SearchQuery): Match[] {
    const search = literalSearch(query);
    if (search == null) return scanQuery(state, query);

    const doc = this.normalizedDoc(state.doc, query.caseSensitive);
    return scanNormalized(doc, normalizeSearch(search, query.caseSensitive));
  }

  private normalizedDoc(doc: Text, caseSensitive: boolean): NormalizedDoc {
    const cached = this.doc;
    if (cached != null && cached.doc === doc && cached.caseSensitive === caseSensitive) {
      return cached.normalized;
    }

    const normalized = normalizeDoc(doc.toString(), caseSensitive);
    this.doc = { doc, caseSensitive, normalized };
    return normalized;
  }
}

/**
 * A CodeMirror extension that displays the total number of search matches
 * inside the built-in search panel.
 */
export function searchMatchCount(): Extension {
  return ViewPlugin.fromClass(
    class {
      private countEl: HTMLElement | null = null;
      private counter = new MatchCounter();

      constructor(private view: EditorView) {
        this.updateCount();
      }

      update(update: ViewUpdate) {
        // Recompute when doc changes, search state changes, or selection moves
        const query = getSearchQuery(update.state);
        const prevQuery = getSearchQuery(update.startState);
        const open = searchPanelOpen(update.state);
        const prevOpen = searchPanelOpen(update.startState);

        if (update.docChanged || update.selectionSet || !query.eq(prevQuery) || open !== prevOpen) {
          this.updateCount();
        }
      }

      private updateCount() {
        const state = this.view.state;
        const open = searchPanelOpen(state);
        const query = getSearchQuery(state);

        if (!open) {
          this.removeCountEl();
          return;
        }

        this.ensureCountEl();
        if (this.countEl == null) return;

        if (!query.search) {
          this.countEl.textContent = "0/0";
          return;
        }

        const matches = this.counter.matches(state, query);
        if (matches.length > MAX_COUNT) {
          this.countEl.textContent = `${MAX_COUNT}+`;
        } else if (matches.length === 0) {
          this.countEl.textContent = "0/0";
        } else {
          const current = currentMatch(matches, state.selection.main);
          this.countEl.textContent = `${current}/${matches.length}`;
        }
      }

      private ensureCountEl() {
        // Find the search panel in the editor DOM
        const panel = this.view.dom.querySelector(".cm-search");
        if (!panel) {
          this.countEl = null;
          return;
        }

        if (this.countEl && this.countEl.parentElement === panel) {
          return; // Already attached
        }

        this.countEl = document.createElement("span");
        this.countEl.className = "cm-search-match-count";

        // Reorder: insert prev button, then next button, then count after the search input
        const searchInput = panel.querySelector("input");
        const prevBtn = panel.querySelector('button[name="prev"]');
        const nextBtn = panel.querySelector('button[name="next"]');
        if (searchInput && searchInput.parentElement === panel) {
          searchInput.after(this.countEl);
          if (prevBtn) this.countEl.after(prevBtn);
          if (nextBtn && prevBtn) prevBtn.after(nextBtn);
        } else {
          panel.prepend(this.countEl);
        }
      }

      private removeCountEl() {
        if (this.countEl) {
          this.countEl.remove();
          this.countEl = null;
        }
      }

      destroy() {
        this.removeCountEl();
      }
    },
  );
}
