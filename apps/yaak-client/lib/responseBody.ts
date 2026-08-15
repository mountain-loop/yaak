import type { HttpResponse } from "@yaakapp-internal/models";
import type { FilterResponse } from "@yaakapp-internal/plugins";
import type { ServerSentEvent, SseSummary } from "@yaakapp-internal/sse";
import { candidateJsonPayloadsFromSseText, computeSseSummary } from "@yaakapp-internal/sse";
import { rpc } from "./rpc";
import { platform } from "@yaakapp-internal/platform";

/**
 * Reading a response body means naming the response, never the file it lives
 * in: the backend resolves an id against its own records, so nothing the UI
 * says can point a read somewhere else.
 */

export async function getResponseBodyText({
  response,
  filter,
}: {
  response: HttpResponse;
  filter: string | null;
}): Promise<string | null> {
  const result = await rpc<FilterResponse>("cmd_http_response_body", {
    responseId: response.id,
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
  try {
    const events = await rpc<ServerSentEvent[]>("cmd_get_sse_events", {
      responseId: response.id,
    });
    if (events.length > 0) {
      return events;
    }
  } catch {
    // Fall back to raw JSON frame parsing for non-standard SSE-like responses.
  }

  const text = await getResponseBodyDecoded(response);
  if (text == null) return [];

  return candidateJsonPayloadsFromSseText(text).map((data, index) => ({
    data,
    eventType: "",
    id: String(index),
    retry: null,
  }));
}

export async function getResponseBodySseSummary(
  response: HttpResponse,
  resultKeyPath: string,
): Promise<SseSummary> {
  const text = await getResponseBodyDecoded(response);
  if (text == null) return { fragmentCount: 0, summary: "" };

  return computeSseSummary(text, resultKeyPath);
}

export async function getResponseBodyBytes(
  response: HttpResponse,
): Promise<Uint8Array<ArrayBuffer> | null> {
  // A response body is stored under the response's own id
  return platform.blobs.read(response.id);
}

async function getResponseBodyDecoded(response: HttpResponse): Promise<string | null> {
  const bytes = await getResponseBodyBytes(response);
  return bytes == null ? null : new TextDecoder("utf-8").decode(bytes);
}
