import type { HttpResponseHeader } from '@yaakapp-internal/models';
import { useMemo } from 'react';

export function useContentTypeFromHeaders(headers: HttpResponseHeader[] | null): string | null {
  return useMemo(
    () => headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? null,
    [headers],
  );
}
