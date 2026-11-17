import type { HttpRequest, HttpResponse, HttpResponseEvent } from "@yaakapp-internal/models";
import { describe, expect, test } from "vite-plus/test";
import { cookieHeadersFromEvents, httpRequestToView, httpResponseToView } from "./httpViews";

function event(e: HttpResponseEvent["event"]): HttpResponseEvent {
  return { event: e } as HttpResponseEvent;
}

describe("httpRequestToView", () => {
  test("maps the request and reads its content type from the headers", () => {
    const request = {
      id: "rq_1",
      method: "POST",
      url: "https://yaak.app",
      headers: [{ name: "content-type", value: "application/json", enabled: true }],
      urlParameters: [{ name: "a", value: "1", enabled: true }],
      bodyType: "application/json",
      body: { text: "{}" },
    } as unknown as HttpRequest;

    expect(httpRequestToView(request)).toEqual({
      id: "rq_1",
      method: "POST",
      url: "https://yaak.app",
      headers: request.headers,
      urlParameters: request.urlParameters,
      bodyType: "application/json",
      body: { text: "{}" },
      contentType: "application/json",
      auth: null,
    });
  });
});

describe("httpResponseToView", () => {
  test("keys state to the request and puts the stored time in UTC", () => {
    const response = {
      id: "rs_1",
      requestId: "rq_1",
      state: "closed",
      status: 200,
      statusReason: "OK",
      url: "https://yaak.app",
      headers: [{ name: "Content-Type", value: "text/plain" }],
      requestHeaders: [],
      contentLength: 10,
      contentLengthCompressed: 4,
      requestContentLength: 0,
      createdAt: "2026-11-04T22:10:00.123",
      elapsed: 30,
      elapsedHeaders: 20,
      elapsedDns: 5,
      error: null,
      remoteAddr: null,
      version: "HTTP/1.1",
    } as unknown as HttpResponse;

    expect(httpResponseToView(response, undefined)).toMatchObject({
      id: "rs_1",
      ownerId: "rq_1",
      contentType: "text/plain",
      startedAt: "2026-11-04T22:10:00.123Z",
      elapsedMs: 30,
      elapsedHeadersMs: 20,
      elapsedDnsMs: 5,
      contentLengthCompressed: 4,
      cookieHeaders: { sent: [], received: [] },
    });
  });
});

describe("cookieHeadersFromEvents", () => {
  test("collects Cookie headers sent and Set-Cookie headers received", () => {
    const events = [
      event({ type: "header_up", name: "Cookie", value: "a=1" }),
      event({ type: "header_up", name: "Accept", value: "*/*" }),
      event({ type: "header_down", name: "set-cookie", value: "b=2" }),
      event({ type: "header_down", name: "Content-Type", value: "text/plain" }),
    ];
    expect(cookieHeadersFromEvents(events)).toEqual({ sent: ["a=1"], received: ["b=2"] });
    expect(cookieHeadersFromEvents(undefined)).toEqual({ sent: [], received: [] });
  });
});
