//! Reading back what a send left behind: response events, request bodies, and
//! where a response body lives.

use crate::error::{Error, Result};
use crate::host::Host;
use std::fs;
use std::path::PathBuf;
use yaak_models::client_db::ClientDb;
use yaak_models::models::HttpResponseEvent;
use yaak_rpc_schema::*;

/// Where a response's body is, and what it is meant to be read as.
pub struct ResponseBodyLocation {
    /// None when the response has no stored body.
    pub path: Option<PathBuf>,
    /// The response's declared `Content-Type`, empty when it has none.
    pub content_type: String,
}

/// Find a response's body from its id alone.
///
/// The frontend hands back an id and never a path, so the only bodies reachable
/// here are ones the engine wrote and the database still knows about. A
/// response that was never saved has no entry, and its body came back from the
/// send that made it.
pub fn locate_response_body(db: &ClientDb, response_id: &str) -> Result<ResponseBodyLocation> {
    let response = db.get_http_response(response_id)?;

    Ok(ResponseBodyLocation {
        path: response.body_path.map(PathBuf::from),
        content_type: response
            .headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case("content-type"))
            .map(|h| h.value.clone())
            .unwrap_or_default(),
    })
}

pub async fn cmd_get_http_response_events<H: Host>(
    host: H,
    req: CmdGetHttpResponseEventsReq,
) -> Result<Vec<HttpResponseEvent>> {
    let events: Vec<HttpResponseEvent> = host.db().list_http_response_events(&req.response_id)?;
    Ok(events)
}

/// The body's path on this machine, for the desktop host to read or hand to the
/// webview's asset protocol.
///
/// The frontend holds response ids; only `packages/platform`'s Tauri host sees
/// the path, and only because it is about to open the file itself. Hosts
/// without a filesystem serve the same bytes over HTTP instead.
pub async fn cmd_http_response_body_path<H: Host>(
    host: H,
    req: CmdHttpResponseBodyPathReq,
) -> Result<Option<String>> {
    let location = locate_response_body(&host.db(), &req.response_id)?;
    Ok(location.path.map(|p| p.to_string_lossy().to_string()))
}

pub async fn cmd_http_request_body<H: Host>(
    host: H,
    req: CmdHttpRequestBodyReq,
) -> Result<Option<Vec<u8>>> {
    let body_id = format!("{}.request", req.response_id);
    let chunks = host.blobs().get_chunks(&body_id)?;

    if chunks.is_empty() {
        return Ok(None);
    }

    // Concatenate all chunks
    let body: Vec<u8> = chunks.into_iter().flat_map(|c| c.data).collect();
    Ok(Some(body))
}

pub async fn cmd_save_response<H: Host>(host: H, req: CmdSaveResponseReq) -> Result<()> {
    let response = host.db().get_http_response(&req.response_id)?;

    let body_path =
        response.body_path.ok_or(Error::Generic("Response does not have a body".to_string()))?;
    fs::copy(body_path, &req.filepath).map_err(|e| Error::Generic(e.to_string()))?;

    Ok(())
}
