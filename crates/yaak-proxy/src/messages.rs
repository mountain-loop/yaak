use std::time::SystemTime;

use bytes::{Bytes, BytesMut};

/// The streaming protocol a flow carries, recorded as messages beside its bodies.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    /// An HTTP/1.1 WebSocket, after its `101 Switching Protocols`.
    WebSocket,
    /// A `text/event-stream` response.
    Sse,
    /// `application/grpc`, over HTTP/2.
    Grpc,
    /// `application/grpc-web`, binary or base64 (`-text`).
    GrpcWeb,
}

/// Which side sent a message.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageDirection {
    Client,
    Server,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MessageKind {
    WebSocketText,
    WebSocketBinary,
    WebSocketPing,
    WebSocketPong,
    WebSocketClose {
        code: Option<u16>,
        reason: String,
    },
    SseEvent {
        event: Option<String>,
        id: Option<String>,
        retry: Option<u64>,
        /// The event's lines as they came, comments included, up to [`RAW_LIMIT`] bytes.
        raw: String,
    },
    GrpcMessage,
    /// The status of a gRPC call: its HTTP/2 trailers, the headers of a trailers-only response,
    /// or a gRPC-Web trailer frame. The payload is the trailers as `name: value` lines.
    GrpcTrailers {
        status: Option<i32>,
        message: Option<String>,
    },
}

/// One message of a stream, as it passed through.
#[derive(Debug, Clone)]
pub struct StreamMessage {
    pub direction: MessageDirection,
    pub kind: MessageKind,
    pub at: SystemTime,
    /// Bytes it took on the wire: the frames' payloads, the event's lines, the length-prefixed
    /// message without its prefix.
    pub size: u64,
    /// The payload decoded: unmasked, reassembled, inflated or decompressed. Cut at the
    /// engine's `capture_body_limit`.
    pub data: Bytes,
    /// `data` is cut short.
    pub truncated: bool,
    /// It was compressed on the wire: permessage-deflate, or gRPC's compressed flag.
    pub compressed: bool,
    /// Why the payload could not be decoded; `data` is then what could be read of it.
    pub error: Option<String>,
}

/// Bytes kept of an SSE event's raw lines.
pub const RAW_LIMIT: usize = 4096;

impl StreamMessage {
    pub(crate) fn new(direction: MessageDirection, kind: MessageKind) -> Self {
        Self {
            direction,
            kind,
            at: SystemTime::now(),
            size: 0,
            data: Bytes::new(),
            truncated: false,
            compressed: false,
            error: None,
        }
    }
}

/// A payload collected up to a limit, counting what is left out.
pub(crate) struct Capped {
    pub(crate) data: BytesMut,
    pub(crate) truncated: bool,
    limit: usize,
}

impl Capped {
    pub(crate) fn new(limit: usize) -> Self {
        Self { data: BytesMut::new(), truncated: false, limit }
    }

    pub(crate) fn push(&mut self, bytes: &[u8]) {
        let room = self.limit.saturating_sub(self.data.len());
        if bytes.len() > room {
            self.truncated = true;
        }
        self.data.extend_from_slice(&bytes[..bytes.len().min(room)]);
    }

    pub(crate) fn take(&mut self) -> (Bytes, bool) {
        let truncated = std::mem::take(&mut self.truncated);
        (self.data.split().freeze(), truncated)
    }
}
