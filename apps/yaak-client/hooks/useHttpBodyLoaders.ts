import { useQueryClient } from "@tanstack/react-query";
import type { HttpResponse } from "@yaakapp-internal/models";
import type { HttpBodyLoader, HttpBodyResult } from "@yaakapp-internal/ui";
import { useMemo } from "react";
import { getResponseBodyText } from "../lib/responseBody";
import { getRequestBodyText, useHttpRequestBody } from "./useHttpRequestBody";
import {
  responseBodyTextQuery,
  useResponseBodyBytes,
  useResponseBodyText,
} from "./useResponseBodyText";
import { useResponseBodyUrl } from "./useResponseBodyUrl";

interface QueryLike<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
}

function result<T>({ data, isLoading, error }: QueryLike<T>): HttpBodyResult<T> {
  return { data, isLoading, error };
}

const noUrl: HttpBodyResult<string | null> = { data: null, isLoading: false, error: null };

/** Reads a response's stored body the ways the shared viewers ask for it */
export function useResponseBodyLoader(response: HttpResponse | null): HttpBodyLoader | null {
  const queryClient = useQueryClient();
  return useMemo(() => {
    if (response == null) return null;
    return {
      useText: () => result(useResponseBodyText({ response, filter: null })),
      useBytes: () => result(useResponseBodyBytes({ response })),
      useUrl: (enabled: boolean) => {
        // Waiting on a URL that isn't asked for yet still counts as loading
        const url = useResponseBodyUrl(enabled ? response : null);
        return { data: url.data, isLoading: url.isPending, error: url.error };
      },
      // Shares the response body query's cache, so applying and showing a filter cost one RPC
      filterText: (filter: string) =>
        queryClient.fetchQuery(responseBodyTextQuery({ response, filter })),
      getText: () => getResponseBodyText({ response, filter: null }),
    };
  }, [queryClient, response]);
}

/** Reads the body a response's request was sent with */
export function useRequestBodyLoader(response: HttpResponse | null): HttpBodyLoader | null {
  return useMemo(() => {
    if (response == null) return null;
    return {
      useText: () => {
        const body = useHttpRequestBody(response);
        return { ...result(body), data: body.data?.bodyText ?? null };
      },
      useBytes: () => {
        const body = useHttpRequestBody(response);
        return { ...result(body), data: body.data?.body ?? null };
      },
      useUrl: () => noUrl,
      getText: () => getRequestBodyText(response).then((d) => d?.bodyText ?? ""),
    };
  }, [response]);
}
