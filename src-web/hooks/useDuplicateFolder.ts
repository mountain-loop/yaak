import { useMutation } from './useMutation';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';

export function useDuplicateFolder(id: string) {
  return useMutation<void, string>({
    mutationKey: ['duplicate_folder', id],
    mutationFn: () => invokeCmd('cmd_duplicate_folder', { id }),
    onSettled: () => trackEvent('folder', 'duplicate'),
  });
}
