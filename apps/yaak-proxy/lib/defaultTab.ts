import type { Flow } from "@yaakapp-internal/proxy-lib";

/** The request half's tabs, named as the shared request pane names them */
export const REQUEST_TAB_BODY = "body";
export const REQUEST_TAB_PARAMS = "params";
export const REQUEST_TAB_HEADERS = "headers";
export const REQUEST_TAB_AUTH = "auth";
export const REQUEST_TAB_COOKIES = "cookies";

/** The response half's tabs, named as the shared response pane names them */
export const RESPONSE_TAB_BODY = "body";
export const RESPONSE_TAB_HEADERS = "headers";
export const RESPONSE_TAB_COOKIES = "cookies";
export const RESPONSE_TAB_TIMELINE = "timeline";
export const RESPONSE_TAB_INFO = "info";
export const RESPONSE_TAB_MESSAGES = "messages";

export type FlowPane = "request" | "response";

/** What a flow has, which picks the tab each half opens on */
export type FlowShape = "response_body" | "request_body" | "neither" | "stream" | "no_response";

export function flowShape(
  flow: Pick<
    Flow,
    "streamKind" | "status" | "error" | "cancelled" | "requestSize" | "responseSize"
  >,
): FlowShape {
  if (flow.streamKind != null) return "stream";
  if (flow.status == null && (flow.error != null || flow.cancelled)) return "no_response";
  if (flow.responseSize > 0) return "response_body";
  if (flow.requestSize > 0) return "request_body";
  return "neither";
}

/** The tab a half opens on for a shape, before anything was learned */
export function shapeDefaultTab(pane: FlowPane, shape: FlowShape, hasRequestBody: boolean): string {
  if (pane === "request") {
    return hasRequestBody ? REQUEST_TAB_BODY : REQUEST_TAB_HEADERS;
  }
  switch (shape) {
    case "response_body":
      return RESPONSE_TAB_BODY;
    case "stream":
      return RESPONSE_TAB_MESSAGES;
    case "no_response":
      return RESPONSE_TAB_TIMELINE;
    case "request_body":
    case "neither":
      return RESPONSE_TAB_HEADERS;
  }
}

/** Where the tab last chosen by hand for a shape is kept */
export function learnedTabKey(pane: FlowPane, shape: FlowShape): string {
  return `proxy_learned_tab.${pane}.${shape}`;
}

/** Where learned tabs are read from and written to: local storage in the app */
export interface TabMemory {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/**
 * The tab a half opens on for a flow with no tab of its own: the one last chosen by hand for
 * flows of its shape, when this flow has that tab, else the shape's default.
 */
export function defaultTabFor(
  pane: FlowPane,
  flow: Parameters<typeof flowShape>[0],
  available: string[],
  memory: TabMemory | null,
): string {
  const shape = flowShape(flow);
  const learned = memory?.getItem(learnedTabKey(pane, shape)) ?? null;
  if (learned != null && available.includes(learned)) return learned;
  return shapeDefaultTab(pane, shape, flow.requestSize > 0);
}

/** A tab chosen by hand becomes the default for flows of the same shape */
export function learnTab(
  pane: FlowPane,
  flow: Parameters<typeof flowShape>[0],
  tab: string,
  memory: TabMemory | null,
) {
  memory?.setItem(learnedTabKey(pane, flowShape(flow)), tab);
}

export function browserTabMemory(): TabMemory | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
