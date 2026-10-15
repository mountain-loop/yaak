//! The built-in MCP server: `yaak_mcp`'s tools on 127.0.0.1:64343, served
//! while the `mcpServerEnabled` setting is on, behind a bearer token kept in
//! key_values.

use crate::models_ext::QueryManagerExt;
use crate::plugin_events::send_http_request_in_window;
use crate::{environment_from_window, workspace_from_window};
use log::{error, info};
use rand::Rng;
use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};
use tokio::sync::Mutex;
use yaak_mcp::http::{DEFAULT_PORT, HttpServer};
use yaak_mcp::{HostResult, McpHost, WorkspaceInfo};
use yaak_models::models::{Folder, HttpRequest, HttpResponse};
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{Color, PluginContext, ShowToastRequest};

pub(crate) const TOKEN_NAMESPACE: &str = "no_sync";
pub(crate) const TOKEN_KEY: &str = "mcp_server_token";

#[derive(Default)]
struct McpServerState(Mutex<Option<HttpServer>>);

pub(crate) fn init<R: Runtime>(app_handle: &AppHandle<R>) {
    app_handle.manage(McpServerState::default());
    sync(app_handle);
}

/// Start or stop the server to match the setting.
pub(crate) fn sync<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let Some(state) = app_handle.try_state::<McpServerState>() else {
            return;
        };
        let mut server = state.0.lock().await;
        let enabled = app_handle.db().get_settings().mcp_server_enabled;
        match (enabled, server.is_some()) {
            (true, false) => match start(&app_handle).await {
                Ok(s) => {
                    info!("MCP server listening on http://{}{}", s.addr, yaak_mcp::http::PATH);
                    *server = Some(s);
                }
                Err(e) => {
                    error!("Failed to start MCP server: {e}");
                    let _ = app_handle.emit(
                        "show_toast",
                        ShowToastRequest {
                            message: format!(
                                "Failed to start the MCP server on port {DEFAULT_PORT}: {e}"
                            ),
                            color: Some(Color::Danger),
                            timeout: Some(10000),
                            ..Default::default()
                        },
                    );
                }
            },
            (false, true) => {
                if let Some(s) = server.take() {
                    s.stop().await;
                    info!("MCP server stopped");
                }
            }
            (true, true) | (false, false) => {}
        }
    });
}

async fn start<R: Runtime>(app_handle: &AppHandle<R>) -> std::io::Result<HttpServer> {
    let host = Arc::new(AppMcpHost { app_handle: app_handle.clone() });
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, DEFAULT_PORT));
    yaak_mcp::http::serve(host, addr, token(app_handle)).await
}

/// The token, generated the first time the server starts.
fn token<R: Runtime>(app_handle: &AppHandle<R>) -> String {
    let existing = app_handle.db().get_key_value_str(TOKEN_NAMESPACE, TOKEN_KEY, "");
    if !existing.is_empty() {
        return existing;
    }
    let mut rng = rand::rng();
    let token: String = (0..32).map(|_| format!("{:02x}", rng.random::<u8>())).collect();
    if let Err(e) = app_handle.with_tx(|tx| {
        tx.set_key_value_str(TOKEN_NAMESPACE, TOKEN_KEY, &token, &UpdateSource::Background);
        Ok(())
    }) {
        error!("Failed to save MCP server token: {e}");
    }
    token
}

struct AppMcpHost<R: Runtime> {
    app_handle: AppHandle<R>,
}

impl<R: Runtime> AppMcpHost<R> {
    fn window_for_workspace(&self, workspace_id: &str) -> Option<WebviewWindow<R>> {
        self.app_handle
            .webview_windows()
            .into_values()
            .find(|w| workspace_from_window(w).is_some_and(|ws| ws.id == workspace_id))
    }
}

impl<R: Runtime> McpHost for AppMcpHost<R> {
    fn list_workspaces(&self) -> HostResult<Vec<WorkspaceInfo>> {
        let mut workspaces: Vec<WorkspaceInfo> = Vec::new();
        for window in self.app_handle.webview_windows().values() {
            if let Some(w) = workspace_from_window(window)
                && !workspaces.iter().any(|existing| existing.id == w.id)
            {
                workspaces.push(WorkspaceInfo { id: w.id, name: w.name });
            }
        }
        Ok(workspaces)
    }

    fn active_environment_id(&self, workspace_id: &str) -> HostResult<Option<String>> {
        Ok(self
            .window_for_workspace(workspace_id)
            .and_then(|w| environment_from_window(&w))
            .map(|e| e.id))
    }

    fn list_http_requests(&self, workspace_id: &str) -> HostResult<Vec<HttpRequest>> {
        self.app_handle.db().list_http_requests(workspace_id).map_err(|e| e.to_string())
    }

    fn get_http_request(&self, id: &str) -> HostResult<Option<HttpRequest>> {
        Ok(self.app_handle.db().get_http_request(id).ok())
    }

    fn upsert_http_request(&self, request: &HttpRequest) -> HostResult<HttpRequest> {
        self.app_handle
            .with_tx(|tx| tx.upsert_http_request(request, &UpdateSource::Plugin))
            .map_err(|e| format!("Failed to upsert HTTP request: {e}"))
    }

    fn delete_http_request(&self, id: &str) -> HostResult<HttpRequest> {
        self.app_handle
            .with_tx(|tx| tx.delete_http_request_by_id(id, &UpdateSource::Plugin))
            .map_err(|e| format!("Failed to delete HTTP request: {e}"))
    }

    fn list_folders(&self, workspace_id: &str) -> HostResult<Vec<Folder>> {
        self.app_handle.db().list_folders(workspace_id).map_err(|e| e.to_string())
    }

    fn upsert_folder(&self, folder: &Folder) -> HostResult<Folder> {
        self.app_handle
            .with_tx(|tx| tx.upsert_folder(folder, &UpdateSource::Plugin))
            .map_err(|e| format!("Failed to upsert folder: {e}"))
    }

    fn delete_folder(&self, id: &str) -> HostResult<Folder> {
        self.app_handle
            .with_tx(|tx| tx.delete_folder_by_id(id, &UpdateSource::Plugin))
            .map_err(|e| format!("Failed to delete folder: {e}"))
    }

    async fn send_http_request(
        &self,
        workspace_id: &str,
        request: HttpRequest,
        environment_id: Option<String>,
    ) -> HostResult<HttpResponse> {
        let window = self
            .window_for_workspace(workspace_id)
            .ok_or_else(|| format!("No window is open for workspace {workspace_id}"))?;
        let plugin_context = PluginContext {
            label: Some(window.label().to_string()),
            workspace_id: Some(workspace_id.to_string()),
            ..PluginContext::new_empty()
        };
        let sent = send_http_request_in_window(
            &window,
            request,
            environment_id.as_deref(),
            &plugin_context,
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(sent.response)
    }

    fn show_toast(&self, toast: ShowToastRequest) -> HostResult<()> {
        self.app_handle.emit("show_toast", toast).map_err(|e| e.to_string())
    }
}
