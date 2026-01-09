import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appInfo } from '@yaakapp/app/lib/appInfo';
import { useEffect } from 'react';
import { LicenseCheckStatus } from './bindings/license';

export * from './bindings/license';

const CHECK_QUERY_KEY = ['license.check'];

export function useLicense() {
  const queryClient = useQueryClient();
  const activate = useMutation<void, string, { licenseKey: string }>({
    mutationKey: ['license.activate'],
    mutationFn: (payload) => invoke('plugin:yaak-license|activate', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY }),
  });

  const deactivate = useMutation<void, string, void>({
    mutationKey: ['license.deactivate'],
    mutationFn: () => invoke('plugin:yaak-license|deactivate'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY }),
  });

  // Check the license again after a license is activated
  useEffect(() => {
    const unlisten = listen('license-activated', async () => {
      await queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const check = useQuery<LicenseCheckStatus | null, string>({
    refetchInterval: 1000 * 60 * 60 * 12, // Refetch every 12 hours
    refetchOnWindowFocus: false,
    queryKey: CHECK_QUERY_KEY,
    queryFn: async () => {
      if (!appInfo.featureLicense) {
        return null;
      }
      return invoke<LicenseCheckStatus>('plugin:yaak-license|check');
    },
  });

  return {
    activate,
    deactivate,
    check,
  } as const;
}
