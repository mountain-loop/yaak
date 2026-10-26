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
    /// The body is incomplete: cut on the wire at the capture limit, or decoded past `limit`.
    pub truncated: bool,
}

/// A flow's body decoded with its Content-Encoding, at most `limit` bytes of it. A body cut
/// at the capture limit decodes as far as its stored bytes go.
pub async fn read_body(
    blobs: &BlobManager,
    flow: &Flow,
    body: FlowBody,
    limit: usize,
) -> Result<DecodedBody, String> {
    let raw = read_raw_body(blobs, &flow.id, body)?;
    let stored_size = raw.len();
    let wire_truncated = flow.truncated(body);
    let encoding =
        ContentEncoding::from_header(find_header(flow.headers(body), "content-encoding"));
    if encoding == ContentEncoding::Identity {
        let truncated = wire_truncated || raw.len() > limit;
        let mut data = raw;
        data.truncate(limit);
        return Ok(DecodedBody { data, stored_size, truncated });
    }

    // One byte past the limit tells a body that fills it from one that overflows it.
    let take = u64::try_from(limit).unwrap_or(u64::MAX).saturating_add(1);
    let mut data = Vec::new();
    let mut decoder = streaming_decoder(Cursor::new(raw), encoding).take(take);
    match decoder.read_to_end(&mut data).await {
        Ok(_) => {}
        Err(_) if wire_truncated => {}
        Err(e) => return Err(format!("Failed to decode {encoding:?} body: {e}")),
    }
    let truncated = wire_truncated || data.len() > limit;
    data.truncate(limit);
    Ok(DecodedBody { data, stored_size, truncated })
}
