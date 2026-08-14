import type { HttpResponse } from "@yaakapp-internal/models";
import { flushAllModelWrites } from "@yaakapp-internal/models";
import { rpc } from "../lib/rpc";
import { getActiveCookieJar } from "./useActiveCookieJar";
import { getActiveEnvironment } from "./useActiveEnvironment";
import { createFastMutation, useFastMutation } from "./useFastMutation";

async function sendAnyHttpRequestById(id: string | null): Promise<HttpResponse | null> {
  if (id == null) {
    return null;
  }

  await flushAllModelWrites();

  return rpc("cmd_send_http_request", {
    requestId: id,
    environmentId: getActiveEnvironment()?.id,
    cookieJarId: getActiveCookieJar()?.id,
  });
}

export function useSendAnyHttpRequest() {
  return useFastMutation<HttpResponse | null, string, string | null>({
    mutationKey: ["send_any_request"],
    mutationFn: sendAnyHttpRequestById,
  });
}

export const sendAnyHttpRequest = createFastMutation<HttpResponse | null, string, string | null>({
  mutationKey: ["send_any_request"],
  mutationFn: sendAnyHttpRequestById,
});
