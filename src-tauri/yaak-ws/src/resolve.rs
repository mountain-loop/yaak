use crate::error::Result;
use tauri::{Runtime, WebviewWindow};
use yaak_models::models::WebsocketRequest;
use yaak_models::query_manager::QueryManagerExt;

pub(crate) fn resolve_websocket_request<R: Runtime>(
    window: &WebviewWindow<R>,
    request: &WebsocketRequest,
) -> Result<WebsocketRequest> {
    let mut new_request = request.clone();

    let (authentication_type, authentication) =
        window.db().resolve_auth_for_websocket_request(request)?;
    new_request.authentication_type = authentication_type;
    new_request.authentication = authentication;

    let headers = window.db().resolve_headers_for_websocket_request(request)?;
    new_request.headers = headers;

    Ok(new_request)
}
