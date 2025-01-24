import { useQuery } from '@tanstack/react-query';
import type {
  GetHttpAuthenticationConfigResponse,
  GetHttpAuthenticationSummaryResponse,
  JsonPrimitive,
} from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { atom, useSetAtom } from 'jotai/index';
import { useState } from 'react';
import { invokeCmd } from '../lib/tauri';
import { showErrorToast } from '../lib/toast';
import {useHttpResponses} from "./useHttpResponses";
import { usePluginsKey } from './usePlugins';
import { md5 } from 'js-md5';

const httpAuthenticationSummariesAtom = atom<GetHttpAuthenticationSummaryResponse[]>([]);
const orderedHttpAuthenticationAtom = atom((get) =>
  get(httpAuthenticationSummariesAtom).sort((a, b) => a.name.localeCompare(b.name)),
);

export function useHttpAuthenticationSummaries() {
  return useAtomValue(orderedHttpAuthenticationAtom);
}

export function useHttpAuthenticationConfig(
  authName: string | null,
  config: Record<string, JsonPrimitive>,
  requestId: string,
) {
  const responses = useHttpResponses();

  // Some auth handlers like OAuth 2.0 show the current token after a successful request. To
  // handle that, we'll force the auth to re-fetch after each new response
  const responseKey = md5(responses.map(r => r.id).join(':'));

  return useQuery({
    queryKey: ['http_authentication_config', { requestId, authName, config }, responseKey],
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryFn: () =>
      invokeCmd<GetHttpAuthenticationConfigResponse>('cmd_get_http_authentication_config', {
        authName,
        config,
        requestId,
      }),
  });
}

export function useSubscribeHttpAuthentication() {
  const [numResults, setNumResults] = useState<number>(0);
  const pluginsKey = usePluginsKey();
  const setAtom = useSetAtom(httpAuthenticationSummariesAtom);

  useQuery({
    queryKey: ['http_authentication_summaries', pluginsKey],
    // Fetch periodically until functions are returned
    // NOTE: visibilitychange (refetchOnWindowFocus) does not work on Windows, so we'll rely on this logic
    //  to refetch things until that's working again
    // TODO: Update plugin system to wait for plugins to initialize before sending the first event to them
    refetchInterval: numResults > 0 ? Infinity : 1000,
    refetchOnMount: true,
    queryFn: async () => {
      try {
        const result = await invokeCmd<GetHttpAuthenticationSummaryResponse[]>(
          'cmd_get_http_authentication_summaries',
        );
        setNumResults(result.length);
        setAtom(result);
        return result;
      } catch (err) {
        showErrorToast('http-authentication-error', err);
      }
    },
  });
}
