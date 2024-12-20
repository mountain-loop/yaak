import { useParams } from '@tanstack/react-router';

export function useActiveRequestId(): string | null {
  const { requestId } = useParams({ strict: false });
  return requestId ?? null;
}
