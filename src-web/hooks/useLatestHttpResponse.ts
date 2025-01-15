import type { HttpResponse } from '@yaakapp-internal/models';
import { useHttpResponses } from './useHttpResponses';

export function useLatestHttpResponse(requestId: string | null): HttpResponse | null {
  return useHttpResponses().find((r) => r.requestId === requestId) ?? null;
}
