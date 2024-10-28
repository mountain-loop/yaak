import { useQuery } from '@tanstack/react-query';
import type { GetTemplateFunctionsResponse } from '@yaakapp-internal/plugin';
import { useState } from 'react';
import { invokeCmd } from '../lib/tauri';
import { usePluginsKey } from './usePlugins';

export function useTemplateFunctions() {
  const pluginsKey = usePluginsKey();
  const [numFns, setNumFns] = useState<number>(0);

  const result = useQuery({
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
      return result;
    },
  });

  return result.data?.flatMap((r) => r.functions) ?? [];
}
