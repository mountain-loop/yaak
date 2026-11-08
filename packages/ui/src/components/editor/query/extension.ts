import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { highlightingFor } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { Tag } from "@lezer/highlight";
import { tags as t } from "@lezer/highlight";
import type { Schema, TokenKind } from "@yaakapp-internal/query";
import { queryCompletions, queryTokens } from "@yaakapp-internal/query";

/** A term the search cannot run, to underline: `from` and `to` count UTF-16 units */
export interface QueryProblem {
  from: number;
  to: number;
  /** Shown on hover, a few words */
  label: string;
  /** Searchable later rather than wrong: marked more quietly */
  quiet?: boolean;
}

export interface QueryFilterOptions {
  schema: Schema;
  /** The values seen for each field path, offered after `@field:` */
  values?: Record<string, string[]>;
  /**
   * Values for field paths `values` lacks, read as completion opens: `host` for `@host:`, and a
   * map's name, `header`, for the keys after `@header.`. Null for a path with none to offer.
   */
  loadValues?: (paths: string[]) => Promise<Record<string, string[]>>;
  /**
   * More completions for a bare word or an empty spot, after the engine's, such as saved
   * searches. `typed` is the word, and the completions replace it.
   */
  moreCompletions?: (typed: string) => Completion[];
  /** The terms of a query the search cannot run, underlined as typing settles */
  problems?: (text: string) => Promise<QueryProblem[]>;
}

const tokenTags: Record<TokenKind, Tag | null> = {
  field: t.attributeName,
  value: t.attributeValue,
  operator: t.operatorKeyword,
  quote: t.string,
  paren: t.paren,
  negation: t.operator,
  text: null,
};

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const token of queryTokens(state.doc.toString())) {
    const tag = tokenTags[token.kind];
    const className = tag == null ? null : highlightingFor(state, [tag]);
    if (className == null || token.span.start === token.span.end) continue;
    builder.add(token.span.start, token.span.end, Decoration.mark({ class: className }));
  }
  return builder.finish();
}

const highlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.state);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/**
 * The field paths whose values the term at `pos` would offer: its field's, a quoted value with
 * spaces included, or its map's keys
 */
export function pathsAt(text: string, pos: number): string[] {
  const before = text.slice(0, pos);
  const value = /@([A-Za-z0-9_.-]+):(?:"(?:[^"\\]|\\.)*|[^\s()"]*)$/.exec(before);
  if (value?.[1] != null) return [value[1].toLowerCase()];
  const key = /@([A-Za-z0-9_.-]+)\.[A-Za-z0-9_-]*$/.exec(before);
  if (key?.[1] != null) return [key[1].toLowerCase()];
  return [];
}

/** The bare word being typed at `pos`, or empty at the start of a term */
function wordAt(text: string, pos: number): { word: string; from: number } | null {
  const before = text.slice(0, pos);
  const m = /(^|[\s(])([^\s()"@:-][^\s()":]*)?$/.exec(before);
  if (m == null) return null;
  const word = m[2] ?? "";
  return { word, from: pos - word.length };
}

function completionSource({ schema, values, loadValues, moreCompletions }: QueryFilterOptions) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const text = ctx.state.doc.toString();
    let known = values ?? {};
    const wanted = pathsAt(text, ctx.pos).filter((p) => known[p] == null);
    if (loadValues != null && wanted.length > 0) {
      known = { ...known, ...(await loadValues(wanted)) };
      if (ctx.aborted) return null;
    }
    const result = queryCompletions(text, ctx.pos, schema, known);

    const options: Completion[] = (result?.items ?? []).map((item) => ({
      label: item.label,
      type: item.kind === "field" ? "property" : "constant",
      info: item.info ?? undefined,
      apply: (view, _completion, from, to) => {
        view.dispatch({
          changes: { from, to, insert: item.insert },
          selection: { anchor: from + item.insert.length },
        });
        if (item.reopen) startCompletion(view);
      },
    }));

    let from = result?.span.start ?? ctx.pos;
    let to = result?.span.end ?? ctx.pos;
    const word = moreCompletions == null ? null : wordAt(text, ctx.pos);
    // On an empty spot, only when asked for
    if (moreCompletions != null && word != null && (word.word !== "" || ctx.explicit)) {
      const more = moreCompletions(word.word);
      if (more.length > 0) {
        // Both replace the word being typed
        if (options.length === 0) [from, to] = [word.from, ctx.pos];
        if (from === word.from) options.push(...more);
      }
    }
    if (options.length === 0) return null;

    // Field names pop up for something typed; on an empty spot, only when asked for
    const onlyFields = options.every((o) => o.type === "property");
    if (onlyFields && from === to && !ctx.explicit) return null;

    // The engine has already filtered and ranked the options
    return { from, to, options, filter: false };
  };
}

const setProblems = StateEffect.define<QueryProblem[]>();

/** Underlines what the search cannot run, as `problems` last answered for the text */
const problemField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, tr) {
    let next = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setProblems)) continue;
      const builder = new RangeSetBuilder<Decoration>();
      const length = tr.state.doc.length;
      for (const p of [...effect.value].sort((a, b) => a.from - b.from)) {
        const from = Math.min(p.from, length);
        // An empty value, `@size:`, marks the colon before it
        const to = Math.min(Math.max(p.to, p.from + 1), length);
        const at = p.to === p.from ? Math.max(0, from - 1) : from;
        if (at >= to) continue;
        const className = p.quiet ? "cm-query-quiet" : "cm-query-problem";
        builder.add(at, to, Decoration.mark({ class: className, attributes: { title: p.label } }));
      }
      next = builder.finish();
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** How long typing settles before the search's problems are asked for */
const PROBLEMS_MS = 150;

function problemChecker(problems: (text: string) => Promise<QueryProblem[]>) {
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | null = null;

      constructor(readonly view: EditorView) {
        this.check();
      }

      update(update: ViewUpdate) {
        if (!update.docChanged) return;
        if (this.timer != null) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.check(), PROBLEMS_MS);
      }

      check() {
        this.timer = null;
        const text = this.view.state.doc.toString();
        problems(text)
          .then((found) => {
            // Answered for text since changed: the next check covers it
            if (this.view.state.doc.toString() !== text) return;
            this.view.dispatch({ effects: setProblems.of(found) });
          })
          .catch(() => {});
      }

      destroy() {
        if (this.timer != null) clearTimeout(this.timer);
      }
    },
  );
}

const problemTheme = EditorView.baseTheme({
  ".cm-query-problem": {
    textDecoration: "underline wavy var(--color-danger)",
    textUnderlineOffset: "3px",
  },
  ".cm-query-quiet": {
    textDecoration: "underline dotted var(--color-text-subtlest, currentColor)",
    textUnderlineOffset: "3px",
  },
});

/** Highlighting and completion for a search box written in Yaak's query language */
export function queryFilter(options: QueryFilterOptions): Extension {
  const extensions: Extension[] = [
    highlight,
    autocompletion({ override: [completionSource(options)] }),
  ];
  if (options.problems != null) {
    extensions.push(problemField, problemChecker(options.problems), problemTheme);
  }
  return extensions;
}
