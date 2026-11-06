//! gRPC and gRPC-Web: the length-prefixed messages of each direction's body, and the call's
//! status from its trailers.

use std::io::Read;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use bytes::Bytes;
use flate2::read::{GzDecoder, ZlibDecoder};
use hyper::header::HeaderMap;

use crate::decode::Decoding;
use crate::messages::{Capped, MessageDirection, MessageKind, StreamKind, StreamMessage};

/// gRPC's compressed flag, in the first byte of each message's prefix.
const FLAG_COMPRESSED: u8 = 0x01;
/// gRPC-Web's flag for the frame that carries the trailers.
const FLAG_TRAILERS: u8 = 0x80;
const PREFIX_LEN: usize = 5;

/// The gRPC flavor a request's `Content-Type` names, and whether it is gRPC-Web's base64 one.
pub fn detect(content_type: Option<&str>) -> Option<(StreamKind, bool)> {
    let content_type = content_type?.trim().to_ascii_lowercase();
    let essence = content_type.split(';').next().unwrap_or_default().trim();
    if let Some(rest) = essence.strip_prefix("application/grpc-web") {
        return match rest {
            "" | "+proto" => Some((StreamKind::GrpcWeb, false)),
            "-text" | "-text+proto" => Some((StreamKind::GrpcWeb, true)),
            _ => None,
        };
    }
    match essence.strip_prefix("application/grpc") {
        Some("" | "+proto") => Some((StreamKind::Grpc, false)),
        _ => None,
    }
}

/// `/package.Service/Method` as its service and method.
pub fn service_and_method(path: &str) -> Option<(&str, &str)> {
    let path = path.split('?').next()?;
    let (service, method) = path.strip_prefix('/')?.split_once('/')?;
    (!service.is_empty() && !method.is_empty() && !method.contains('/'))
        .then_some((service, method))
}

pub(crate) struct GrpcParser {
    direction: MessageDirection,
    /// `grpc-encoding`, what a compressed message is compressed with.
    encoding: Option<String>,
    /// gRPC-Web's base64 flavor, with base64 not yet a whole quantum.
    base64: Option<Vec<u8>>,
    prefix: Vec<u8>,
    /// The message being read: its flag, length, bytes left, and payload.
    current: Option<(u8, u32, u32, Capped)>,
    limit: usize,
    broken: bool,
    /// The body's `Content-Encoding`, which gRPC-Web may use, undone before anything else.
    decoding: Decoding,
}

impl GrpcParser {
    /// Reads a body sent with `content_encoding`, as a gRPC-Web one can be.
    pub(crate) fn with_content_encoding(mut self, content_encoding: Option<&str>) -> Self {
        self.decoding = Decoding::new(content_encoding, self.limit);
        self
    }

    pub(crate) fn new(
        direction: MessageDirection,
        encoding: Option<&str>,
        text: bool,
        limit: usize,
    ) -> Self {
        Self {
            direction,
            encoding: encoding.map(|e| e.trim().to_ascii_lowercase()),
            base64: text.then(Vec::new),
            prefix: Vec::with_capacity(PREFIX_LEN),
            current: None,
            limit,
            broken: false,
            decoding: Decoding::Identity,
        }
    }

    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Vec<StreamMessage> {
        match std::mem::replace(&mut self.decoding, Decoding::Unsupported) {
            Decoding::Identity => {
                self.decoding = Decoding::Identity;
                self.feed_decoded(bytes)
            }
            // An encoding this cannot undo leaves the frames unreadable.
            Decoding::Unsupported => Vec::new(),
            // A piece at a time, so a highly compressed body never expands all at once.
            Decoding::Decoder(mut decoder) => {
                let mut messages = Vec::new();
                let decoded = decoder.feed(bytes, &mut |piece| {
                    messages.extend(self.feed_decoded(piece));
                });
                if decoded.is_ok() {
                    self.decoding = Decoding::Decoder(decoder);
                }
                messages
            }
        }
    }

    /// Reads bytes with any Content-Encoding undone: base64 first for gRPC-Web's text flavor,
    /// then the frames.
    fn feed_decoded(&mut self, bytes: &[u8]) -> Vec<StreamMessage> {
        if self.broken {
            return Vec::new();
        }
        let Some(pending) = self.base64.as_mut() else {
            return self.read(bytes);
        };
        pending.extend(bytes.iter().filter(|b| !b.is_ascii_whitespace()));
        // Each response chunk is base64 of its own, padded, so padding can come mid-stream:
        // decoded up to and including each padded quantum.
        let whole = pending.len() / 4 * 4;
        let mut decoded = Vec::new();
        let mut start = 0;
        for end in (4..=whole).step_by(4) {
            if pending[end - 1] == b'=' || end == whole {
                match BASE64.decode(&pending[start..end]) {
                    Ok(bytes) => decoded.extend(bytes),
                    Err(_) => {
                        self.broken = true;
                        return Vec::new();
                    }
                }
                start = end;
            }
        }
        pending.drain(..whole);
        self.read(&decoded)
    }

    fn read(&mut self, mut bytes: &[u8]) -> Vec<StreamMessage> {
        let mut messages = Vec::new();
        while !bytes.is_empty() {
            let Some((_, _, remaining, payload)) = self.current.as_mut() else {
                let take = (PREFIX_LEN - self.prefix.len()).min(bytes.len());
                self.prefix.extend_from_slice(&bytes[..take]);
                bytes = &bytes[take..];
                if self.prefix.len() == PREFIX_LEN {
                    let flag = self.prefix[0];
                    let length = u32::from_be_bytes(self.prefix[1..5].try_into().unwrap());
                    self.prefix.clear();
                    self.current = Some((flag, length, length, Capped::new(self.limit)));
                    if length == 0 {
                        messages.push(self.finish());
                    }
                }
                continue;
            };
            let n = (*remaining as usize).min(bytes.len());
            payload.push(&bytes[..n]);
            *remaining -= n as u32;
            bytes = &bytes[n..];
            if *remaining == 0 {
                messages.push(self.finish());
            }
        }
        messages
    }

    /// The body ended: a message it ended partway through, as much of it as came, cut short and
    /// as it came (not decompressed), so its bytes are still recorded. A prefix alone, with none
    /// of a message's bytes yet, carries nothing to keep.
    pub(crate) fn end(&mut self) -> Option<StreamMessage> {
        let (flag, length, remaining, mut payload) = self.current.take()?;
        let (data, _) = payload.take();
        let compressed = flag & FLAG_COMPRESSED != 0;
        // A gRPC-Web trailers frame stays one, its status read from what came when it can be.
        let mut message = if flag & FLAG_TRAILERS != 0 {
            let text = if compressed { "".into() } else { String::from_utf8_lossy(&data) };
            trailers_message(self.direction, &text)
        } else {
            StreamMessage::new(self.direction, MessageKind::GrpcMessage)
        };
        message.data = data;
        message.size = u64::from(length);
        message.truncated = true;
        message.compressed = compressed;
        message.error = Some(format!(
            "The body ended partway through this message, {} of its {length} bytes in",
            length - remaining
        ));
        Some(message)
    }

    fn finish(&mut self) -> StreamMessage {
        let (flag, length, _, mut payload) = self.current.take().expect("a message being read");
        let (data, truncated) = payload.take();
        let compressed = flag & FLAG_COMPRESSED != 0;
        let (data, truncated, error) =
            if compressed { self.decompress(data, truncated) } else { (data, truncated, None) };
        // gRPC-Web's trailers, read once decompressed, as they can be.
        let mut message = if flag & FLAG_TRAILERS != 0 {
            // Trailers that would not decompress are kept as they came, with no status read.
            let text = if error.is_none() { String::from_utf8_lossy(&data) } else { "".into() };
            let mut message = trailers_message(self.direction, &text);
            message.data = data;
            message
        } else {
            let mut message = StreamMessage::new(self.direction, MessageKind::GrpcMessage);
            message.data = data;
            message
        };
        message.size = u64::from(length);
        message.truncated = truncated;
        message.compressed = compressed;
        message.error = error;
        message
    }

    /// A compressed message's payload decompressed with `grpc-encoding`, whether that is cut at
    /// the limit, and why it could not be decompressed, when it could not: then the payload as
    /// it came.
    fn decompress(&self, data: Bytes, truncated: bool) -> (Bytes, bool, Option<String>) {
        let mut decoded = Vec::new();
        let take = self.limit as u64 + 1;
        let result = match self.encoding.as_deref() {
            Some("gzip") => GzDecoder::new(&data[..]).take(take).read_to_end(&mut decoded),
            Some("deflate") => ZlibDecoder::new(&data[..]).take(take).read_to_end(&mut decoded),
            other => {
                let error =
                    format!("Compressed with {}, not decoded", other.unwrap_or("no encoding"));
                return (data, truncated, Some(error));
            }
        };
        match result {
            Ok(_) if !truncated => {
                let truncated = decoded.len() > self.limit;
                decoded.truncate(self.limit);
                (decoded.into(), truncated, None)
            }
            // A payload cut at the limit cannot be decompressed whole.
            Ok(_) => (data, truncated, Some("Too large to decompress".into())),
            Err(e) => (data, truncated, Some(format!("Failed to decompress the message: {e}"))),
        }
    }
}

/// The trailers message for `grpc-status` and `grpc-message` in `headers`, the HTTP/2 trailers
/// or a trailers-only response's headers. None when they carry no status.
pub(crate) fn trailers_from_headers(headers: &HeaderMap) -> Option<StreamMessage> {
    headers.get("grpc-status")?;
    let text: String = headers
        .iter()
        .map(|(name, value)| format!("{name}: {}\r\n", String::from_utf8_lossy(value.as_bytes())))
        .collect();
    let mut message = trailers_message(MessageDirection::Server, &text);
    message.size = text.len() as u64;
    Some(message)
}

/// Trailers written as `name: value` lines, as gRPC-Web frames them.
fn trailers_message(direction: MessageDirection, text: &str) -> StreamMessage {
    let mut status = None;
    let mut status_message = None;
    for line in text.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if name.trim().eq_ignore_ascii_case("grpc-status") {
            status = value.parse().ok();
        } else if name.trim().eq_ignore_ascii_case("grpc-message") {
            status_message = Some(percent_decode(value));
        }
    }
    let kind = MessageKind::GrpcTrailers { status, message: status_message };
    let mut message = StreamMessage::new(direction, kind);
    message.data = text.to_string().into();
    message
}

/// `grpc-message` is percent-encoded UTF-8.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && let Some(byte) =
                value.get(i + 1..i + 3).and_then(|hex| u8::from_str_radix(hex, 16).ok())
        {
            out.push(byte);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(flag: u8, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![flag];
        out.extend((payload.len() as u32).to_be_bytes());
        out.extend(payload);
        out
    }

    /// A body that ends partway through a message keeps what came of it, cut short.
    #[test]
    fn a_message_cut_off_by_the_end_is_kept() {
        let mut parser = GrpcParser::new(MessageDirection::Server, None, false, 1024);
        let mut stream = frame(0, b"whole");
        stream.extend(&frame(0, b"half of it")[..8]);
        let messages = parser.feed(&stream);
        assert_eq!(messages.len(), 1);
        let cut = parser.end().expect("the unfinished message");
        assert_eq!((&cut.data[..], cut.size, cut.truncated), (&b"hal"[..], 10, true));
        assert!(cut.error.as_deref().unwrap().contains("3 of its 10 bytes"));
        // Nothing unfinished: nothing more.
        assert!(parser.end().is_none());
        // A trailers frame cut short is still a trailers frame.
        let mut parser = GrpcParser::new(MessageDirection::Server, None, false, 1024);
        parser.feed(&frame(FLAG_TRAILERS, b"grpc-status: 0\r\n")[..12]);
        let cut = parser.end().expect("the unfinished trailers");
        assert!(matches!(cut.kind, MessageKind::GrpcTrailers { .. }));
        assert_eq!((&cut.data[..], cut.truncated), (&b"grpc-st"[..], true));
        // A prefix alone carries none of a message's bytes.
        parser.feed(&[0, 0]);
        assert!(parser.end().is_none());
    }

    #[test]
    fn detects_flavors() {
        assert_eq!(detect(Some("application/grpc")), Some((StreamKind::Grpc, false)));
        assert_eq!(detect(Some("application/grpc+proto")), Some((StreamKind::Grpc, false)));
        assert_eq!(detect(Some("application/grpc-web+proto")), Some((StreamKind::GrpcWeb, false)));
        assert_eq!(detect(Some("application/grpc-web-text")), Some((StreamKind::GrpcWeb, true)));
        assert_eq!(detect(Some("application/grpc+json")), None);
        assert_eq!(detect(Some("application/json")), None);
        assert_eq!(service_and_method("/pkg.Greeter/SayHello"), Some(("pkg.Greeter", "SayHello")));
        assert_eq!(service_and_method("/"), None);
    }

    #[test]
    fn splits_messages_across_chunks() {
        let mut bytes = frame(0, b"hello");
        bytes.extend(frame(0, b""));
        bytes.extend(frame(0, b"world!"));
        let mut parser = GrpcParser::new(MessageDirection::Client, None, false, 1024);
        let mut messages = Vec::new();
        for byte in bytes {
            messages.extend(parser.feed(&[byte]));
        }
        let payloads: Vec<&[u8]> = messages.iter().map(|m| &m.data[..]).collect();
        assert_eq!(payloads, vec![&b"hello"[..], b"", b"world!"]);
    }

    #[test]
    fn decompresses_gzip_and_reads_web_trailers_in_base64() {
        use flate2::write::GzEncoder;
        use std::io::Write;
        let mut gz = GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(b"squeezed").unwrap();
        let compressed = gz.finish().unwrap();
        // Two separately padded base64 chunks, as gRPC-Web text responses come.
        let first = BASE64.encode(frame(FLAG_COMPRESSED, &compressed));
        let second =
            BASE64.encode(frame(FLAG_TRAILERS, b"grpc-status: 5\r\ngrpc-message: not%20found\r\n"));
        let mut parser = GrpcParser::new(MessageDirection::Server, Some("gzip"), true, 1024);
        let mut messages = parser.feed(first.as_bytes());
        messages.extend(parser.feed(second.as_bytes()));
        assert_eq!(&messages[0].data[..], b"squeezed");
        assert!(messages[0].compressed);
        assert_eq!(
            messages[1].kind,
            MessageKind::GrpcTrailers { status: Some(5), message: Some("not found".into()) }
        );
    }

    #[test]
    fn compressed_web_trailers_are_read_once_decompressed() {
        use flate2::write::GzEncoder;
        use std::io::Write;
        let mut gz = GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(b"grpc-status: 5\r\n").unwrap();
        let trailers = frame(FLAG_TRAILERS | FLAG_COMPRESSED, &gz.finish().unwrap());
        let mut parser = GrpcParser::new(MessageDirection::Server, Some("gzip"), false, 1024);
        let messages = parser.feed(&trailers);
        assert_eq!(messages[0].kind, MessageKind::GrpcTrailers { status: Some(5), message: None });
        assert!(messages[0].compressed && messages[0].error.is_none());
    }
}
