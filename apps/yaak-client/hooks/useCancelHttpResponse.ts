import { platform } from "@yaakapp-internal/platform";
import { useFastMutation } from "./useFastMutation";

export function useCancelHttpResponse(id: string | null) {
  return useFastMutation<void>({
    mutationKey: ["cancel_http_response", id],
    mutationFn: () => platform.emit(`cancel_http_response_${id}`),
  });
}
