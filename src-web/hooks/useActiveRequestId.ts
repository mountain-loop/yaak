import { useParams } from 'react-router-dom';

export function useActiveRequestId(): string | null {
  const { requestId } = useParams();
  return requestId ?? null;
}
