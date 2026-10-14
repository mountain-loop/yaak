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

/// A flow's body decoded with its Content-Encoding. A truncated body decodes as far as its
/// stored bytes go.
pub async fn read_body(
    blobs: &BlobManager,
    flow: &Flow,
    body: FlowBody,
) -> Result<Vec<u8>, String> {
    let raw = read_raw_body(blobs, &flow.id, body)?;
    let encoding = ContentEncoding::from_header(find_header(flow.headers(body), "content-encoding"));
    if encoding == ContentEncoding::Identity {
        return Ok(raw);
    }

    let mut decoded = Vec::new();
    match streaming_decoder(Cursor::new(raw), encoding).read_to_end(&mut decoded).await {
        Ok(_) => Ok(decoded),
        Err(_) if flow.truncated(body) => Ok(decoded),
        Err(e) => Err(format!("Failed to decode {encoding:?} body: {e}")),
    }
}
