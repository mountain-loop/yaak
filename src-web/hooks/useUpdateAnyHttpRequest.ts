import type { HttpRequest } from '@yaakapp-internal/models';
import { upsertAnyModel } from '@yaakapp-internal/models';
import { useFastMutation } from './useFastMutation';
import { getHttpRequest } from './useHttpRequests';

export function useUpdateAnyHttpRequest() {
  return useFastMutation<
    void,
    unknown,
    { id: string; update: Partial<HttpRequest> | ((r: HttpRequest) => HttpRequest) }
  >({
    mutationKey: ['update_any_http_request'],
    mutationFn: async ({ id, update }) => {
      const request = getHttpRequest(id);
      if (request === null) {
        throw new Error("Can't update a null request");
      }

      const patchedRequest =
        typeof update === 'function' ? update(request) : { ...request, ...update };
      await upsertAnyModel(patchedRequest);
    },
  });
}
