import { useMutation } from '@tanstack/react-query';
import { InlineCode } from '../components/core/InlineCode';
import { showAlert } from '../lib/alert';
import { useAppInfo } from './useAppInfo';

export function useCheckForUpdates() {
  const appInfo = useAppInfo();

  return useMutation({
    mutationKey: ['check_for_updates'],
    mutationFn: async () => {
      const hasUpdate: boolean = false;
      if (!hasUpdate) {
        showAlert({
          id: 'no-updates',
          title: 'No Update Available',
          body: (
            <>
              You are currently on the latest version <InlineCode>{appInfo.version}</InlineCode>
            </>
          ),
        });
      }
    },
  });
}
