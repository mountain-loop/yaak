import type { HttpRequest, HttpResponse, HttpResponseEvent } from "@yaakapp-internal/models";
import type { HttpRequestView, HttpResponseView } from "@yaakapp-internal/ui";
import { getContentTypeFromHeaders } from "./model_util";

/** A request as the shared request pane shows it. Auth stays with the client's own editor */
export function httpRequestToView(request: HttpRequest): HttpRequestView {
  return {
    id: request.id,
    method: request.method,
    url: request.url,
    headers: request.headers,
    urlParameters: request.urlParameters,
    bodyType: request.bodyType,
    body: request.body,
    contentType: getContentTypeFromHeaders(request.headers),
    auth: null,
  };
}

/** A response as the shared response pane shows it, with its cookies from the send's events */
export function httpResponseToView(
  response: HttpResponse,
  events: HttpResponseEvent[] | undefined,
): HttpResponseView {
  return {
    id: response.id,
    ownerId: response.requestId,
    state: response.state,
    status: response.status,
    statusReason: response.statusReason,
    url: response.url,
    headers: response.headers,
    requestHeaders: response.requestHeaders,
    contentType: getContentTypeFromHeaders(response.headers),
    contentLength: response.contentLength,
    contentLengthCompressed: response.contentLengthCompressed,
    requestContentLength: response.requestContentLength,
    // Stored as UTC without a zone
    startedAt: `${response.createdAt}Z`,
    elapsedMs: response.elapsed,
    elapsedHeadersMs: response.elapsedHeaders,
    elapsedDnsMs: response.elapsedDns,
    error: response.error,
    remoteAddr: response.remoteAddr,
    version: response.version,
    cookieHeaders: cookieHeadersFromEvents(events),
  };
}

/** The `Cookie` headers sent and `Set-Cookie` headers received, from a send's events */
export function cookieHeadersFromEvents(
  events: HttpResponseEvent[] | undefined,
): HttpResponseView["cookieHeaders"] {
  const sent: string[] = [];
  const received: string[] = [];
  for (const { event } of events ?? []) {
    if (event.type === "header_up" && event.name.toLowerCase() === "cookie") {
      sent.push(event.value);
    } else if (event.type === "header_down" && event.name.toLowerCase() === "set-cookie") {
      received.push(event.value);
    }
  }
  return { sent, received };
}
