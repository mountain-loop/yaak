import {
  grpcRequestsAtom,
  httpRequestsAtom,
  websocketRequestsAtom,
} from "@yaakapp-internal/models";
import { atom, useAtomValue } from "jotai";
import { selectAtom } from "jotai/utils";

export const allRequestsAtom = atom((get) => [
  ...get(httpRequestsAtom),
  ...get(grpcRequestsAtom),
  ...get(websocketRequestsAtom),
]);

export function useAllRequests() {
  return useAtomValue(allRequestsAtom);
}

const stringArrayEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// Identity-stable derivations so subscribers don't recompute or re-render when
// unrelated request fields change (eg. every debounced edit of a request)
export const allRequestIdsAtom = selectAtom(
  allRequestsAtom,
  (requests) => requests.map((r) => r.id),
  stringArrayEqual,
);

export const allRequestUrlsAtom = selectAtom(
  allRequestsAtom,
  (requests) => {
    const urls = new Set<string>();
    for (const r of requests) {
      if (r.url) urls.add(r.url);
    }
    return Array.from(urls);
  },
  stringArrayEqual,
);
