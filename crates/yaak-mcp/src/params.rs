//! Tool inputs, mirroring the zod schemas of the `@yaak/mcp-server` plugin
//! they replace. Optional fields skip serializing so that a tool's input,
//! serialized, holds only what the caller gave, ready to lay over a model.

use rmcp::schemars::{self, JsonSchema};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

const WORKSPACE_ID: &str = "Workspace ID (required if multiple workspaces are open)";

const BODY_TYPE: &str = r#"Body type. Supported values: "binary", "graphql", "application/x-www-form-urlencoded", "multipart/form-data", or any text-based type (e.g., "application/json", "text/plain")"#;

const BODY: &str = r#"Body content object. Structure varies by bodyType:
- "binary": { filePath: "/path/to/file" }
- "graphql": { query: "{ users { name } }", variables: "{\"id\": \"123\"}" }
- "application/x-www-form-urlencoded": { form: [{ name: "key", value: "val", enabled: true }] }
- "multipart/form-data": { form: [{ name: "field", value: "text", file: "/path/to/file", enabled: true }] }
- text-based (application/json, etc.): { text: "raw body content" }"#;

const AUTHENTICATION_TYPE: &str = r#"Authentication type. Common values: "basic", "bearer", "oauth2", "apikey", "jwt", "awsv4", "oauth1", "ntlm", "none". Use null to inherit from parent."#;

const AUTHENTICATION: &str = r#"Authentication configuration object. Structure varies by authenticationType:
- "basic": { username: "user", password: "pass" }
- "bearer": { token: "abc123", prefix: "Bearer" }
- "oauth2": { clientId: "...", clientSecret: "...", grantType: "authorization_code", authorizationUrl: "...", accessTokenUrl: "...", scope: "...", ... }
- "apikey": { location: "header" | "query", key: "X-API-Key", value: "..." }
- "jwt": { algorithm: "HS256", secret: "...", payload: "{ ... }" }
- "awsv4": { accessKeyId: "...", secretAccessKey: "...", service: "sts", region: "us-east-1", sessionToken: "..." }
- "none": {}"#;

fn enabled_default() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
pub struct Pair {
    pub name: String,
    pub value: String,
    #[serde(default = "enabled_default")]
    pub enabled: bool,
}

/// The given fields of a tool input, by their model names.
pub fn given_fields<T: Serialize>(input: &T) -> Map<String, Value> {
    match serde_json::to_value(input) {
        Ok(Value::Object(fields)) => fields,
        _ => Map::new(),
    }
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceParams {
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetHttpRequestParams {
    #[schemars(description = "The HTTP request ID")]
    pub id: String,
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendHttpRequestParams {
    #[schemars(description = "The HTTP request ID to send")]
    pub id: String,
    #[schemars(
        description = "Environment ID for this send only; defaults to the active environment"
    )]
    pub environment_id: Option<String>,
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateHttpRequestParams {
    #[serde(skip_serializing)]
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request name (empty string to auto-generate from URL)")]
    pub name: Option<String>,
    #[schemars(description = "Request URL")]
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "HTTP method (defaults to GET)")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Parent folder ID")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request description")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request headers")]
    pub headers: Option<Vec<Pair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "URL query parameters")]
    pub url_parameters: Option<Vec<Pair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = BODY_TYPE)]
    pub body_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = BODY)]
    pub body: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION_TYPE)]
    pub authentication_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION)]
    pub authentication: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateHttpRequestParams {
    #[serde(skip_serializing)]
    #[schemars(description = "HTTP request ID to update")]
    pub id: String,
    #[serde(skip_serializing)]
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request name")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request URL")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "HTTP method")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Parent folder ID")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request description")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Request headers")]
    pub headers: Option<Vec<Pair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "URL query parameters")]
    pub url_parameters: Option<Vec<Pair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = BODY_TYPE)]
    pub body_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = BODY)]
    pub body: Option<Map<String, Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION_TYPE)]
    pub authentication_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION)]
    pub authentication: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteHttpRequestParams {
    #[schemars(description = "HTTP request ID to delete")]
    pub id: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetFolderParams {
    #[schemars(description = "The folder ID")]
    pub id: String,
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateFolderParams {
    #[serde(skip_serializing)]
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
    #[schemars(description = "Folder name")]
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Parent folder ID (for nested folders)")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Folder description")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Sort priority for ordering")]
    pub sort_priority: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Default headers to apply to requests in this folder")]
    pub headers: Option<Vec<Pair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION_TYPE)]
    pub authentication_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION)]
    pub authentication: Option<Map<String, Value>>,
}

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFolderParams {
    #[serde(skip_serializing)]
    #[schemars(description = "Folder ID to update")]
    pub id: String,
    #[serde(skip_serializing)]
    #[schemars(description = WORKSPACE_ID)]
    pub workspace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Folder name")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Parent folder ID (for nested folders)")]
    pub folder_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Folder description")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Sort priority for ordering")]
    pub sort_priority: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = "Default headers to apply to requests in this folder")]
    pub headers: Option<Vec<Pair>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION_TYPE)]
    pub authentication_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schemars(description = AUTHENTICATION)]
    pub authentication: Option<Map<String, Value>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct DeleteFolderParams {
    #[schemars(description = "Folder ID to delete")]
    pub id: String,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToastIcon {
    AlertTriangle,
    Check,
    CheckCircle,
    ChevronDown,
    Copy,
    Info,
    Pin,
    Search,
    Trash,
}

#[derive(Debug, Clone, Copy, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToastColor {
    Primary,
    Secondary,
    Info,
    Success,
    Notice,
    Warning,
    Danger,
}

#[derive(Debug, Deserialize, JsonSchema)]
pub struct ShowToastParams {
    #[schemars(description = "The message to display")]
    pub message: String,
    #[schemars(description = "Icon name")]
    pub icon: Option<ToastIcon>,
    #[schemars(description = "Toast color")]
    pub color: Option<ToastColor>,
    #[schemars(description = "Timeout in milliseconds")]
    pub timeout: Option<f64>,
}
