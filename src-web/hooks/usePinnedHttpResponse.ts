import type { HttpResponse} from '@yaakapp-internal/models';
import { httpResponsesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai/index';
import { useKeyValue } from './useKeyValue';
import { useLatestHttpResponse } from './useLatestHttpResponse';

export function usePinnedHttpResponse(activeRequestId: string) {
  const latestResponse = useLatestHttpResponse(activeRequestId);
  const { set, value: pinnedResponseId } = useKeyValue<string | null>({
    // Key on the latest response instead of activeRequest because responses change out of band of active request
    key: ['pinned_http_response_id', latestResponse?.id ?? 'n/a'],
    fallback: null,
    namespace: 'global',
  });
  const allResponses = useAtomValue(httpResponsesAtom);
  const responses = allResponses.filter((r) => r.requestId === activeRequestId);
  const activeResponse: HttpResponse | null =
    responses.find((r) => r.id === pinnedResponseId) ?? latestResponse;

  const setPinnedResponseId = async (id: string) => {
    if (pinnedResponseId === id) {
      await set(null);
    } else {
      await set(id);
    }
  };

  return { activeResponse, setPinnedResponseId, pinnedResponseId, responses } as const;
}
