//! Yaak's MCP server: the tools, written once against [`McpHost`], and the
//! transports the CLI serves them on: stdio by default, streamable HTTP with
//! `yaak mcp --http`.

pub mod http;
mod params;
mod server;

use serde::Serialize;
use std::future::Future;
use yaak_models::models::{Folder, HttpRequest, HttpResponse};
use yaak_plugins::events::ShowToastRequest;

pub use server::YaakMcpServer;

pub type HostResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
}

/// What the tools need from whichever process hosts them. Errors are shown to
/// the MCP client as is.
pub trait McpHost: Send + Sync + 'static {
    /// The workspaces a tool may act on: open windows in the app, every
    /// workspace in the CLI.
    fn list_workspaces(&self) -> HostResult<Vec<WorkspaceInfo>>;

    /// The environment a send uses when the caller names none.
    fn active_environment_id(&self, workspace_id: &str) -> HostResult<Option<String>>;

    fn list_http_requests(&self, workspace_id: &str) -> HostResult<Vec<HttpRequest>>;
    fn get_http_request(&self, id: &str) -> HostResult<Option<HttpRequest>>;
    fn upsert_http_request(&self, request: &HttpRequest) -> HostResult<HttpRequest>;
    fn delete_http_request(&self, id: &str) -> HostResult<HttpRequest>;

    fn list_folders(&self, workspace_id: &str) -> HostResult<Vec<Folder>>;
    fn upsert_folder(&self, folder: &Folder) -> HostResult<Folder>;
    fn delete_folder(&self, id: &str) -> HostResult<Folder>;

    /// Send `request` from `workspace_id`, with `environment_id` overriding the
    /// active environment for this send only.
    fn send_http_request(
        &self,
        workspace_id: &str,
        request: HttpRequest,
        environment_id: Option<String>,
    ) -> impl Future<Output = HostResult<HttpResponse>> + Send;

    fn show_toast(&self, toast: ShowToastRequest) -> HostResult<()>;
}

/// Serve the tools on stdin and stdout until the client disconnects.
pub async fn serve_stdio<H: McpHost>(host: H) -> Result<(), String> {
    use rmcp::ServiceExt;
    let service = YaakMcpServer::new(host)
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|e| format!("Failed to start MCP server: {e}"))?;
    service.waiting().await.map_err(|e| format!("MCP server stopped: {e}"))?;
    Ok(())
}
