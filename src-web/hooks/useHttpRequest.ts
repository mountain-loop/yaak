import type { HttpRequest } from '@yaakapp-internal/models';
import { useHttpRequests } from './useHttpRequests';

export function useHttpRequest(id: string | null): HttpRequest | null {
  const requests = useHttpRequests();
  return requests.find((r) => r.id === id) ?? null;
}
