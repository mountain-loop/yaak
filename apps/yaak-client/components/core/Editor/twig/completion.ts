import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { startCompletion } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import type { TemplateFunction } from "@yaakapp-internal/plugins";

const openTag = "${[ ";
const closeTag = " ]}";

export type TwigCompletionOptionVariable = {
  type: "variable";
};

export type TwigCompletionOptionNamespace = {
  type: "namespace";
};

export type TwigCompletionOptionFunction = TemplateFunction & {
  type: "function";
};

export type TwigCompletionOption = (
  | TwigCompletionOptionFunction
  | TwigCompletionOptionVariable
  | TwigCompletionOptionNamespace
) & {
  name: string;
  label: string | HTMLElement;
  description?: string;
  onClick: (rawTag: string, startPos: number) => void;
  value: string | null;
  invalid?: boolean;
};

export interface TwigCompletionConfig {
  options: TwigCompletionOption[];
}

const MIN_MATCH_NAME = 1;

// Only inspect adjacent whitespace, including newlines, rather than copying the
// entire document to look for a delimiter in large request bodies.
function skipWhitespace(state: EditorState, pos: number, direction: -1 | 1) {
  while (direction === -1 ? pos > 0 : pos < state.doc.length) {
    const from = direction === -1 ? pos - 1 : pos;
    if (!/\s/.test(state.sliceDoc(from, from + 1))) break;
    pos += direction;
  }
  return pos;
}

function findOpenTag(state: EditorState, from: number) {
  const end = skipWhitespace(state, from, -1);
  return end >= 3 && state.sliceDoc(end - 3, end) === "${[" ? end - 3 : null;
}

export function twigCompletion({ options }: TwigCompletionConfig) {
  return function completions(context: CompletionContext) {
    const toStartOfName = context.matchBefore(/[\w_.]*/);
    const toMatch = toStartOfName ?? null;

    if (toMatch === null) return null;

    const matchLen = toMatch.to - toMatch.from;
    const hasOpenTag = findOpenTag(context.state, toMatch.from) !== null;
    if (!context.explicit && !hasOpenTag && toMatch.from > 0 && matchLen < MIN_MATCH_NAME) {
      return null;
    }

    const completions: Completion[] = options
      .flatMap((o): Completion[] => {
        const matchSegments = toMatch.text.replace(/^\$/, "").split(".");
        const optionSegments = o.name.split(".");

        // If not on the last segment, only complete the namespace
        if (matchSegments.length < optionSegments.length) {
          const prefix = optionSegments.slice(0, matchSegments.length).join(".");
          return [
            {
              label: `${prefix}.*`,
              type: "namespace",
              detail: "namespace",
              apply: (view, _completion, from, to) => {
                const insert = `${prefix}.`;
                view.dispatch({
                  changes: { from, to, insert: insert },
                  selection: { anchor: from + insert.length },
                });
                // Leave the autocomplete open so the user can continue typing the rest of the namespace
                startCompletion(view);
              },
            },
          ];
        }

        // If on the last segment, wrap the entire tag
        const inner = o.type === "function" ? `${o.name}()` : o.name;
        return [
          {
            label: o.name,
            info: o.description,
            detail: o.type,
            type: o.type === "variable" ? "variable" : "function",
            apply: (view, _completion, from, to) => {
              // Keep the completion range name-only for filtering, but replace a manually
              // typed opener when accepting (through either the keyboard or the menu).
              const opener = findOpenTag(view.state, from);
              if (opener !== null) {
                from = opener;
                const hasParentheses =
                  o.type === "function" && view.state.sliceDoc(to, to + 2) === "()";
                const closer = skipWhitespace(view.state, to + (hasParentheses ? 2 : 0), 1);
                if (view.state.sliceDoc(closer, closer + 2) === "]}") to = closer + 2;
              }
              const insert = openTag + inner + closeTag;
              view.dispatch({
                changes: { from, to, insert: insert },
                selection: { anchor: from + insert.length },
              });
            },
          },
        ];
      })
      .filter((v) => v != null);

    const uniqueCompletions = uniqueBy(completions, "label");
    const sortedCompletions = uniqueCompletions.sort((a, b) => {
      const boostDiff = defaultBoost(b) - defaultBoost(a);
      if (boostDiff !== 0) return boostDiff;
      return a.label.localeCompare(b.label);
    });

    return {
      matchLen,
      // Delimiters change the replacement range; dots change namespace options.
      validFor: /^\w*$/,
      from: toMatch.from,
      options: sortedCompletions,
    };
  };
}

export function uniqueBy<T, K extends keyof T>(arr: T[], key: K): T[] {
  const map = new Map<T[K], T>();
  for (const item of arr) {
    map.set(item[key], item); // overwrites → keeps last
  }
  return [...map.values()];
}

export function defaultBoost(o: Completion) {
  if (o.type === "variable") return 4;
  if (o.type === "constant") return 3;
  if (o.type === "function") return 2;
  if (o.type === "namespace") return 1;
  return 0;
}
