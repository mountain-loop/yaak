import { useQuery } from '@tanstack/react-query';
import type { GetHttpAuthenticationResponse } from '@yaakapp-internal/plugins';
import { useAtomValue } from 'jotai';
import { atom, useSetAtom } from 'jotai/index';
import { useState } from 'react';
import { invokeCmd } from '../lib/tauri';

const httpAuthenticationAtom = atom<GetHttpAuthenticationResponse[]>([]);
const orderedHttpAuthenticationAtom = atom((get) =>
  get(httpAuthenticationAtom).sort((a, b) => a.name.localeCompare(b.name)),
);

export function useHttpAuthentication() {
  return useAtomValue(orderedHttpAuthenticationAtom);
}

export function useSubscribeHttpAuthentication() {
  const [numResults, setNumResults] = useState<number>(0);
  const setAtom = useSetAtom(httpAuthenticationAtom);

  useQuery({
    queryKey: ['http_authentication'],
    // Fetch periodically until functions are returned
    // NOTE: visibilitychange (refetchOnWindowFocus) does not work on Windows, so we'll rely on this logic
    //  to refetch things until that's working again
    // TODO: Update plugin system to wait for plugins to initialize before sending the first event to them
    refetchInterval: numResults > 0 ? Infinity : 1000,
    refetchOnMount: true,
    queryFn: async () => {
      const result = await invokeCmd<GetHttpAuthenticationResponse[]>(
        'cmd_get_http_authentication',
      );
      setNumResults(result.length);
      setAtom(result);
      return result;
    },
  });
}
