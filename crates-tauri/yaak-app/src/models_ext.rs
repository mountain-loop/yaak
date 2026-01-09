//! Tauri-specific extensions for yaak-models.
//!
//! This module provides the Tauri plugin initialization and extension traits
//! that allow accessing QueryManager and BlobManager from Tauri's Manager types.

use tauri::plugin::TauriPlugin;
use tauri::{Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use yaak_models::blob_manager::BlobManager;
use yaak_models::db_context::DbContext;
use yaak_models::error::Result;
use yaak_models::models::{AnyModel, GraphQlIntrospection, GrpcEvent, Settings, WebsocketEvent};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;

/// Extension trait for accessing the QueryManager from Tauri Manager types.
pub trait QueryManagerExt<'a, R> {
    fn db_manager(&'a self) -> State<'a, QueryManager>;
    fn db(&'a self) -> DbContext<'a>;
    fn with_tx<F, T>(&'a self, func: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>;
}

impl<'a, R: Runtime, M: Manager<R>> QueryManagerExt<'a, R> for M {
    fn db_manager(&'a self) -> State<'a, QueryManager> {
        self.state::<QueryManager>()
    }

    fn db(&'a self) -> DbContext<'a> {
        let qm = self.state::<QueryManager>();
        qm.inner().connect()
    }

    fn with_tx<F, T>(&'a self, func: F) -> Result<T>
    where
        F: FnOnce(&DbContext) -> Result<T>,
    {
        let qm = self.state::<QueryManager>();
        qm.inner().with_tx(func)
    }
}

/// Extension trait for accessing the BlobManager from Tauri Manager types.
pub trait BlobManagerExt<'a, R> {
    fn blob_manager(&'a self) -> State<'a, BlobManager>;
    fn blobs(&'a self) -> yaak_models::blob_manager::BlobContext;
}

impl<'a, R: Runtime, M: Manager<R>> BlobManagerExt<'a, R> for M {
    fn blob_manager(&'a self) -> State<'a, BlobManager> {
        self.state::<BlobManager>()
    }

    fn blobs(&'a self) -> yaak_models::blob_manager::BlobContext {
        let manager = self.state::<BlobManager>();
        manager.inner().connect()
    }
}

// Commands for yaak-models
use tauri::WebviewWindow;

#[tauri::command]
pub(crate) fn models_upsert<R: Runtime>(
    window: WebviewWindow<R>,
    model: AnyModel,
) -> Result<String> {
    use yaak_models::error::Error::GenericError;

    let db = window.db();
    let blobs = window.blob_manager();
    let source = &UpdateSource::from_window_label(window.label());
    let id = match model {
        AnyModel::CookieJar(m) => db.upsert_cookie_jar(&m, source)?.id,
        AnyModel::Environment(m) => db.upsert_environment(&m, source)?.id,
        AnyModel::Folder(m) => db.upsert_folder(&m, source)?.id,
        AnyModel::GrpcRequest(m) => db.upsert_grpc_request(&m, source)?.id,
        AnyModel::HttpRequest(m) => db.upsert_http_request(&m, source)?.id,
        AnyModel::HttpResponse(m) => db.upsert_http_response(&m, source, &blobs)?.id,
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

#[tauri::command]
pub(crate) fn models_delete<R: Runtime>(
    window: WebviewWindow<R>,
    model: AnyModel,
) -> Result<String> {
    use yaak_models::error::Error::GenericError;

    let blobs = window.blob_manager();
    // Use transaction for deletions because it might recurse
    window.with_tx(|tx| {
        let source = &UpdateSource::from_window_label(window.label());
        let id = match model {
            AnyModel::CookieJar(m) => tx.delete_cookie_jar(&m, source)?.id,
            AnyModel::Environment(m) => tx.delete_environment(&m, source)?.id,
            AnyModel::Folder(m) => tx.delete_folder(&m, source)?.id,
            AnyModel::GrpcConnection(m) => tx.delete_grpc_connection(&m, source)?.id,
            AnyModel::GrpcRequest(m) => tx.delete_grpc_request(&m, source)?.id,
            AnyModel::HttpRequest(m) => tx.delete_http_request(&m, source)?.id,
            AnyModel::HttpResponse(m) => tx.delete_http_response(&m, source, &blobs)?.id,
            AnyModel::Plugin(m) => tx.delete_plugin(&m, source)?.id,
            AnyModel::WebsocketConnection(m) => tx.delete_websocket_connection(&m, source)?.id,
            AnyModel::WebsocketRequest(m) => tx.delete_websocket_request(&m, source)?.id,
            AnyModel::Workspace(m) => tx.delete_workspace(&m, source)?.id,
            a => return Err(GenericError(format!("Cannot delete AnyModel {a:?})"))),
        };
        Ok(id)
    })
}

#[tauri::command]
pub(crate) fn models_duplicate<R: Runtime>(
    window: WebviewWindow<R>,
    model: AnyModel,
) -> Result<String> {
    use yaak_models::error::Error::GenericError;

    // Use transaction for duplications because it might recurse
    window.with_tx(|tx| {
        let source = &UpdateSource::from_window_label(window.label());
        let id = match model {
            AnyModel::Environment(m) => tx.duplicate_environment(&m, source)?.id,
            AnyModel::Folder(m) => tx.duplicate_folder(&m, source)?.id,
            AnyModel::GrpcRequest(m) => tx.duplicate_grpc_request(&m, source)?.id,
            AnyModel::HttpRequest(m) => tx.duplicate_http_request(&m, source)?.id,
            AnyModel::WebsocketRequest(m) => tx.duplicate_websocket_request(&m, source)?.id,
            a => return Err(GenericError(format!("Cannot duplicate AnyModel {a:?})"))),
        };

        Ok(id)
    })
}

#[tauri::command]
pub(crate) fn models_websocket_events<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    connection_id: &str,
) -> Result<Vec<WebsocketEvent>> {
    Ok(app_handle.db().list_websocket_events(connection_id)?)
}

#[tauri::command]
pub(crate) fn models_grpc_events<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    connection_id: &str,
) -> Result<Vec<GrpcEvent>> {
    Ok(app_handle.db().list_grpc_events(connection_id)?)
}

#[tauri::command]
pub(crate) fn models_get_settings<R: Runtime>(app_handle: tauri::AppHandle<R>) -> Result<Settings> {
    Ok(app_handle.db().get_settings())
}

#[tauri::command]
pub(crate) fn models_get_graphql_introspection<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request_id: &str,
) -> Result<Option<GraphQlIntrospection>> {
    Ok(app_handle.db().get_graphql_introspection(request_id))
}

#[tauri::command]
pub(crate) fn models_upsert_graphql_introspection<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    request_id: &str,
    workspace_id: &str,
    content: Option<String>,
    window: WebviewWindow<R>,
) -> Result<GraphQlIntrospection> {
    let source = UpdateSource::from_window_label(window.label());
    Ok(app_handle.db().upsert_graphql_introspection(workspace_id, request_id, content, &source)?)
}

#[tauri::command]
pub(crate) fn models_workspace_models<R: Runtime>(
    window: WebviewWindow<R>,
    workspace_id: Option<&str>,
) -> Result<String> {
    let db = window.db();
    let mut l: Vec<AnyModel> = Vec::new();

    // Add the settings
    l.push(db.get_settings().into());

    // Add global models
    l.append(&mut db.list_workspaces()?.into_iter().map(Into::into).collect());
    l.append(&mut db.list_key_values()?.into_iter().map(Into::into).collect());
    l.append(&mut db.list_plugins()?.into_iter().map(Into::into).collect());

    // Add the workspace children
    if let Some(wid) = workspace_id {
        l.append(&mut db.list_cookie_jars(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_environments_ensure_base(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_folders(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_grpc_connections(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_grpc_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_http_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_http_responses(wid, None)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_websocket_connections(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_websocket_requests(wid)?.into_iter().map(Into::into).collect());
        l.append(&mut db.list_workspace_metas(wid)?.into_iter().map(Into::into).collect());
    }

    let j = serde_json::to_string(&l)?;

    Ok(escape_str_for_webview(&j))
}

fn escape_str_for_webview(input: &str) -> String {
    input
        .chars()
        .map(|c| {
            let code = c as u32;
            // ASCII
            if code <= 0x7F {
                c.to_string()
                // BMP characters encoded normally
            } else if code < 0xFFFF {
                format!("\\u{:04X}", code)
                // Beyond BMP encoded a surrogate pairs
            } else {
                let high = ((code - 0x10000) >> 10) + 0xD800;
                let low = ((code - 0x10000) & 0x3FF) + 0xDC00;
                format!("\\u{:04X}\\u{:04X}", high, low)
            }
        })
        .collect()
}

/// Initialize database managers as a plugin (for initialization order).
/// Commands are in the main invoke_handler.
/// This must be registered before other plugins that depend on the database.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("yaak-models-db")
        .setup(|app_handle, _api| {
            let app_path = app_handle.path().app_data_dir().unwrap();
            let db_path = app_path.join("db.sqlite");
            let blob_path = app_path.join("blobs.sqlite");

            let (query_manager, blob_manager, rx) =
                match yaak_models::init_standalone(&db_path, &blob_path) {
                    Ok(result) => result,
                    Err(e) => {
                        app_handle
                            .dialog()
                            .message(e.to_string())
                            .kind(MessageDialogKind::Error)
                            .blocking_show();
                        return Err(Box::from(e.to_string()));
                    }
                };

            app_handle.manage(query_manager);
            app_handle.manage(blob_manager);

            // Forward model change events to the frontend
            let app_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                for payload in rx {
                    app_handle.emit("model_write", payload).unwrap();
                }
            });

            Ok(())
        })
        .build()
}
