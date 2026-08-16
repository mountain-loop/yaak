//! Filling in what a request inherits from its folders and workspace.
//!
//! A request stored in the database records only what is set *on it*;
//! authentication and headers can come from any ancestor. Anything that acts on
//! a request as the user sees it — sending it, handing it to a plugin — has to
//! resolve that chain first, which is why this is shared rather than living
//! next to any one caller.

use crate::error::Result;
use yaak_models::client_db::ClientDb;
use yaak_models::models::{GrpcRequest, HttpRequest, WebsocketRequest};

/// The request with inherited auth and headers filled in, plus the id of the
/// model the authentication was inherited *from* — plugins key their token
/// caches on it, so it must be the ancestor's id and not the request's.
pub fn resolve_http_request(db: &ClientDb, request: &HttpRequest) -> Result<(HttpRequest, String)> {
    let mut new_request = request.clone();

    let (authentication_type, authentication, authentication_context_id) =
        db.resolve_auth_for_http_request(request)?;
    new_request.authentication_type = authentication_type;
    new_request.authentication = authentication;

    new_request.headers = db.resolve_headers_for_http_request(request)?;

    Ok((new_request, authentication_context_id))
}

pub fn resolve_grpc_request(db: &ClientDb, request: &GrpcRequest) -> Result<(GrpcRequest, String)> {
    let mut new_request = request.clone();

    let (authentication_type, authentication, authentication_context_id) =
        db.resolve_auth_for_grpc_request(request)?;
    new_request.authentication_type = authentication_type;
    new_request.authentication = authentication;

    new_request.metadata = db.resolve_metadata_for_grpc_request(request)?;

    Ok((new_request, authentication_context_id))
}

pub fn resolve_websocket_request(
    db: &ClientDb,
    request: &WebsocketRequest,
) -> Result<(WebsocketRequest, String)> {
    let mut new_request = request.clone();

    let (authentication_type, authentication, authentication_context_id) =
        db.resolve_auth_for_websocket_request(request)?;
    new_request.authentication_type = authentication_type;
    new_request.authentication = authentication;

    new_request.headers = db.resolve_headers_for_websocket_request(request)?;

    Ok((new_request, authentication_context_id))
}
