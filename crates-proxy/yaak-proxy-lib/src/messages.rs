//! The messages of streaming flows: WebSocket frames, server-sent events, and gRPC messages and
//! trailers. Each is a row of `flow_messages`, its payload inline when small, else in
//! `blobs.sqlite`. Like flows, they are never pruned; clearing removes them with their flow.

use crate::db::ProxyQueryManager;
use chrono::{DateTime, NaiveDateTime, Utc};
use rusqlite::{Row, params};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::generate_prefixed_id;
use yaak_models::blob_manager::BlobManager;

/// Payloads up to this many bytes are kept in the row; larger ones in `blobs.sqlite`.
pub const INLINE_LIMIT: usize = 4096;
/// Characters of a text payload kept as its preview.
pub const PREVIEW_CHARS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum MessageDirection {
    Client,
    Server,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_models.ts")]
pub enum MessageKind {
    WebsocketText,
    WebsocketBinary,
    WebsocketPing,
    WebsocketPong,
    WebsocketClose,
    SseEvent,
    GrpcMessage,
    GrpcTrailers,
}

const KINDS: [MessageKind; 8] = [
    MessageKind::WebsocketText,
    MessageKind::WebsocketBinary,
    MessageKind::WebsocketPing,
    MessageKind::WebsocketPong,
    MessageKind::WebsocketClose,
    MessageKind::SseEvent,
    MessageKind::GrpcMessage,
    MessageKind::GrpcTrailers,
];

impl MessageKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WebsocketText => "websocket_text",
            Self::WebsocketBinary => "websocket_binary",
            Self::WebsocketPing => "websocket_ping",
            Self::WebsocketPong => "websocket_pong",
            Self::WebsocketClose => "websocket_close",
            Self::SseEvent => "sse_event",
            Self::GrpcMessage => "grpc_message",
            Self::GrpcTrailers => "grpc_trailers",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        KINDS.into_iter().find(|k| k.as_str() == s)
    }

    /// The WebSocket opcode, for HAR's `_webSocketMessages`.
    pub fn websocket_opcode(self) -> Option<u8> {
        match self {
            Self::WebsocketText => Some(1),
            Self::WebsocketBinary => Some(2),
            Self::WebsocketClose => Some(8),
            Self::WebsocketPing => Some(9),
            Self::WebsocketPong => Some(10),
            _ => None,
        }
    }
}

/// What a kind of message carries beside its payload. Fields that do not apply are left out.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct MessageMeta {
    /// A WebSocket close frame's status code.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub close_code: Option<u16>,
    /// A WebSocket close frame's reason.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub close_reason: Option<String>,
    /// An SSE event's `event` field.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub event: Option<String>,
    /// An SSE event's `id` field.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub event_id: Option<String>,
    /// An SSE event's `retry` field, in milliseconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "number")]
    pub retry: Option<u64>,
    /// An SSE event's lines as they came, comments included, up to 4 KB.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub raw: Option<String>,
    /// gRPC trailers' `grpc-status`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub grpc_status: Option<i32>,
    /// gRPC trailers' `grpc-message`, decoded.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub grpc_message: Option<String>,
}

/// One message of a streaming flow. Its payload is fetched on its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct FlowMessage {
    pub id: String,
    pub flow_id: String,
    /// Its place in the flow, from 0, in the order messages passed the proxy.
    #[ts(type = "number")]
    pub seq: i64,
    pub direction: MessageDirection,
    pub kind: MessageKind,
    /// When it had passed the proxy whole.
    pub timestamp: NaiveDateTime,
    /// Bytes it took on the wire: the frames' payloads, the event's lines, the gRPC message
    /// without its prefix.
    #[ts(type = "number")]
    pub size: i64,
    /// Bytes of payload stored: unmasked, reassembled, inflated or decompressed, and cut at the
    /// capture limit.
    #[ts(type = "number")]
    pub stored_size: i64,
    /// The stored payload is cut short at the capture limit.
    pub truncated: bool,
    /// It was compressed on the wire (permessage-deflate, gRPC's compressed flag); the payload is
    /// stored decompressed unless `error` says otherwise.
    pub compressed: bool,
    /// Why the payload could not be decoded or stored.
    pub error: Option<String>,
    pub meta: MessageMeta,
    /// The payload's start as text, when it is text.
    pub preview: Option<String>,
}

impl FlowMessage {
    /// The message as it is stored, from the engine's.
    pub fn from_engine(flow_id: &str, seq: i64, message: &yaak_proxy::StreamMessage) -> Self {
        use yaak_proxy::MessageKind as K;
        let mut meta = MessageMeta::default();
        let kind = match &message.kind {
            K::WebSocketText => MessageKind::WebsocketText,
            K::WebSocketBinary => MessageKind::WebsocketBinary,
            K::WebSocketPing => MessageKind::WebsocketPing,
            K::WebSocketPong => MessageKind::WebsocketPong,
            K::WebSocketClose { code, reason } => {
                meta.close_code = *code;
                meta.close_reason = Some(reason.clone()).filter(|r| !r.is_empty());
                MessageKind::WebsocketClose
            }
            K::SseEvent { event, id, retry, raw } => {
                meta.event = event.clone();
                meta.event_id = id.clone();
                meta.retry = *retry;
                meta.raw = Some(raw.clone());
                MessageKind::SseEvent
            }
            K::GrpcMessage => MessageKind::GrpcMessage,
            K::GrpcTrailers { status, message } => {
                meta.grpc_status = *status;
                meta.grpc_message = message.clone();
                MessageKind::GrpcTrailers
            }
        };
        let direction = match message.direction {
            yaak_proxy::MessageDirection::Client => MessageDirection::Client,
            yaak_proxy::MessageDirection::Server => MessageDirection::Server,
        };
        let preview = match kind {
            // Binary by nature, however it happens to read.
            MessageKind::WebsocketBinary | MessageKind::GrpcMessage => None,
            MessageKind::WebsocketClose => meta.close_reason.clone(),
            _ => text_preview(&message.data, message.truncated),
        };
        Self {
            id: generate_prefixed_id("fm"),
            flow_id: flow_id.to_string(),
            seq,
            direction,
            kind,
            timestamp: DateTime::<Utc>::from(message.at).naive_utc(),
            size: i64::try_from(message.size).unwrap_or(i64::MAX),
            stored_size: message.data.len() as i64,
            truncated: message.truncated,
            compressed: message.compressed,
            error: message.error.clone(),
            meta,
            preview,
        }
    }

    /// Where a payload too large for the row is kept in `blobs.sqlite`.
    pub fn blob_id(&self) -> String {
        format!("{}.msg.{}", self.flow_id, self.id)
    }

    fn from_row(r: &Row) -> rusqlite::Result<Self> {
        let direction: String = r.get("direction")?;
        let kind: String = r.get("kind")?;
        let meta: String = r.get("meta")?;
        Ok(Self {
            id: r.get("id")?,
            flow_id: r.get("flow_id")?,
            seq: r.get("seq")?,
            direction: if direction == "client" {
                MessageDirection::Client
            } else {
                MessageDirection::Server
            },
            kind: MessageKind::parse(&kind).unwrap_or(MessageKind::WebsocketBinary),
            timestamp: r.get("timestamp")?,
            size: r.get("size")?,
            stored_size: r.get("stored_size")?,
            truncated: r.get("truncated")?,
            compressed: r.get("compressed")?,
            error: r.get("error")?,
            meta: serde_json::from_str(&meta).unwrap_or_default(),
            preview: r.get("preview")?,
        })
    }
}

/// The start of `data` as text, if it is UTF-8: a cut can split a character at the end.
fn text_preview(data: &[u8], truncated: bool) -> Option<String> {
    let text = match std::str::from_utf8(data) {
        Ok(text) => text,
        Err(e) if truncated && e.error_len().is_none() => {
            std::str::from_utf8(&data[..e.valid_up_to()]).ok()?
        }
        Err(_) => return None,
    };
    Some(text.chars().take(PREVIEW_CHARS).collect())
}

/// Writes `message`, with its payload in the row when `inline` has it.
pub fn insert(
    conn: &rusqlite::Connection,
    message: &FlowMessage,
    inline: Option<&[u8]>,
) -> rusqlite::Result<()> {
    let meta = serde_json::to_string(&message.meta).unwrap_or_else(|_| "{}".into());
    let direction = match message.direction {
        MessageDirection::Client => "client",
        MessageDirection::Server => "server",
    };
    conn.execute(
        "INSERT INTO flow_messages (id, flow_id, seq, direction, kind, timestamp, size, \
        stored_size, truncated, compressed, error, meta, preview, data) \
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            message.id,
            message.flow_id,
            message.seq,
            direction,
            message.kind.as_str(),
            message.timestamp,
            message.size,
            message.stored_size,
            message.truncated,
            message.compressed,
            message.error,
            meta,
            message.preview,
            inline,
        ],
    )?;
    Ok(())
}

const COLUMNS: &str = "id, flow_id, seq, direction, kind, timestamp, size, stored_size, \
    truncated, compressed, error, meta, preview";

/// A flow's messages in order, after `after_seq` when given, at most `limit` of them.
pub fn list(
    db: &ProxyQueryManager,
    flow_id: &str,
    after_seq: Option<i64>,
    limit: Option<usize>,
) -> Result<Vec<FlowMessage>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let limit = limit.map_or(-1, |l| l.min(i64::MAX as usize) as i64);
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {COLUMNS} FROM flow_messages WHERE flow_id = ?1 AND seq > ?2 \
                ORDER BY seq LIMIT ?3"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![flow_id, after_seq.unwrap_or(-1), limit], FlowMessage::from_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    })
}

/// Messages recorded for a flow.
pub fn count(db: &ProxyQueryManager, flow_id: &str) -> Result<i64, String> {
    db.with_conn(|c| {
        c.conn()
            .resolve()
            .query_row("SELECT COUNT(*) FROM flow_messages WHERE flow_id = ?1", [flow_id], |r| {
                r.get(0)
            })
            .map_err(|e| e.to_string())
    })
}

pub fn find(
    db: &ProxyQueryManager,
    flow_id: &str,
    seq: i64,
) -> Result<Option<FlowMessage>, String> {
    db.with_conn(|c| {
        let conn = c.conn().resolve();
        let found = conn.query_row(
            &format!("SELECT {COLUMNS} FROM flow_messages WHERE flow_id = ?1 AND seq = ?2"),
            params![flow_id, seq],
            FlowMessage::from_row,
        );
        match found {
            Ok(message) => Ok(Some(message)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    })
}

pub fn get(db: &ProxyQueryManager, flow_id: &str, seq: i64) -> Result<FlowMessage, String> {
    find(db, flow_id, seq)?.ok_or_else(|| format!("No message {seq} in flow {flow_id}"))
}

/// A message's stored payload: decoded, and cut at the capture limit.
pub fn payload(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    message: &FlowMessage,
) -> Result<Vec<u8>, String> {
    let inline: Option<Vec<u8>> = db.with_conn(|c| {
        c.conn()
            .resolve()
            .query_row("SELECT data FROM flow_messages WHERE id = ?1", [&message.id], |r| r.get(0))
            .map_err(|e| e.to_string())
    })?;
    if let Some(data) = inline {
        return Ok(data);
    }
    let chunks = blobs.connect().get_chunks(&message.blob_id()).map_err(|e| e.to_string())?;
    Ok(chunks.into_iter().flat_map(|c| c.data).collect())
}
