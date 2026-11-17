import type { Flow, FlowMessage, MessageKind } from "@yaakapp-internal/proxy-lib";
import type { StreamEvent } from "@yaakapp-internal/ui";

/** gRPC's status codes by number, as a call's status row names them */
const GRPC_STATUS = [
  "OK",
  "CANCELLED",
  "UNKNOWN",
  "INVALID_ARGUMENT",
  "DEADLINE_EXCEEDED",
  "NOT_FOUND",
  "ALREADY_EXISTS",
  "PERMISSION_DENIED",
  "RESOURCE_EXHAUSTED",
  "FAILED_PRECONDITION",
  "ABORTED",
  "OUT_OF_RANGE",
  "UNIMPLEMENTED",
  "INTERNAL",
  "UNAVAILABLE",
  "DATA_LOSS",
  "UNAUTHENTICATED",
];

const KIND_LABELS: Record<MessageKind, string> = {
  websocket_text: "text",
  websocket_binary: "binary",
  websocket_ping: "ping",
  websocket_pong: "pong",
  websocket_close: "close",
  sse_event: "message",
  grpc_message: "message",
  grpc_trailers: "status",
};

/** A gRPC status as its row shows it: `0 OK`, `12 UNIMPLEMENTED: not here` */
export function grpcStatusText(status: number | null | undefined, message?: string | null) {
  if (status == null) return message ?? "No status";
  const name = GRPC_STATUS[status];
  const code = name == null ? String(status) : `${status} ${name}`;
  return message ? `${code}: ${message}` : code;
}

/** A WebSocket close as its row shows it: `1000 bye`, or that it had no code */
export function closeText(code: number | null | undefined, reason: string | null | undefined) {
  const parts = [code == null ? "No status code" : String(code), reason ?? ""].filter(Boolean);
  return parts.join(" ");
}

/** A stored message as the shared event stream viewer lists it */
export function messageToStreamEvent(message: FlowMessage): StreamEvent {
  const { kind, meta } = message;
  const base: StreamEvent = {
    key: String(message.seq),
    direction: message.direction === "client" ? "sent" : "received",
    kind: KIND_LABELS[kind],
    timestamp: message.timestamp,
    size: message.size,
    preview: message.preview,
    binary: kind === "websocket_binary" || kind === "grpc_message",
    truncated: message.truncated,
    error: message.error,
  };
  switch (kind) {
    case "sse_event":
      return { ...base, kind: meta.event ?? "message", title: "Event Received" };
    case "websocket_close":
      return {
        ...base,
        note: closeText(meta.closeCode, meta.closeReason),
        title: message.direction === "client" ? "Closed by the App" : "Closed by the Server",
        warning: meta.closeCode != null && meta.closeCode !== 1000 && meta.closeCode !== 1001,
      };
    case "websocket_ping":
    case "websocket_pong":
      return { ...base, title: kind === "websocket_ping" ? "Ping" : "Pong" };
    case "grpc_trailers":
      return {
        ...base,
        direction: "info",
        note: grpcStatusText(meta.grpcStatus, meta.grpcMessage),
        title: "Call Status",
        warning: meta.grpcStatus != null && meta.grpcStatus !== 0,
      };
    default:
      return base;
  }
}

/**
 * `incoming` added to `existing`, both in order by seq, without repeats: a page and the
 * messages that arrived while it loaded can overlap.
 */
export function mergeMessages(existing: FlowMessage[], incoming: FlowMessage[]): FlowMessage[] {
  if (incoming.length === 0) return existing;
  const last = existing[existing.length - 1];
  if (last == null) return dedupeSorted(incoming);
  const first = incoming[0];
  // The usual case: what comes next follows on
  if (first != null && first.seq > last.seq && isSorted(incoming)) {
    return [...existing, ...incoming];
  }
  return dedupeSorted([...existing, ...incoming]);
}

function isSorted(messages: FlowMessage[]): boolean {
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const next = messages[i];
    if (prev == null || next == null || next.seq <= prev.seq) return false;
  }
  return true;
}

function dedupeSorted(messages: FlowMessage[]): FlowMessage[] {
  const bySeq = new Map<number, FlowMessage>();
  for (const message of messages) bySeq.set(message.seq, message);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The Messages tab's name for a flow's stream, or null for a flow that isn't one */
export function messagesTabLabel(flow: Pick<Flow, "streamKind">): string | null {
  if (flow.streamKind == null) return null;
  return flow.streamKind === "sse" ? "Events" : "Messages";
}

/** Whether a stream is still open: it has no end, error or cancel yet */
export function streamIsOpen(
  flow: Pick<Flow, "streamKind" | "elapsedMs" | "error" | "cancelled">,
): boolean {
  return flow.streamKind != null && flow.elapsedMs == null && flow.error == null && !flow.cancelled;
}
