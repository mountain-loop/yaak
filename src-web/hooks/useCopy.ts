import { clear, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useCallback } from 'react';
import { useToast } from './useToast';

export function useCopy({ disableToast }: { disableToast?: boolean } = {}) {
  const toast = useToast();

  const copy = useCallback(
    (text: string | null) => {
      if (text == null) {
        clear().catch(console.error);
      } else {
        writeText(text).catch(console.error);
      }
      if (text != '' && !disableToast) {
        toast.show({
          id: 'copied',
          color: 'secondary',
          icon: 'copy',
          message: 'Copied to clipboard',
        });
      }
    },
    [disableToast, toast],
  );

  return copy;
}
