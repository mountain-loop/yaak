use crate::error::Error::GenericError;
use crate::error::Result;
use crate::models::{AnyModel, GrpcEvent, Settings, WebsocketEvent};
use crate::query_manager::QueryManagerExt;
use crate::util::UpdateSource;
use tauri::{AppHandle, Runtime, WebviewWindow};

#[tauri::command]
pub(crate) fn upsert<R: Runtime>(window: WebviewWindow<R>, model: AnyModel) -> Result<String> {
    let db = window.db();
    let source = &UpdateSource::from_window(&window);
    let id = match model {
        AnyModel::HttpRequest(m) => db.upsert_http_request(&m, source)?.id,
        AnyModel::CookieJar(m) => db.upsert_cookie_jar(&m, source)?.id,
        AnyModel::Environment(m) => db.upsert_environment(&m, source)?.id,
        AnyModel::Folder(m) => db.upsert_folder(&m, source)?.id,
        AnyModel::KeyValue(m) => db.upsert_key_value(&m, source)?.id,
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

#[tauri::command]
pub(crate) fn duplicate<R: Runtime>(window: WebviewWindow<R>, model: AnyModel) -> Result<String> {
    let db = window.db();
    let source = &UpdateSource::from_window(&window);
    let id = match model {
        AnyModel::HttpRequest(m) => db.duplicate_http_request(&m, source)?.id,
        AnyModel::Environment(m) => db.duplicate_environment(&m, source)?.id,
        AnyModel::Folder(m) => db.duplicate_folder(&m, source)?.id,
        AnyModel::GrpcRequest(m) => db.duplicate_grpc_request(&m, source)?.id,
        AnyModel::WebsocketRequest(m) => db.duplicate_websocket_request(&m, source)?.id,
        a => return Err(GenericError(format!("Cannot duplicate AnyModel {a:?})"))),
    };

    Ok(id)
}

#[tauri::command]
pub(crate) fn websocket_events<R: Runtime>(
    app_handle: AppHandle<R>,
    connection_id: &str,
) -> Result<Vec<WebsocketEvent>> {
    Ok(app_handle.db().list_websocket_events(connection_id)?)
}

#[tauri::command]
pub(crate) fn grpc_events<R: Runtime>(
    app_handle: AppHandle<R>,
    connection_id: &str,
) -> Result<Vec<GrpcEvent>> {
    Ok(app_handle.db().list_grpc_events(connection_id)?)
}

#[tauri::command]
pub(crate) fn get_settings<R: Runtime>(app_handle: AppHandle<R>) -> Result<Settings> {
    Ok(app_handle.db().get_settings())
}

#[tauri::command]
pub(crate) fn workspace_models<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: Option<&str>,
) -> Result<Vec<AnyModel>> {
    let db = window.db();
    let mut l: Vec<AnyModel> = Vec::new();

    // Add the settings
    l.push(db.get_settings().into());

    // Add global models
    l.append(&mut db.list_workspaces()?.into_iter().map(Into::into).collect());
    l.append(&mut db.list_workspace_metas()?.into_iter().map(Into::into).collect());
    l.append(&mut db.list_key_values()?.into_iter().map(Into::into).collect());
    l.append(&mut db.list_plugins()?.into_iter().map(Into::into).collect());

    // Add the workspace children
    if let Some(wid) = workspace_id {
        l.append(&mut db.list_cookie_jars(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_environments(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_folders(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_grpc_connections(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_grpc_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_http_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_http_responses(wid, None)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_websocket_connections(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_websocket_requests(wid)?.into_iter().map(Into::into).collect());
    }

    Ok(l)
}
