import type { Flow } from "@yaakapp-internal/proxy-lib";
import {
  type EventStreamColumns,
  EventStreamViewer,
  HStack,
  type StreamEvent,
  type StreamPayloadView,
} from "@yaakapp-internal/ui";
import { useCallback, useMemo } from "react";
import { useFlowMessages, useMessageSource } from "../hooks/useFlowMessages";
import { base64ToBytes } from "../lib/body";
import { grpcStatusText, messageToStreamEvent, streamIsOpen } from "../lib/messages";

const WEBSOCKET_COLUMNS: EventStreamColumns = {
  direction: true,
  kind: "Type",
  preview: "Message",
  size: true,
  time: true,
};
const SSE_COLUMNS: EventStreamColumns = {
  kind: "Event",
  kindWidth: "9.5rem",
  preview: "Data",
  size: true,
  time: true,
};
const GRPC_COLUMNS: EventStreamColumns = {
  direction: true,
  kind: "Type",
  preview: "Message",
  size: true,
  time: true,
};

/**
 * A streaming flow's messages: a WebSocket's frames, an event stream's events, a gRPC call's
 * messages and status, following new ones while the stream is open. The selected message's
 * payload opens below as text or a hexdump; a gRPC message's also decoded, with its schema or
 * without one.
 */
export function FlowMessages({ flow }: { flow: Flow }) {
  const source = useMessageSource();
  const { messages, loading, error } = useFlowMessages(flow.id, source, flow.messageCount);
  const events = useMemo(() => messages.map(messageToStreamEvent), [messages]);
  const kind = flow.streamKind;
  const grpc = kind === "grpc" || kind === "grpc_web";
  const columns = kind === "sse" ? SSE_COLUMNS : grpc ? GRPC_COLUMNS : WEBSOCKET_COLUMNS;
  const noun = kind === "sse" ? "Event" : "Message";
  const catchUp = useMemo(
    () => ({
      label: (count: number) => `${count} new ${noun.toLowerCase()}${count === 1 ? "" : "s"}`,
    }),
    [noun],
  );

  const loadPayload = useCallback(
    async (event: StreamEvent) => {
      const res = await source.payload(flow.id, Number(event.key));
      return { bytes: base64ToBytes(res.data) };
    },
    [flow.id, source],
  );

  const payloadViews = useCallback(
    (event: StreamEvent): StreamPayloadView[] | null => {
      if (!grpc || event.direction === "info") return null;
      const decode = (schemaless: boolean) => async () => {
        const decoded = await source.decodeGrpc(flow.id, Number(event.key), schemaless);
        const note = [
          decoded.messageType == null ? null : `Decoded as ${decoded.messageType}`,
          decoded.note,
        ]
          .filter(Boolean)
          .join(". ");
        return { text: decoded.json, language: "json" as const, note: note || null };
      };
      return [
        { value: "decoded", label: "Decoded", type: "text", load: decode(false) },
        { value: "schemaless", label: "Schemaless", type: "text", load: decode(true) },
        { value: "raw", label: "Raw bytes", type: "hexdump" },
      ];
    },
    [flow.id, grpc, source],
  );

  const open = streamIsOpen(flow);
  const count = Math.max(flow.messageCount, messages.length);
  const header = (
    <HStack space={2} className="pl-2 mb-1 h-xs font-mono text-xs text-text-subtle">
      {kind === "websocket" && (
        <>
          {open ? (
            <span className="text-success">CONNECTED</span>
          ) : flow.error != null ? (
            <span className="text-danger">ERROR</span>
          ) : (
            <span className="text-text-subtle">CLOSED</span>
          )}
          <span>&bull;</span>
        </>
      )}
      <span>
        {count} {count === 1 ? noun : `${noun}s`}
      </span>
      {grpc && flow.grpcStatus != null && (
        <>
          <span>&bull;</span>
          <span className={flow.grpcStatus === 0 ? "text-success" : "text-danger"}>
            {grpcStatusText(flow.grpcStatus, flow.grpcMessage)}
          </span>
        </>
      )}
    </HStack>
  );

  return (
    <EventStreamViewer
      events={events}
      header={header}
      error={error ?? (open ? null : flow.error)}
      isLoading={loading && events.length === 0}
      emptyMessage={
        open ? `Waiting for the first ${noun.toLowerCase()}` : `No ${noun.toLowerCase()}s`
      }
      splitLayoutStorageKey="proxy_flow_messages"
      columns={columns}
      loadPayload={loadPayload}
      payloadViews={payloadViews}
      catchUp={catchUp}
    />
  );
}
