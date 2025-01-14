import { useFastMutation } from './useFastMutation';
import { useSendAnyHttpRequest } from './useSendAnyHttpRequest';

export function useSendManyRequests() {
  const sendAnyRequest = useSendAnyHttpRequest();
  return useFastMutation<void, string, string[]>({
    mutationKey: ['send_many_requests'],
    mutationFn: async (requestIds: string[]) => {
      for (const id of requestIds) {
        sendAnyRequest.mutate(id);
      }
    },
  });
}
