import type { HttpUrlParameter } from '@yaakapp-internal/models';
import { generateId } from '../lib/generateId';
import { pluralize } from '../lib/pluralize';
import { showToast } from '../lib/toast';
import { useFastMutation } from './useFastMutation';
import { getHttpRequest } from './useHttpRequests';
import { useRequestEditor } from './useRequestEditor';
import { useUpdateAnyHttpRequest } from './useUpdateAnyHttpRequest';

export function useImportQuerystring(requestId: string) {
  const updateRequest = useUpdateAnyHttpRequest();
  const [, { focusParamsTab, forceParamsRefresh, forceUrlRefresh }] = useRequestEditor();

  return useFastMutation({
    mutationKey: ['import_querystring'],
    mutationFn: async (url: string) => {
      const split = url.split(/\?(.*)/s);
      const baseUrl = split[0] ?? '';
      const querystring = split[1] ?? '';
      if (!querystring) return;

      const request = getHttpRequest(requestId);
      if (request == null) return;

      const parsedParams = Array.from(new URLSearchParams(querystring).entries());
      const urlParameters: HttpUrlParameter[] = parsedParams.map(([name, value]) => ({
        name,
        value,
        enabled: true,
        id: generateId(),
      }));

      await updateRequest.mutateAsync({
        id: requestId,
        update: {
          url: baseUrl ?? '',
          urlParameters,
        },
      });

      if (urlParameters.length > 0) {
        showToast({
          id: 'querystring-imported',
          color: 'info',
          message: `Extracted ${urlParameters.length} ${pluralize('parameter', urlParameters.length)} from URL`,
        });
      }

      focusParamsTab();

      // Wait for request to update, then refresh the UI
      // TODO: Somehow make this deterministic
      setTimeout(() => {
        forceUrlRefresh();
        forceParamsRefresh();
      }, 100);
    },
  });
}
