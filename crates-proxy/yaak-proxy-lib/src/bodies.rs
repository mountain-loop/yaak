use crate::models::{Flow, FlowBody, find_header};
use std::io::Cursor;
use tokio::io::AsyncReadExt;
use yaak_http::decompress::{ContentEncoding, streaming_decoder};
use yaak_models::blob_manager::BlobManager;

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
}

/// A flow's body decoded with its Content-Encoding, at most `limit` bytes of it. A body that
/// fails to decode, as one cut short does, keeps what decoded before the failure.
pub async fn read_body(
    blobs: &BlobManager,
    flow: &Flow,
    body: FlowBody,
    limit: usize,
) -> Result<DecodedBody, String> {
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
        return Ok(DecodedBody { data, stored_size, truncated, decode_error: None });
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
    Ok(DecodedBody { data, stored_size, truncated, decode_error })
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
    blobs: &BlobManager,
    flow: &Flow,
    body: FlowBody,
    limit: usize,
) -> Result<DecodedBody, String> {
    let decoded = read_body(blobs, flow, body, limit).await?;
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

    #[tokio::test]
    async fn response_failed_after_its_headers_is_truncated() {
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
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

        let body = read_body(&blobs, &cut, FlowBody::Response, 1024).await.unwrap();
        assert_eq!((body.data.as_slice(), body.truncated), (&b"{\"rows\": ["[..], true));
        // The request went out whole; the error is the response's.
        let request = read_body(&blobs, &cut, FlowBody::Request, 1024).await.unwrap();
        assert!(!request.truncated);
        // With no headers there was never a response body to cut.
        let refused = Flow { status: None, ..cut.clone() };
        assert!(!read_body(&blobs, &refused, FlowBody::Response, 1024).await.unwrap().truncated);

        // The client cancelling partway through cuts it short the same way.
        let cancelled = Flow { error: None, cancelled: true, ..cut };
        let body = read_body(&blobs, &cancelled, FlowBody::Response, 1024).await.unwrap();
        assert_eq!((body.data.as_slice(), body.truncated), (&b"{\"rows\": ["[..], true));
    }

    #[tokio::test]
    async fn cancelled_gzip_response_keeps_what_decoded() {
        use std::io::Write;
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
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

        let body = read_body(&blobs, &flow, FlowBody::Response, 8192).await.unwrap();
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
            let body = read_body(&blobs, &flow, FlowBody::Request, 1024).await.unwrap();
            assert_eq!(body.decode_error, None, "{id}");
            assert_eq!((body.data.as_slice(), body.truncated), (&logs[..], false), "{id}");
        }
    }

    #[tokio::test]
    async fn undecodable_body_reads_as_it_was_on_the_wire() {
        let (_db, blobs, _rx) = yaak_models::init_in_memory().unwrap();
        let flow = deflate_request(&blobs, "fl_bad", b"\x00\x01 not deflate");

        let decoded = read_body(&blobs, &flow, FlowBody::Request, 1024).await.unwrap();
        assert!(decoded.decode_error.is_some());
        let raw = read_body_or_raw(&blobs, &flow, FlowBody::Request, 1024).await.unwrap();
        assert_eq!(raw.data, b"\x00\x01 not deflate");
        assert!(!raw.truncated);
        assert_eq!(raw.decode_error, decoded.decode_error);
        let cut = read_body_or_raw(&blobs, &flow, FlowBody::Request, 4).await.unwrap();
        assert_eq!((cut.data.as_slice(), cut.truncated), (&b"\x00\x01 n"[..], true));
    }
}
