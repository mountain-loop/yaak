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
 */
export function useRequestVersion(versionId: string | null | undefined, requestId: string | null) {
  const requests = useAtomValue(allRequestsAtom);
  const liveUpdatedAt = requests.find((r) => r.id === requestId)?.updatedAt;

  return useQuery({
    placeholderData: (prev) => prev,
    queryKey: ["request_version", versionId, liveUpdatedAt],
    enabled: versionId != null,
    queryFn: () =>
      rpc<RequestVersionComparison>("models_request_version", { versionId: versionId! }),
  });
}
