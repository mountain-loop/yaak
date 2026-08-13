import { useQuery } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import type { SseSummary } from "@yaakapp-internal/sse";
import { getResponseBodySseSummary } from "../lib/responseBody";

export function useResponseBodySseSummary(response: HttpResponse, resultKeyPath: string | null) {
  return useQuery<SseSummary>({
    enabled: resultKeyPath != null,
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: [
      "response-body-sse-summary",
      response.id,
      response.updatedAt,
      response.contentLength,
      resultKeyPath,
    ],
    queryFn: () => getResponseBodySseSummary(response, resultKeyPath ?? ""),
  });
}
