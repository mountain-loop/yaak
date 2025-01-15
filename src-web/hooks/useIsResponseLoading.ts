import { isResponseLoading } from '../lib/model_util';
import { useLatestHttpResponse } from './useLatestHttpResponse';

export function useIsResponseLoading(requestId: string | null): boolean {
  const response = useLatestHttpResponse(requestId);
  if (response === null) return false;
  return isResponseLoading(response);
}
