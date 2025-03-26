use crate::error::Error::GenericError;
use crate::error::Result;
use crate::models::AnyModel;
use crate::query_manager::QueryManagerExt;
use crate::util::UpdateSource;
use tauri::{Runtime, WebviewWindow};

#[tauri::command]
pub(crate) async fn upsert<R: Runtime>(
    window: WebviewWindow<R>,
    model: AnyModel,
) -> Result<String> {
    let db = window.db();
    let source = &UpdateSource::from_window(&window);
    let id = match model {
        AnyModel::HttpRequest(m) => db.upsert_http_request(&m, source)?.id,
        AnyModel::CookieJar(m) => db.upsert_cookie_jar(&m, source)?.id,
        AnyModel::Environment(m) => db.upsert_environment(&m, source)?.id,
        AnyModel::Folder(m) => db.upsert_folder(&m, source)?.id,
        AnyModel::GrpcRequest(m) => db.upsert_grpc_request(&m, source)?.id,
        AnyModel::HttpResponse(m) => db.upsert_http_response(&m, source)?.id,
        AnyModel::Plugin(m) => db.upsert_plugin(&m, source)?.id,
        AnyModel::Settings(m) => db.upsert_settings(&m, source)?.id,
        AnyModel::WebsocketRequest(m) => db.upsert_websocket_request(&m, source)?.id,
        AnyModel::Workspace(m) => db.upsert_workspace(&m, source)?.id,
        AnyModel::WorkspaceMeta(m) => db.upsert_workspace_meta(&m, source)?.id,
        a => return Err(GenericError(format!("Cannot upsert AnyModel {a:?})"))),
    };

    Ok(id)
}

#[tauri::command]
pub(crate) fn delete<R: Runtime>(window: WebviewWindow<R>, model: AnyModel) -> Result<String> {
    let db = window.db();
    let source = &UpdateSource::from_window(&window);
    let id = match model {
        AnyModel::HttpRequest(m) => db.delete_http_request(&m, source)?.id,
        AnyModel::CookieJar(m) => db.delete_cookie_jar(&m, source)?.id,
        AnyModel::Environment(m) => db.delete_environment(&m, source)?.id,
        AnyModel::Folder(m) => db.delete_folder(&m, source)?.id,
        AnyModel::GrpcConnection(m) => db.delete_grpc_connection(&m, source)?.id,
        AnyModel::GrpcRequest(m) => db.delete_grpc_request(&m, source)?.id,
        AnyModel::HttpResponse(m) => db.delete_http_response(&m, source)?.id,
        AnyModel::Plugin(m) => db.delete_plugin(&m, source)?.id,
        AnyModel::WebsocketConnection(m) => db.delete_websocket_connection(&m, source)?.id,
        AnyModel::WebsocketRequest(m) => db.delete_websocket_request(&m, source)?.id,
        AnyModel::Workspace(m) => db.delete_workspace(&m, source)?.id,
        a => return Err(GenericError(format!("Cannot delete AnyModel {a:?})"))),
    };

    Ok(id)
}
