import { useQuery } from '@tanstack/react-query';
import type { GetTemplateFunctionsResponse, TemplateFunction } from '@yaakapp-internal/plugins';
import { atom, useAtomValue } from 'jotai';
import { useSetAtom } from 'jotai/index';
import { useMemo, useState } from 'react';
import type { TwigCompletionOption } from '../components/core/Editor/twig/completion';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';

const templateFunctionsAtom = atom<TemplateFunction[]>([]);

export function useTemplateFunctionCompletionOptions(
  onClick: (fn: TemplateFunction, ragTag: string, pos: number) => void,
) {
  const templateFunctions = useAtomValue(templateFunctionsAtom);
  return useMemo<TwigCompletionOption[]>(() => {
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
          onClick: (rawTag: string, startPos: number) => onClick(fn, rawTag, startPos),
        };
      }) ?? []
    );
  }, [onClick, templateFunctions]);
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
    refetchInterval: numFns > 0 ? Infinity : 1000,
    refetchOnMount: true,
    queryFn: async () => {
      const result = await invokeCmd<GetTemplateFunctionsResponse[]>('cmd_template_functions');
      setNumFns(result.length);
      const functions = result.flatMap((r) => r.functions) ?? [];
      setAtom(functions);
      return functions;
    },
  });
}
