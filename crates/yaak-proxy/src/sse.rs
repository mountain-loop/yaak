//! Server-sent events (the WHATWG `text/event-stream` format), read from a response body as it
//! streams.

use crate::decode::Decoding;
use crate::messages::{Capped, MessageDirection, MessageKind, RAW_LIMIT, StreamMessage};

const BOM: &[u8] = b"\xEF\xBB\xBF";
/// Bytes a line may take beyond the capture limit, for its field name.
const LINE_SLACK: usize = 64;

pub(crate) struct SseParser {
    /// The response's Content-Encoding, undone before the events are read.
    decoding: Decoding,
    line: Capped,
    /// A chunk ended in a CR whose line is not ended yet: an LF starting the next chunk makes it
    /// a CRLF, which stays with the event it ends.
    pending_cr: bool,
    /// The stream ends lines with a bare CR, so a CR ending a chunk ends its line at once, and
    /// an LF that starts the next chunk is skipped as the end of a CRLF.
    bare_cr: bool,
    /// The last chunk ended in a CR read as a bare one.
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
    raw: Capped,
    size: u64,
}

impl SseParser {
    pub(crate) fn new(content_encoding: Option<&str>, limit: usize) -> Self {
        Self {
            decoding: Decoding::new(content_encoding),
            // Room for a field name before a value up to the limit.
            line: Capped::new(limit.saturating_add(LINE_SLACK)),
            pending_cr: false,
            bare_cr: false,
            after_cr: false,
            event: None,
            id: None,
            retry: None,
            data: Capped::new(limit),
            data_lines: 0,
            data_truncated: false,
            bom: Some(Vec::new()),
            raw: Capped::new(RAW_LIMIT),
            size: 0,
        }
    }

    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Vec<StreamMessage> {
        // Left unsupported if decoding fails: what follows cannot be read.
        match std::mem::replace(&mut self.decoding, Decoding::Unsupported) {
            Decoding::Identity => {
                self.decoding = Decoding::Identity;
                self.read(bytes)
            }
            Decoding::Unsupported => Vec::new(),
            // A piece at a time, so a highly compressed body never expands all at once.
            Decoding::Decoder(mut decoder) => {
                let mut events = Vec::new();
                if decoder.feed(bytes, &mut |piece| events.extend(self.read(piece))).is_ok() {
                    self.decoding = Decoding::Decoder(decoder);
                }
                events
            }
        }
    }

    /// The body ended: a line ending held back for the LF that might have followed it ends its
    /// line now.
    pub(crate) fn finish(&mut self) -> Vec<StreamMessage> {
        if std::mem::take(&mut self.pending_cr) {
            return self.end_line().into_iter().collect();
        }
        Vec::new()
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
            // A CR that ended the last chunk: an LF now makes it a CRLF, kept with its line.
            if std::mem::take(&mut self.pending_cr) {
                if byte == b'\n' {
                    self.size += 1;
                    self.raw.push(b"\n");
                }
                events.extend(self.end_line());
                if byte == b'\n' {
                    continue;
                }
            }
            // The LF of a CRLF split from a CR already read as a bare one.
            if std::mem::take(&mut self.after_cr) && byte == b'\n' {
                continue;
            }
            self.size += 1;
            self.raw.push(&[byte]);
            match byte {
                b'\r' if bytes.get(i) == Some(&b'\n') => {
                    i += 1;
                    self.size += 1;
                    self.raw.push(b"\n");
                    events.extend(self.end_line());
                }
                // Whether an LF follows is for the next chunk to say, unless the stream has
                // shown it ends lines with bare CRs; then the line ends now, not a chunk late.
                b'\r' if i == bytes.len() => {
                    if self.bare_cr {
                        self.after_cr = true;
                        events.extend(self.end_line());
                    } else {
                        self.pending_cr = true;
                    }
                }
                b'\r' => {
                    self.bare_cr = true;
                    events.extend(self.end_line());
                }
                b'\n' => events.extend(self.end_line()),
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
            b"retry" if !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit()) => {
                self.retry = value.parse().ok();
            }
            _ => {}
        }
        None
    }

    /// Ends the event at a blank line. As a browser does, only a block with a `data` line is an
    /// event; one with only `id`, `retry` or `event` lines dispatches nothing.
    fn dispatch(&mut self) -> Option<StreamMessage> {
        let (raw, _) = self.raw.take();
        let size = std::mem::take(&mut self.size);
        let (event, id, retry) = (self.event.take(), self.id.take(), self.retry.take());
        let (data, truncated) = self.data.take();
        let truncated = truncated || std::mem::take(&mut self.data_truncated);
        if std::mem::take(&mut self.data_lines) == 0 {
            return None;
        }
        let raw = String::from_utf8_lossy(&raw).into_owned();
        let kind = MessageKind::SseEvent { event, id, retry, raw };
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
        let mut events: Vec<_> = stream.iter().flat_map(|b| parser.feed(&[*b])).collect();
        events.extend(parser.finish());
        events
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
    fn crlf_stays_with_the_event_it_ends_however_it_is_split() {
        for split in [false, true] {
            let stream = b"data: a\r\n\r\ndata: b\r\n\r\n";
            let mut parser = SseParser::new(None, 1024);
            let events =
                if split { feed_bytewise(&mut parser, stream) } else { parser.feed(stream) };
            assert_eq!(events.len(), 2, "split: {split}");
            assert_eq!(raw(&events[0]), "data: a\r\n\r\n", "split: {split}");
            assert_eq!(events[0].size, 11, "split: {split}");
            assert_eq!(raw(&events[1]), "data: b\r\n\r\n", "split: {split}");
        }
    }

    #[test]
    fn a_cr_ending_a_chunk_waits_for_the_next_unless_the_stream_uses_bare_crs() {
        // A CR ending the chunk might start a CRLF, so its line waits for the next byte.
        let mut parser = SseParser::new(None, 1024);
        assert!(parser.feed(b"data: x\n\r").is_empty());
        let events = parser.feed(b"\n");
        assert_eq!(raw(&events[0]), "data: x\n\r\n");

        // Bare CRs seen mid-chunk: one ending a chunk ends its event at once.
        let mut parser = SseParser::new(None, 1024);
        let events = parser.feed(b"data: a\r\rdata: b\r\r");
        assert_eq!(events.len(), 2);
        assert_eq!((&events[0].data[..], &events[1].data[..]), (&b"a"[..], &b"b"[..]));
        // An LF after it is the rest of a CRLF, no blank line of its own.
        let events = parser.feed(b"\ndata: c\r\r");
        assert_eq!(events.len(), 1);
        assert_eq!(&events[0].data[..], b"c");

        // A held CR at the body's end ends its line then.
        let mut parser = SseParser::new(None, 1024);
        assert!(parser.feed(b"data: y\n\r").is_empty());
        assert_eq!(&parser.finish()[0].data[..], b"y");
    }

    #[test]
    fn only_blocks_with_data_are_events() {
        let mut parser = SseParser::new(None, 1024);
        let events = parser.feed(b"retry: 1500\n\nid: 7\nevent: x\n\ndata:\n\n: comment\n\n");
        assert_eq!(events.len(), 1, "only the empty data event");
        assert_eq!(&events[0].data[..], b"");
        assert_eq!(raw(&events[0]), "data:\n\n");
    }

    #[test]
    fn a_data_line_past_the_limit_is_truncated() {
        let mut parser = SseParser::new(None, 16);
        let events = parser.feed(format!("data: {}\n\n", "x".repeat(100)).as_bytes());
        assert_eq!(events[0].data.len(), 16);
        assert!(events[0].truncated);
    }

    #[test]
    fn gzip_events_are_read_as_they_decompress() {
        use std::io::Write;
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gz.write_all(b"data: one\n\n").unwrap();
        gz.flush().unwrap();
        let first = gz.get_ref().len();
        gz.write_all(b"data: two\n\n").unwrap();
        let compressed = gz.finish().unwrap();
        let mut parser = SseParser::new(Some("gzip"), 1024);
        let events = parser.feed(&compressed[..first]);
        assert_eq!(&events[0].data[..], b"one", "before the rest of the body");
        assert_eq!(&parser.feed(&compressed[first..])[0].data[..], b"two");
    }
}
