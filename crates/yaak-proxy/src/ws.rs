//! WebSocket capture: after the `101`, the upgraded connections are relayed byte for byte, and
//! a frame parser on each direction records every frame as it passes. The parser reads a copy
//! of what was already written on, so it never holds bytes back or changes them.

use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::time::Instant;

use flate2::{Decompress, FlushDecompress, Status};
use hyper::header::{HeaderMap, SEC_WEBSOCKET_EXTENSIONS};
use hyper::upgrade::OnUpgrade;
use hyper_util::rt::TokioIo;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::messages::{Capped, MessageDirection, MessageKind, StreamMessage};
use crate::{Engine, ProxyEvent};

const OP_CONTINUATION: u8 = 0x0;
const OP_TEXT: u8 = 0x1;
const OP_BINARY: u8 = 0x2;
const OP_CLOSE: u8 = 0x8;
const OP_PING: u8 = 0x9;
const OP_PONG: u8 = 0xA;

/// The most a control frame carries (RFC 6455 5.5).
const MAX_CONTROL_PAYLOAD: usize = 125;

/// The tail permessage-deflate strips from each compressed message (RFC 7692 7.2.2).
const DEFLATE_TAIL: [u8; 4] = [0x00, 0x00, 0xff, 0xff];

/// permessage-deflate as the server accepted it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Deflate {
    client_no_context_takeover: bool,
    server_no_context_takeover: bool,
}

/// The permessage-deflate parameters in the server's `Sec-WebSocket-Extensions`, if it accepted
/// the extension.
pub(crate) fn negotiated_deflate(headers: &HeaderMap) -> Option<Deflate> {
    let extensions =
        headers.get_all(SEC_WEBSOCKET_EXTENSIONS).iter().filter_map(|v| v.to_str().ok());
    for extension in extensions.flat_map(|v| v.split(',')) {
        let mut params = extension.split(';').map(str::trim);
        if !params.next().is_some_and(|name| name.eq_ignore_ascii_case("permessage-deflate")) {
            continue;
        }
        let mut deflate = Deflate::default();
        for param in params {
            let name = param.split('=').next().unwrap_or_default().trim();
            if name.eq_ignore_ascii_case("client_no_context_takeover") {
                deflate.client_no_context_takeover = true;
            } else if name.eq_ignore_ascii_case("server_no_context_takeover") {
                deflate.server_no_context_takeover = true;
            }
        }
        return Some(deflate);
    }
    None
}

/// One WebSocket flow, shared by its two directions. It ends once both sides have sent a close
/// frame, or when the connection does, whichever is first.
pub(crate) struct WsFlow {
    id: u64,
    start: Instant,
    engine: Arc<Engine>,
    /// A bit per direction that has sent a close frame.
    closes: AtomicU8,
    ended: AtomicBool,
}

impl WsFlow {
    pub(crate) fn new(id: u64, start: Instant, engine: Arc<Engine>) -> Self {
        Self { id, start, engine, closes: AtomicU8::new(0), ended: AtomicBool::new(false) }
    }

    fn emit(&self, message: StreamMessage) {
        if !self.ended.load(Ordering::Relaxed) {
            self.engine.emit(ProxyEvent::Message { id: self.id, message });
        }
    }

    fn closed(&self, direction: MessageDirection) {
        let bit = match direction {
            MessageDirection::Client => 1,
            MessageDirection::Server => 2,
        };
        if self.closes.fetch_or(bit, Ordering::Relaxed) | bit == 3 {
            self.end(None);
        }
    }

    pub(crate) fn end(&self, error: Option<String>) {
        if !self.ended.swap(true, Ordering::Relaxed) {
            self.engine.emit(ProxyEvent::StreamEnd {
                id: self.id,
                elapsed_ms: self.start.elapsed().as_millis() as u64,
                error,
            });
        }
    }
}

/// Relays an upgraded WebSocket connection, recording its frames on `flow`, and ends the flow
/// when the connection ends.
pub(crate) async fn relay(
    client: OnUpgrade,
    upstream: OnUpgrade,
    flow: Arc<WsFlow>,
    deflate: Option<Deflate>,
) -> io::Result<()> {
    let (client, upstream) = match tokio::try_join!(client, upstream) {
        Ok(joined) => joined,
        Err(e) => {
            flow.end(Some(e.to_string()));
            return Err(io::Error::other(e));
        }
    };
    let (client_read, client_write) = tokio::io::split(TokioIo::new(client));
    let (upstream_read, upstream_write) = tokio::io::split(TokioIo::new(upstream));
    let limit = flow.engine.capture_body_limit;
    let outbound = FrameParser::new(
        MessageDirection::Client,
        flow.clone(),
        limit,
        deflate.map(|d| d.client_no_context_takeover),
    );
    let inbound = FrameParser::new(
        MessageDirection::Server,
        flow.clone(),
        limit,
        deflate.map(|d| d.server_no_context_takeover),
    );
    let result = tokio::try_join!(
        pump(client_read, upstream_write, outbound),
        pump(upstream_read, client_write, inbound),
    );
    flow.end(result.as_ref().err().map(ToString::to_string));
    result.map(|_| ())
}

/// Copies `from` to `to`, then shows the parser what went through. At the end of `from`, closes
/// `to` for writing, and the other direction carries on until it ends too.
async fn pump<R, W>(mut from: R, mut to: W, mut parser: FrameParser) -> io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut buf = vec![0u8; 16 * 1024];
    loop {
        let n = from.read(&mut buf).await?;
        if n == 0 {
            let _ = to.shutdown().await;
            return Ok(());
        }
        to.write_all(&buf[..n]).await?;
        to.flush().await?;
        parser.feed(&buf[..n]);
    }
}

struct Frame {
    fin: bool,
    opcode: u8,
    mask: Option<[u8; 4]>,
    remaining: u64,
    offset: usize,
}

/// A data message being reassembled from its frames.
struct Assembly {
    opcode: u8,
    compressed: bool,
    size: u64,
    payload: Capped,
    error: Option<String>,
}

/// One direction's inflate context, kept across messages unless the side that sends them
/// negotiated no context takeover.
struct Inflater {
    decompress: Decompress,
    no_context_takeover: bool,
    /// Inflating failed, so the context is lost for the messages after.
    failed: bool,
}

impl Inflater {
    fn inflate(&mut self, mut input: &[u8], out: &mut Capped) -> Result<(), String> {
        let mut buf = [0u8; 8192];
        loop {
            let (read_before, written_before) =
                (self.decompress.total_in(), self.decompress.total_out());
            let status = self
                .decompress
                .decompress(input, &mut buf, FlushDecompress::Sync)
                .map_err(|e| e.to_string())?;
            let read = (self.decompress.total_in() - read_before) as usize;
            let written = (self.decompress.total_out() - written_before) as usize;
            out.push(&buf[..written]);
            input = &input[read..];
            if status == Status::StreamEnd {
                // A final block ends the deflate stream; the next message starts a new one.
                self.decompress.reset(false);
            }
            if (input.is_empty() && written < buf.len()) || (read == 0 && written == 0) {
                return Ok(());
            }
        }
    }
}

/// Reads WebSocket frames (RFC 6455 5.2) from one direction's bytes, records each message and
/// control frame. Stops recording at a frame it cannot read, as the stream is then unknown.
struct FrameParser {
    direction: MessageDirection,
    flow: Arc<WsFlow>,
    limit: usize,
    header: Vec<u8>,
    frame: Option<Frame>,
    message: Option<Assembly>,
    control: Vec<u8>,
    inflater: Option<Inflater>,
    broken: bool,
}

/// The length of the frame header that starts with `header`, once its first two bytes are in.
fn header_len(header: &[u8]) -> Option<usize> {
    let second = *header.get(1)?;
    let length = match second & 0x7f {
        126 => 2,
        127 => 8,
        _ => 0,
    };
    let mask = if second & 0x80 != 0 { 4 } else { 0 };
    Some(2 + length + mask)
}

impl FrameParser {
    fn new(
        direction: MessageDirection,
        flow: Arc<WsFlow>,
        limit: usize,
        no_context_takeover: Option<bool>,
    ) -> Self {
        Self {
            direction,
            flow,
            limit,
            header: Vec::with_capacity(14),
            frame: None,
            message: None,
            control: Vec::new(),
            inflater: no_context_takeover.map(|no_context_takeover| Inflater {
                decompress: Decompress::new(false),
                no_context_takeover,
                failed: false,
            }),
            broken: false,
        }
    }

    fn feed(&mut self, mut data: &[u8]) {
        while !data.is_empty() && !self.broken {
            let Some(frame) = self.frame.as_mut() else {
                let need = header_len(&self.header).unwrap_or(2);
                let take = (need - self.header.len()).min(data.len());
                self.header.extend_from_slice(&data[..take]);
                data = &data[take..];
                if header_len(&self.header) == Some(self.header.len()) {
                    self.begin_frame();
                }
                continue;
            };
            let n = frame.remaining.min(data.len() as u64) as usize;
            let mut chunk = data[..n].to_vec();
            if let Some(mask) = frame.mask {
                for (i, byte) in chunk.iter_mut().enumerate() {
                    *byte ^= mask[(frame.offset + i) % 4];
                }
            }
            frame.offset += n;
            frame.remaining -= n as u64;
            let (fin, opcode, done) = (frame.fin, frame.opcode, frame.remaining == 0);
            data = &data[n..];
            self.payload(opcode, &chunk);
            if done {
                self.frame = None;
                self.end_frame(fin, opcode);
            }
        }
    }

    fn begin_frame(&mut self) {
        let header = std::mem::take(&mut self.header);
        let (first, second) = (header[0], header[1]);
        let fin = first & 0x80 != 0;
        let rsv1 = first & 0x40 != 0;
        let opcode = first & 0x0f;
        let (length, rest) = match second & 0x7f {
            126 => (u16::from_be_bytes([header[2], header[3]]) as u64, &header[4..]),
            127 => (u64::from_be_bytes(header[2..10].try_into().unwrap()), &header[10..]),
            n => (n as u64, &header[2..]),
        };
        let mask = (second & 0x80 != 0).then(|| [rest[0], rest[1], rest[2], rest[3]]);
        self.header = header;
        self.header.clear();

        match opcode {
            OP_CLOSE | OP_PING | OP_PONG => self.control.clear(),
            OP_TEXT | OP_BINARY => {
                self.message = Some(Assembly {
                    opcode,
                    compressed: rsv1 && self.inflater.is_some(),
                    size: 0,
                    payload: Capped::new(self.limit),
                    error: None,
                });
            }
            OP_CONTINUATION => {}
            // An opcode no extension here defines: what follows cannot be read.
            _ => {
                self.broken = true;
                return;
            }
        }
        self.frame = Some(Frame { fin, opcode, mask, remaining: length, offset: 0 });
        if length == 0 {
            self.frame = None;
            self.end_frame(fin, opcode);
        }
    }

    fn payload(&mut self, opcode: u8, chunk: &[u8]) {
        if opcode >= OP_CLOSE {
            // At most what a control frame may carry, however long a broken one claims to be.
            let room = MAX_CONTROL_PAYLOAD.saturating_sub(self.control.len());
            self.control.extend_from_slice(&chunk[..chunk.len().min(room)]);
            return;
        }
        let Some(message) = self.message.as_mut() else {
            return;
        };
        message.size += chunk.len() as u64;
        match self.inflater.as_mut().filter(|_| message.compressed) {
            Some(inflater) if !inflater.failed => {
                if let Err(e) = inflater.inflate(chunk, &mut message.payload) {
                    inflater.failed = true;
                    message.error = Some(format!("Failed to inflate the message: {e}"));
                }
            }
            Some(_) => {
                message.payload.push(chunk);
                message.error.get_or_insert_with(|| {
                    "Not inflated: an earlier message failed to, which lost the context".into()
                });
            }
            None => message.payload.push(chunk),
        }
    }

    fn end_frame(&mut self, fin: bool, opcode: u8) {
        if opcode >= OP_CLOSE {
            let payload = std::mem::take(&mut self.control);
            let kind = match opcode {
                OP_PING => MessageKind::WebSocketPing,
                OP_PONG => MessageKind::WebSocketPong,
                _ => {
                    let code =
                        (payload.len() >= 2).then(|| u16::from_be_bytes([payload[0], payload[1]]));
                    let reason = String::from_utf8_lossy(payload.get(2..).unwrap_or_default());
                    MessageKind::WebSocketClose { code, reason: reason.into_owned() }
                }
            };
            let mut message = StreamMessage::new(self.direction, kind);
            message.size = payload.len() as u64;
            message.data = payload.into();
            self.flow.emit(message);
            if opcode == OP_CLOSE {
                self.flow.closed(self.direction);
            }
            return;
        }
        if !fin {
            return;
        }
        let Some(mut assembly) = self.message.take() else {
            return;
        };
        if assembly.compressed
            && let Some(inflater) = self.inflater.as_mut()
        {
            if !inflater.failed
                && let Err(e) = inflater.inflate(&DEFLATE_TAIL, &mut assembly.payload)
            {
                inflater.failed = true;
                assembly.error = Some(format!("Failed to inflate the message: {e}"));
            }
            if inflater.no_context_takeover && !inflater.failed {
                inflater.decompress.reset(false);
            }
        }
        let kind = if assembly.opcode == OP_TEXT {
            MessageKind::WebSocketText
        } else {
            MessageKind::WebSocketBinary
        };
        let mut message = StreamMessage::new(self.direction, kind);
        let (data, truncated) = assembly.payload.take();
        message.size = assembly.size;
        message.data = data;
        message.truncated = truncated;
        message.compressed = assembly.compressed;
        message.error = assembly.error;
        self.flow.emit(message);
    }
}
