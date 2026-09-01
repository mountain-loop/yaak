//! The client's RPC surface: every command, wired to its Tauri implementation.
//!
//! The *shape* of the surface — command names, request payloads, response
//! types — is declared once in `yaak_rpc_schema`, which is also where the
//! TypeScript bindings come from. This module supplies the desktop's half: an
//! adapter per command that turns a `ClientCtx` and a request struct into a
//! call on the existing implementation, and the single `rpc` Tauri command that
//! is the only way the frontend reaches any of it — one envelope,
//! `{ cmd, payload }`, exactly like the proxy app.
//!
//! Command bodies live in one of two places. Host-independent ones are in
//! `yaak_commands`, written against its `Host` trait, which `ClientCtx`
//! implements below; their adapters are one line. The rest still have their
//! natural Tauri signatures (window, app handle, managed state) and their
//! adapters unpack the request for them. Either way the wire format stays
//! transport-agnostic: another host builds its router from the same schema
//! with its own `Host`, and the frontend cannot tell.

use crate::error::Result;
use crate::notifications::YaakNotifier;
use crate::updates::YaakUpdater;
use log::warn;
use serde::Serialize;
use tauri::{Manager, Runtime, State, WebviewWindow};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use yaak_commands::{Host, PluginHost};
use yaak_core::WorkspaceContext;
use yaak_crypto::manager::EncryptionManager;
use yaak_git::{
    BranchDeleteResult, CloneResult, GitBranchInfo, GitCommit, GitFileDiff, GitRemote,
    GitStatusSummary, GitWorktreeStatus, PullResult, PushResult,
};
use yaak_grpc::manager::GrpcHandle;
use yaak_grpc::ServiceDefinition;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{
    GraphQlIntrospection, GrpcEvent, HttpRequest, HttpRequestHeader, HttpResponse,
    HttpResponseEvent, ImportSource, Plugin, Settings, WebsocketConnection, WebsocketEvent,
    WorkspaceMeta,
};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{BatchUpsertResult, ImportPlan};
use yaak_plugins::events::{
    CallFolderActionRequest, CallGrpcRequestActionRequest, CallHttpRequestActionRequest,
    CallWebsocketRequestActionRequest, CallWorkspaceActionRequest, FilterResponse, ImportResponse,
    JsonPrimitive, RenderPurpose, GetFolderActionsResponse, GetGrpcRequestActionsResponse,
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse,
    GetHttpRequestActionsResponse, GetTemplateFunctionConfigResponse,
    GetTemplateFunctionSummaryResponse, GetThemesResponse, GetWebsocketRequestActionsResponse,
    GetWorkspaceActionsResponse,
};
use yaak_plugins::api::{PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::native_template_functions::encrypt_secure_template_function;
use yaak_plugins::template_callback::PluginTemplateCallback;
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_rpc::RpcRouter;
use yaak_rpc_schema::*;
use yaak_sse::sse::ServerSentEvent;
use yaak_sync::sync::SyncOp;
use yaak_templates::TemplateCallback;
use yaak_tauri_utils::window::WorkspaceWindowTrait;
use yaak_ws::WebsocketManager;

/// Per-call context: the window a command was invoked from.
///
/// Window identity is load-bearing — model writes carry it for echo
/// suppression, and plugin events and toasts are routed back through it — so it
/// rides along with every dispatch rather than living in shared state.
pub(crate) struct ClientCtx<R: Runtime> {
    pub window: WebviewWindow<R>,
}

// Derived Clone would demand `R: Clone`, which `Runtime` types don't provide;
// the window handle itself is always cloneable.
impl<R: Runtime> Clone for ClientCtx<R> {
    fn clone(&self) -> Self {
        Self { window: self.window.clone() }
    }
}

/// The desktop is a host: the client is the window, the session is the
/// window's URL, and the shared managers are Tauri managed state.
impl<R: Runtime> Host for ClientCtx<R> {
    fn client_id(&self) -> &str {
        self.window.label()
    }

    fn session(&self) -> WorkspaceContext {
        self.window.workspace_context()
    }

    fn app_version(&self) -> String {
        self.window.package_info().version.to_string()
    }

    fn query_manager(&self) -> &QueryManager {
        self.window.state::<QueryManager>().inner()
    }

    fn blob_manager(&self) -> &BlobManager {
        self.window.state::<BlobManager>().inner()
    }

    fn encryption_manager(&self) -> &EncryptionManager {
        self.window.state::<EncryptionManager>().inner()
    }
}

impl<R: Runtime> ClientCtx<R> {
    /// The plugin runtime this window talks to, once it finishes booting.
    /// Only the `PluginHost` impl below uses it; everything else goes through
    /// the trait.
    async fn pm(&self) -> yaak_plugins::error::Result<PluginManager> {
        crate::plugins_ext::plugin_manager(&self.window).await
    }
}

/// The desktop answers all of these out of the `PluginManager` it already
/// runs — the Node sidecar. Each is a delegation, which is the point: the
/// operations are what the handlers need, and this is one host's way of
/// providing them.
impl<R: Runtime> PluginHost for ClientCtx<R> {
    async fn loaded_plugin_metadata(&self, directory: &str) -> Option<PluginMetadata> {
        let handle = self.pm().await.ok()?.get_plugin_by_dir(directory).await?;
        Some(handle.info())
    }

    async fn take_plugin_init_errors(&self) -> Vec<(String, String)> {
        match self.pm().await {
            Ok(pm) => pm.take_init_errors().await,
            Err(_) => Vec::new(),
        }
    }

    async fn resolve_plugins(&self, plugins: Vec<Plugin>) -> Vec<Plugin> {
        match self.pm().await {
            Ok(pm) => pm.resolve_plugins_for_runtime_from_db(plugins).await,
            Err(_) => plugins,
        }
    }

    async fn template_callback(
        &self,
        purpose: RenderPurpose,
    ) -> yaak_commands::Result<impl TemplateCallback> {
        Ok(PluginTemplateCallback::new(
            Arc::new(self.pm().await?),
            Arc::new(self.encryption_manager().clone()),
            &self.plugin_context(),
            purpose,
        ))
    }

    async fn template_function_summaries(
        &self,
    ) -> yaak_commands::Result<Vec<GetTemplateFunctionSummaryResponse>> {
        Ok(self.pm().await?.get_template_function_summaries(&self.plugin_context()).await?)
    }

    async fn template_function_config(
        &self,
        function_name: &str,
        values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> yaak_commands::Result<GetTemplateFunctionConfigResponse> {
        Ok(self
            .pm()
            .await?
            .get_template_function_config(&self.plugin_context(), function_name, values, model_id)
            .await?)
    }

    async fn themes(&self) -> yaak_commands::Result<Vec<GetThemesResponse>> {
        Ok(self.pm().await?.get_themes(&self.plugin_context()).await?)
    }

    async fn http_request_actions(
        &self,
    ) -> yaak_commands::Result<Vec<GetHttpRequestActionsResponse>> {
        Ok(self.pm().await?.get_http_request_actions(&self.plugin_context()).await?)
    }

    async fn websocket_request_actions(
        &self,
    ) -> yaak_commands::Result<Vec<GetWebsocketRequestActionsResponse>> {
        Ok(self.pm().await?.get_websocket_request_actions(&self.plugin_context()).await?)
    }

    async fn grpc_request_actions(
        &self,
    ) -> yaak_commands::Result<Vec<GetGrpcRequestActionsResponse>> {
        Ok(self.pm().await?.get_grpc_request_actions(&self.plugin_context()).await?)
    }

    async fn workspace_actions(&self) -> yaak_commands::Result<Vec<GetWorkspaceActionsResponse>> {
        Ok(self.pm().await?.get_workspace_actions(&self.plugin_context()).await?)
    }

    async fn folder_actions(&self) -> yaak_commands::Result<Vec<GetFolderActionsResponse>> {
        Ok(self.pm().await?.get_folder_actions(&self.plugin_context()).await?)
    }

    async fn call_http_request_action(
        &self,
        req: CallHttpRequestActionRequest,
    ) -> yaak_commands::Result<()> {
        Ok(self.pm().await?.call_http_request_action(&self.plugin_context(), req).await?)
    }

    async fn call_grpc_request_action(
        &self,
        req: CallGrpcRequestActionRequest,
    ) -> yaak_commands::Result<()> {
        Ok(self.pm().await?.call_grpc_request_action(&self.plugin_context(), req).await?)
    }

    async fn call_websocket_request_action(
        &self,
        req: CallWebsocketRequestActionRequest,
    ) -> yaak_commands::Result<()> {
        Ok(self.pm().await?.call_websocket_request_action(&self.plugin_context(), req).await?)
    }

    async fn call_workspace_action(
        &self,
        req: CallWorkspaceActionRequest,
    ) -> yaak_commands::Result<()> {
        Ok(self.pm().await?.call_workspace_action(&self.plugin_context(), req).await?)
    }

    async fn call_folder_action(
        &self,
        req: CallFolderActionRequest,
    ) -> yaak_commands::Result<()> {
        Ok(self.pm().await?.call_folder_action(&self.plugin_context(), req).await?)
    }

    async fn http_authentication_summaries(
        &self,
    ) -> yaak_commands::Result<Vec<GetHttpAuthenticationSummaryResponse>> {
        let results = self.pm().await?.get_http_authentication_summaries(&self.plugin_context()).await?;
        Ok(results.into_iter().map(|(_, a)| a).collect())
    }

    async fn http_authentication_config(
        &self,
        auth_name: &str,
        values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> yaak_commands::Result<GetHttpAuthenticationConfigResponse> {
        Ok(self
            .pm()
            .await?
            .get_http_authentication_config(&self.plugin_context(), auth_name, values, model_id)
            .await?)
    }

    async fn call_http_authentication_action(
        &self,
        auth_name: &str,
        action_index: i32,
        values: HashMap<String, JsonPrimitive>,
        model_id: &str,
    ) -> yaak_commands::Result<()> {
        Ok(self
            .pm()
            .await?
            .call_http_authentication_action(
                &self.plugin_context(),
                auth_name,
                action_index,
                values,
                model_id,
            )
            .await?)
    }

    async fn import_data(&self, content: &str) -> yaak_commands::Result<ImportResponse> {
        Ok(self.pm().await?.import_data(&self.plugin_context(), content).await?)
    }

    async fn reload_plugins(&self, plugins: Vec<Plugin>) -> Vec<(String, String)> {
        match self.pm().await {
            Ok(pm) => pm.initialize_all_plugins(plugins, &self.plugin_context()).await,
            Err(e) => vec![("*".to_string(), e.to_string())],
        }
    }

    async fn encrypt_secure_template(&self, template: &str) -> yaak_commands::Result<String> {
        let plugin_manager = Arc::new(self.pm().await?);
        let encryption_manager = Arc::new(self.encryption_manager().clone());
        Ok(encrypt_secure_template_function(
            plugin_manager,
            encryption_manager,
            &self.plugin_context(),
            template,
        )?)
    }
}

/// The one Tauri command. The payload is the yaak-rpc envelope's payload;
/// a missing payload means an empty one.
#[tauri::command]
pub(crate) async fn rpc<R: Runtime>(
    window: WebviewWindow<R>,
    router: State<'_, RpcRouter<ClientCtx<R>>>,
    cmd: String,
    payload: Option<serde_json::Value>,
) -> std::result::Result<serde_json::Value, String> {
    let ctx = ClientCtx { window };
    let payload = payload.unwrap_or_else(|| serde_json::Value::Object(Default::default()));
    log::debug!("RPC {cmd}");
    router.dispatch(&cmd, payload, &ctx).await.map_err(|e| {
        log::warn!("RPC {cmd} failed: {}", e.message);
        e.message
    })
}

/// A callback that forwards a stream of messages to the calling window as
/// `stream_{id}` events. The stream id is minted by the caller so it can
/// subscribe before the command starts and never miss a message.
fn stream_emitter<R: Runtime, T: Serialize>(
    ctx: &ClientCtx<R>,
    stream_id: &str,
) -> impl Fn(T) + Send + Sync + 'static {
    use tauri::Emitter;
    let window = ctx.window.clone();
    let event = format!("stream_{stream_id}");
    move |payload: T| {
        let value = match serde_json::to_value(payload) {
            Ok(value) => value,
            Err(e) => {
                warn!("Failed to serialize stream event: {e}");
                return;
            }
        };
        if let Err(e) = window.emit_to(window.label(), &event, value) {
            warn!("Failed to emit stream event: {e}");
        }
    }
}

// -- Streaming commands (hand-written: they push events while they run) --

async fn cmd_git_watch_worktree_status<R: Runtime>(
    ctx: ClientCtx<R>,
    req: CmdGitWatchWorktreeStatusReq,
) -> Result<GitWatchResult> {
    let on_status = stream_emitter(&ctx, &req.stream_id);
    crate::git_watcher::watch_git_worktree_status(
        ctx.window.app_handle().clone(),
        &req.dir,
        on_status,
    )
    .await
}

async fn cmd_sync_watch<R: Runtime>(
    ctx: ClientCtx<R>,
    req: CmdSyncWatchReq,
) -> Result<WatchResult> {
    let on_event = stream_emitter(&ctx, &req.stream_id);
    Ok(crate::sync_ext::sync_watch(
        ctx.window.app_handle().clone(),
        &req.sync_dir,
        &req.workspace_id,
        on_event,
    )
    .await?)
}

/// Build the router with every command in the schema registered to its
/// adapter here. Generic over the runtime so the same registry serves Wry and
/// CEF builds. Adding a command means adding it to the schema *and* writing an
/// adapter below; a missing adapter fails to compile rather than 404 at runtime.
macro_rules! register_commands {
    ( $( $name:ident ( $req:ty ) -> $res:ty ),* $(,)? ) => {
        pub(crate) fn build_rpc_router<R: Runtime>() -> RpcRouter<ClientCtx<R>> {
            let mut router = RpcRouter::new();
            $( router.register(stringify!($name), yaak_rpc::rpc_handler_async!($name)); )*
            router
        }
    };
}
yaak_rpc_schema::with_commands!(register_commands);

// -- Adapters --

async fn cmd_metadata<R: Runtime>(ctx: ClientCtx<R>, _req: CmdMetadataReq) -> Result<AppMetaData> {
    Ok(crate::cmd_metadata(ctx.window.app_handle().clone()).await?)
}

async fn cmd_template_tokens_to_string<R: Runtime>(ctx: ClientCtx<R>, req: CmdTemplateTokensToStringReq) -> Result<String> {
    Ok(yaak_commands::templates::cmd_template_tokens_to_string(ctx, req).await?)
}

async fn cmd_render_template<R: Runtime>(ctx: ClientCtx<R>, req: CmdRenderTemplateReq) -> Result<String> {
    Ok(yaak_commands::templates::cmd_render_template(ctx, req).await?)
}

async fn cmd_send_feedback<R: Runtime>(ctx: ClientCtx<R>, req: CmdSendFeedbackReq) -> Result<()> {
    Ok(crate::cmd_send_feedback(ctx.window.app_handle().clone(), req.feature, req.text).await?)
}

async fn cmd_dismiss_notification<R: Runtime>(ctx: ClientCtx<R>, req: CmdDismissNotificationReq) -> Result<()> {
    Ok(crate::cmd_dismiss_notification(ctx.window.clone(), &req.notification_id, ctx.window.app_handle().state::<Mutex<YaakNotifier>>()).await?)
}

async fn cmd_grpc_reflect<R: Runtime>(ctx: ClientCtx<R>, req: CmdGrpcReflectReq) -> Result<Vec<ServiceDefinition>> {
    Ok(crate::cmd_grpc_reflect(&req.request_id, req.environment_id.as_deref(), req.proto_files, ctx.window.clone(), ctx.window.app_handle().clone(), ctx.window.app_handle().state::<Mutex<GrpcHandle>>()).await?)
}

async fn cmd_grpc_go<R: Runtime>(ctx: ClientCtx<R>, req: CmdGrpcGoReq) -> Result<String> {
    Ok(crate::cmd_grpc_go(&req.request_id, req.environment_id.as_deref(), req.proto_files, ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<Mutex<GrpcHandle>>()).await?)
}

async fn cmd_restart<R: Runtime>(ctx: ClientCtx<R>, _req: CmdRestartReq) -> Result<()> {
    Ok(crate::cmd_restart(ctx.window.app_handle().clone()).await?)
}

async fn cmd_send_ephemeral_request<R: Runtime>(ctx: ClientCtx<R>, req: CmdSendEphemeralRequestReq) -> Result<EphemeralHttpResponse> {
    Ok(crate::cmd_send_ephemeral_request(req.request, req.environment_id.as_deref(), req.cookie_jar_id.as_deref(), ctx.window.clone(), ctx.window.app_handle().clone()).await?)
}

async fn cmd_format_json<R: Runtime>(ctx: ClientCtx<R>, req: CmdFormatJsonReq) -> Result<String> {
    Ok(yaak_commands::data::cmd_format_json(ctx, req).await?)
}

async fn cmd_format_graphql<R: Runtime>(_ctx: ClientCtx<R>, req: CmdFormatGraphqlReq) -> Result<String> {
    Ok(crate::cmd_format_graphql(&req.text).await?)
}

async fn cmd_http_response_body<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpResponseBodyReq) -> Result<FilterResponse> {
    Ok(crate::cmd_http_response_body(ctx.window.clone(), &req.response_id, req.filter.as_deref()).await?)
}

async fn cmd_http_response_body_path<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpResponseBodyPathReq) -> Result<Option<String>> {
    Ok(yaak_commands::responses::cmd_http_response_body_path(ctx, req).await?)
}

async fn cmd_http_request_body<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpRequestBodyReq) -> Result<Option<Vec<u8>>> {
    Ok(yaak_commands::responses::cmd_http_request_body(ctx, req).await?)
}

async fn cmd_get_sse_events<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetSseEventsReq) -> Result<Vec<ServerSentEvent>> {
    Ok(crate::cmd_get_sse_events(ctx.window.app_handle().clone(), &req.response_id).await?)
}

async fn cmd_get_http_response_events<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetHttpResponseEventsReq) -> Result<Vec<HttpResponseEvent>> {
    Ok(yaak_commands::responses::cmd_get_http_response_events(ctx, req).await?)
}

async fn cmd_import_data<R: Runtime>(ctx: ClientCtx<R>, req: CmdImportDataReq) -> Result<ImportPlan> {
    Ok(crate::cmd_import_data(ctx.window.clone(), &req.file_path, req.destination).await?)
}

async fn cmd_import_url<R: Runtime>(ctx: ClientCtx<R>, req: CmdImportUrlReq) -> Result<ImportPlan> {
    Ok(crate::cmd_import_url(ctx.window.clone(), &req.url, req.destination).await?)
}

async fn cmd_commit_import<R: Runtime>(ctx: ClientCtx<R>, req: CmdCommitImportReq) -> Result<BatchUpsertResult> {
    Ok(crate::cmd_commit_import(ctx.window.clone(), req.plan).await?)
}

async fn cmd_list_import_sources<R: Runtime>(ctx: ClientCtx<R>, req: CmdListImportSourcesReq) -> Result<Vec<ImportSource>> {
    use crate::models_ext::QueryManagerExt;
    Ok(ctx.window.db().list_import_sources(&req.workspace_id)?)
}

async fn cmd_import_sources_for_origin<R: Runtime>(ctx: ClientCtx<R>, req: CmdImportSourcesForOriginReq) -> Result<Vec<ImportSource>> {
    use crate::models_ext::QueryManagerExt;
    let origin = match (req.file_path, req.url) {
        (Some(file_path), _) => crate::import::file_origin(&file_path).origin,
        (None, Some(url)) => match crate::import::normalize_import_url(&url) {
            Ok(url) => crate::import::url_origin(&url).origin,
            Err(_) => return Ok(Vec::new()),
        },
        (None, None) => return Ok(Vec::new()),
    };
    Ok(ctx.window.db().list_import_sources_by_origin(&origin)?)
}

async fn cmd_http_request_actions<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpRequestActionsReq) -> Result<Vec<GetHttpRequestActionsResponse>> {
    Ok(yaak_commands::actions::cmd_http_request_actions(ctx, req).await?)
}

async fn cmd_websocket_request_actions<R: Runtime>(ctx: ClientCtx<R>, req: CmdWebsocketRequestActionsReq) -> Result<Vec<GetWebsocketRequestActionsResponse>> {
    Ok(yaak_commands::actions::cmd_websocket_request_actions(ctx, req).await?)
}

async fn cmd_call_websocket_request_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallWebsocketRequestActionReq) -> Result<()> {
    Ok(yaak_commands::actions::cmd_call_websocket_request_action(ctx, req).await?)
}

async fn cmd_workspace_actions<R: Runtime>(ctx: ClientCtx<R>, req: CmdWorkspaceActionsReq) -> Result<Vec<GetWorkspaceActionsResponse>> {
    Ok(yaak_commands::actions::cmd_workspace_actions(ctx, req).await?)
}

async fn cmd_call_workspace_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallWorkspaceActionReq) -> Result<()> {
    Ok(yaak_commands::actions::cmd_call_workspace_action(ctx, req).await?)
}

async fn cmd_folder_actions<R: Runtime>(ctx: ClientCtx<R>, req: CmdFolderActionsReq) -> Result<Vec<GetFolderActionsResponse>> {
    Ok(yaak_commands::actions::cmd_folder_actions(ctx, req).await?)
}

async fn cmd_call_folder_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallFolderActionReq) -> Result<()> {
    Ok(yaak_commands::actions::cmd_call_folder_action(ctx, req).await?)
}

async fn cmd_grpc_request_actions<R: Runtime>(ctx: ClientCtx<R>, req: CmdGrpcRequestActionsReq) -> Result<Vec<GetGrpcRequestActionsResponse>> {
    Ok(yaak_commands::actions::cmd_grpc_request_actions(ctx, req).await?)
}

async fn cmd_template_function_summaries<R: Runtime>(ctx: ClientCtx<R>, req: CmdTemplateFunctionSummariesReq) -> Result<Vec<GetTemplateFunctionSummaryResponse>> {
    Ok(yaak_commands::templates::cmd_template_function_summaries(ctx, req).await?)
}

async fn cmd_template_function_config<R: Runtime>(ctx: ClientCtx<R>, req: CmdTemplateFunctionConfigReq) -> Result<GetTemplateFunctionConfigResponse> {
    Ok(yaak_commands::templates::cmd_template_function_config(ctx, req).await?)
}

async fn cmd_get_http_authentication_summaries<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetHttpAuthenticationSummariesReq) -> Result<Vec<GetHttpAuthenticationSummaryResponse>> {
    Ok(yaak_commands::auth::cmd_get_http_authentication_summaries(ctx, req).await?)
}

async fn cmd_get_http_authentication_config<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetHttpAuthenticationConfigReq) -> Result<GetHttpAuthenticationConfigResponse> {
    Ok(yaak_commands::auth::cmd_get_http_authentication_config(ctx, req).await?)
}

async fn cmd_call_http_request_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallHttpRequestActionReq) -> Result<()> {
    Ok(yaak_commands::actions::cmd_call_http_request_action(ctx, req).await?)
}

async fn cmd_call_grpc_request_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallGrpcRequestActionReq) -> Result<()> {
    Ok(yaak_commands::actions::cmd_call_grpc_request_action(ctx, req).await?)
}

async fn cmd_call_http_authentication_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallHttpAuthenticationActionReq) -> Result<()> {
    Ok(yaak_commands::auth::cmd_call_http_authentication_action(ctx, req).await?)
}

async fn cmd_curl_to_request<R: Runtime>(ctx: ClientCtx<R>, req: CmdCurlToRequestReq) -> Result<HttpRequest> {
    Ok(yaak_commands::actions::cmd_curl_to_request(ctx, req).await?)
}

async fn cmd_export_data<R: Runtime>(ctx: ClientCtx<R>, req: CmdExportDataReq) -> Result<()> {
    Ok(yaak_commands::data::cmd_export_data(ctx, req).await?)
}

async fn cmd_save_base64_to_binary<R: Runtime>(ctx: ClientCtx<R>, req: CmdSaveBase64ToBinaryReq) -> Result<()> {
    Ok(crate::cmd_save_base64_to_binary(ctx.window.app_handle().clone(), &req.filepath, &req.data).await?)
}

async fn cmd_save_response<R: Runtime>(ctx: ClientCtx<R>, req: CmdSaveResponseReq) -> Result<()> {
    Ok(yaak_commands::responses::cmd_save_response(ctx, req).await?)
}

async fn cmd_send_http_request<R: Runtime>(ctx: ClientCtx<R>, req: CmdSendHttpRequestReq) -> Result<HttpResponse> {
    Ok(crate::cmd_send_http_request(ctx.window.app_handle().clone(), ctx.window.clone(), req.environment_id.as_deref(), req.cookie_jar_id.as_deref(), req.request_id).await?)
}

async fn cmd_reload_plugins<R: Runtime>(ctx: ClientCtx<R>, req: CmdReloadPluginsReq) -> Result<Vec<(String, String)>> {
    Ok(yaak_commands::actions::cmd_reload_plugins(ctx, req).await?)
}

async fn cmd_plugin_info<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginInfoReq) -> Result<PluginMetadata> {
    Ok(yaak_commands::plugins::cmd_plugin_info(ctx, req).await?)
}

async fn cmd_delete_all_grpc_connections<R: Runtime>(ctx: ClientCtx<R>, req: CmdDeleteAllGrpcConnectionsReq) -> Result<()> {
    Ok(yaak_commands::models::cmd_delete_all_grpc_connections(ctx, req).await?)
}

async fn cmd_delete_send_history<R: Runtime>(ctx: ClientCtx<R>, req: CmdDeleteSendHistoryReq) -> Result<()> {
    Ok(yaak_commands::models::cmd_delete_send_history(ctx, req).await?)
}

async fn cmd_delete_all_http_responses<R: Runtime>(ctx: ClientCtx<R>, req: CmdDeleteAllHttpResponsesReq) -> Result<()> {
    Ok(yaak_commands::models::cmd_delete_all_http_responses(ctx, req).await?)
}

async fn cmd_get_workspace_meta<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetWorkspaceMetaReq) -> Result<WorkspaceMeta> {
    Ok(yaak_commands::models::cmd_get_workspace_meta(ctx, req).await?)
}

async fn cmd_new_child_window<R: Runtime>(ctx: ClientCtx<R>, req: CmdNewChildWindowReq) -> Result<()> {
    Ok(crate::cmd_new_child_window(ctx.window.clone(), &req.url, &req.label, &req.title, req.inner_size).await?)
}

async fn cmd_new_main_window<R: Runtime>(ctx: ClientCtx<R>, req: CmdNewMainWindowReq) -> Result<()> {
    Ok(crate::cmd_new_main_window(ctx.window.app_handle().clone(), &req.url).await?)
}

async fn cmd_check_for_updates<R: Runtime>(ctx: ClientCtx<R>, _req: CmdCheckForUpdatesReq) -> Result<bool> {
    Ok(crate::cmd_check_for_updates(ctx.window.clone(), ctx.window.app_handle().state::<Mutex<YaakUpdater>>()).await?)
}

async fn cmd_decrypt_template<R: Runtime>(ctx: ClientCtx<R>, req: CmdDecryptTemplateReq) -> Result<String> {
    Ok(yaak_commands::encryption::cmd_decrypt_template(ctx, req).await?)
}

async fn cmd_secure_template<R: Runtime>(ctx: ClientCtx<R>, req: CmdSecureTemplateReq) -> Result<String> {
    Ok(yaak_commands::encryption::cmd_secure_template(ctx, req).await?)
}

async fn cmd_get_themes<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetThemesReq) -> Result<Vec<GetThemesResponse>> {
    Ok(yaak_commands::templates::cmd_get_themes(ctx, req).await?)
}

async fn cmd_enable_encryption<R: Runtime>(ctx: ClientCtx<R>, req: CmdEnableEncryptionReq) -> Result<()> {
    Ok(yaak_commands::encryption::cmd_enable_encryption(ctx, req).await?)
}

async fn cmd_reveal_workspace_key<R: Runtime>(ctx: ClientCtx<R>, req: CmdRevealWorkspaceKeyReq) -> Result<String> {
    Ok(yaak_commands::encryption::cmd_reveal_workspace_key(ctx, req).await?)
}

async fn cmd_set_workspace_key<R: Runtime>(ctx: ClientCtx<R>, req: CmdSetWorkspaceKeyReq) -> Result<()> {
    Ok(yaak_commands::encryption::cmd_set_workspace_key(ctx, req).await?)
}

async fn cmd_disable_encryption<R: Runtime>(ctx: ClientCtx<R>, req: CmdDisableEncryptionReq) -> Result<()> {
    Ok(yaak_commands::encryption::cmd_disable_encryption(ctx, req).await?)
}

async fn cmd_default_headers<R: Runtime>(ctx: ClientCtx<R>, req: CmdDefaultHeadersReq) -> Result<Vec<HttpRequestHeader>> {
    Ok(yaak_commands::models::cmd_default_headers(ctx, req).await?)
}

async fn models_upsert<R: Runtime>(ctx: ClientCtx<R>, req: ModelsUpsertReq) -> Result<String> {
    Ok(yaak_commands::models::models_upsert(ctx, req).await?)
}

/// Runs on a blocking thread rather than the async runtime: a cascading delete
/// (a workspace with thousands of requests) holds a transaction for its whole
/// duration, and stalling the runtime stalls every other IPC call behind it.
/// That is this host's concern, so the shared handler stays plain and the
/// relocation happens here.
async fn models_delete<R: Runtime>(ctx: ClientCtx<R>, req: ModelsDeleteReq) -> Result<String> {
    let deleted = tauri::async_runtime::spawn_blocking(move || {
        yaak_commands::models::models_delete_blocking(&ctx, req)
    })
    .await
    .map_err(|e| crate::error::Error::GenericError(format!("Delete task failed: {e}")))?;
    Ok(deleted?)
}

async fn models_duplicate<R: Runtime>(ctx: ClientCtx<R>, req: ModelsDuplicateReq) -> Result<String> {
    Ok(yaak_commands::models::models_duplicate(ctx, req).await?)
}

async fn models_websocket_events<R: Runtime>(ctx: ClientCtx<R>, req: ModelsWebsocketEventsReq) -> Result<Vec<WebsocketEvent>> {
    Ok(yaak_commands::models::models_websocket_events(ctx, req).await?)
}

async fn models_grpc_events<R: Runtime>(ctx: ClientCtx<R>, req: ModelsGrpcEventsReq) -> Result<Vec<GrpcEvent>> {
    Ok(yaak_commands::models::models_grpc_events(ctx, req).await?)
}

async fn models_get_settings<R: Runtime>(ctx: ClientCtx<R>, req: ModelsGetSettingsReq) -> Result<Settings> {
    Ok(yaak_commands::models::models_get_settings(ctx, req).await?)
}

async fn models_get_graphql_introspection<R: Runtime>(ctx: ClientCtx<R>, req: ModelsGetGraphqlIntrospectionReq) -> Result<Option<GraphQlIntrospection>> {
    Ok(yaak_commands::models::models_get_graphql_introspection(ctx, req).await?)
}

async fn models_upsert_graphql_introspection<R: Runtime>(ctx: ClientCtx<R>, req: ModelsUpsertGraphqlIntrospectionReq) -> Result<GraphQlIntrospection> {
    Ok(yaak_commands::models::models_upsert_graphql_introspection(ctx, req).await?)
}

/// Non-ASCII is escaped to `\uXXXX` before the JSON crosses into the webview:
/// on Linux, sending Cyrillic (and possibly other) characters through this
/// payload leaves every string in the parsed models subtly mis-encoded and
/// CodeMirror unable to place the cursor (feedback: "editing the URL sometimes
/// freezes the app"). Escape sequences sidestep it. This is a quirk of the
/// webview transport, not of the data, so it lives in the adapter rather than
/// the shared handler.
async fn models_workspace_models<R: Runtime>(ctx: ClientCtx<R>, req: ModelsWorkspaceModelsReq) -> Result<String> {
    let json = yaak_commands::models::models_workspace_models(ctx, req).await?;
    Ok(escape_str_for_webview(&json))
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

async fn cmd_git_checkout<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitCheckoutReq) -> Result<String> {
    Ok(crate::git_ext::cmd_git_checkout(&req.dir, &req.branch, req.force).await?)
}

async fn cmd_git_branch<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitBranchReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_branch(&req.dir, &req.branch, req.base.as_deref()).await?)
}

async fn cmd_git_delete_branch<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitDeleteBranchReq) -> Result<BranchDeleteResult> {
    Ok(crate::git_ext::cmd_git_delete_branch(&req.dir, &req.branch, req.force).await?)
}

async fn cmd_git_delete_remote_branch<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitDeleteRemoteBranchReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_delete_remote_branch(&req.dir, &req.branch).await?)
}

async fn cmd_git_merge_branch<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitMergeBranchReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_merge_branch(&req.dir, &req.branch).await?)
}

async fn cmd_git_rename_branch<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitRenameBranchReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_rename_branch(&req.dir, &req.old_name, &req.new_name).await?)
}

async fn cmd_git_status<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitStatusReq) -> Result<GitStatusSummary> {
    Ok(crate::git_ext::cmd_git_status(&req.dir).await?)
}

async fn cmd_git_branch_info<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitBranchInfoReq) -> Result<GitBranchInfo> {
    Ok(crate::git_ext::cmd_git_branch_info(&req.dir).await?)
}

async fn cmd_git_worktree_status<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitWorktreeStatusReq) -> Result<GitWorktreeStatus> {
    Ok(crate::git_ext::cmd_git_worktree_status(&req.dir).await?)
}

async fn cmd_git_log<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitLogReq) -> Result<Vec<GitCommit>> {
    Ok(crate::git_ext::cmd_git_log(&req.dir).await?)
}

async fn cmd_git_log_for_file<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitLogForFileReq) -> Result<Vec<GitCommit>> {
    Ok(crate::git_ext::cmd_git_log_for_file(&req.dir, req.rela_path).await?)
}

async fn cmd_git_file_diff_for_commit<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitFileDiffForCommitReq) -> Result<GitFileDiff> {
    Ok(crate::git_ext::cmd_git_file_diff_for_commit(&req.dir, &req.commit_oid, req.rela_path).await?)
}

async fn cmd_git_initialize<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitInitializeReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_initialize(&req.dir).await?)
}

async fn cmd_git_clone<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitCloneReq) -> Result<CloneResult> {
    Ok(crate::git_ext::cmd_git_clone(&req.url, &req.dir).await?)
}

async fn cmd_git_commit<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitCommitReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_commit(&req.dir, &req.message).await?)
}

async fn cmd_git_fetch_all<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitFetchAllReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_fetch_all(&req.dir).await?)
}

async fn cmd_git_push<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitPushReq) -> Result<PushResult> {
    Ok(crate::git_ext::cmd_git_push(&req.dir).await?)
}

async fn cmd_git_pull<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitPullReq) -> Result<PullResult> {
    Ok(crate::git_ext::cmd_git_pull(&req.dir).await?)
}

async fn cmd_git_pull_force_reset<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitPullForceResetReq) -> Result<PullResult> {
    Ok(crate::git_ext::cmd_git_pull_force_reset(&req.dir, &req.remote, &req.branch).await?)
}

async fn cmd_git_pull_merge<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitPullMergeReq) -> Result<PullResult> {
    Ok(crate::git_ext::cmd_git_pull_merge(&req.dir, &req.remote, &req.branch).await?)
}

async fn cmd_git_add<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitAddReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_add(&req.dir, req.rela_paths).await?)
}

async fn cmd_git_unstage<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitUnstageReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_unstage(&req.dir, req.rela_paths).await?)
}

async fn cmd_git_reset_changes<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitResetChangesReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_reset_changes(&req.dir).await?)
}

async fn cmd_git_restore_files<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitRestoreFilesReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_restore_files(&req.dir, req.rela_paths).await?)
}

async fn cmd_git_restore_file_from_commit<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitRestoreFileFromCommitReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_restore_file_from_commit(&req.dir, &req.commit_oid, req.rela_path).await?)
}

async fn cmd_git_add_credential<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitAddCredentialReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_add_credential(&req.remote_url, &req.username, &req.password).await?)
}

async fn cmd_git_remotes<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitRemotesReq) -> Result<Vec<GitRemote>> {
    Ok(crate::git_ext::cmd_git_remotes(&req.dir).await?)
}

async fn cmd_git_add_remote<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitAddRemoteReq) -> Result<GitRemote> {
    Ok(crate::git_ext::cmd_git_add_remote(&req.dir, &req.name, &req.url).await?)
}

async fn cmd_git_rm_remote<R: Runtime>(_ctx: ClientCtx<R>, req: CmdGitRmRemoteReq) -> Result<()> {
    Ok(crate::git_ext::cmd_git_rm_remote(&req.dir, &req.name).await?)
}

async fn cmd_sync_calculate<R: Runtime>(ctx: ClientCtx<R>, req: CmdSyncCalculateReq) -> Result<Vec<SyncOp>> {
    Ok(crate::sync_ext::cmd_sync_calculate(ctx.window.app_handle().clone(), &req.workspace_id, &req.sync_dir).await?)
}

async fn cmd_sync_calculate_fs<R: Runtime>(_ctx: ClientCtx<R>, req: CmdSyncCalculateFsReq) -> Result<Vec<SyncOp>> {
    Ok(crate::sync_ext::cmd_sync_calculate_fs(&req.dir).await?)
}

async fn cmd_sync_apply<R: Runtime>(ctx: ClientCtx<R>, req: CmdSyncApplyReq) -> Result<()> {
    Ok(crate::sync_ext::cmd_sync_apply(ctx.window.app_handle().clone(), req.sync_ops, &req.sync_dir, &req.workspace_id).await?)
}

async fn cmd_ws_delete_connections<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsDeleteConnectionsReq) -> Result<()> {
    Ok(yaak_commands::models::cmd_ws_delete_connections(ctx, req).await?)
}

async fn cmd_ws_send<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsSendReq) -> Result<WebsocketConnection> {
    Ok(crate::ws_ext::cmd_ws_send(&req.connection_id, req.environment_id.as_deref(), ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<Mutex<WebsocketManager>>()).await?)
}

async fn cmd_ws_close<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsCloseReq) -> Result<WebsocketConnection> {
    Ok(crate::ws_ext::cmd_ws_close(&req.connection_id, ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<Mutex<WebsocketManager>>()).await?)
}

async fn cmd_ws_connect<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsConnectReq) -> Result<WebsocketConnection> {
    Ok(crate::ws_ext::cmd_ws_connect(&req.request_id, req.environment_id.as_deref(), req.cookie_jar_id.as_deref(), ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<Mutex<WebsocketManager>>()).await?)
}

async fn cmd_plugins_search<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginsSearchReq) -> Result<PluginSearchResponse> {
    Ok(crate::plugins_ext::cmd_plugins_search(ctx.window.app_handle().clone(), &req.query).await?)
}

async fn cmd_plugins_install<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginsInstallReq) -> Result<()> {
    Ok(crate::plugins_ext::cmd_plugins_install(ctx.window.clone(), &req.name, req.version).await?)
}

async fn cmd_plugins_install_from_directory<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginsInstallFromDirectoryReq) -> Result<Plugin> {
    Ok(crate::plugins_ext::cmd_plugins_install_from_directory(ctx.window.clone(), &req.directory).await?)
}

async fn cmd_plugins_uninstall<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginsUninstallReq) -> Result<Plugin> {
    Ok(crate::plugins_ext::cmd_plugins_uninstall(&req.plugin_id, ctx.window.clone()).await?)
}

async fn cmd_plugin_init_errors<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginInitErrorsReq) -> Result<Vec<(String, String)>> {
    Ok(yaak_commands::plugins::cmd_plugin_init_errors(ctx, req).await?)
}

async fn cmd_plugins_updates<R: Runtime>(ctx: ClientCtx<R>, _req: CmdPluginsUpdatesReq) -> Result<PluginUpdatesResponse> {
    Ok(crate::plugins_ext::cmd_plugins_updates(ctx.window.app_handle().clone()).await?)
}

async fn cmd_plugins_update_all<R: Runtime>(ctx: ClientCtx<R>, _req: CmdPluginsUpdateAllReq) -> Result<Vec<PluginNameVersion>> {
    Ok(crate::plugins_ext::cmd_plugins_update_all(ctx.window.clone()).await?)
}
