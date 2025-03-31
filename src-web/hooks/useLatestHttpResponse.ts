import type { HttpResponse} from '@yaakapp-internal/models';
import { httpResponsesAtom } from '@yaakapp-internal/models';
import { useAtomValue } from 'jotai/index';

export function useLatestHttpResponse(requestId: string | null): HttpResponse | null {
  return useAtomValue(httpResponsesAtom).find((r) => r.requestId === requestId) ?? null;
}
