use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_common::window::WorkspaceWindowTrait;
use yaak_models::models::{
    Environment, Folder, GrpcRequest, HttpRequest, HttpResponse, WebsocketRequest, Workspace,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct InternalEvent {
    pub id: String,
    pub plugin_ref_id: String,
    pub plugin_name: String,
    pub reply_id: Option<String>,
    pub window_context: PluginWindowContext,
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
    pub window_context: PluginWindowContext,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_events.ts")]
pub enum PluginWindowContext {
    None,
    Label {
        label: String,
        workspace_id: Option<String>,
    },
}

impl PluginWindowContext {
    pub fn new<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        Self::Label {
            label: window.label().to_string(),
            workspace_id: window.workspace_id(),
        }
    }
    pub fn new_no_workspace<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        Self::Label {
            label: window.label().to_string(),
            workspace_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_events.ts")]
pub enum InternalEventPayload {
    BootRequest(BootRequest),
    BootResponse,

    ReloadResponse(ReloadResponse),

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

    ListCookieNamesRequest(ListCookieNamesRequest),
    ListCookieNamesResponse(ListCookieNamesResponse),
    GetCookieValueRequest(GetCookieValueRequest),
    GetCookieValueResponse(GetCookieValueResponse),

    // HTTP Request Actions
    GetHttpRequestActionsRequest(EmptyPayload),
    GetHttpRequestActionsResponse(GetHttpRequestActionsResponse),
    CallHttpRequestActionRequest(CallHttpRequestActionRequest),

    // Grpc Request Actions
    GetGrpcRequestActionsRequest(EmptyPayload),
    GetGrpcRequestActionsResponse(GetGrpcRequestActionsResponse),
    CallGrpcRequestActionRequest(CallGrpcRequestActionRequest),

    // Template Functions
    GetTemplateFunctionSummaryRequest(EmptyPayload),
    GetTemplateFunctionSummaryResponse(GetTemplateFunctionSummaryResponse),
    GetTemplateFunctionConfigRequest(GetTemplateFunctionConfigRequest),
    GetTemplateFunctionConfigResponse(GetTemplateFunctionConfigResponse),
    CallTemplateFunctionRequest(CallTemplateFunctionRequest),
    CallTemplateFunctionResponse(CallTemplateFunctionResponse),

    // Http Authentication
    GetHttpAuthenticationSummaryRequest(EmptyPayload),
    GetHttpAuthenticationSummaryResponse(GetHttpAuthenticationSummaryResponse),
    GetHttpAuthenticationConfigRequest(GetHttpAuthenticationConfigRequest),
    GetHttpAuthenticationConfigResponse(GetHttpAuthenticationConfigResponse),
    CallHttpAuthenticationRequest(CallHttpAuthenticationRequest),
    CallHttpAuthenticationResponse(CallHttpAuthenticationResponse),
    CallHttpAuthenticationActionRequest(CallHttpAuthenticationActionRequest),
    CallHttpAuthenticationActionResponse(EmptyPayload),

    CopyTextRequest(CopyTextRequest),
    CopyTextResponse(EmptyPayload),

    RenderHttpRequestRequest(RenderHttpRequestRequest),
    RenderHttpRequestResponse(RenderHttpRequestResponse),

    RenderGrpcRequestRequest(RenderGrpcRequestRequest),
    RenderGrpcRequestResponse(RenderGrpcRequestResponse),

    TemplateRenderRequest(TemplateRenderRequest),
    TemplateRenderResponse(TemplateRenderResponse),

    GetKeyValueRequest(GetKeyValueRequest),
    GetKeyValueResponse(GetKeyValueResponse),
    SetKeyValueRequest(SetKeyValueRequest),
    SetKeyValueResponse(SetKeyValueResponse),
    DeleteKeyValueRequest(DeleteKeyValueRequest),
    DeleteKeyValueResponse(DeleteKeyValueResponse),

    OpenWindowRequest(OpenWindowRequest),
    WindowNavigateEvent(WindowNavigateEvent),
    WindowCloseEvent,
    CloseWindowRequest(CloseWindowRequest),

    ShowToastRequest(ShowToastRequest),
    ShowToastResponse(EmptyPayload),

    PromptTextRequest(PromptTextRequest),
    PromptTextResponse(PromptTextResponse),

    GetHttpRequestByIdRequest(GetHttpRequestByIdRequest),
    GetHttpRequestByIdResponse(GetHttpRequestByIdResponse),

    FindHttpResponsesRequest(FindHttpResponsesRequest),
    FindHttpResponsesResponse(FindHttpResponsesResponse),

    GetThemesRequest(GetThemesRequest),
    GetThemesResponse(GetThemesResponse),

    /// Returned when a plugin doesn't get run, just so the server
    /// has something to listen for
    EmptyResponse(EmptyPayload),

    ErrorResponse(ErrorResponse),
}

impl InternalEventPayload {
    pub fn type_name(&self) -> String {
        if let Ok(serde_json::Value::Object(map)) = serde_json::to_value(self) {
            map.get("type").map(|s| s.as_str().unwrap_or("unknown").to_string())
        } else {
            None
        }
        .unwrap_or("invalid_event".to_string())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, type = "{}", export_to = "gen_events.ts")]
pub struct EmptyPayload {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, export_to = "gen_events.ts")]
pub struct ErrorResponse {
    pub error: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct BootRequest {
    pub dir: String,
    pub watch: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ReloadResponse {
    pub silent: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ImportRequest {
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ImportResponse {
    pub resources: ImportResources,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FilterRequest {
    pub content: String,
    pub filter: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FilterResponse {
    pub content: String,
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ExportHttpRequestRequest {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ExportHttpRequestResponse {
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct SendHttpRequestRequest {
    #[ts(type = "Partial<HttpRequest>")]
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct SendHttpRequestResponse {
    pub http_response: HttpResponse,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, type = "{}", export_to = "gen_events.ts")]
pub struct ListCookieNamesRequest {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ListCookieNamesResponse {
    pub names: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetCookieValueRequest {
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetCookieValueResponse {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CopyTextRequest {
    pub text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct RenderHttpRequestRequest {
    pub http_request: HttpRequest,
    pub purpose: RenderPurpose,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct RenderHttpRequestResponse {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct RenderGrpcRequestRequest {
    pub grpc_request: GrpcRequest,
    pub purpose: RenderPurpose,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct RenderGrpcRequestResponse {
    pub grpc_request: GrpcRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetThemesRequest {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ThemeComponents {
    #[ts(optional)]
    pub dialog: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub menu: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub toast: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub sidebar: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub response_pane: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub app_header: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub button: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub banner: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub template_tag: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub url_bar: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub editor: Option<ThemeComponentColors>,
    #[ts(optional)]
    pub input: Option<ThemeComponentColors>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ThemeComponentColors {
    #[ts(optional)]
    pub surface: Option<String>,
    #[ts(optional)]
    pub surface_highlight: Option<String>,
    #[ts(optional)]
    pub surface_active: Option<String>,

    #[ts(optional)]
    pub text: Option<String>,
    #[ts(optional)]
    pub text_subtle: Option<String>,
    #[ts(optional)]
    pub text_subtlest: Option<String>,

    #[ts(optional)]
    pub border: Option<String>,
    #[ts(optional)]
    pub border_subtle: Option<String>,
    #[ts(optional)]
    pub border_focus: Option<String>,

    #[ts(optional)]
    pub shadow: Option<String>,
    #[ts(optional)]
    pub backdrop: Option<String>,
    #[ts(optional)]
    pub selection: Option<String>,

    #[ts(optional)]
    pub primary: Option<String>,
    #[ts(optional)]
    pub secondary: Option<String>,
    #[ts(optional)]
    pub info: Option<String>,
    #[ts(optional)]
    pub success: Option<String>,
    #[ts(optional)]
    pub notice: Option<String>,
    #[ts(optional)]
    pub warning: Option<String>,
    #[ts(optional)]
    pub danger: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct Theme {
    /// How the theme is identified. This should never be changed
    pub id: String,
    /// The friendly name of the theme to be displayed to the user
    pub label: String,
    /// Whether the theme will be used for dark or light appearance
    pub dark: bool,
    /// The default top-level colors for the theme
    pub base: ThemeComponentColors,
    /// Optionally override theme for individual UI components for more control
    #[ts(optional)]
    pub components: Option<ThemeComponents>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetThemesResponse {
    pub themes: Vec<Theme>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct TemplateRenderRequest {
    pub data: serde_json::Value,
    pub purpose: RenderPurpose,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct TemplateRenderResponse {
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct OpenWindowRequest {
    pub url: String,
    /// Label for the window. If not provided, a random one will be generated.
    pub label: String,

    #[ts(optional)]
    pub title: Option<String>,

    #[ts(optional)]
    pub size: Option<WindowSize>,

    #[ts(optional)]
    pub data_dir_key: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct WindowSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CloseWindowRequest {
    pub label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct WindowNavigateEvent {
    pub url: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ShowToastRequest {
    pub message: String,

    #[ts(optional)]
    pub color: Option<Color>,

    #[ts(optional)]
    pub icon: Option<Icon>,

    #[ts(optional)]
    pub timeout: Option<i32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
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
#[ts(export, export_to = "gen_events.ts")]
pub struct PromptTextResponse {
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_events.ts")]
pub enum Color {
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
        Color::Secondary
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_events.ts")]
pub enum Icon {
    AlertTriangle,
    Check,
    CheckCircle,
    ChevronDown,
    Copy,
    Info,
    Pin,
    Search,
    Trash,

    #[serde(untagged)]
    #[ts(type = "\"_unknown\"")]
    _Unknown(String),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetHttpAuthenticationSummaryResponse {
    pub name: String,
    pub label: String,
    pub short_label: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct HttpAuthenticationAction {
    pub label: String,

    #[ts(optional)]
    pub icon: Option<Icon>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetHttpAuthenticationConfigRequest {
    pub context_id: String,
    pub values: HashMap<String, JsonPrimitive>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetHttpAuthenticationConfigResponse {
    pub args: Vec<FormInput>,
    pub plugin_ref_id: String,

    #[ts(optional)]
    pub actions: Option<Vec<HttpAuthenticationAction>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallHttpAuthenticationRequest {
    pub context_id: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub method: String,
    pub url: String,
    pub headers: Vec<HttpHeader>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallHttpAuthenticationActionRequest {
    pub index: i32,
    pub plugin_ref_id: String,
    pub args: CallHttpAuthenticationActionArgs,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallHttpAuthenticationActionArgs {
    pub context_id: String,
    pub values: HashMap<String, JsonPrimitive>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "gen_events.ts")]
pub enum JsonPrimitive {
    String(String),
    Number(f64),
    Boolean(bool),
    Null,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallHttpAuthenticationResponse {
    /// HTTP headers to add to the request. Existing headers will be replaced, while
    /// new headers will be added.
    #[ts(optional)]
    pub set_headers: Option<Vec<HttpHeader>>,

    /// Query parameters to add to the request. Existing params will be replaced, while
    /// new params will be added.
    #[ts(optional)]
    pub set_query_parameters: Option<Vec<HttpHeader>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetTemplateFunctionSummaryResponse {
    pub functions: Vec<TemplateFunction>,
    pub plugin_ref_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetTemplateFunctionConfigRequest {
    pub context_id: String,
    pub name: String,
    pub values: HashMap<String, JsonPrimitive>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetTemplateFunctionConfigResponse {
    pub function: TemplateFunction,
    pub plugin_ref_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct TemplateFunction {
    pub name: String,

    #[ts(optional)]
    pub description: Option<String>,

    /// Also support alternative names. This is useful for not breaking existing
    /// tags when changing the `name` property
    #[ts(optional)]
    pub aliases: Option<Vec<String>>,
    pub args: Vec<TemplateFunctionArg>,
}

/// Similar to FormInput, but contains
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", untagged)]
#[ts(export, export_to = "gen_events.ts")]
pub enum TemplateFunctionArg {
    FormInput(FormInput),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_events.ts")]
pub enum FormInput {
    Text(FormInputText),
    Editor(FormInputEditor),
    Select(FormInputSelect),
    Checkbox(FormInputCheckbox),
    File(FormInputFile),
    HttpRequest(FormInputHttpRequest),
    Accordion(FormInputAccordion),
    Banner(FormInputBanner),
    Markdown(FormInputMarkdown),
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputBase {
    /// The name of the input. The value will be stored at this object attribute in the resulting data
    pub name: String,

    /// Whether this input is visible for the given configuration. Use this to
    /// make branching forms.
    #[ts(optional)]
    pub hidden: Option<bool>,

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

    #[ts(optional)]
    pub disabled: Option<bool>,

    /// Longer description of the input, likely shown in a tooltip
    #[ts(optional)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputText {
    #[serde(flatten)]
    pub base: FormInputBase,

    /// Placeholder for the text input
    #[ts(optional = nullable)]
    pub placeholder: Option<String>,

    /// Placeholder for the text input
    #[ts(optional)]
    pub password: Option<bool>,

    /// Whether to allow newlines in the input, like a <textarea/>
    #[ts(optional)]
    pub multi_line: Option<bool>,

    #[ts(optional)]
    pub completion_options: Option<Vec<GenericCompletionOption>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_events.ts")]
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
#[ts(export, export_to = "gen_events.ts")]
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

    #[ts(optional)]
    pub read_only: Option<bool>,

    #[ts(optional)]
    pub completion_options: Option<Vec<GenericCompletionOption>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GenericCompletionOption {
    label: String,

    #[ts(optional)]
    detail: Option<String>,

    #[ts(optional)]
    info: Option<String>,

    #[ts(optional)]
    #[serde(rename = "type")]
    pub type_: Option<CompletionOptionType>,

    #[ts(optional)]
    pub boost: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_events.ts")]
pub enum CompletionOptionType {
    Constant,
    Variable,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputHttpRequest {
    #[serde(flatten)]
    pub base: FormInputBase,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
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
#[ts(export, export_to = "gen_events.ts")]
pub struct FileFilter {
    pub name: String,
    /// File extensions to require
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputSelect {
    #[serde(flatten)]
    pub base: FormInputBase,

    /// The options that will be available in the select input
    pub options: Vec<FormInputSelectOption>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputCheckbox {
    #[serde(flatten)]
    pub base: FormInputBase,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputSelectOption {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputAccordion {
    pub label: String,

    #[ts(optional)]
    pub inputs: Option<Vec<FormInput>>,

    #[ts(optional)]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputBanner {
    #[ts(optional)]
    pub inputs: Option<Vec<FormInput>>,

    #[ts(optional)]
    pub hidden: Option<bool>,

    #[ts(optional)]
    pub color: Option<Color>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FormInputMarkdown {
    pub content: String,

    #[ts(optional)]
    pub hidden: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_events.ts")]
pub enum Content {
    Text { content: String },
    Markdown { content: String },
}

impl Default for Content {
    fn default() -> Self {
        Self::Text {
            content: String::default(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallTemplateFunctionRequest {
    pub name: String,
    pub args: CallTemplateFunctionArgs,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallTemplateFunctionResponse {
    pub value: Option<String>,
    #[ts(optional)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallTemplateFunctionArgs {
    pub purpose: RenderPurpose,
    pub values: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_events.ts")]
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
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetHttpRequestActionsResponse {
    pub actions: Vec<HttpRequestAction>,
    pub plugin_ref_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct HttpRequestAction {
    pub label: String,
    #[ts(optional)]
    pub icon: Option<Icon>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallHttpRequestActionRequest {
    pub index: i32,
    pub plugin_ref_id: String,
    pub args: CallHttpRequestActionArgs,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallHttpRequestActionArgs {
    pub http_request: HttpRequest,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetGrpcRequestActionsResponse {
    pub actions: Vec<GrpcRequestAction>,
    pub plugin_ref_id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GrpcRequestAction {
    pub label: String,
    #[ts(optional)]
    pub icon: Option<Icon>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallGrpcRequestActionRequest {
    pub index: i32,
    pub plugin_ref_id: String,
    pub args: CallGrpcRequestActionArgs,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct CallGrpcRequestActionArgs {
    pub grpc_request: GrpcRequest,
    pub proto_files: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetHttpRequestByIdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetHttpRequestByIdResponse {
    pub http_request: Option<HttpRequest>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FindHttpResponsesRequest {
    pub request_id: String,
    #[ts(optional)]
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct FindHttpResponsesResponse {
    pub http_responses: Vec<HttpResponse>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct ImportResources {
    pub workspaces: Vec<Workspace>,
    pub environments: Vec<Environment>,
    pub folders: Vec<Folder>,
    pub http_requests: Vec<HttpRequest>,
    pub grpc_requests: Vec<GrpcRequest>,
    pub websocket_requests: Vec<WebsocketRequest>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetKeyValueRequest {
    pub key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct GetKeyValueResponse {
    #[ts(optional)]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct SetKeyValueRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, type = "{}", export_to = "gen_events.ts")]
pub struct SetKeyValueResponse {}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_events.ts")]
pub struct DeleteKeyValueRequest {
    pub key: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, export_to = "gen_events.ts")]
pub struct DeleteKeyValueResponse {
    pub deleted: bool,
}
