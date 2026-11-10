import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  BODY_TYPE_BINARY,
  BODY_TYPE_FORM_MULTIPART,
  BODY_TYPE_FORM_URLENCODED,
  BODY_TYPE_JSON,
  BODY_TYPE_OTHER,
} from "@yaakapp-internal/ui/httpTypes";
import { describe, expect, test } from "vite-plus/test";
import {
  authFromHeaders,
  type FlowBodyData,
  flowBodyFromRpc,
  flowRequestToView,
  flowResponseToView,
  queryToPairs,
  utcTimestamp,
} from "./flowViews";

const flow: Flow = {
  id: "fl_1",
  number: 1,
  createdAt: "2026-11-04T22:10:00Z",
  updatedAt: "2026-11-04T22:10:01Z",
  startedAt: "2026-11-04T22:10:00Z",
  method: "POST",
  url: "https://api.example.com/v1/items?limit=1&q=a+b#top",
  clientHttpVersion: "HTTP/1.1",
  upstreamHttpVersion: "HTTP/2",
  remoteAddr: "1.2.3.4:443",
  status: 201,
  contentType: "application/json",
  requestHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Cookie", value: "a=1" },
  ],
  responseHeaders: [
    { name: "Content-Type", value: "application/json" },
    { name: "Set-Cookie", value: "b=2; Path=/" },
  ],
  requestSize: 7,
  responseSize: 12,
  requestTruncated: false,
  responseTruncated: false,
  elapsedHeadersMs: 40,
  elapsedMs: 55,
  error: null,
  cancelled: false,
  savedRequestId: null,
  clientPid: null,
  clientName: null,
  clientBundleId: null,
  clientPath: null,
  clientCwd: null,
  streamKind: null,
  messageCount: 0,
  grpcService: null,
  grpcMethod: null,
  grpcStatus: null,
  grpcMessage: null,
  graphqlOperation: null,
  tunnelled: false,
  tunnelReason: null,
  tunnelExcludedBy: null,
  tunnelExcludedBuiltIn: false,
  tunnelRejectedBy: null,
  reconnectRequested: false,
  tlsRejected: null,
  agentRead: false,
  clientAddr: null,
  elapsedConnectMs: null,
  elapsedTlsMs: null,
  elapsedRequestMs: null,
  upstreamTlsVersion: null,
  upstreamTlsCipher: null,
};

function bytes(text: string): FlowBodyData {
  return { bytes: new TextEncoder().encode(text), truncated: false, storedSize: text.length };
}

function withContentType(contentType: string): Flow {
  return { ...flow, requestHeaders: [{ name: "Content-Type", value: contentType }] };
}

describe("flowRequestToView", () => {
  test("maps the request line, headers and query", () => {
    const view = flowRequestToView(flow, bytes('{"a":1}'));
    expect(view.method).toBe("POST");
    expect(view.url).toBe(flow.url);
    expect(view.headers.map((h) => h.name)).toEqual(["Content-Type", "Cookie"]);
    expect(view.urlParameters.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: "limit", value: "1" },
      { name: "q", value: "a b" },
    ]);
    expect(view.contentType).toBe("application/json");
  });

  test("reads a JSON body as JSON, sent as written", () => {
    const view = flowRequestToView(flow, bytes('{"a":1}'));
    expect(view.bodyType).toBe(BODY_TYPE_JSON);
    expect(view.body).toEqual({ text: '{"a":1}', sendJsonComments: true });
  });

  test("reads a url-encoded body as form fields", () => {
    const view = flowRequestToView(
      withContentType("application/x-www-form-urlencoded; charset=utf-8"),
      bytes("a=1&b=two+words&c=%26"),
    );
    expect(view.bodyType).toBe(BODY_TYPE_FORM_URLENCODED);
    expect(view.body.form?.map(({ name, value }) => [name, value])).toEqual([
      ["a", "1"],
      ["b", "two words"],
      ["c", "&"],
    ]);
  });

  test("leaves multipart and binary bodies to the viewers", () => {
    expect(
      flowRequestToView(withContentType("multipart/form-data; boundary=x"), bytes("--x--"))
        .bodyType,
    ).toBe(BODY_TYPE_FORM_MULTIPART);
    const binary: FlowBodyData = {
      bytes: new Uint8Array([0xff, 0xfe, 0x00]),
      truncated: false,
      storedSize: 3,
    };
    expect(flowRequestToView(withContentType("application/octet-stream"), binary).bodyType).toBe(
      BODY_TYPE_BINARY,
    );
  });

  test("reads other text as text, and no body as none", () => {
    expect(flowRequestToView(withContentType("text/plain"), bytes("hi")).bodyType).toBe(
      BODY_TYPE_OTHER,
    );
    expect(flowRequestToView(flow, bytes("")).bodyType).toBeNull();
    expect(flowRequestToView(flow, null).bodyType).toBeNull();
  });

  test("shows authentication from the Authorization header", () => {
    expect(authFromHeaders([{ name: "authorization", value: "Bearer abc" }])).toEqual({
      label: "Bearer",
      values: [{ name: "Authorization", value: "Bearer abc" }],
    });
    expect(authFromHeaders([{ name: "Authorization", value: "Custom x" }])?.label).toBe("Auth");
    expect(authFromHeaders([])).toBeNull();
  });
});

describe("flowResponseToView", () => {
  test("maps status, timing, sizes and cookies", () => {
    const view = flowResponseToView(flow);
    expect(view).toMatchObject({
      id: "fl_1",
      ownerId: "fl_1",
      state: "closed",
      status: 201,
      statusReason: "Created",
      contentType: "application/json",
      contentLength: 12,
      requestContentLength: 7,
      startedAt: "2026-11-04T22:10:00Z",
      elapsedMs: 55,
      elapsedHeadersMs: 40,
      version: "HTTP/2",
      remoteAddr: "1.2.3.4:443",
      cookieHeaders: { sent: ["a=1"], received: ["b=2; Path=/"] },
    });
  });

  test("shows a gzip response's decoded size, with its wire size as compressed", () => {
    const gzipped: Flow = {
      ...flow,
      responseHeaders: [...flow.responseHeaders, { name: "Content-Encoding", value: "gzip" }],
      responseSize: 40,
    };
    const decoded: FlowBodyData = {
      bytes: new Uint8Array(120),
      truncated: false,
      storedSize: 40,
    };
    expect(flowResponseToView(gzipped, decoded)).toMatchObject({
      contentLength: 120,
      contentLengthCompressed: 40,
    });
    // Before the body loads, the wire size stands in, still marked compressed
    expect(flowResponseToView(gzipped)).toMatchObject({
      contentLength: 40,
      contentLengthCompressed: 40,
    });
  });

  test("keeps the wire size for an unencoded body cut at the capture limit", () => {
    const cut: FlowBodyData = { bytes: new Uint8Array(5), truncated: true, storedSize: 5 };
    expect(flowResponseToView(flow, cut)).toMatchObject({
      contentLength: 12,
      contentLengthCompressed: null,
    });
    expect(flowResponseToView(flow, bytes("hello world!"))).toMatchObject({
      contentLength: 12,
      contentLengthCompressed: null,
    });
  });

  test("reads the engine's zone-less timestamps as UTC", () => {
    expect(flowResponseToView({ ...flow, startedAt: "2026-11-04T22:10:00.123" })?.startedAt).toBe(
      "2026-11-04T22:10:00.123Z",
    );
    expect(utcTimestamp("2026-11-04T22:10:00+02:00")).toBe("2026-11-04T22:10:00+02:00");
  });

  test("is still connected while the body streams", () => {
    expect(flowResponseToView({ ...flow, elapsedMs: null })?.state).toBe("connected");
  });

  test("has no response while waiting on one", () => {
    expect(flowResponseToView({ ...flow, status: null, elapsedMs: null })).toBeNull();
  });

  test("carries a failure as the response's error", () => {
    const view = flowResponseToView({ ...flow, status: null, elapsedMs: null, error: "refused" });
    expect(view).toMatchObject({ state: "closed", status: 0, error: "refused" });
  });

  test("says when the client gave up before a response", () => {
    const view = flowResponseToView({ ...flow, status: null, elapsedMs: null, cancelled: true });
    expect(view?.error).toBe("Cancelled by the client");
  });
});

describe("flowBodyFromRpc", () => {
  test("decodes the RPC's base64", () => {
    const body = flowBodyFromRpc({ data: btoa("hello"), truncated: true, storedSize: 5 });
    expect(new TextDecoder().decode(body.bytes)).toBe("hello");
    expect(body.truncated).toBe(true);
  });
});

describe("queryToPairs", () => {
  test("ignores the fragment and keeps repeats", () => {
    expect(queryToPairs("https://x.test/?a=1&a=2#b=3").map((p) => p.value)).toEqual(["1", "2"]);
    expect(queryToPairs("https://x.test/")).toEqual([]);
  });
});
