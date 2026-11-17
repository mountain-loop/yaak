import type { DecodedGrpcMessage, Flow, FlowMessage } from "@yaakapp-internal/proxy-lib";
import type { MessageSource } from "../hooks/useFlowMessages";

/** A streaming flow with its messages and their payloads, for the Messages tab */
export interface StreamFixture {
  label: string;
  flow: Flow;
  messages: FlowMessage[];
  payloads: Uint8Array[];
  /** Messages still to come while the harness runs, one at a time */
  later?: { message: FlowMessage; payload: Uint8Array }[];
  decoded?: Record<number, { decoded: DecodedGrpcMessage; schemaless: DecodedGrpcMessage }>;
}

const encode = (s: string) => new TextEncoder().encode(s);

const flowBase: Flow = {
  id: "fl_stream",
  number: 1410,
  createdAt: "2026-11-05T21:41:12",
  updatedAt: "2026-11-05T21:41:20",
  startedAt: "2026-11-05T21:41:12.100",
  method: "GET",
  url: "https://gateway.discord.gg/?v=10&encoding=json",
  clientHttpVersion: "HTTP/1.1",
  upstreamHttpVersion: "HTTP/1.1",
  remoteAddr: "162.159.135.234:443",
  status: 101,
  contentType: null,
  requestHeaders: [{ name: "Upgrade", value: "websocket" }],
  responseHeaders: [{ name: "Upgrade", value: "websocket" }],
  requestSize: 0,
  responseSize: 0,
  requestTruncated: false,
  responseTruncated: false,
  elapsedHeadersMs: 88,
  elapsedMs: 128_400,
  error: null,
  cancelled: false,
  savedRequestId: null,
  clientPid: 812,
  clientName: "Discord",
  clientBundleId: "com.hnc.Discord",
  clientPath: "/Applications/Discord.app",
  clientCwd: null,
  streamKind: "websocket",
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

/** Seconds past 21:41:12 as a stored timestamp */
function at(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const s = 12 + Math.floor(ms / 1000);
  const m = 41 + Math.floor(s / 60);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `2026-11-05T21:${pad(m)}:${pad(s % 60)}.${pad(ms % 1000, 3)}`;
}

function build(
  flowId: string,
  rows: [number, FlowMessage["direction"], FlowMessage["kind"], Uint8Array, FlowMessage["meta"]?][],
): { messages: FlowMessage[]; payloads: Uint8Array[] } {
  const messages = rows.map(([seconds, direction, kind, payload, meta], seq) => {
    const text = new TextDecoder().decode(payload);
    const binary = kind === "websocket_binary" || kind === "grpc_message";
    return {
      id: `fm_${flowId}_${seq}`,
      flowId,
      seq,
      direction,
      kind,
      timestamp: at(seconds),
      size: kind === "sse_event" ? (meta?.raw?.length ?? payload.length) : payload.length,
      storedSize: payload.length,
      truncated: false,
      compressed: false,
      error: null,
      meta: meta ?? {},
      preview:
        binary || kind === "grpc_trailers"
          ? null
          : kind === "websocket_close"
            ? (meta?.closeReason ?? null)
            : text.slice(0, 200) || null,
    } satisfies FlowMessage;
  });
  return { messages, payloads: rows.map((r) => r[3]) };
}

const json = (v: unknown) => encode(JSON.stringify(v));

const ws = build("fl_ws", [
  [0.09, "server", "websocket_text", json({ op: 10, d: { heartbeat_interval: 41250 } })],
  [0.11, "client", "websocket_text", json({ op: 2, d: { token: "mfa.••••", intents: 3276799 } })],
  [
    0.41,
    "server",
    "websocket_text",
    json({ t: "READY", s: 1, op: 0, d: { v: 10, session_id: "5f1c…" } }),
  ],
  [
    1.02,
    "server",
    "websocket_binary",
    Uint8Array.from([0x78, 0x9c, 0xab, 0x56, 0xca, 0x2f, 0x50, 0xb2, 0x32, 0xd4, 0x51, 0x02, 0x00]),
  ],
  [41.25, "client", "websocket_text", json({ op: 1, d: 1 })],
  [41.31, "server", "websocket_text", json({ op: 11 })],
  [
    43.3,
    "server",
    "websocket_text",
    json({
      t: "MESSAGE_CREATE",
      s: 5,
      op: 0,
      d: { content: "shipping the proxy beta tonight?", author: { username: "mara" } },
    }),
  ],
  [60.0, "server", "websocket_ping", new Uint8Array()],
  [60.0, "client", "websocket_pong", new Uint8Array()],
  [82.5, "client", "websocket_text", json({ op: 1, d: 5 })],
  [82.56, "server", "websocket_text", json({ op: 11 })],
  [
    128.3,
    "client",
    "websocket_close",
    Uint8Array.from([0x03, 0xe8, 0x62, 0x79, 0x65]),
    { closeCode: 1000, closeReason: "bye" },
  ],
  [128.4, "server", "websocket_close", Uint8Array.from([0x03, 0xe8]), { closeCode: 1000 }],
]);

const sseEvents: [string, unknown][] = [
  [
    "message_start",
    {
      type: "message_start",
      message: { id: "msg_01HqX", model: "claude-opus-5-5", usage: { input_tokens: 18204 } },
    },
  ],
  [
    "content_block_start",
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  ],
  ["ping", { type: "ping" }],
  [
    "content_block_delta",
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "The 402 comes from" },
    },
  ],
  [
    "content_block_delta",
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " Stripe: the card on" },
    },
  ],
  [
    "content_block_delta",
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " file was declined with" },
    },
  ],
  [
    "content_block_delta",
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: " insufficient_funds." },
    },
  ],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  [
    "message_delta",
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 312 } },
  ],
  ["message_stop", { type: "message_stop" }],
];

function sse(flowId: string, count: number) {
  return build(
    flowId,
    sseEvents.slice(0, count).map(([event, data], i) => {
      const payload = json(data);
      const raw = `event: ${event}\ndata: ${new TextDecoder().decode(payload)}\n\n`;
      return [0.8 + i * (i < 3 ? 0.05 : 0.18), "server", "sse_event", payload, { event, raw }];
    }),
  );
}

const sseFlow: Flow = {
  ...flowBase,
  method: "POST",
  url: "https://api.anthropic.com/v1/messages",
  clientHttpVersion: "HTTP/2",
  upstreamHttpVersion: "HTTP/2",
  status: 200,
  contentType: "text/event-stream; charset=utf-8",
  responseHeaders: [{ name: "content-type", value: "text/event-stream; charset=utf-8" }],
  clientName: "claude",
  clientBundleId: null,
  clientPath: "/opt/homebrew/bin/claude",
  streamKind: "sse",
  elapsedMs: 2_610,
};

const sseDone = sse("fl_sse_done", sseEvents.length);
const sseOpen = sse("fl_sse_open", sseEvents.length);

// A string in field 1, as a server-streaming call's replies
function proto(text: string, n?: number): Uint8Array {
  const bytes = encode(text);
  const out = [0x0a, bytes.length, ...bytes];
  if (n != null) out.push(0x10, n);
  return Uint8Array.from(out);
}

const grpcReplies = ["us-east-1a ok", "us-east-1b ok", "us-east-1c degraded", "eu-west-1a ok"];
const grpc = build("fl_grpc", [
  [0.02, "client", "grpc_message", proto("prod")],
  ...grpcReplies.map(
    (r, i) =>
      [0.31 + i * 0.42, "server", "grpc_message", proto(r, i + 1)] as [
        number,
        "server",
        "grpc_message",
        Uint8Array,
      ],
  ),
  [2.1, "server", "grpc_trailers", encode("grpc-status: 0\r\n"), { grpcStatus: 0 }],
]);

const schema = {
  id: "gs_1",
  createdAt: "2026-11-05T20:00:00",
  updatedAt: "2026-11-05T20:00:00",
  hostPattern: "health.internal",
  source: "reflection" as const,
  protoPaths: [],
  services: ["ops.Health"],
};

const grpcDecoded: StreamFixture["decoded"] = Object.fromEntries(
  [["prod"], ...grpcReplies.map((r, i) => [r, i + 1])].map(([text, n], seq) => [
    seq,
    {
      decoded: {
        json: JSON.stringify(
          seq === 0
            ? { environment: text }
            : { zone: String(text).split(" ")[0], state: String(text).split(" ")[1], sequence: n },
          null,
          2,
        ),
        messageType: seq === 0 ? "ops.WatchRequest" : "ops.ZoneHealth",
        schema,
        note: null,
      },
      schemaless: {
        json: JSON.stringify(
          [
            { field: 1, wireType: "len", string: text },
            ...(n == null ? [] : [{ field: 2, wireType: "varint", value: n }]),
          ],
          null,
          2,
        ),
        messageType: null,
        schema: null,
        note: "Decoded without a schema: field names and types are guesses",
      },
    },
  ]),
);

export const streamFixtures: StreamFixture[] = [
  {
    label: "WebSocket",
    flow: { ...flowBase, id: "fl_ws", messageCount: ws.messages.length },
    ...ws,
  },
  {
    label: "SSE, open",
    flow: { ...sseFlow, id: "fl_sse_open", elapsedMs: null, messageCount: 6 },
    messages: sseOpen.messages.slice(0, 6),
    payloads: sseOpen.payloads,
    later: sseOpen.messages.slice(6).map((message) => ({
      message,
      payload: sseOpen.payloads[message.seq] ?? new Uint8Array(),
    })),
  },
  {
    label: "SSE, done",
    flow: { ...sseFlow, id: "fl_sse_done", messageCount: sseDone.messages.length },
    ...sseDone,
  },
  {
    label: "gRPC stream",
    flow: {
      ...flowBase,
      id: "fl_grpc",
      method: "POST",
      url: "https://health.internal/ops.Health/Watch",
      clientHttpVersion: "HTTP/2",
      upstreamHttpVersion: "HTTP/2",
      status: 200,
      contentType: "application/grpc",
      responseHeaders: [{ name: "content-type", value: "application/grpc" }],
      clientName: "grpcurl",
      clientPath: "/opt/homebrew/bin/grpcurl",
      streamKind: "grpc",
      grpcService: "ops.Health",
      grpcMethod: "Watch",
      grpcStatus: 0,
      elapsedMs: 2_100,
      messageCount: grpc.messages.length,
    },
    ...grpc,
    decoded: grpcDecoded,
  },
];

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The fixture's messages as the engine would serve them, the later ones arriving every 900 ms */
export function fixtureSource(fixture: StreamFixture): MessageSource {
  const messages = [...fixture.messages];
  const listeners = new Set<(m: FlowMessage) => void>();
  const later = [...(fixture.later ?? [])];
  if (later.length > 0) {
    const timer = setInterval(() => {
      const next = later.shift();
      if (next == null) return clearInterval(timer);
      messages.push(next.message);
      for (const l of listeners) l(next.message);
    }, 900);
  }
  return {
    list: async (_flowId, afterSeq, limit) => {
      const after = messages.filter((m) => afterSeq == null || m.seq > afterSeq);
      return { messages: after.slice(0, limit), total: messages.length };
    },
    subscribe: (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    payload: async (_flowId, seq) => ({
      data: base64(fixture.payloads[seq] ?? new Uint8Array()),
      truncated: false,
    }),
    decodeGrpc: async (_flowId, seq, schemaless) => {
      const entry = fixture.decoded?.[seq];
      if (entry == null) throw new Error(`Message ${seq} is not a gRPC message`);
      return schemaless ? entry.schemaless : entry.decoded;
    },
  };
}
