import type { HttpRequest, HttpResponse } from '@yaakapp-internal/models';
import { invokeCmd } from './tauri';

export async function sendEphemeralRequest(
  request: HttpRequest,
  environmentId: string | null,
): Promise<HttpResponse> {
  // Remove some things that we don't want to associate
  const newRequest = { ...request };
  return invokeCmd('cmd_send_ephemeral_request', { request: newRequest, environmentId });
}
