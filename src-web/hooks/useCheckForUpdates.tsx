import { useMutation } from '@tanstack/react-query';
import { InlineCode } from '../components/core/InlineCode';
import { showAlert } from '../lib/alert';
import { minPromiseMillis } from '../lib/minPromiseMillis';
import { invokeCmd } from '../lib/tauri';
import { useAppInfo } from './useAppInfo';

export function useCheckForUpdates() {
  const appInfo = useAppInfo();

  return useMutation({
    mutationKey: ['check_for_updates'],
    mutationFn: async () => {
      const hasUpdate: boolean = await minPromiseMillis(invokeCmd('cmd_check_for_updates'), 500);
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
