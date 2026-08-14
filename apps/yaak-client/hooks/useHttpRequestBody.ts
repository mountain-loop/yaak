import { useQuery } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import { rpc } from "../lib/rpc";

export function useHttpRequestBody(response: HttpResponse | null) {
  return useQuery({
    placeholderData: (prev) => prev, // Keep previous data on refetch
    queryKey: ["request_body", response?.id, response?.state, response?.requestContentLength],
    enabled: (response?.requestContentLength ?? 0) > 0,
    queryFn: async () => {
      return getRequestBodyText(response);
    },
  });
}

export async function getRequestBodyText(response: HttpResponse | null) {
  if (response?.id == null) {
    return null;
  }

  const data = await rpc<number[] | null>("cmd_http_request_body", {
    responseId: response.id,
  });

  if (data == null) {
    return null;
  }

  const body = new Uint8Array(data);
  const bodyText = new TextDecoder("utf-8", { fatal: false }).decode(body);
  return { body, bodyText };
}
