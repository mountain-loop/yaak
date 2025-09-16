import type { HttpResponse } from '@yaakapp-internal/models';
import type { FilterResponse } from '@yaakapp-internal/plugins';
import type { ServerSentEvent } from '@yaakapp-internal/sse';
import { invokeCmd } from './tauri';

export async function getResponseBodyText({
  responseId,
  filter,
}: {
  responseId: string;
  filter: string | null;
}): Promise<string | null> {
  const result = await invokeCmd<FilterResponse>('cmd_http_response_body', {
    responseId,
    filter,
  });

  if (result.error) {
    throw new Error(result.error);
  }

  return result.content;
}

export async function getResponseBodyEventSource(
  response: HttpResponse,
): Promise<ServerSentEvent[]> {
  if (!response.bodyPath) return [];
  return invokeCmd<ServerSentEvent[]>('cmd_get_sse_events', {
    filePath: response.bodyPath,
  });
}
