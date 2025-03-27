import type { HttpResponse} from '@yaakapp-internal/models';
import { useModelList } from '@yaakapp-internal/models';

export function useLatestHttpResponse(requestId: string | null): HttpResponse | null {
  return useModelList('http_response').find((r) => r.requestId === requestId) ?? null;
}
