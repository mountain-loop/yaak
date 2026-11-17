import { describe, expect, test } from "vite-plus/test";
import {
  defaultTabFor,
  flowShape,
  learnTab,
  REQUEST_TAB_BODY,
  REQUEST_TAB_HEADERS,
  REQUEST_TAB_INFO,
  RESPONSE_TAB_BODY,
  RESPONSE_TAB_COOKIES,
  RESPONSE_TAB_HEADERS,
  RESPONSE_TAB_MESSAGES,
  type TabMemory,
} from "./defaultTab";

type ShapeFlow = Parameters<typeof flowShape>[0];

const ok: ShapeFlow = {
  streamKind: null,
  status: 200,
  error: null,
  cancelled: false,
  requestSize: 0,
  responseSize: 120,
};

function memory(): TabMemory & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
  };
}

const RESPONSE_TABS = [RESPONSE_TAB_BODY, RESPONSE_TAB_HEADERS, RESPONSE_TAB_COOKIES];

describe("flowShape", () => {
  test("names what the flow has", () => {
    expect(flowShape(ok)).toBe("response_body");
    expect(flowShape({ ...ok, responseSize: 0, requestSize: 20 })).toBe("request_body");
    expect(flowShape({ ...ok, responseSize: 0 })).toBe("neither");
    expect(flowShape({ ...ok, streamKind: "websocket" })).toBe("stream");
    expect(flowShape({ ...ok, status: null, error: "refused" })).toBe("no_response");
    expect(flowShape({ ...ok, status: null, cancelled: true })).toBe("no_response");
  });

  test("a body cut after the headers still has its response", () => {
    expect(flowShape({ ...ok, error: "reset mid-body" })).toBe("response_body");
  });
});

describe("defaultTabFor", () => {
  test("follows the table", () => {
    const m = memory();
    // A response body, the request's Info, as there is no request body
    expect(defaultTabFor("request", ok, [], m)).toBe(REQUEST_TAB_INFO);
    expect(defaultTabFor("request", { ...ok, requestSize: 9 }, [], m)).toBe(REQUEST_TAB_BODY);
    expect(defaultTabFor("response", ok, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_BODY);
    // A request body, no response body
    const post = { ...ok, requestSize: 30, responseSize: 0 };
    expect(defaultTabFor("request", post, [], m)).toBe(REQUEST_TAB_BODY);
    expect(defaultTabFor("response", post, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_HEADERS);
    // Neither
    const empty = { ...ok, responseSize: 0 };
    expect(defaultTabFor("request", empty, [], m)).toBe(REQUEST_TAB_INFO);
    expect(defaultTabFor("response", empty, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_HEADERS);
    // A stream
    const ws = { ...ok, streamKind: "websocket" as const };
    expect(defaultTabFor("response", ws, [...RESPONSE_TABS, RESPONSE_TAB_MESSAGES], m)).toBe(
      RESPONSE_TAB_MESSAGES,
    );
    // No response at all: its timeline is in the request's Info
    const failed = { ...ok, status: null, error: "refused", responseSize: 0 };
    expect(defaultTabFor("response", failed, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_HEADERS);
    expect(defaultTabFor("request", failed, [], m)).toBe(REQUEST_TAB_INFO);
    expect(defaultTabFor("request", { ...failed, requestSize: 4 }, [], m)).toBe(REQUEST_TAB_BODY);
  });

  test("a tab chosen by hand becomes the default for the same shape and pane", () => {
    const m = memory();
    learnTab("response", ok, RESPONSE_TAB_COOKIES, m);
    expect(defaultTabFor("response", ok, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_COOKIES);
    // Not for other shapes, nor the other pane
    const post = { ...ok, requestSize: 30, responseSize: 0 };
    expect(defaultTabFor("response", post, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_HEADERS);
    expect(defaultTabFor("request", ok, ["info", "body", "headers"], m)).toBe(REQUEST_TAB_INFO);
  });

  test("a learned tab the flow doesn't have falls back to the table", () => {
    const m = memory();
    const ws = { ...ok, streamKind: "websocket" as const };
    learnTab("response", ws, RESPONSE_TAB_MESSAGES, m);
    learnTab("response", ok, RESPONSE_TAB_MESSAGES, m);
    expect(defaultTabFor("response", ok, RESPONSE_TABS, m)).toBe(RESPONSE_TAB_BODY);
  });

  test("the request half opens on Info unless it has a body, and learns like the response", () => {
    const m = memory();
    const tabs = [REQUEST_TAB_INFO, REQUEST_TAB_BODY, REQUEST_TAB_HEADERS];
    expect(defaultTabFor("request", ok, tabs, m)).toBe(REQUEST_TAB_INFO);
    expect(defaultTabFor("request", { ...ok, requestSize: 5 }, tabs, m)).toBe(REQUEST_TAB_BODY);
    learnTab("request", ok, REQUEST_TAB_HEADERS, m);
    expect(defaultTabFor("request", ok, tabs, m)).toBe(REQUEST_TAB_HEADERS);
  });

  test("works without storage", () => {
    expect(defaultTabFor("response", ok, RESPONSE_TABS, null)).toBe(RESPONSE_TAB_BODY);
  });
});
