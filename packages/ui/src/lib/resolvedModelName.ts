import type { AnyModel } from "@yaakapp-internal/models";
import { replaceTemplateTags } from "./templateTags";

/**
 * The name Yaak shows for a model: its own, or for a request without one its URL, with
 * template tags reduced to their contents and the protocol left off.
 */
export function resolvedModelName(r: AnyModel | null): string {
  if (r == null) return "";

  if (!("url" in r) || r.model === "plugin") {
    return "name" in r ? r.name : "";
  }

  // Return name if it has one
  if ("name" in r && r.name) {
    return r.name;
  }

  return unnamedRequestName(r);
}

/** What a request, or its response or connection, needs for the name Yaak shows without one */
export interface UnnamedRequest {
  /** `http_request`, `websocket_request`, and any other model reads as gRPC, as in Yaak */
  model: string;
  url: string;
  bodyType?: string | null;
  service?: string | null;
  method?: string | null;
}

/**
 * The name Yaak shows for a request without one: its URL, with template tags reduced to their
 * contents and the protocol left off, or the kind of request when the URL is empty.
 */
export function unnamedRequestName(r: UnnamedRequest): string {
  // Replace variable syntax with variable name
  const withoutVariables = replaceTemplateTags(r.url, (m) => m.inner.trim());
  if (withoutVariables.trim() === "") {
    return r.model === "http_request"
      ? r.bodyType && r.bodyType === "graphql"
        ? "GraphQL Request"
        : "HTTP Request"
      : r.model === "websocket_request"
        ? "WebSocket Request"
        : "gRPC Request";
  }

  // GRPC gets nice short names
  if (r.model === "grpc_request" && r.service != null && r.method != null) {
    const shortService = r.service.split(".").pop();
    return `${shortService}/${r.method}`;
  }

  // Strip unnecessary protocol
  const withoutProto = withoutVariables.replace(/^(http|https|ws|wss):\/\//, "");

  return withoutProto;
}
