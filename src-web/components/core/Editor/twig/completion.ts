import type { Completion, CompletionContext } from '@codemirror/autocomplete';

const openTag = '${[ ';
const closeTag = ' ]}';

export type TwigCompletionOptionVariable = {
  type: 'variable';
};

export type TwigCompletionOptionNamespace = {
  type: 'namespace';
};

export type TwigCompletionOptionFunction = {
  args: { name: string }[];
  aliases?: string[];
  type: 'function';
};

export type TwigCompletionOption = (
  | TwigCompletionOptionFunction
  | TwigCompletionOptionVariable
  | TwigCompletionOptionNamespace
) & {
  name: string;
  label: string;
  description?: string;
  onClick: (rawTag: string, startPos: number) => void;
  value: string | null;
  invalid?: boolean;
};

export interface TwigCompletionConfig {
  options: TwigCompletionOption[];
}

const MIN_MATCH_VAR = 1;
const MIN_MATCH_NAME = 1;

export function twigCompletion({ options }: TwigCompletionConfig) {
  return function completions(context: CompletionContext) {
    const toStartOfName = context.matchBefore(/[\w_.]*/);
    const toStartOfVariable = context.matchBefore(/\$\{?\[?\s*[\w_]*/);
    const toMatch = toStartOfVariable ?? toStartOfName ?? null;

    if (toMatch === null) return null;

    const matchLen = toMatch.to - toMatch.from;

    const failedVarLen = toStartOfVariable !== null && matchLen < MIN_MATCH_VAR;
    if (failedVarLen && !context.explicit) {
      return null;
    }

    const failedNameLen = toStartOfVariable === null && matchLen < MIN_MATCH_NAME;
    if (failedNameLen && !context.explicit) {
      return null;
    }

    const completions: Completion[] = options
      .flatMap((o): Completion[] => {
        const matchSegments = toStartOfName!.text.split('.');
        const optionSegments = o.name.split('.');

        // If not on the last segment, only complete the namespace
        if (matchSegments.length < optionSegments.length) {
          const prefix = optionSegments.slice(0, matchSegments.length).join('.');
          return [
            {
              label: prefix + '.*',
              apply: prefix,
              type: 'namespace',
            },
          ];
        }

        // If on the last segment, wrap the entire tag
        const inner = o.type === 'function' ? `${o.name}()` : o.name;
        return [
          {
            label: o.name,
            apply: openTag + inner + closeTag,
            info: o.description,
            detail: o.type,
            type: o.type === 'variable' ? 'variable' : 'function',
          },
        ];
      })
      .filter((v) => v != null);

    // TODO: Figure out how to make autocomplete stay open if opened explicitly. It sucks when you explicitly
    //  open it, then it closes when you type the next character.
    return {
      validFor: () => true, // Not really sure why this is all it needs
      from: toMatch.from,
      matchLen,
      options: completions
        // Filter out exact matches
        .filter((o) => o.label !== toMatch.text),
    };
  };
}
