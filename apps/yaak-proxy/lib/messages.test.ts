import type { FlowMessage } from "@yaakapp-internal/proxy-lib";
import { describe, expect, test } from "vite-plus/test";
import {
  closeText,
  grpcStatusText,
  mergeMessages,
  messagesTabLabel,
  messageToStreamEvent,
  streamIsOpen,
} from "./messages";

function message(seq: number, patch: Partial<FlowMessage> = {}): FlowMessage {
  return {
    id: `fm_${seq}`,
    flowId: "fl_1",
    seq,
    direction: "server",
    kind: "websocket_text",
    timestamp: "2026-11-06T09:30:00.000",
    size: 5,
    storedSize: 5,
    truncated: false,
    compressed: false,
    error: null,
    meta: {},
    preview: "hello",
    ...patch,
  };
}

describe("mergeMessages", () => {
  test("appends what follows on", () => {
    const merged = mergeMessages([message(0), message(1)], [message(2), message(3)]);
    expect(merged.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  });

  test("drops repeats and keeps order when a page overlaps live messages", () => {
    const merged = mergeMessages([message(0), message(2)], [message(1), message(2), message(3)]);
    expect(merged.map((m) => m.seq)).toEqual([0, 1, 2, 3]);
  });

  test("keeps the same array when nothing came", () => {
    const existing = [message(0)];
    expect(mergeMessages(existing, [])).toBe(existing);
  });
});

describe("messageToStreamEvent", () => {
  test("a WebSocket frame keeps its direction, type, size and time", () => {
    expect(messageToStreamEvent(message(4, { direction: "client" }))).toMatchObject({
      key: "4",
      direction: "sent",
      kind: "text",
      size: 5,
      timestamp: "2026-11-06T09:30:00.000",
      preview: "hello",
      binary: false,
    });
    expect(messageToStreamEvent(message(5, { kind: "websocket_binary" })).binary).toBe(true);
  });

  test("a close says its code and reason, and warns when it wasn't a normal close", () => {
    const normal = messageToStreamEvent(
      message(6, { kind: "websocket_close", meta: { closeCode: 1000, closeReason: "bye" } }),
    );
    expect([normal.kind, normal.note, normal.warning]).toEqual(["close", "1000 bye", false]);
    const abnormal = messageToStreamEvent(
      message(7, { kind: "websocket_close", meta: { closeCode: 1011 } }),
    );
    expect([abnormal.note, abnormal.warning]).toEqual(["1011", true]);
  });

  test("an event is named by its event field, or message", () => {
    const named = messageToStreamEvent(message(0, { kind: "sse_event", meta: { event: "tick" } }));
    expect(named.kind).toBe("tick");
    expect(messageToStreamEvent(message(1, { kind: "sse_event" })).kind).toBe("message");
  });

  test("a gRPC call's trailers are its status row", () => {
    const status = messageToStreamEvent(
      message(2, { kind: "grpc_trailers", meta: { grpcStatus: 12, grpcMessage: "not here" } }),
    );
    expect(status).toMatchObject({
      direction: "info",
      kind: "status",
      note: "12 UNIMPLEMENTED: not here",
      warning: true,
    });
  });
});

describe("labels", () => {
  test("statuses and closes", () => {
    expect(grpcStatusText(0)).toBe("0 OK");
    expect(grpcStatusText(42)).toBe("42");
    expect(grpcStatusText(null, "gone")).toBe("gone");
    expect(closeText(null, null)).toBe("No status code");
  });

  test("the tab is Events for an event stream and Messages for the rest", () => {
    expect(messagesTabLabel({ streamKind: "sse" })).toBe("Events");
    expect(messagesTabLabel({ streamKind: "websocket" })).toBe("Messages");
    expect(messagesTabLabel({ streamKind: null })).toBeNull();
  });

  test("a stream is open until it ends, fails or is cancelled", () => {
    const open = {
      streamKind: "websocket" as const,
      elapsedMs: null,
      error: null,
      cancelled: false,
    };
    expect(streamIsOpen(open)).toBe(true);
    expect(streamIsOpen({ ...open, elapsedMs: 10 })).toBe(false);
    expect(streamIsOpen({ ...open, error: "reset" })).toBe(false);
    expect(streamIsOpen({ ...open, streamKind: null })).toBe(false);
  });
});
