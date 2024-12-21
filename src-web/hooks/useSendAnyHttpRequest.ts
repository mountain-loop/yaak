import { useMutation } from './useMutation';
import type { HttpResponse } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { getHttpRequest } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import { useActiveCookieJar } from './useActiveCookieJar';
import { useActiveEnvironment } from './useActiveEnvironment';
import { useAlert } from './useAlert';

export function useSendAnyHttpRequest() {
  const alert = useAlert();
  const [environment] = useActiveEnvironment();
  const [activeCookieJar] = useActiveCookieJar();
  return useMutation<HttpResponse | null, string, string | null>({
    mutationKey: ['send_any_request'],
    mutationFn: async (id) => {
      const request = await getHttpRequest(id);
      if (request == null) {
        return null;
      }

      return invokeCmd('cmd_send_http_request', {
        request,
        environmentId: environment?.id,
        cookieJarId: activeCookieJar?.id,
      });
    },
    onSettled: () => trackEvent('http_request', 'send'),
    onError: (err) => alert({ id: 'send-failed', title: 'Send Failed', body: err }),
  });
}
