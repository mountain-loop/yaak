import { useMutation } from '@tanstack/react-query';
import type { HttpRequest } from '@yaakapp-internal/models';
import {useSetAtom} from "jotai/index";
import { getHttpRequest } from '../lib/store';
import { invokeCmd } from '../lib/tauri';
import {httpRequestsAtom} from "./useHttpRequests";
import {updateModelList} from "./useSyncModelStores";

export function useUpdateAnyHttpRequest() {
  const setHttpRequests = useSetAtom(httpRequestsAtom);
  return useMutation<
    HttpRequest,
    unknown,
    { id: string; update: Partial<HttpRequest> | ((r: HttpRequest) => HttpRequest) }
  >({
    mutationKey: ['update_any_http_request'],
    mutationFn: async ({ id, update }) => {
      const request = await getHttpRequest(id);
      if (request === null) {
        throw new Error("Can't update a null request");
      }

      const patchedRequest =
        typeof update === 'function' ? update(request) : { ...request, ...update };
      return invokeCmd<HttpRequest>('cmd_update_http_request', { request: patchedRequest });
    },
    onSuccess: async (request) => {
      setHttpRequests(updateModelList(request));
    }
  });
}
