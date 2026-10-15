use crate::params::*;
use crate::{HostResult, McpHost, WorkspaceInfo};
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{Implementation, ServerCapabilities, ServerConfig};
use rmcp::{ServerHandler, tool, tool_handler, tool_router};
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value, json};
use std::sync::Arc;
use yaak_models::models::{Folder, HttpRequest};
use yaak_plugins::events::{Color, Icon, ShowToastRequest};

type ToolResult = Result<String, String>;

pub struct YaakMcpServer<H: McpHost> {
    host: Arc<H>,
    tool_router: ToolRouter<Self>,
}

impl<H: McpHost> Clone for YaakMcpServer<H> {
    fn clone(&self) -> Self {
        Self { host: self.host.clone(), tool_router: self.tool_router.clone() }
    }
}

impl<H: McpHost> YaakMcpServer<H> {
    pub fn new(host: H) -> Self {
        Self::from_arc(Arc::new(host))
    }

    pub fn from_arc(host: Arc<H>) -> Self {
        Self { host, tool_router: Self::tool_router() }
    }

    fn resolve_workspace(&self, workspace_id: Option<&str>) -> HostResult<WorkspaceInfo> {
        let workspaces = self.host.list_workspaces()?;

        let Some(workspace_id) = workspace_id else {
            if workspaces.len() > 1 {
                let list = workspaces
                    .iter()
                    .enumerate()
                    .map(|(i, w)| format!("{}. {} (ID: {})", i + 1, w.name, w.id))
                    .collect::<Vec<_>>()
                    .join("\n");
                return Err(format!(
                    "Multiple workspaces are open. Please specify which workspace to use.\n\n\
                     Currently open workspaces:\n{list}\n\n\
                     You can use the list_workspaces tool to get workspace IDs, then use other tools \
                     with the workspace context. For example, ask the user which workspace they want \
                     to work with by presenting them with the numbered list above."
                ));
            }
            return workspaces.into_iter().next().ok_or_else(|| "No workspace is open".to_string());
        };

        if let Some(workspace) = workspaces.iter().find(|w| w.id == workspace_id) {
            return Ok(workspace.clone());
        }
        let list =
            workspaces.iter().map(|w| format!("- {} (ID: {})", w.name, w.id)).collect::<Vec<_>>();
        Err(format!(
            "Workspace with ID \"{workspace_id}\" not found.\n\nAvailable workspaces:\n{}",
            list.join("\n")
        ))
    }

    fn find_folder(&self, workspace_id: &str, id: &str) -> HostResult<Option<Folder>> {
        Ok(self.host.list_folders(workspace_id)?.into_iter().find(|f| f.id == id))
    }
}

#[tool_router]
impl<H: McpHost> YaakMcpServer<H> {
    #[tool(
        name = "list_workspaces",
        title = "List Workspaces",
        description = "List all open workspaces in Yaak"
    )]
    async fn list_workspaces(&self) -> ToolResult {
        to_json(&self.host.list_workspaces()?)
    }

    #[tool(
        name = "get_workspace_id",
        title = "Get Workspace ID",
        description = "Get the current workspace ID"
    )]
    async fn get_workspace_id(&self) -> ToolResult {
        Ok(self.resolve_workspace(None)?.id)
    }

    #[tool(
        name = "get_environment_id",
        title = "Get Environment ID",
        description = "Get the current environment ID"
    )]
    async fn get_environment_id(&self) -> ToolResult {
        let workspace = self.resolve_workspace(None)?;
        Ok(self
            .host
            .active_environment_id(&workspace.id)?
            .unwrap_or_else(|| "No environment selected".to_string()))
    }

    #[tool(
        name = "list_http_requests",
        title = "List HTTP Requests",
        description = "List all HTTP requests in a workspace"
    )]
    async fn list_http_requests(&self, Parameters(p): Parameters<WorkspaceParams>) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        to_json(&self.host.list_http_requests(&workspace.id)?)
    }

    #[tool(
        name = "get_http_request",
        title = "Get HTTP Request",
        description = "Get details of a specific HTTP request by ID"
    )]
    async fn get_http_request(
        &self,
        Parameters(p): Parameters<GetHttpRequestParams>,
    ) -> ToolResult {
        self.resolve_workspace(p.workspace_id.as_deref())?;
        to_json(&self.host.get_http_request(&p.id)?)
    }

    #[tool(
        name = "send_http_request",
        title = "Send HTTP Request",
        description = "Send an HTTP request and get the response"
    )]
    async fn send_http_request(
        &self,
        Parameters(p): Parameters<SendHttpRequestParams>,
    ) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        let request = self
            .host
            .get_http_request(&p.id)?
            .ok_or_else(|| format!("HTTP request with ID {} not found", p.id))?;
        let response =
            self.host.send_http_request(&workspace.id, request, p.environment_id).await?;

        // Plugins never saw where the host keeps the body, so neither do MCP clients
        let mut response = serde_json::to_value(response).map_err(|e| e.to_string())?;
        if let Value::Object(fields) = &mut response {
            fields.remove("bodyPath");
        }
        to_json(&response)
    }

    #[tool(
        name = "create_http_request",
        title = "Create HTTP Request",
        description = "Create a new HTTP request"
    )]
    async fn create_http_request(
        &self,
        Parameters(p): Parameters<CreateHttpRequestParams>,
    ) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        let mut fields = Map::new();
        fields.insert("name".into(), json!(""));
        fields.insert("method".into(), json!("GET"));
        fields.insert("workspaceId".into(), json!(workspace.id));
        fields.extend(given_fields(&p));
        fields.insert("id".into(), json!(""));
        let request: HttpRequest = from_fields(fields)?;
        to_json(&self.host.upsert_http_request(&request)?)
    }

    #[tool(
        name = "update_http_request",
        title = "Update HTTP Request",
        description = "Update an existing HTTP request"
    )]
    async fn update_http_request(
        &self,
        Parameters(p): Parameters<UpdateHttpRequestParams>,
    ) -> ToolResult {
        self.resolve_workspace(p.workspace_id.as_deref())?;
        let existing = self
            .host
            .get_http_request(&p.id)?
            .ok_or_else(|| format!("HTTP request with ID {} not found", p.id))?;
        let request: HttpRequest = merge(&existing, given_fields(&p))?;
        to_json(&self.host.upsert_http_request(&request)?)
    }

    #[tool(
        name = "delete_http_request",
        title = "Delete HTTP Request",
        description = "Delete an HTTP request by ID"
    )]
    async fn delete_http_request(
        &self,
        Parameters(p): Parameters<DeleteHttpRequestParams>,
    ) -> ToolResult {
        let request = self.host.delete_http_request(&p.id)?;
        Ok(format!("Deleted: {} ({})", request.name, request.id))
    }

    #[tool(
        name = "list_folders",
        title = "List Folders",
        description = "List all folders in a workspace"
    )]
    async fn list_folders(&self, Parameters(p): Parameters<WorkspaceParams>) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        to_json(&self.host.list_folders(&workspace.id)?)
    }

    #[tool(
        name = "get_folder",
        title = "Get Folder",
        description = "Get details of a specific folder by ID"
    )]
    async fn get_folder(&self, Parameters(p): Parameters<GetFolderParams>) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        to_json(&self.find_folder(&workspace.id, &p.id)?)
    }

    #[tool(
        name = "create_folder",
        title = "Create Folder",
        description = "Create a new folder in a workspace"
    )]
    async fn create_folder(&self, Parameters(p): Parameters<CreateFolderParams>) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        let mut fields = given_fields(&p);
        fields.insert("workspaceId".into(), json!(workspace.id));
        fields.insert("id".into(), json!(""));
        let folder: Folder = from_fields(fields)?;
        to_json(&self.host.upsert_folder(&folder)?)
    }

    #[tool(
        name = "update_folder",
        title = "Update Folder",
        description = "Update an existing folder"
    )]
    async fn update_folder(&self, Parameters(p): Parameters<UpdateFolderParams>) -> ToolResult {
        let workspace = self.resolve_workspace(p.workspace_id.as_deref())?;
        let existing = self
            .find_folder(&workspace.id, &p.id)?
            .ok_or_else(|| format!("Folder with ID {} not found", p.id))?;
        let folder: Folder = merge(&existing, given_fields(&p))?;
        to_json(&self.host.upsert_folder(&folder)?)
    }

    #[tool(
        name = "delete_folder",
        title = "Delete Folder",
        description = "Delete a folder by ID"
    )]
    async fn delete_folder(&self, Parameters(p): Parameters<DeleteFolderParams>) -> ToolResult {
        let folder = self.host.delete_folder(&p.id)?;
        Ok(format!("Deleted: {} ({})", folder.name, folder.id))
    }

    #[tool(
        name = "show_toast",
        title = "Show Toast",
        description = "Show a toast notification in Yaak"
    )]
    async fn show_toast(&self, Parameters(p): Parameters<ShowToastParams>) -> ToolResult {
        self.host.show_toast(ShowToastRequest {
            message: p.message.clone(),
            icon: p.icon.map(icon),
            color: p.color.map(color),
            timeout: Some(p.timeout.map_or(5000, |t| t as i32)),
        })?;
        Ok(format!("✓ Toast shown: \"{}\"", p.message))
    }
}

#[tool_handler]
impl<H: McpHost> ServerHandler for YaakMcpServer<H> {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::new("yaak-mcp-server", env!("CARGO_PKG_VERSION"));
        info
    }
}

fn to_json<T: Serialize>(value: &T) -> ToolResult {
    serde_json::to_string_pretty(value).map_err(|e| format!("Failed to serialize result: {e}"))
}

fn from_fields<T: DeserializeOwned>(fields: Map<String, Value>) -> HostResult<T> {
    serde_json::from_value(Value::Object(fields)).map_err(|e| format!("Invalid input: {e}"))
}

/// The given fields laid over `existing`, keeping its id.
fn merge<T: Serialize + DeserializeOwned>(
    existing: &T,
    given: Map<String, Value>,
) -> HostResult<T> {
    let Value::Object(mut fields) = serde_json::to_value(existing).map_err(|e| e.to_string())?
    else {
        return Err("Model did not serialize to an object".to_string());
    };
    let id = fields.get("id").cloned();
    fields.extend(given);
    if let Some(id) = id {
        fields.insert("id".into(), id);
    }
    from_fields(fields)
}

fn icon(icon: ToastIcon) -> Icon {
    match icon {
        ToastIcon::AlertTriangle => Icon::AlertTriangle,
        ToastIcon::Check => Icon::Check,
        ToastIcon::CheckCircle => Icon::CheckCircle,
        ToastIcon::ChevronDown => Icon::ChevronDown,
        ToastIcon::Copy => Icon::Copy,
        ToastIcon::Info => Icon::Info,
        ToastIcon::Pin => Icon::Pin,
        ToastIcon::Search => Icon::Search,
        ToastIcon::Trash => Icon::Trash,
    }
}

fn color(color: ToastColor) -> Color {
    match color {
        ToastColor::Primary => Color::Primary,
        ToastColor::Secondary => Color::Secondary,
        ToastColor::Info => Color::Info,
        ToastColor::Success => Color::Success,
        ToastColor::Notice => Color::Notice,
        ToastColor::Warning => Color::Warning,
        ToastColor::Danger => Color::Danger,
    }
}
