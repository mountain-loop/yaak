import { useQuery } from '@tanstack/react-query';
import type { GetTemplateFunctionsResponse } from '@yaakapp-internal/plugins';
import type { GetTemplateFunctionsResponse, TemplateFunction } from '@yaakapp-internal/plugin';
import { atom, useAtomValue } from 'jotai';
import { useSetAtom } from 'jotai/index';
import { useState } from 'react';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';

const templateFunctionsAtom = atom<TemplateFunction[]>([]);

export function useTemplateFunctions() {
  return useAtomValue(templateFunctionsAtom);
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
    refetchInterval: numFns > 0 ? Infinity : 500,
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
