import { linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import {
  closeBracketsExtensions,
  getLanguageExtension as getBaseLanguageExtension,
  type LanguageSupports,
  readonlyExtensions as baseReadonlyExtensions,
  syntaxExtensions,
} from "@yaakapp-internal/ui/editor";
import { graphql } from "cm6-graphql";
import type { GraphQLSchema } from "graphql";
import { activeRequestIdAtom } from "../../../hooks/useActiveRequestId";
import type { WrappedEnvironmentVariable } from "../../../hooks/useEnvironmentVariables";
import { jotaiStore } from "../../../lib/jotai";
import { renderMarkdown } from "../../../lib/markdown";
import { showGraphQLDocExplorerAtom } from "../../graphql/graphqlAtoms";
import type { EditorProps } from "./Editor";
import { jsonParseLinter } from "./json-lint";
import { largeValues } from "./largeValues";
import { pairs } from "./pairs/extension";
import { timeline } from "./timeline/extension";
import type { TwigCompletionOption } from "./twig/completion";
import { twig } from "./twig/extension";
import { pathParametersPlugin } from "./twig/pathParameters";
import { url } from "./url/extension";

const languages: LanguageSupports = { ...syntaxExtensions, url, pairs, timeline };

export function getLanguageExtension({
  useTemplating,
  language = "text",
  lintExtension,
  environmentVariables,
  autocomplete,
  hideGutter,
  onClickVariable,
  onClickMissingVariable,
  onClickPathParameter,
  completionOptions,
  graphQLSchema,
}: {
  useTemplating: boolean;
  environmentVariables: WrappedEnvironmentVariable[];
  onClickVariable: (option: WrappedEnvironmentVariable, tagValue: string, startPos: number) => void;
  onClickMissingVariable: (name: string, tagValue: string, startPos: number) => void;
  onClickPathParameter: (name: string) => void;
  completionOptions: TwigCompletionOption[];
  graphQLSchema: GraphQLSchema | null;
} & Pick<EditorProps, "language" | "autocomplete" | "hideGutter" | "lintExtension">): Extension {
  // GraphQL is a special exception
  if (language === "graphql") {
    return [
      graphql(graphQLSchema ?? undefined, {
        async onCompletionInfoRender(gqlCompletionItem): Promise<Node | null> {
          if (!gqlCompletionItem.documentation) return null;
          const innerHTML = await renderMarkdown(gqlCompletionItem.documentation);
          const span = document.createElement("span");
          span.innerHTML = innerHTML;
          return span;
        },
        onShowInDocs(field, type, parentType) {
          const activeRequestId = jotaiStore.get(activeRequestIdAtom);
          if (activeRequestId == null) return;
          jotaiStore.set(showGraphQLDocExplorerAtom, (v) => ({
            ...v,
            [activeRequestId]: { field, type, parentType },
          }));
        },
      }),
      [closeBracketsExtensions],
    ];
  }

  return getBaseLanguageExtension({
    language,
    hideGutter,
    languages,
    lintExtension: language === "json" ? (lintExtension ?? linter(jsonParseLinter())) : undefined,
    extraExtensions: language === "url" ? [pathParametersPlugin(onClickPathParameter)] : [],
    wrap: useTemplating
      ? (base, extraExtensions) =>
          twig({
            base,
            environmentVariables,
            completionOptions,
            autocomplete,
            onClickVariable,
            onClickMissingVariable,
            onClickPathParameter,
            extraExtensions,
          })
      : undefined,
  });
}

// Nobody is editing this, so every rule applies
export const readonlyExtensions = [...baseReadonlyExtensions, largeValues];
