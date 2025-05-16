import { useQuery } from '@tanstack/react-query';
import type { GetHttpAuthenticationSummaryResponse } from '@yaakapp-internal/plugins';
import { useAtomValue , atom } from 'jotai';
import { useState } from 'react';
import { jotaiStore } from '../lib/jotai';
import { invokeCmd } from '../lib/tauri';
import { showErrorToast } from '../lib/toast';
import { usePluginsKey } from './usePlugins';

const httpAuthenticationSummariesAtom = atom<GetHttpAuthenticationSummaryResponse[]>([]);
const orderedHttpAuthenticationAtom = atom((get) =>
  get(httpAuthenticationSummariesAtom)?.sort((a, b) => a.name.localeCompare(b.name)),
);

export function useHttpAuthenticationSummaries() {
  return useAtomValue(orderedHttpAuthenticationAtom);
}

export function useSubscribeHttpAuthentication() {
  const [numResults, setNumResults] = useState<number>(0);
  const pluginsKey = usePluginsKey();

  useQuery({
    queryKey: ['http_authentication_summaries', pluginsKey],
    // Fetch periodically until functions are returned
    // NOTE: visibilitychange (refetchOnWindowFocus) does not work on Windows, so we'll rely on this logic
    //  to refetch things until that's working again
    // TODO: Update plugin system to wait for plugins to initialize before sending the first event to them
    refetchInterval: numResults > 0 ? Infinity : 1000,
    refetchOnMount: true,
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: async () => {
      try {
        const result = await invokeCmd<GetHttpAuthenticationSummaryResponse[]>(
          'cmd_get_http_authentication_summaries',
        );
        setNumResults(result.length);
        jotaiStore.set(httpAuthenticationSummariesAtom, result);
        return result;
      } catch (err) {
        showErrorToast('http-authentication-error', err);
      }
    },
  });
}
