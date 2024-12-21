import { useMutation } from './useMutation';
import { event } from '@tauri-apps/api';
import { trackEvent } from '../lib/analytics';

export function useCancelHttpResponse(id: string | null) {
  return useMutation<void>({
    mutationKey: ['cancel_http_response', id],
    mutationFn: () => event.emit(`cancel_http_response_${id}`),
    onSettled: () => trackEvent('http_response', 'cancel'),
  });
}
