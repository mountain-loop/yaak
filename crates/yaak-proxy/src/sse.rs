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

pub(crate) struct SseParser {
    decoder: Decoder,
    line: Capped,
    /// The last byte was a CR, so an LF right after it ends no second line.
    after_cr: bool,
    event: Option<String>,
    id: Option<String>,
    retry: Option<u64>,
    data: Capped,
    /// `data` fields since the last event, which `data` joins with line feeds.
    data_lines: usize,
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
            line: Capped::new(limit),
            after_cr: false,
            event: None,
            id: None,
            retry: None,
            data: Capped::new(limit),
            data_lines: 0,
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

    fn read(&mut self, bytes: &[u8]) -> Vec<StreamMessage> {
        let mut events = Vec::new();
        for &byte in bytes {
            self.size += 1;
            self.raw.push(&[byte]);
            let after_cr = std::mem::replace(&mut self.after_cr, byte == b'\r');
            match byte {
                b'\n' if after_cr => {}
                b'\n' | b'\r' => {
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
        let (line, _) = self.line.take();
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
            return None;
        }
        let (data, truncated) = self.data.take();
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
