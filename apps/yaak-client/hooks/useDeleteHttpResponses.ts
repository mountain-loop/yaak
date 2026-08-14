import { rpc } from "../lib/rpc";
import { useFastMutation } from "./useFastMutation";

export function useDeleteHttpResponses(requestId?: string) {
  return useFastMutation({
    mutationKey: ["delete_http_responses", requestId],
    mutationFn: async () => {
      if (requestId === undefined) return;
      await rpc("cmd_delete_all_http_responses", { requestId });
    },
  });
}
