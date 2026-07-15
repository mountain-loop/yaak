import type { CompletionContext } from "@codemirror/autocomplete";
import type { GenericCompletionOption } from "@yaakapp-internal/plugins";
import { defaultBoost } from "./twig/completion";

/**
 * A completion option that may insert text different from its display label.
 * When `apply` is set, the autocomplete and the suggestion dropdown show
 * `label` but insert `apply` (e.g. a friendly "Chrome (Windows)" label that
 * inserts the full User-Agent string).
 */
export type GenericCompletionOptionWithApply = GenericCompletionOption & { apply?: string };

export interface GenericCompletionConfig {
  minMatch?: number;
  options: GenericCompletionOptionWithApply[];
}

/**
 * Complete options, always matching until the start of the line
 */
export function genericCompletion(config?: GenericCompletionConfig) {
  if (config == null) return [];

  const { minMatch = 1, options } = config;

  return function completions(context: CompletionContext) {
    const toMatch = context.matchBefore(/.*/);

    // Only match if we're at the start of the line
    if (toMatch === null || toMatch.from > 0) return null;

    const matchedMinimumLength = toMatch.to - toMatch.from >= minMatch;
    if (!matchedMinimumLength && !context.explicit) return null;

    const optionsWithoutExactMatches = options
      .filter((o) => o.label !== toMatch.text)
      .map((o) => ({
        ...o,
        boost: defaultBoost(o),
      }));
    return {
      validFor: () => true, // Not really sure why this is all it needs
      from: toMatch.from,
      options: optionsWithoutExactMatches,
    };
  };
}
