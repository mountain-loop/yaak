import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { useListenToTauriEvent } from '@yaakapp/app/hooks/useListenToTauriEvent';
import { LicenseCheckStatus } from './bindings/license';

export * from './bindings/license';

export function useLicense() {
  const queryClient = useQueryClient();
  const activate = useMutation<void, string, { licenseKey: string }>({
    mutationKey: ['license.activate'],
    mutationFn: (payload) => invoke('plugin:yaak-license|activate', payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY });
    },
  });

  // Check the license again after a license is activated
  useListenToTauriEvent('license-activated', async () => {
    await queryClient.invalidateQueries({ queryKey: CHECK_QUERY_KEY });
  });

  const CHECK_QUERY_KEY = ['license.check'];
  const check = useQuery<void, string, LicenseCheckStatus>({
    queryKey: CHECK_QUERY_KEY,
    queryFn: () => invoke('plugin:yaak-license|check'),
  });

  return {
    activate,
    check,
  } as const;
}
