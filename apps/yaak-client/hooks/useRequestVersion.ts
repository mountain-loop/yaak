import { useQuery } from "@tanstack/react-query";
import type { RequestVersionComparison } from "@yaakapp-internal/models";
import { useAtomValue } from "jotai";
import { allRequestsAtom } from "./useAllRequests";
import { rpc } from "../lib/rpc";

/**
 * The request version a response was sent from, alongside the request as it
 * stands now.
 *
 * Refetches when the live request is written, which is what keeps the "has this
 * changed?" answer honest while someone edits. The comparison itself is the
 * backend's — the frontend never hashes anything.
 *
 * Only ever answers for the version asked about: a response with no version
 * gets nothing, and switching responses never shows the last one's comparison
 * while the new one loads.
 */
export function useRequestVersion(
  versionId: string | null | undefined,
  requestId: string | null,
): RequestVersionComparison | null {
  const requests = useAtomValue(allRequestsAtom);
  const liveUpdatedAt = requests.find((r) => r.id === requestId)?.updatedAt;

  const { data } = useQuery({
    // Keep the last answer across edits to the live request, but never across
    // versions, or a response would borrow another response's comparison
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === versionId ? prev : undefined),
    queryKey: ["request_version", versionId, liveUpdatedAt],
    enabled: versionId != null,
    queryFn: () =>
      rpc<RequestVersionComparison>("models_request_version", { versionId: versionId! }),
  });

  return versionId != null && data?.version.id === versionId ? data : null;
}
