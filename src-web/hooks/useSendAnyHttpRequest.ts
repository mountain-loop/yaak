import type { HttpResponse } from '@yaakapp-internal/models';
import { trackEvent } from '../lib/analytics';
import { invokeCmd } from '../lib/tauri';
import { getActiveCookieJar } from './useActiveCookieJar';
import { getActiveEnvironment } from './useActiveEnvironment';
import { useFastMutation } from './useFastMutation';
import { getHttpRequest } from './useHttpRequests';

export function useSendAnyHttpRequest() {
  return useFastMutation<HttpResponse | null, string, string | null>({
    mutationKey: ['send_any_request'],
    mutationFn: async (id) => {
      const request = getHttpRequest(id ?? 'n/a');
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
  });
}
