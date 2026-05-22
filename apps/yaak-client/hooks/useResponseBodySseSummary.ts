import { useQuery } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import type { SseSummary } from "@yaakapp-internal/sse";
import { getResponseBodySseSummary } from "../lib/responseBody";

export function useResponseBodySseSummary(response: HttpResponse, resultKeyPath: string) {
  return useQuery<SseSummary>({
    placeholderData: (prev) => prev,
    queryKey: [
      "response-body-sse-summary",
      response.id,
      response.updatedAt,
      response.contentLength,
      resultKeyPath,
    ],
    queryFn: () => getResponseBodySseSummary(response, resultKeyPath),
  });
}
