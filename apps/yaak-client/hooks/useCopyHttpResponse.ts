import type { HttpResponse } from "@yaakapp-internal/models";
import { copyToClipboard } from "../lib/copy";
import { getResponseBodyText } from "../lib/responseBody";
import { useFastMutation } from "./useFastMutation";

export function useCopyHttpResponse(response: HttpResponse | null) {
  return useFastMutation({
    mutationKey: ["copy_http_response", response?.id],
    async mutationFn() {
      if (response == null) return;

      const body = await getResponseBodyText({ response, filter: null });
      copyToClipboard(body);
    },
  });
}
