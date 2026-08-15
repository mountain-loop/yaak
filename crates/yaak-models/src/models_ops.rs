//! Generic model writes, shared by every host.
//!
//! `upsert`, `delete` and `duplicate` take an `AnyModel` and fan out to the
//! typed query for its variant. That fan-out is long, mechanical, and has to
//! grow a new arm every time a model is added — exactly the code that should
//! not exist twice. The host supplies the database handles and the
//! `UpdateSource` identifying who is writing; nothing here knows whether the
//! caller is a desktop window or an HTTP request.

use crate::blob_manager::BlobManager;
use crate::client_db::ClientDb;
use crate::error::Error::GenericError;
use crate::error::Result;
use crate::models::AnyModel;
use crate::util::UpdateSource;

pub fn upsert_model(
    db: &ClientDb,
    blobs: &BlobManager,
    model: AnyModel,
    source: &UpdateSource,
) -> Result<String> {
    let id = match model {
        AnyModel::CookieJar(m) => db.upsert_cookie_jar(&m, source)?.id,
        AnyModel::Environment(m) => db.upsert_environment(&m, source)?.id,
        AnyModel::Folder(m) => db.upsert_folder(&m, source)?.id,
        AnyModel::GrpcRequest(m) => db.upsert_grpc_request(&m, source)?.id,
        AnyModel::HttpRequest(m) => db.upsert_http_request(&m, source)?.id,
        AnyModel::HttpResponse(m) => db.upsert_http_response(&m, source, blobs)?.id,
        AnyModel::KeyValue(m) => db.upsert_key_value(&m, source)?.id,
        AnyModel::Plugin(m) => db.upsert_plugin(&m, source)?.id,
        AnyModel::Settings(m) => db.upsert_settings(&m, source)?.id,
        AnyModel::WebsocketRequest(m) => db.upsert_websocket_request(&m, source)?.id,
        AnyModel::Workspace(m) => db.upsert_workspace(&m, source)?.id,
        AnyModel::WorkspaceMeta(m) => db.upsert_workspace_meta(&m, source)?.id,
        a => return Err(GenericError(format!("Cannot upsert AnyModel {a:?})"))),
    };

    Ok(id)
}

/// Deletes cascade, so callers run this inside a transaction.
pub fn delete_model(
    tx: &ClientDb,
    blobs: &BlobManager,
    model: AnyModel,
    source: &UpdateSource,
) -> Result<String> {
    let id = match model {
        AnyModel::CookieJar(m) => tx.delete_cookie_jar(&m, source)?.id,
        AnyModel::Environment(m) => tx.delete_environment(&m, source)?.id,
        AnyModel::Folder(m) => tx.delete_folder(&m, source)?.id,
        AnyModel::GrpcConnection(m) => tx.delete_grpc_connection(&m, source)?.id,
        AnyModel::GrpcRequest(m) => tx.delete_grpc_request(&m, source)?.id,
        AnyModel::HttpRequest(m) => tx.delete_http_request(&m, source)?.id,
        AnyModel::HttpResponse(m) => tx.delete_http_response(&m, source, blobs)?.id,
        AnyModel::Plugin(m) => tx.delete_plugin(&m, source)?.id,
        AnyModel::WebsocketConnection(m) => tx.delete_websocket_connection(&m, source)?.id,
        AnyModel::WebsocketRequest(m) => tx.delete_websocket_request(&m, source)?.id,
        AnyModel::Workspace(m) => tx.delete_workspace(&m, source, blobs)?.id,
        a => return Err(GenericError(format!("Cannot delete AnyModel {a:?})"))),
    };

    Ok(id)
}

/// Duplicates recurse, so callers run this inside a transaction.
///
/// The model is re-read from the database rather than taken from the caller, so
/// a duplicate never comes from a stale frontend snapshot.
pub fn duplicate_model(
    tx: &ClientDb,
    model_type: &str,
    model_id: &str,
    source: &UpdateSource,
) -> Result<String> {
    let id = match model_type {
        "environment" => tx.duplicate_environment(&tx.get_environment(model_id)?, source)?.id,
        "folder" => tx.duplicate_folder(&tx.get_folder(model_id)?, source)?.id,
        "grpc_request" => tx.duplicate_grpc_request(&tx.get_grpc_request(model_id)?, source)?.id,
        "http_request" => tx.duplicate_http_request(&tx.get_http_request(model_id)?, source)?.id,
        "websocket_request" => {
            tx.duplicate_websocket_request(&tx.get_websocket_request(model_id)?, source)?.id
        }
        t => return Err(GenericError(format!("Cannot duplicate model type {t}"))),
    };

    Ok(id)
}
