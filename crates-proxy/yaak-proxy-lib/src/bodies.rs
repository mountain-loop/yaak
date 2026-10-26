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
    // A response that failed after its headers ended short on the wire.
    let cut = body == FlowBody::Response && flow.status.is_some() && flow.error.is_some();
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
        let refused = Flow { status: None, ..cut };
        assert!(!read_body(&blobs, &refused, FlowBody::Response, 1024).await.unwrap().truncated);
    }
}
