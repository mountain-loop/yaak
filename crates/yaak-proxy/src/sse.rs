//! Server-sent events (the WHATWG `text/event-stream` format), read from a response body as it
//! streams.

use std::io::Write;

use flate2::write::{GzDecoder, ZlibDecoder};

use crate::messages::{Capped, MessageDirection, MessageKind, RAW_LIMIT, StreamMessage};

/// The response's Content-Encoding, undone before the events are read.
enum Decoder {
    Identity,
    Gzip(GzDecoder<Vec<u8>>),
    Deflate(ZlibDecoder<Vec<u8>>),
    /// One this cannot undo, so no events are read.
    Unsupported,
}

const BOM: &[u8] = b"\xEF\xBB\xBF";
/// Bytes a line may take beyond the capture limit, for its field name.
const LINE_SLACK: usize = 64;

pub(crate) struct SseParser {
    decoder: Decoder,
    line: Capped,
    /// The last chunk ended in a CR, so an LF starting the next ends no second line.
    after_cr: bool,
    event: Option<String>,
    id: Option<String>,
    retry: Option<u64>,
    data: Capped,
    /// `data` fields since the last event, which `data` joins with line feeds.
    data_lines: usize,
    /// A `data` line was longer than could be kept.
    data_truncated: bool,
    /// The start of the stream read so far while it may be a byte order mark; None after.
    bom: Option<Vec<u8>>,
    /// A field was set since the last event.
    any_field: bool,
    raw: Capped,
    size: u64,
}

impl SseParser {
    pub(crate) fn new(content_encoding: Option<&str>, limit: usize) -> Self {
        let decoder = match content_encoding.map(|e| e.trim().to_ascii_lowercase()).as_deref() {
            None | Some("") | Some("identity") => Decoder::Identity,
            Some("gzip") | Some("x-gzip") => Decoder::Gzip(GzDecoder::new(Vec::new())),
            Some("deflate") => Decoder::Deflate(ZlibDecoder::new(Vec::new())),
            Some(_) => Decoder::Unsupported,
        };
        Self {
            decoder,
            // Room for a field name before a value up to the limit.
            line: Capped::new(limit.saturating_add(LINE_SLACK)),
            after_cr: false,
            event: None,
            id: None,
            retry: None,
            data: Capped::new(limit),
            data_lines: 0,
            data_truncated: false,
            bom: Some(Vec::new()),
            any_field: false,
            raw: Capped::new(RAW_LIMIT),
            size: 0,
        }
    }

    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Vec<StreamMessage> {
        let decoded = match &mut self.decoder {
            Decoder::Identity => return self.read(bytes),
            Decoder::Unsupported => return Vec::new(),
            Decoder::Gzip(d) => d.write_all(bytes).map(|_| std::mem::take(d.get_mut())),
            Decoder::Deflate(d) => d.write_all(bytes).map(|_| std::mem::take(d.get_mut())),
        };
        match decoded {
            Ok(decoded) => self.read(&decoded),
            Err(_) => {
                self.decoder = Decoder::Unsupported;
                Vec::new()
            }
        }
    }

    fn read(&mut self, mut bytes: &[u8]) -> Vec<StreamMessage> {
        // One UTF-8 byte order mark at the start of the stream is no part of it, however the
        // chunks split it.
        if let Some(seen) = self.bom.as_mut() {
            let take = (BOM.len() - seen.len()).min(bytes.len());
            seen.extend_from_slice(&bytes[..take]);
            if !BOM.starts_with(seen) {
                let seen = self.bom.take().unwrap_or_default();
                let mut events = self.read(&seen);
                events.extend(self.read(&bytes[take..]));
                return events;
            }
            bytes = &bytes[take..];
            if seen.len() < BOM.len() {
                return Vec::new();
            }
            self.bom = None;
        }

        let mut events = Vec::new();
        let mut i = 0;
        while i < bytes.len() {
            let byte = bytes[i];
            i += 1;
            // The LF of a CRLF split from its CR: the line, and maybe the event, ended with
            // the CR.
            if std::mem::take(&mut self.after_cr) && byte == b'\n' {
                continue;
            }
            self.size += 1;
            self.raw.push(&[byte]);
            match byte {
                b'\r' | b'\n' => {
                    // A CRLF ends one line, and stays with the event it ends.
                    if byte == b'\r' {
                        if bytes.get(i) == Some(&b'\n') {
                            i += 1;
                            self.size += 1;
                            self.raw.push(b"\n");
                        } else {
                            self.after_cr = i == bytes.len();
                        }
                    }
                    if let Some(event) = self.end_line() {
                        events.push(event);
                    }
                }
                _ => self.line.push(&[byte]),
            }
        }
        events
    }

    fn end_line(&mut self) -> Option<StreamMessage> {
        let (line, line_truncated) = self.line.take();
        self.data_truncated |= line_truncated && line.starts_with(b"data");
        if line.is_empty() {
            return self.dispatch();
        }
        if line[0] == b':' {
            return None;
        }
        let (name, value) = match line.iter().position(|&b| b == b':') {
            Some(i) => {
                let value = &line[i + 1..];
                (&line[..i], value.strip_prefix(b" ").unwrap_or(value))
            }
            None => (&line[..], &b""[..]),
        };
        let value = String::from_utf8_lossy(value);
        match name {
            b"event" => self.event = Some(value.into_owned()),
            b"data" => {
                if self.data_lines > 0 {
                    self.data.push(b"\n");
                }
                self.data.push(value.as_bytes());
                self.data_lines += 1;
            }
            b"id" if !value.contains('\0') => self.id = Some(value.into_owned()),
            b"retry" => match value.parse() {
                Ok(retry) if value.bytes().all(|b| b.is_ascii_digit()) => self.retry = Some(retry),
                _ => return None,
            },
            _ => return None,
        }
        self.any_field = true;
        None
    }

    fn dispatch(&mut self) -> Option<StreamMessage> {
        let (raw, _) = self.raw.take();
        let size = std::mem::take(&mut self.size);
        self.data_lines = 0;
        if !std::mem::take(&mut self.any_field) {
            self.data_truncated = false;
            return None;
        }
        let (data, truncated) = self.data.take();
        let truncated = truncated || std::mem::take(&mut self.data_truncated);
        let kind = MessageKind::SseEvent {
            event: self.event.take(),
            id: self.id.take(),
            retry: self.retry.take(),
            raw: String::from_utf8_lossy(&raw).into_owned(),
        };
        let mut message = StreamMessage::new(MessageDirection::Server, kind);
        message.size = size;
        message.data = data;
        message.truncated = truncated;
        Some(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_bytewise(parser: &mut SseParser, stream: &[u8]) -> Vec<StreamMessage> {
        stream.iter().flat_map(|b| parser.feed(&[*b])).collect()
    }

    fn raw(message: &StreamMessage) -> &str {
        match &message.kind {
            MessageKind::SseEvent { raw, .. } => raw,
            _ => panic!("not an event"),
        }
    }

    #[test]
    fn a_byte_order_mark_split_across_chunks_is_skipped() {
        let mut parser = SseParser::new(None, 1024);
        let events =
            feed_bytewise(&mut parser, b"\xEF\xBB\xBFdata: hello\n\ndata: \xEF\xBB\xBF\n\n");
        assert_eq!(&events[0].data[..], b"hello");
        assert_eq!(&events[1].data[..], b"\xEF\xBB\xBF", "only at the start of the stream");
    }

    #[test]
    fn crlf_stays_with_the_event_it_ends() {
        for split in [false, true] {
            let stream = b"data: a\r\n\r\ndata: b\r\n\r\n";
            let mut parser = SseParser::new(None, 1024);
            let events =
                if split { feed_bytewise(&mut parser, stream) } else { parser.feed(stream) };
            assert_eq!(events.len(), 2);
            if !split {
                assert_eq!(raw(&events[0]), "data: a\r\n\r\n");
                assert_eq!(events[0].size, 11);
            }
            assert!(raw(&events[1]).starts_with("data: b"), "{:?}", raw(&events[1]));
        }
    }

    #[test]
    fn a_data_line_past_the_limit_is_truncated() {
        let mut parser = SseParser::new(None, 16);
        let events = parser.feed(format!("data: {}\n\n", "x".repeat(100)).as_bytes());
        assert_eq!(events[0].data.len(), 16);
        assert!(events[0].truncated);
    }
}
