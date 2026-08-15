import { useQuery } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import { platform } from "@yaakapp-internal/platform";

/**
 * A URL for a stored response body, for the viewers that hand one to an element
 * instead of reading the bytes themselves.
 *
 * Resolved once here rather than inside each viewer: the host may have to ask
 * the backend where the body is, and a viewer that computes its source during
 * render (the PDF one, deliberately) needs it settled before it mounts.
 *
 * Null data means the response has no stored body.
 */
export function useResponseBodyUrl(response: HttpResponse | null) {
  const responseId = response?.id ?? null;

  return useQuery({
    queryKey: ["response_body_url", responseId, response?.updatedAt ?? ""],
    enabled: responseId != null,
    // A response body is stored under the response's own id
    queryFn: () => (responseId == null ? null : platform.blobs.url(responseId)),
  });
}
