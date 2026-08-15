import type { HttpRequest } from "@yaakapp-internal/models";
import type { EphemeralHttpResponse } from "@yaakapp-internal/rpc-schema";
import { getActiveCookieJar } from "../hooks/useActiveCookieJar";
import { rpc } from "./rpc";

export async function sendEphemeralRequest(
  request: HttpRequest,
  environmentId: string | null,
): Promise<EphemeralHttpResponse> {
  // Remove some things that we don't want to associate
  const newRequest = { ...request };
  return rpc("cmd_send_ephemeral_request", {
    request: newRequest,
    environmentId,
    cookieJarId: getActiveCookieJar()?.id,
  });
}
