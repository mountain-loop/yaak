import { readFile } from "@tauri-apps/plugin-fs";
import type { HttpResponse } from "@yaakapp-internal/models";
import type { FilterResponse } from "@yaakapp-internal/plugins";
import type { ServerSentEvent, SseSummary } from "@yaakapp-internal/sse";
import { candidateJsonPayloadsFromSseText, computeSseSummary } from "@yaakapp-internal/sse";
import { invokeCmd } from "./tauri";

export async function getResponseBodyText({
  response,
  filter,
}: {
  response: HttpResponse;
  filter: string | null;
}): Promise<string | null> {
  const result = await invokeCmd<FilterResponse>("cmd_http_response_body", {
    response,
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
  try {
    const events = await invokeCmd<ServerSentEvent[]>("cmd_get_sse_events", {
      filePath: response.bodyPath,
    });
    if (events.length > 0) {
      return events;
    }
  } catch {
    // Fall back to raw JSON frame parsing for non-standard SSE-like responses.
  }

  const bytes = await readFile(response.bodyPath);
  const text = new TextDecoder("utf-8").decode(bytes);
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
  if (!response.bodyPath) return { fragmentCount: 0, summary: "" };

  const bytes = await readFile(response.bodyPath);
  const text = new TextDecoder("utf-8").decode(bytes);
  return computeSseSummary(text, resultKeyPath);
}

export async function getResponseBodyBytes(
  response: HttpResponse,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.bodyPath) return null;
  return readFile(response.bodyPath);
}
