import { useMutation } from './useMutation';
import { useSendAnyHttpRequest } from './useSendAnyHttpRequest';

export function useSendManyRequests() {
  const sendAnyRequest = useSendAnyHttpRequest();
  return useMutation<void, string, string[]>({
    mutationKey: ['send_many_requests'],
    mutationFn: async (requestIds: string[]) => {
      for (const id of requestIds) {
        sendAnyRequest.mutate(id);
      }
    },
  });
}
