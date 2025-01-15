import type { GrpcRequest } from '@yaakapp-internal/models';
import { useGrpcRequests } from './useGrpcRequests';

export function useGrpcRequest(id: string | null): GrpcRequest | null {
  const requests = useGrpcRequests();
  return requests.find((r) => r.id === id) ?? null;
}
