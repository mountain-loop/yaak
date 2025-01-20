use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{Runtime, WebviewWindow};
use ts_rs::TS;

use yaak_models::models::{Environment, Folder, GrpcRequest, HttpRequest, HttpResponse, Workspace};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct InternalEvent {
    pub id: String,
    pub plugin_ref_id: String,
    pub plugin_name: String,
    pub reply_id: Option<String>,
    pub window_context: WindowContext,
    pub payload: InternalEventPayload,
}

/// Special type used to deserialize everything but the payload. This is so we can
/// catch any plugin-related type errors, since payload is sent by the plugin author
/// and all other fields are sent by Yaak first-party code.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InternalEventRawPayload {
    pub id: String,
    pub plugin_ref_id: String,
    pub plugin_name: String,
    pub reply_id: Option<String>,
    pub window_context: WindowContext,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "events.ts")]
pub enum WindowContext {
    None,
    Label { label: String },
}

impl WindowContext {
    pub fn from_window<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        Self::Label {
            label: window.label().to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "events.ts")]
pub enum InternalEventPayload {
    BootRequest(BootRequest),
    BootResponse(BootResponse),

    ReloadRequest(EmptyPayload),
    ReloadResponse(EmptyPayload),

    TerminateRequest,
    TerminateResponse,

    ImportRequest(ImportRequest),
    ImportResponse(ImportResponse),

    FilterRequest(FilterRequest),
    FilterResponse(FilterResponse),

    ExportHttpRequestRequest(ExportHttpRequestRequest),
    ExportHttpRequestResponse(ExportHttpRequestResponse),

    SendHttpRequestRequest(SendHttpRequestRequest),
    SendHttpRequestResponse(SendHttpRequestResponse),

    // Request Actions
    GetHttpRequestActionsRequest(EmptyPayload),
    GetHttpRequestActionsResponse(GetHttpRequestActionsResponse),
    CallHttpRequestActionRequest(CallHttpRequestActionRequest),

    // Template Functions
    GetTemplateFunctionsRequest,
    GetTemplateFunctionsResponse(GetTemplateFunctionsResponse),
    CallTemplateFunctionRequest(CallTemplateFunctionRequest),
    CallTemplateFunctionResponse(CallTemplateFunctionResponse),

    GetHttpAuthenticationRequest(EmptyPayload),
    GetHttpAuthenticationResponse(GetHttpAuthenticationResponse),
    CallHttpAuthenticationRequest(CallHttpAuthenticationRequest),
    CallHttpAuthenticationResponse(CallHttpAuthenticationResponse),

    CopyTextRequest(CopyTextRequest),

    RenderHttpRequestRequest(RenderHttpRequestRequest),
    RenderHttpRequestResponse(RenderHttpRequestResponse),

    TemplateRenderRequest(TemplateRenderRequest),
    TemplateRenderResponse(TemplateRenderResponse),

    ShowToastRequest(ShowToastRequest),

    PromptTextRequest(PromptTextRequest),
    PromptTextResponse(PromptTextResponse),

    GetHttpRequestByIdRequest(GetHttpRequestByIdRequest),
    GetHttpRequestByIdResponse(GetHttpRequestByIdResponse),

    FindHttpResponsesRequest(FindHttpResponsesRequest),
    FindHttpResponsesResponse(FindHttpResponsesResponse),

    /// Returned when a plugin doesn't get run, just so the server
    /// has something to listen for
    EmptyResponse(EmptyPayload),

    ErrorResponse(ErrorResponse),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, type = "{}", export_to = "events.ts")]
pub struct EmptyPayload {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, export_to = "events.ts")]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct BootRequest {
    pub dir: String,
    pub watch: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct BootResponse {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct ImportRequest {
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct ImportResponse {
    pub resources: ImportResources,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FilterRequest {
    pub content: String,
    pub filter: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FilterResponse {
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct ExportHttpRequestRequest {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct ExportHttpRequestResponse {
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct SendHttpRequestRequest {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct SendHttpRequestResponse {
    pub http_response: HttpResponse,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CopyTextRequest {
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct RenderHttpRequestRequest {
    pub http_request: HttpRequest,
    pub purpose: RenderPurpose,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct RenderHttpRequestResponse {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct TemplateRenderRequest {
    pub data: serde_json::Value,
    pub purpose: RenderPurpose,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct TemplateRenderResponse {
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct ShowToastRequest {
    pub message: String,
    #[ts(optional)]
    pub color: Option<Color>,
    #[ts(optional)]
    pub icon: Option<Icon>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PromptTextRequest {
    // A unique ID to identify the prompt (eg. "enter-password")
    pub id: String,
    // Title to show on the prompt dialog
    pub title: String,
    // Text to show on the label above the input
    pub label: String,
    #[ts(optional)]
    pub description: Option<String>,
    #[ts(optional)]
    pub default_value: Option<String>,
    #[ts(optional)]
    pub placeholder: Option<String>,
    /// Text to add to the confirmation button
    #[ts(optional)]
    pub confirm_text: Option<String>,
    /// Text to add to the cancel button
    #[ts(optional)]
    pub cancel_text: Option<String>,
    /// Require the user to enter a non-empty value
    #[ts(optional)]
    pub required: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct PromptTextResponse {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "events.ts")]
pub enum Color {
    Custom,
    Default,
    Primary,
    Secondary,
    Info,
    Success,
    Notice,
    Warning,
    Danger,
}

impl Default for Color {
    fn default() -> Self {
        Color::Default
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "events.ts")]
pub enum Icon {
    Copy,
    Info,
    CheckCircle,
    AlertTriangle,

    #[serde(untagged)]
    #[ts(type = "\"_unknown\"")]
    _Unknown(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct GetHttpAuthenticationResponse {
    pub name: String,
    pub label: String,
    pub short_label: String,
    pub config: Vec<FormInput>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallHttpAuthenticationRequest {
    pub config: serde_json::Map<String, serde_json::Value>,
    pub method: String,
    pub url: String,
    pub headers: Vec<HttpHeader>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallHttpAuthenticationResponse {
    /// HTTP headers to add to the request. Existing headers will be replaced, while
    /// new headers will be added.
    pub set_headers: Vec<HttpHeader>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct GetTemplateFunctionsResponse {
    pub functions: Vec<TemplateFunction>,
    pub plugin_ref_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct TemplateFunction {
    pub name: String,
    #[ts(optional)]
    pub description: Option<String>,

    /// Also support alternative names. This is useful for not breaking existing
    /// tags when changing the `name` property
    #[ts(optional)]
    pub aliases: Option<Vec<String>>,
    pub args: Vec<FormInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "events.ts")]
pub enum FormInput {
    Text(FormInputText),
    Editor(FormInputEditor),
    Select(FormInputSelect),
    Checkbox(FormInputCheckbox),
    File(FormInputFile),
    HttpRequest(FormInputHttpRequest),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputBase {
    pub name: String,

    /// Whether the user must fill in the argument
    #[ts(optional)]
    pub optional: Option<bool>,

    /// The label of the input
    #[ts(optional)]
    pub label: Option<String>,

    /// Visually hide the label of the input
    #[ts(optional)]
    pub hide_label: Option<bool>,

    /// The default value
    #[ts(optional)]
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputText {
    #[serde(flatten)]
    pub base: FormInputBase,

    /// Placeholder for the text input
    #[ts(optional = nullable)]
    pub placeholder: Option<String>,

    /// Placeholder for the text input
    #[ts(optional)]
    pub password: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "events.ts")]
pub enum EditorLanguage {
    Text,
    Javascript,
    Json,
    Html,
    Xml,
    Graphql,
    Markdown,
}

impl Default for EditorLanguage {
    fn default() -> Self {
        Self::Text
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputEditor {
    #[serde(flatten)]
    pub base: FormInputBase,

    /// Placeholder for the text input
    #[ts(optional = nullable)]
    pub placeholder: Option<String>,

    /// Don't show the editor gutter (line numbers, folds, etc.)
    #[ts(optional)]
    pub hide_gutter: Option<bool>,

    /// Language for syntax highlighting
    #[ts(optional)]
    pub language: Option<EditorLanguage>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputHttpRequest {
    #[serde(flatten)]
    pub base: FormInputBase,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputFile {
    #[serde(flatten)]
    pub base: FormInputBase,

    /// The title of the file selection window
    pub title: String,

    /// Allow selecting multiple files
    #[ts(optional)]
    pub multiple: Option<bool>,

    // Select a directory, not a file
    #[ts(optional)]
    pub directory: Option<bool>,

    // Default file path for selection dialog
    #[ts(optional)]
    pub default_path: Option<String>,

    // Specify to only allow selection of certain file extensions
    #[ts(optional)]
    pub filters: Option<Vec<FileFilter>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FileFilter {
    pub name: String,
    /// File extensions to require
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputSelect {
    #[serde(flatten)]
    pub base: FormInputBase,

    /// The options that will be available in the select input
    pub options: Vec<FormInputSelectOption>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputCheckbox {
    #[serde(flatten)]
    pub base: FormInputBase,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FormInputSelectOption {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallTemplateFunctionRequest {
    pub name: String,
    pub args: CallTemplateFunctionArgs,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallTemplateFunctionResponse {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallTemplateFunctionArgs {
    pub purpose: RenderPurpose,
    pub values: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "events.ts")]
pub enum RenderPurpose {
    Send,
    Preview,
}

impl Default for RenderPurpose {
    fn default() -> Self {
        RenderPurpose::Preview
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, export_to = "events.ts")]
pub struct GetHttpRequestActionsRequest {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct GetHttpRequestActionsResponse {
    pub actions: Vec<HttpRequestAction>,
    pub plugin_ref_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct HttpRequestAction {
    pub key: String,
    pub label: String,
    #[ts(optional)]
    pub icon: Option<Icon>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallHttpRequestActionRequest {
    pub key: String,
    pub plugin_ref_id: String,
    pub args: CallHttpRequestActionArgs,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct CallHttpRequestActionArgs {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct GetHttpRequestByIdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct GetHttpRequestByIdResponse {
    pub http_request: Option<HttpRequest>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FindHttpResponsesRequest {
    pub request_id: String,
    #[ts(optional)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct FindHttpResponsesResponse {
    pub http_responses: Vec<HttpResponse>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "events.ts")]
pub struct ImportResources {
    pub workspaces: Vec<Workspace>,
    pub environments: Vec<Environment>,
    pub folders: Vec<Folder>,
    pub http_requests: Vec<HttpRequest>,
    pub grpc_requests: Vec<GrpcRequest>,
}
