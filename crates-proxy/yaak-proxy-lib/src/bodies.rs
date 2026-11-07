use crate::db::ProxyQueryManager;
use crate::messages::{self, FlowMessage, MessageDirection, MessageKind};
use crate::models::{Flow, FlowBody, StreamKind, find_header};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use std::io::Cursor;
use tokio::io::AsyncReadExt;
use yaak_http::decompress::{ContentEncoding, streaming_decoder};
use yaak_models::blob_manager::BlobManager;

/// Messages read at a time while putting a body back together.
const MESSAGE_PAGE: usize = 500;

/// What a WebSocket's response body reads as: it has none.
pub const WEBSOCKET_BODY_NOTE: &str =
    "A WebSocket has no body after its 101 response. Its frames are its messages.";

/// Whether a flow's body is its stream's messages rather than bytes stored on their own: an
/// event stream's response, a gRPC call's request, and its response when the server answered
/// in gRPC (a gateway's error page is a body like any other), and a WebSocket's response. Such a
/// body is not written to `blobs.sqlite`; reading it puts it back together from the messages.
///
/// A body with a Content-Encoding keeps its bytes instead: the messages are read from it decoded,
/// but only its bytes can say whether they decoded whole (gzip's checksum, an encoding the
/// stream's reader can't undo), and they read back through the body's decoder as any other.
pub fn from_messages(flow: &Flow, which: FlowBody) -> bool {
    let encoding = find_header(flow.headers(which), "content-encoding").map(str::trim);
    let encoded = encoding.is_some_and(|e| !e.is_empty() && !e.eq_ignore_ascii_case("identity"));
    if encoded && flow.stream_kind != Some(StreamKind::Websocket) {
        return false;
    }
    match (flow.stream_kind, which) {
        (None, _) => false,
        (Some(StreamKind::Websocket | StreamKind::Sse), FlowBody::Request) => false,
        (Some(StreamKind::Websocket | StreamKind::Sse), FlowBody::Response) => true,
        (Some(StreamKind::Grpc | StreamKind::GrpcWeb), FlowBody::Request) => true,
        (Some(StreamKind::Grpc | StreamKind::GrpcWeb), FlowBody::Response) => {
            yaak_proxy::detect_grpc(find_header(&flow.response_headers, "content-type")).is_some()
        }
    }
}

/// A flow's body as stored: the bytes on the wire, up to the capture limit.
pub fn read_raw_body(
    blobs: &BlobManager,
    flow_id: &str,
    body: FlowBody,
) -> Result<Vec<u8>, String> {
    let chunks =
        blobs.connect().get_chunks(&Flow::body_id(flow_id, body)).map_err(|e| e.to_string())?;
    Ok(chunks.into_iter().flat_map(|c| c.data).collect())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedBody {
    pub data: Vec<u8>,
    /// Bytes stored for the body, as they were on the wire.
    pub stored_size: usize,
    /// The body is incomplete: cut on the wire at the capture limit, decoded past `limit`, or
    /// decoded only as far as `decode_error`.
    pub truncated: bool,
    /// Why decoding stopped before the end of the stored bytes.
    pub decode_error: Option<String>,
    /// What to know about the body beyond its bytes, as that a WebSocket has none.
    pub note: Option<String>,
}

impl DecodedBody {
    pub fn new(data: Vec<u8>, truncated: bool) -> Self {
        Self { stored_size: data.len(), data, truncated, decode_error: None, note: None }
    }
}

/// A flow's body decoded with its Content-Encoding, at most `limit` bytes of it. A body that
/// fails to decode, as one cut short does, keeps what decoded before the failure. A body that is
/// a stream's messages is put back together from them, decoded as they are.
pub async fn read_body(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    flow: &Flow,
    body: FlowBody,
    limit: usize,
) -> Result<DecodedBody, String> {
    // A gRPC call that ended while its upload still went on kept the upload's bytes instead.
    if from_messages(flow, body)
        && !blobs.connect().body_exists(&Flow::body_id(&flow.id, body)).unwrap_or(false)
    {
        return message_body(db, blobs, flow, body, limit);
    }
    let raw = read_raw_body(blobs, &flow.id, body)?;
    let stored_size = raw.len();
    // A response that failed or was cancelled after its headers ended short on the wire.
    let cut = body == FlowBody::Response
        && flow.status.is_some()
        && (flow.error.is_some() || flow.cancelled);
    let wire_truncated = flow.truncated(body) || cut;
    let encoding =
        ContentEncoding::from_header(find_header(flow.headers(body), "content-encoding"));
    // A HEAD or 304 response names its encoding but has no body to decode.
    if raw.is_empty() || encoding == ContentEncoding::Identity {
        let truncated = wire_truncated || raw.len() > limit;
        let mut data = raw;
        data.truncate(limit);
        return Ok(DecodedBody { data, stored_size, truncated, decode_error: None, note: None });
    }

    // One byte past the limit tells a body that fills it from one that overflows it.
    let take = u64::try_from(limit).unwrap_or(u64::MAX).saturating_add(1);
    let mut data = Vec::new();
    let mut decoder = streaming_decoder(Cursor::new(raw), encoding).take(take);
    let decode_error = match decoder.read_to_end(&mut data).await {
        Ok(_) => None,
        // Expected of a body cut on the wire; anything else is worth saying.
        Err(_) if wire_truncated => None,
        Err(e) => Some(format!("Failed to decode {encoding:?} body: {e}")),
    };
    let truncated = wire_truncated || decode_error.is_some() || data.len() > limit;
    data.truncate(limit);
    Ok(DecodedBody { data, stored_size, truncated, decode_error, note: None })
}

/// A body that is its stream's messages, as it was on the wire once decoded: an event stream's
/// events as they came, comments within an event included, and a gRPC call's messages framed
/// again (uncompressed, so flagged as such), with a gRPC-Web response's trailers frame, in base64
/// for `grpc-web-text`. Blocks of an event stream that were not events, as a keep-alive comment
/// alone is, are not kept, so are not in it.
fn message_body(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    flow: &Flow,
    which: FlowBody,
    limit: usize,
) -> Result<DecodedBody, String> {
    let Some(kind) = flow.stream_kind else {
        return Ok(DecodedBody::new(Vec::new(), false));
    };
    if kind == StreamKind::Websocket {
        return Ok(DecodedBody {
            note: Some(WEBSOCKET_BODY_NOTE.into()),
            ..DecodedBody::new(Vec::new(), false)
        });
    }
    let direction = match which {
        FlowBody::Request => MessageDirection::Client,
        FlowBody::Response => MessageDirection::Server,
    };
    let content_type = find_header(flow.headers(which), "content-type");
    let base64_text = yaak_proxy::detect_grpc(content_type).is_some_and(|(_, text)| text);
    // The status of a trailers-only response came in its headers, not a frame of its body.
    let trailers_in_body = kind == StreamKind::GrpcWeb
        && which == FlowBody::Response
        && find_header(&flow.response_headers, "grpc-status").is_none();
    // Enough to fill the limit, after base64 makes it a third longer.
    let room = if base64_text { limit / 3 * 4 + 4 } else { limit };

    // A response that failed or was cancelled after its headers ended short, as `read_body`
    // says of one stored whole.
    let mut truncated = which == FlowBody::Response
        && flow.status.is_some()
        && (flow.error.is_some() || flow.cancelled);
    let mut out = Vec::new();
    let mut after = None;
    // Read a page at a time, and no further than the limit needs.
    'pages: loop {
        let page = messages::list(db, &flow.id, after, Some(MESSAGE_PAGE))?;
        let Some(last) = page.last() else {
            break;
        };
        after = Some(last.seq);
        let full = page.len() == MESSAGE_PAGE;
        for message in page {
            if out.len() > room {
                truncated = true;
                break 'pages;
            }
            if message.direction != direction {
                continue;
            }
            match message.kind {
                MessageKind::SseEvent => {
                    let payload = messages::payload(db, blobs, &message)?;
                    out.extend_from_slice(&sse_event_lines(&message, &payload));
                }
                MessageKind::GrpcMessage | MessageKind::GrpcTrailers
                    if message.kind == MessageKind::GrpcMessage || trailers_in_body =>
                {
                    let payload = messages::payload(db, blobs, &message)?;
                    let flag = if message.kind == MessageKind::GrpcMessage { 0 } else { 0x80 };
                    // A frame cut short declares more than it holds, so a reader would take the
                    // frames after it as its rest: the body ends there, cut.
                    if !grpc_frame(&mut out, flag, &message, &payload) {
                        truncated = true;
                        break 'pages;
                    }
                }
                _ => continue,
            }
            truncated |= message.truncated;
        }
        if !full {
            break;
        }
    }
    if base64_text {
        out = BASE64.encode(&out).into_bytes();
    }
    let stored_size = out.len();
    truncated |= out.len() > limit;
    out.truncate(limit);
    Ok(DecodedBody { data: out, stored_size, truncated, decode_error: None, note: None })
}

/// An event's lines as they came. Its raw lines are kept up to [`yaak_proxy::RAW_LIMIT`]; an
/// event longer than that is written again from its fields, as `event`, `id`, `retry` and a
/// `data` line for each line of its data.
fn sse_event_lines(message: &FlowMessage, payload: &[u8]) -> Vec<u8> {
    if let Some(raw) = &message.meta.raw
        && i64::try_from(raw.len()).is_ok_and(|len| len == message.size)
    {
        return raw.as_bytes().to_vec();
    }
    let mut out = Vec::new();
    let meta = &message.meta;
    if let Some(event) = &meta.event {
        out.extend_from_slice(format!("event: {event}\n").as_bytes());
    }
    if let Some(id) = &meta.event_id {
        out.extend_from_slice(format!("id: {id}\n").as_bytes());
    }
    if let Some(retry) = meta.retry {
        out.extend_from_slice(format!("retry: {retry}\n").as_bytes());
    }
    for line in payload.split(|b| *b == b'\n') {
        out.extend_from_slice(b"data: ");
        out.extend_from_slice(line);
        out.push(b'\n');
    }
    out.push(b'\n');
    out
}

/// Appends a gRPC length-prefixed message: its flag byte, its length, and its bytes.
/// A message decompressed is framed again uncompressed, at its decompressed length. One kept as
/// it came (never compressed, or failing to decompress) keeps its flag and the length it was
/// sent with, so one cut short (at the capture limit, or by the body ending partway through it)
/// reads back as it was on the wire, cut.
///
/// Returns whether the frame is whole: false when it declares more bytes than it holds.
fn grpc_frame(out: &mut Vec<u8>, flag: u8, message: &FlowMessage, payload: &[u8]) -> bool {
    let as_sent = !message.compressed || message.error.is_some();
    let (flag, length) = if as_sent {
        (flag | u8::from(message.compressed), usize::try_from(message.size).unwrap_or(usize::MAX))
    } else {
        (flag, payload.len())
    };
    out.push(flag);
    out.extend_from_slice(&u32::try_from(length).unwrap_or(u32::MAX).to_be_bytes());
    out.extend_from_slice(payload);
    payload.len() >= length
}

/// A body's text as the app's viewer reads it, as `decodeBodyText` in `@yaakapp-internal/lib`
/// does: in the charset its content type names, when it names one the WHATWG Encoding Standard
/// knows, or else as UTF-8, or windows-1252 when it isn't valid UTF-8, as browsers read text.
pub fn body_text(data: &[u8], content_type: Option<&str>, truncated: bool) -> String {
    let encoding = content_type
        .and_then(charset_label)
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        // A label the standard maps to "replacement" is one `TextDecoder` refuses.
        .filter(|encoding| *encoding != encoding_rs::REPLACEMENT);
    if let Some(encoding) = encoding {
        return encoding.decode_with_bom_removal(data).0.into_owned();
    }
    if let Some(text) = strict_utf8(data, truncated) {
        return text;
    }
    encoding_rs::WINDOWS_1252.decode_without_bom_handling(data).0.into_owned()
}

/// The `charset` parameter of a content type
fn charset_label(content_type: &str) -> Option<&str> {
    content_type.split(';').skip(1).find_map(|param| {
        let (name, value) = param.split_once('=')?;
        name.trim().eq_ignore_ascii_case("charset").then(|| value.trim().trim_matches('"').trim())
    })
}

/// The bytes as UTF-8 without a byte order mark, or None when they aren't valid UTF-8. A
/// truncated body may end partway through a character, so up to three trailing bytes are dropped
/// before giving up on it.
fn strict_utf8(data: &[u8], truncated: bool) -> Option<String> {
    let max_trim = if truncated { data.len().min(3) } else { 0 };
    (0..=max_trim).find_map(|trim| {
        let text = std::str::from_utf8(&data[..data.len() - trim]).ok()?;
        Some(text.strip_prefix('\u{feff}').unwrap_or(text).to_string())
    })
}

/// A flow's body decoded as `read_body` does, or, when it fails to decode, the bytes as they were
/// on the wire, with `decode_error` saying why.
pub async fn read_body_or_raw(
    db: &ProxyQueryManager,
    blobs: &BlobManager,
    flow: &Flow,
    body: FlowBody,
    limit: usize,
) -> Result<DecodedBody, String> {
    let decoded = read_body(db, blobs, flow, body, limit).await?;
    if decoded.decode_error.is_none() {
        return Ok(decoded);
    }
    let mut data = read_raw_body(blobs, &flow.id, body)?;
    let truncated = flow.truncated(body) || data.len() > limit;
    data.truncate(limit);
    Ok(DecodedBody { data, truncated, ..decoded })
}

#[cfg(test)]
mod tests {
    use super::*;
    use yaak_models::blob_manager::BodyChunkWriter;

    fn proxy_db() -> (tempfile::TempDir, ProxyQueryManager) {
        let dir = tempfile::tempdir().unwrap();
        let db = ProxyQueryManager::new(&dir.path().join("proxy.db")).unwrap();
        (dir, db)
    }

    #[tokio::test]
    async fn response_failed_after_its_headers_is_truncated() {
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let mut writer =
            BodyChunkWriter::new(blobs.clone(), Flow::body_id("fl_cut", FlowBody::Response));
        writer.write(b"{\"rows\": [").unwrap();
        writer.finish().unwrap();
        let cut = Flow {
            id: "fl_cut".into(),
            status: Some(200),
            error: Some("error reading a body from connection".into()),
            ..Default::default()
        };

        let body = read_body(&db, &blobs, &cut, FlowBody::Response, 1024).await.unwrap();
        assert_eq!((body.data.as_slice(), body.truncated), (&b"{\"rows\": ["[..], true));
        // The request went out whole; the error is the response's.
        let request = read_body(&db, &blobs, &cut, FlowBody::Request, 1024).await.unwrap();
        assert!(!request.truncated);
        // With no headers there was never a response body to cut.
        let refused = Flow { status: None, ..cut.clone() };
        assert!(
            !read_body(&db, &blobs, &refused, FlowBody::Response, 1024).await.unwrap().truncated
        );

        // The client cancelling partway through cuts it short the same way.
        let cancelled = Flow { error: None, cancelled: true, ..cut };
        let body = read_body(&db, &blobs, &cancelled, FlowBody::Response, 1024).await.unwrap();
        assert_eq!((body.data.as_slice(), body.truncated), (&b"{\"rows\": ["[..], true));
    }

    #[tokio::test]
    async fn cancelled_gzip_response_keeps_what_decoded() {
        use std::io::Write;
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        gzip.write_all(&[b'z'; 4096]).unwrap();
        let gzip = gzip.finish().unwrap();
        let mut writer =
            BodyChunkWriter::new(blobs.clone(), Flow::body_id("fl_gz", FlowBody::Response));
        writer.write(&gzip[..gzip.len() / 2]).unwrap();
        writer.finish().unwrap();
        let flow = Flow {
            id: "fl_gz".into(),
            status: Some(200),
            cancelled: true,
            response_headers: vec![crate::models::ProxyHeader {
                name: "content-encoding".into(),
                value: "gzip".into(),
            }],
            ..Default::default()
        };

        let body = read_body(&db, &blobs, &flow, FlowBody::Response, 8192).await.unwrap();
        assert!(body.truncated);
        assert_eq!(body.decode_error, None);
    }

    /// The cases `decodeBodyText`'s tests in `@yaakapp-internal/lib` cover, read the same way
    #[test]
    fn body_text_reads_as_the_viewer_does() {
        let french = "Accès refusé : vous n'avez pas l'autorisation d'accéder à cette page.";
        let latin1: Vec<u8> = french.chars().map(|c| c as u8).collect();
        assert_eq!(body_text(&latin1, Some("text/html; charset=iso-8859-1"), false), french);
        assert_eq!(body_text(&latin1, Some("text/plain; CHARSET=\"ISO-8859-1\""), false), french);
        let shift_jis = [
            0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x81, 0x41, 0x90, 0xa2,
            0x8a, 0x45,
        ];
        assert_eq!(
            body_text(&shift_jis, Some("text/plain; charset=Shift_JIS"), false),
            "こんにちは、世界"
        );

        // Unlabeled and not UTF-8: windows-1252
        assert_eq!(body_text(&latin1, Some("text/html"), false), french);
        assert_eq!(body_text(&latin1, None, false), french);
        assert_eq!(body_text(&[0x93, b'h', b'i', 0x94], None, false), "\u{201c}hi\u{201d}");
        // A label `TextDecoder` refuses is no label.
        assert_eq!(body_text(&latin1, Some("text/plain; charset=not-a-charset"), false), french);
        assert_eq!(body_text(&latin1, Some("text/plain; charset=iso-2022-kr"), false), french);

        // UTF-8, labeled or not; labeled, what isn't UTF-8 is replaced
        let json = r#"{"city":"Zürich","greeting":"こんにちは"}"#;
        assert_eq!(body_text(json.as_bytes(), None, false), json);
        assert_eq!(
            body_text(json.as_bytes(), Some("application/json; charset=utf-8"), false),
            json
        );
        assert_eq!(body_text(b"a\xff", Some("text/plain; charset=utf-8"), false), "a\u{fffd}");

        // A UTF-8 body cut partway through a character stays UTF-8
        assert_eq!(body_text(&"abc€".as_bytes()[..5], None, true), "abc");
    }

    fn deflate_request(blobs: &BlobManager, id: &str, stored: &[u8]) -> Flow {
        let mut writer = BodyChunkWriter::new(blobs.clone(), Flow::body_id(id, FlowBody::Request));
        writer.write(stored).unwrap();
        writer.finish().unwrap();
        Flow {
            id: id.into(),
            request_size: stored.len() as i64,
            request_headers: vec![crate::models::ProxyHeader {
                name: "Content-Encoding".into(),
                value: "deflate".into(),
            }],
            ..Default::default()
        }
    }

    /// Browser SDKs send `deflate` both ways: zlib-wrapped, as the spec says, and raw.
    #[tokio::test]
    async fn deflate_request_bodies_decode_wrapped_or_raw() {
        use std::io::Write;
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let logs = br#"[{"message":"hello","service":"browser"}]"#;
        let mut zlib = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        zlib.write_all(logs).unwrap();
        let mut raw =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        raw.write_all(logs).unwrap();

        for (id, stored) in [
            ("fl_zlib", zlib.finish().unwrap()),
            ("fl_raw", raw.finish().unwrap()),
        ] {
            let flow = deflate_request(&blobs, id, &stored);
            let body = read_body(&db, &blobs, &flow, FlowBody::Request, 1024).await.unwrap();
            assert_eq!(body.decode_error, None, "{id}");
            assert_eq!((body.data.as_slice(), body.truncated), (&logs[..], false), "{id}");
        }
    }

    #[tokio::test]
    async fn undecodable_body_reads_as_it_was_on_the_wire() {
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let flow = deflate_request(&blobs, "fl_bad", b"\x00\x01 not deflate");

        let decoded = read_body(&db, &blobs, &flow, FlowBody::Request, 1024).await.unwrap();
        assert!(decoded.decode_error.is_some());
        let raw = read_body_or_raw(&db, &blobs, &flow, FlowBody::Request, 1024).await.unwrap();
        assert_eq!(raw.data, b"\x00\x01 not deflate");
        assert!(!raw.truncated);
        assert_eq!(raw.decode_error, decoded.decode_error);
        let cut = read_body_or_raw(&db, &blobs, &flow, FlowBody::Request, 4).await.unwrap();
        assert_eq!((cut.data.as_slice(), cut.truncated), (&b"\x00\x01 n"[..], true));
    }

    /// Stores `messages` for `flow_id` as the event loop does, payloads inline.
    fn store_messages(
        db: &ProxyQueryManager,
        flow_id: &str,
        messages: &[yaak_proxy::StreamMessage],
    ) {
        db.with_conn(|c| {
            for (seq, message) in messages.iter().enumerate() {
                let row = FlowMessage::from_engine(flow_id, seq as i64, message);
                messages::insert(c.conn().resolve(), &row, Some(&message.data)).unwrap();
            }
        });
    }

    fn stream_message(
        direction: yaak_proxy::MessageDirection,
        kind: yaak_proxy::MessageKind,
        size: u64,
        data: &[u8],
    ) -> yaak_proxy::StreamMessage {
        yaak_proxy::StreamMessage {
            direction,
            kind,
            at: std::time::SystemTime::now(),
            size,
            data: bytes::Bytes::copy_from_slice(data),
            truncated: false,
            compressed: false,
            error: None,
        }
    }

    /// An event's raw lines are kept up to a limit; past it, the event is written again from its
    /// fields. Either way, nothing of the body was stored on its own.
    #[tokio::test]
    async fn event_stream_body_is_its_events() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let short = ": hello\nevent: tick\ndata: one\n\n";
        let long_data = format!("{}\n{}", "a".repeat(3000), "b".repeat(3000));
        let long_size = format!(
            "event: big\nid: 7\ndata: {}\ndata: {}\n\n",
            "a".repeat(3000),
            "b".repeat(3000)
        )
        .len();
        let sse = |event: &str, id: Option<&str>, raw: &str| K::SseEvent {
            event: Some(event.into()),
            id: id.map(String::from),
            retry: None,
            raw: raw.into(),
        };
        store_messages(
            &db,
            "fl_sse",
            &[
                stream_message(D::Server, sse("tick", None, short), short.len() as u64, b"one"),
                stream_message(
                    D::Server,
                    sse("big", Some("7"), &"x".repeat(yaak_proxy::RAW_LIMIT)),
                    long_size as u64,
                    long_data.as_bytes(),
                ),
            ],
        );
        let flow =
            Flow { id: "fl_sse".into(), stream_kind: Some(StreamKind::Sse), ..Default::default() };

        let body = read_body(&db, &blobs, &flow, FlowBody::Response, 1 << 20).await.unwrap();
        let expected = format!(
            "{short}event: big\nid: 7\ndata: {}\ndata: {}\n\n",
            "a".repeat(3000),
            "b".repeat(3000)
        );
        assert_eq!(String::from_utf8(body.data).unwrap(), expected);
        assert_eq!((body.truncated, body.decode_error, body.note), (false, None, None));
        // The request is no stream, and reads from the blob store as any other.
        assert!(!from_messages(&flow, FlowBody::Request));
        let cut = read_body(&db, &blobs, &flow, FlowBody::Response, 10).await.unwrap();
        assert_eq!((cut.data.as_slice(), cut.truncated), (&short.as_bytes()[..10], true));

        // Ended by a failure or a cancel, it is cut short, however whole its events are.
        let cancelled = Flow { status: Some(200), cancelled: true, ..flow.clone() };
        assert!(
            read_body(&db, &blobs, &cancelled, FlowBody::Response, 1 << 20)
                .await
                .unwrap()
                .truncated
        );

        // With a Content-Encoding, the bytes are its record, whatever the encoding.
        for encoding in ["gzip", "br"] {
            let encoded = Flow {
                response_headers: vec![crate::models::ProxyHeader {
                    name: "Content-Encoding".into(),
                    value: encoding.into(),
                }],
                ..flow.clone()
            };
            assert!(!from_messages(&encoded, FlowBody::Response), "{encoding}");
        }
    }

    /// A message cut at the capture limit declares more than it holds: the body ends with it,
    /// so no reader takes the frames after it as its rest.
    #[tokio::test]
    async fn grpc_body_ends_at_a_cut_message() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let mut cut = stream_message(D::Server, K::GrpcMessage, 11, b"\x0a\x09Hel");
        cut.truncated = true;
        store_messages(
            &db,
            "fl_cut",
            &[
                stream_message(D::Server, K::GrpcMessage, 2, b"\x08\x01"),
                cut,
                stream_message(D::Server, K::GrpcMessage, 2, b"\x08\x02"),
            ],
        );
        let flow = Flow {
            id: "fl_cut".into(),
            stream_kind: Some(StreamKind::Grpc),
            response_headers: vec![crate::models::ProxyHeader {
                name: "content-type".into(),
                value: "application/grpc".into(),
            }],
            ..Default::default()
        };

        let body = read_body(&db, &blobs, &flow, FlowBody::Response, 1024).await.unwrap();
        assert_eq!(body.data, b"\x00\x00\x00\x00\x02\x08\x01\x00\x00\x00\x00\x0b\x0a\x09Hel");
        assert!(body.truncated);
    }

    #[tokio::test]
    async fn grpc_web_text_body_is_its_frames_in_base64() {
        use yaak_proxy::{MessageDirection as D, MessageKind as K};
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let (_dir, db) = proxy_db();
        let trailers = K::GrpcTrailers { status: Some(0), message: None };
        store_messages(
            &db,
            "fl_web",
            &[
                stream_message(D::Client, K::GrpcMessage, 2, b"\x08\x01"),
                stream_message(D::Server, K::GrpcMessage, 2, b"\x08\x02"),
                stream_message(D::Server, trailers, 16, b"grpc-status: 0\r\n"),
            ],
        );
        let header = |name: &str, value: &str| crate::models::ProxyHeader {
            name: name.into(),
            value: value.into(),
        };
        let flow = Flow {
            id: "fl_web".into(),
            stream_kind: Some(StreamKind::GrpcWeb),
            request_headers: vec![header("content-type", "application/grpc-web-text")],
            response_headers: vec![header("content-type", "application/grpc-web-text+proto")],
            ..Default::default()
        };

        let request = read_body(&db, &blobs, &flow, FlowBody::Request, 1024).await.unwrap();
        assert_eq!(request.data, BASE64.encode(b"\x00\x00\x00\x00\x02\x08\x01").as_bytes());
        let response = read_body(&db, &blobs, &flow, FlowBody::Response, 1024).await.unwrap();
        let mut frames = b"\x00\x00\x00\x00\x02\x08\x02\x80\x00\x00\x00\x10".to_vec();
        frames.extend_from_slice(b"grpc-status: 0\r\n");
        assert_eq!(response.data, BASE64.encode(&frames).as_bytes());

        // A trailers-only answer's status came in its headers, not a frame.
        let trailers_only = Flow {
            response_headers: vec![
                header("content-type", "application/grpc-web"),
                header("grpc-status", "0"),
            ],
            ..flow.clone()
        };
        let response =
            read_body(&db, &blobs, &trailers_only, FlowBody::Response, 1024).await.unwrap();
        assert_eq!(response.data, b"\x00\x00\x00\x00\x02\x08\x02");

        // A gateway's error page in place of a gRPC answer is a body like any other.
        let gateway = Flow { response_headers: vec![header("content-type", "text/html")], ..flow };
        assert!(!from_messages(&gateway, FlowBody::Response));
        assert!(from_messages(&gateway, FlowBody::Request));
    }
}
