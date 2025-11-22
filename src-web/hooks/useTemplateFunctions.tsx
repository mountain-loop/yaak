import type { EditorView } from '@codemirror/view';
import { useQuery } from '@tanstack/react-query';
import type {
  GetTemplateFunctionSummaryResponse,
  TemplateFunction,
} from '@yaakapp-internal/plugins';
import { parseTemplate } from '@yaakapp-internal/templates';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useMemo, useState } from 'react';
import { TemplateFunctionDialog } from '../components/TemplateFunctionDialog';
import type { TwigCompletionOption } from '../components/core/Editor/twig/completion';
import { InlineCode } from '../components/core/InlineCode';
import { showDialog } from '../lib/dialog';
import { jotaiStore } from '../lib/jotai';
import { withEncryptionEnabled } from '../lib/setupOrConfigureEncryption';
import { invokeCmd } from '../lib/tauri';
import { activeWorkspaceAtom } from './useActiveWorkspace';
import { usePluginsKey } from './usePlugins';

const templateFunctionsAtom = atom<TemplateFunction[]>([]);

export function useTemplateFunctionCompletionOptions(view: EditorView | null, enabled: boolean) {
  const templateFunctions = useAtomValue(templateFunctionsAtom);
  return useMemo<TwigCompletionOption[]>(() => {
    if (!enabled) {
      return [];
    }
    return (
      templateFunctions.map((fn) => {
        const NUM_ARGS = 2;
        const argsWithName = fn.args.filter((a) => 'name' in a);
        const shortArgs =
          argsWithName
            .slice(0, NUM_ARGS)
            .map((a) => a.name)
            .join(', ') + (fn.args.length > NUM_ARGS ? ', …' : '');
        return {
          name: fn.name,
          aliases: fn.aliases,
          type: 'function',
          description: fn.description,
          args: argsWithName.map((a) => ({ name: a.name })),
          value: null,
          label: `${fn.name}(${shortArgs})`,
          onClick: (rawTag: string, startPos: number) => onClick(view, fn, rawTag, startPos),
        };
      }) ?? []
    );
  }, [enabled, templateFunctions, view]);
}

export function useSubscribeTemplateFunctions() {
  const pluginsKey = usePluginsKey();
  const [numFns, setNumFns] = useState<number>(0);
  const setAtom = useSetAtom(templateFunctionsAtom);

  useQuery({
    queryKey: ['template_functions', pluginsKey],
    // Fetch periodically until functions are returned
    // NOTE: visibilitychange (refetchOnWindowFocus) does not work on Windows, so we'll rely on this logic
    //  to refetch things until that's working again
    // TODO: Update plugin system to wait for plugins to initialize before sending the first event to them
    refetchInterval: numFns > 0 ? Number.POSITIVE_INFINITY : 1000,
    refetchOnMount: true,
    queryFn: async () => {
      const result = await invokeCmd<GetTemplateFunctionSummaryResponse[]>(
        'cmd_template_function_summaries',
      );
      setNumFns(result.length);
      const functions = result.flatMap((r) => r.functions) ?? [];
      setAtom(functions);
      return functions;
    },
  });
}

function onClick(
  view: EditorView | null,
  fn: TemplateFunction,
  tagValue: string,
  startPos: number,
) {
  const initialTokens = parseTemplate(tagValue);
  const show = () => {
    showDialog({
      id: `template-function-${Math.random()}`, // Allow multiple at once
      size: 'md',
      className: 'h-[90vh] max-h-[60rem]',
      noPadding: true,
      title: <InlineCode>{fn.name}(…)</InlineCode>,
      description: fn.description,
      render: ({ hide }) => {
        const model = jotaiStore.get(activeWorkspaceAtom);
        if (model == null) return null;
        return (
          <TemplateFunctionDialog
            templateFunction={fn}
            model={model}
            hide={hide}
            initialTokens={initialTokens}
            onChange={(insert) => {
              view?.dispatch({
                changes: [{ from: startPos, to: startPos + tagValue.length, insert }],
              });
            }}
          />
        );
      },
    });
  };

  if (fn.name === 'secure') {
    withEncryptionEnabled(show);
  } else {
    show();
  }
}
