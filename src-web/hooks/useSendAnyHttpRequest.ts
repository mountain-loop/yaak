import type { HttpResponse } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { getHttpRequest } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { getActiveCookieJar } from './useActiveCookieJar';
import { getActiveEnvironment } from './useActiveEnvironment';
import { useAlert } from './useAlert';
import { useFastMutation } from './useFastMutation';

export function useSendAnyHttpRequest() {
  const alert = useAlert();
  return useFastMutation<HttpResponse | null, string, string | null>({
    mutationKey: ['send_any_request'],
    mutationFn: async (id) => {
      const request = await getHttpRequest(id);
      if (request == null) {
        return null;
      }

      return invokeCmd('cmd_send_http_request', {
        request,
        environmentId: getActiveEnvironment()?.id,
        cookieJarId: getActiveCookieJar()?.id,
      });
    },
    onSettled: () => trackEvent('http_request', 'send'),
    onError: (err) => alert({ id: 'send-failed', title: 'Send Failed', body: err }),
  });
}
