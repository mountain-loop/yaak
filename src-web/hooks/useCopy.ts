import { clear, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useCallback } from 'react';
import { showToast } from '../lib/toast';

export function useCopy({ disableToast }: { disableToast?: boolean } = {}) {
  const copy = useCallback(
    (text: string | null) => {
      if (text == null) {
        clear().catch(console.error);
      } else {
        writeText(text).catch(console.error);
      }
      if (text != '' && !disableToast) {
        showToast({
          id: 'copied',
          color: 'secondary',
          icon: 'copy',
          message: 'Copied to clipboard',
        });
      }
    },
    [disableToast],
  );

  return copy;
}
