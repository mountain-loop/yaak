import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { autocompletion, startCompletion } from "@codemirror/autocomplete";
import { highlightingFor } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { Decoration, EditorView, ViewPlugin } from "@codemirror/view";
import type { Tag } from "@lezer/highlight";
import { tags as t } from "@lezer/highlight";
import type { Schema, TokenKind } from "@yaakapp-internal/query";
import { queryCompletions, queryTokens } from "@yaakapp-internal/query";

export interface QueryFilterOptions {
  schema: Schema;
  /** The values seen for each field path, offered after `@field:` */
  values?: Record<string, string[]>;
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

function completionSource({ schema, values }: QueryFilterOptions) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const result = queryCompletions(ctx.state.doc.toString(), ctx.pos, schema, values);
    if (result == null) return null;

    const { start, end } = result.span;
    // Field names pop up for something typed; on an empty spot, only when asked for
    const onlyFields = result.items.every((item) => item.kind === "field");
    if (onlyFields && start === end && !ctx.explicit) return null;

    const options: Completion[] = result.items.map((item) => ({
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

    // The engine has already filtered and ranked the options
    return { from: start, to: end, options, filter: false };
  };
}

/** Highlighting and completion for a search box written in Yaak's query language */
export function queryFilter(options: QueryFilterOptions): Extension {
  return [highlight, autocompletion({ override: [completionSource(options)] })];
}
