import type { HttpResponse } from '@yaakapp-internal/models';
import { getModel } from '@yaakapp-internal/models';
import { invokeCmd } from '../lib/tauri';
import { getActiveCookieJar } from './useActiveCookieJar';
import { getActiveEnvironment } from './useActiveEnvironment';
import { createFastMutation, useFastMutation } from './useFastMutation';

// Helper function to strip both single-line (//) and multi-line (/* * /) comments.
const stripJsonComments = (v: string) => {
  return v.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
};

export function useSendAnyHttpRequest() {
  return useFastMutation<HttpResponse | null, string, string | null>({
    mutationKey: ['send_any_request'],
    mutationFn: async (id) => {
      const request = getModel('http_request', id ?? 'n/a');
      if (request == null) return null;

      const requestToSend = JSON.parse(JSON.stringify(request));

      if (typeof requestToSend.body?.text === 'string') {
        const text = requestToSend.body.text;
        // Check if the text contains a '{' anywhere, or if it's just a  string we want to allow comments in regardless.
        if (text.includes('{') || text.trim().startsWith('//')) {
          requestToSend.body.text = stripJsonComments(text);
        }
      }

      return invokeCmd('cmd_send_http_request', {
        request: requestToSend,
        environmentId: getActiveEnvironment()?.id,
        cookieJarId: getActiveCookieJar()?.id,
      });
    },
  });
}
export const sendAnyHttpRequest = createFastMutation<HttpResponse | null, string, string | null>({
  mutationKey: ['send_any_request'],
  mutationFn: async (id) => {
    const request = getModel('http_request', id ?? 'n/a');
    if (request == null) {
      return null;
    }

    const requestToSend = JSON.parse(JSON.stringify(request));

    if (typeof requestToSend.body?.text === 'string') {
      const trimmed = requestToSend.body.text.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        requestToSend.body.text = stripJsonComments(requestToSend.body.text);
      }
    }

    return invokeCmd('cmd_send_http_request', {
      request: requestToSend,
      environmentId: getActiveEnvironment()?.id,
      cookieJarId: getActiveCookieJar()?.id,
    });
  },
});
