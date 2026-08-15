//! The client's RPC surface: every command, as one registry.
//!
//! Each command has a request struct (the wire payload), an adapter that calls
//! the underlying implementation, and an entry in `rpc_commands!` below, which
//! builds the router and emits the `RpcSchema` TypeScript definition. The
//! single `rpc` Tauri command is the only way the frontend reaches any of
//! this — one envelope, `{ cmd, payload }`, exactly like the proxy app.
//!
//! Adapters exist so command implementations keep their natural Tauri
//! signatures (window, app handle, managed state) while the wire format stays
//! transport-agnostic: a future WebSocket host dispatches into the same router
//! with a different `ClientCtx` construction and nothing else changes.

use crate::error::Result;
use crate::git_watcher::GitWatchResult;
use crate::notifications::YaakNotifier;
use crate::sync_ext::WatchResult;
use crate::updates::YaakUpdater;
use crate::AppMetaData;
use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{Manager, Runtime, State, WebviewWindow};
use tokio::sync::Mutex;
use ts_rs::TS;
use yaak_crypto::manager::EncryptionManager;
use yaak_git::{
    BranchDeleteResult, CloneResult, GitBranchInfo, GitCommit, GitFileDiff, GitRemote,
    GitStatusSummary, GitWorktreeStatus, PullResult, PushResult,
};
use yaak_grpc::manager::GrpcHandle;
use yaak_grpc::ServiceDefinition;
use yaak_models::models::{
    AnyModel, GraphQlIntrospection, GrpcEvent, HttpRequest, HttpRequestHeader, HttpResponse,
    HttpResponseEvent, Plugin, Settings, WebsocketConnection, WebsocketEvent, WorkspaceMeta,
};
use yaak_models::util::BatchUpsertResult;
use yaak_plugins::events::{
    CallFolderActionRequest, CallGrpcRequestActionRequest, CallHttpRequestActionRequest,
    CallWebsocketRequestActionRequest, CallWorkspaceActionRequest, FilterResponse,
    GetFolderActionsResponse, GetGrpcRequestActionsResponse,
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse,
    GetHttpRequestActionsResponse, GetTemplateFunctionConfigResponse,
    GetTemplateFunctionSummaryResponse, GetThemesResponse, GetWebsocketRequestActionsResponse,
    GetWorkspaceActionsResponse, JsonPrimitive, RenderPurpose,
};
use yaak_plugins::api::{PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse};
use yaak_plugins::manager::PluginManager;
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_rpc::RpcRouter;
use yaak_sse::sse::ServerSentEvent;
use yaak_sync::sync::SyncOp;
use yaak_templates::Tokens;
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

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitWatchWorktreeStatusReq {
    pub dir: PathBuf,
    pub stream_id: String,
}

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

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSyncWatchReq {
    pub sync_dir: PathBuf,
    pub workspace_id: String,
    pub stream_id: String,
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

macro_rules! rpc_commands {
    ( $( $name:ident ( $req:ty ) -> $res:ty ),* $(,)? ) => {
        /// Build the router with every command registered. Generic over the
        /// runtime so the same registry serves Wry and CEF builds.
        pub(crate) fn build_rpc_router<R: Runtime>() -> RpcRouter<ClientCtx<R>> {
            let mut router = RpcRouter::new();
            $( router.register(stringify!($name), yaak_rpc::rpc_handler_async!($name)); )*
            router
        }

        /// The wire schema, exported to TypeScript. Field name = command name,
        /// tuple = (request payload, response payload).
        #[derive(TS)]
        #[ts(export, export_to = "gen_rpc.ts")]
        #[allow(non_snake_case, unused)]
        pub(crate) struct RpcSchema {
            $( pub $name: ($req, $res), )*
        }
    };
}

// -- Request payloads and adapters (generated from the original command signatures) --

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdMetadataReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdTemplateTokensToStringReq {
    pub tokens: Tokens,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdRenderTemplateReq {
    pub template: String,
    pub workspace_id: String,
    pub environment_id: Option<String>,
    pub purpose: Option<RenderPurpose>,
    pub ignore_error: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSendFeedbackReq {
    pub feature: String,
    pub text: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDismissNotificationReq {
    pub notification_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGrpcReflectReq {
    pub request_id: String,
    pub environment_id: Option<String>,
    pub proto_files: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGrpcGoReq {
    pub request_id: String,
    pub environment_id: Option<String>,
    pub proto_files: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdRestartReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSendEphemeralRequestReq {
    pub request: HttpRequest,
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
}

/// An unsaved response and its body.
///
/// The body rides along because nothing stored it: there is no database row to
/// look up later and no file for a host to read, so this is the caller's only
/// copy.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct EphemeralHttpResponse {
    pub response: HttpResponse,
    pub body: Vec<u8>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdFormatJsonReq {
    pub text: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdFormatGraphqlReq {
    pub text: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdHttpResponseBodyReq {
    pub response_id: String,
    pub filter: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdHttpResponseBodyPathReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdHttpRequestBodyReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGetSseEventsReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGetHttpResponseEventsReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdImportDataReq {
    pub file_path: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdImportUrlReq {
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdHttpRequestActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdWebsocketRequestActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCallWebsocketRequestActionReq {
    pub req: CallWebsocketRequestActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdWorkspaceActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCallWorkspaceActionReq {
    pub req: CallWorkspaceActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdFolderActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCallFolderActionReq {
    pub req: CallFolderActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGrpcRequestActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdTemplateFunctionSummariesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdTemplateFunctionConfigReq {
    pub function_name: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGetHttpAuthenticationSummariesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGetHttpAuthenticationConfigReq {
    pub auth_name: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCallHttpRequestActionReq {
    pub req: CallHttpRequestActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCallGrpcRequestActionReq {
    pub req: CallGrpcRequestActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCallHttpAuthenticationActionReq {
    pub auth_name: String,
    pub action_index: i32,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCurlToRequestReq {
    pub command: String,
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdExportDataReq {
    pub export_path: String,
    pub workspace_ids: Vec<String>,
    pub include_private_environments: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSaveBase64ToBinaryReq {
    pub filepath: String,
    pub data: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSaveResponseReq {
    pub response_id: String,
    pub filepath: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSendHttpRequestReq {
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdReloadPluginsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginInfoReq {
    pub id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDeleteAllGrpcConnectionsReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDeleteSendHistoryReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDeleteAllHttpResponsesReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGetWorkspaceMetaReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdNewChildWindowReq {
    pub url: String,
    pub label: String,
    pub title: String,
    pub inner_size: (f64, f64),
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdNewMainWindowReq {
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdCheckForUpdatesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDecryptTemplateReq {
    pub template: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSecureTemplateReq {
    pub template: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGetThemesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdEnableEncryptionReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdRevealWorkspaceKeyReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSetWorkspaceKeyReq {
    pub workspace_id: String,
    pub key: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDisableEncryptionReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdDefaultHeadersReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsUpsertReq {
    pub model: AnyModel,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsDeleteReq {
    pub model: AnyModel,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsDuplicateReq {
    pub model_type: String,
    pub model_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsWebsocketEventsReq {
    pub connection_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsGrpcEventsReq {
    pub connection_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsGetSettingsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsGetGraphqlIntrospectionReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsUpsertGraphqlIntrospectionReq {
    pub request_id: String,
    pub workspace_id: String,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct ModelsWorkspaceModelsReq {
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitCheckoutReq {
    pub dir: PathBuf,
    pub branch: String,
    pub force: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitBranchReq {
    pub dir: PathBuf,
    pub branch: String,
    pub base: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitDeleteBranchReq {
    pub dir: PathBuf,
    pub branch: String,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitDeleteRemoteBranchReq {
    pub dir: PathBuf,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitMergeBranchReq {
    pub dir: PathBuf,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitRenameBranchReq {
    pub dir: PathBuf,
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitStatusReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitBranchInfoReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitWorktreeStatusReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitLogReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitLogForFileReq {
    pub dir: PathBuf,
    pub rela_path: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitFileDiffForCommitReq {
    pub dir: PathBuf,
    pub commit_oid: String,
    pub rela_path: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitInitializeReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitCloneReq {
    pub url: String,
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitCommitReq {
    pub dir: PathBuf,
    pub message: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitFetchAllReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitPushReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitPullReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitPullForceResetReq {
    pub dir: PathBuf,
    pub remote: String,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitPullMergeReq {
    pub dir: PathBuf,
    pub remote: String,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitAddReq {
    pub dir: PathBuf,
    pub rela_paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitUnstageReq {
    pub dir: PathBuf,
    pub rela_paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitResetChangesReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitRestoreFilesReq {
    pub dir: PathBuf,
    pub rela_paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitRestoreFileFromCommitReq {
    pub dir: PathBuf,
    pub commit_oid: String,
    pub rela_path: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitAddCredentialReq {
    pub remote_url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitRemotesReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitAddRemoteReq {
    pub dir: PathBuf,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdGitRmRemoteReq {
    pub dir: PathBuf,
    pub name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSyncCalculateReq {
    pub workspace_id: String,
    pub sync_dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSyncCalculateFsReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdSyncApplyReq {
    pub sync_ops: Vec<SyncOp>,
    pub sync_dir: PathBuf,
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdWsDeleteConnectionsReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdWsSendReq {
    pub connection_id: String,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdWsCloseReq {
    pub connection_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdWsConnectReq {
    pub request_id: String,
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginsSearchReq {
    pub query: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginsInstallReq {
    pub name: String,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginsInstallFromDirectoryReq {
    pub directory: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginsUninstallReq {
    pub plugin_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginInitErrorsReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginsUpdatesReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub(crate) struct CmdPluginsUpdateAllReq {}

async fn cmd_metadata<R: Runtime>(ctx: ClientCtx<R>, _req: CmdMetadataReq) -> Result<AppMetaData> {
    Ok(crate::cmd_metadata(ctx.window.app_handle().clone()).await?)
}

async fn cmd_template_tokens_to_string<R: Runtime>(ctx: ClientCtx<R>, req: CmdTemplateTokensToStringReq) -> Result<String> {
    Ok(crate::cmd_template_tokens_to_string(ctx.window.clone(), ctx.window.app_handle().clone(), req.tokens).await?)
}

async fn cmd_render_template<R: Runtime>(ctx: ClientCtx<R>, req: CmdRenderTemplateReq) -> Result<String> {
    Ok(crate::cmd_render_template(ctx.window.clone(), ctx.window.app_handle().clone(), &req.template, &req.workspace_id, req.environment_id.as_deref(), req.purpose, req.ignore_error).await?)
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

async fn cmd_format_json<R: Runtime>(_ctx: ClientCtx<R>, req: CmdFormatJsonReq) -> Result<String> {
    Ok(crate::cmd_format_json(&req.text).await?)
}

async fn cmd_format_graphql<R: Runtime>(_ctx: ClientCtx<R>, req: CmdFormatGraphqlReq) -> Result<String> {
    Ok(crate::cmd_format_graphql(&req.text).await?)
}

async fn cmd_http_response_body<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpResponseBodyReq) -> Result<FilterResponse> {
    Ok(crate::cmd_http_response_body(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>(), &req.response_id, req.filter.as_deref()).await?)
}

async fn cmd_http_response_body_path<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpResponseBodyPathReq) -> Result<Option<String>> {
    Ok(crate::cmd_http_response_body_path(ctx.window.app_handle().clone(), &req.response_id).await?)
}

async fn cmd_http_request_body<R: Runtime>(ctx: ClientCtx<R>, req: CmdHttpRequestBodyReq) -> Result<Option<Vec<u8>>> {
    Ok(crate::cmd_http_request_body(ctx.window.app_handle().clone(), &req.response_id).await?)
}

async fn cmd_get_sse_events<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetSseEventsReq) -> Result<Vec<ServerSentEvent>> {
    Ok(crate::cmd_get_sse_events(ctx.window.app_handle().clone(), &req.response_id).await?)
}

async fn cmd_get_http_response_events<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetHttpResponseEventsReq) -> Result<Vec<HttpResponseEvent>> {
    Ok(crate::cmd_get_http_response_events(ctx.window.app_handle().clone(), &req.response_id).await?)
}

async fn cmd_import_data<R: Runtime>(ctx: ClientCtx<R>, req: CmdImportDataReq) -> Result<BatchUpsertResult> {
    Ok(crate::cmd_import_data(ctx.window.clone(), &req.file_path).await?)
}

async fn cmd_import_url<R: Runtime>(ctx: ClientCtx<R>, req: CmdImportUrlReq) -> Result<BatchUpsertResult> {
    Ok(crate::cmd_import_url(ctx.window.clone(), &req.url).await?)
}

async fn cmd_http_request_actions<R: Runtime>(ctx: ClientCtx<R>, _req: CmdHttpRequestActionsReq) -> Result<Vec<GetHttpRequestActionsResponse>> {
    Ok(crate::cmd_http_request_actions(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_websocket_request_actions<R: Runtime>(ctx: ClientCtx<R>, _req: CmdWebsocketRequestActionsReq) -> Result<Vec<GetWebsocketRequestActionsResponse>> {
    Ok(crate::cmd_websocket_request_actions(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_call_websocket_request_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallWebsocketRequestActionReq) -> Result<()> {
    Ok(crate::cmd_call_websocket_request_action(ctx.window.clone(), req.req, ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_workspace_actions<R: Runtime>(ctx: ClientCtx<R>, _req: CmdWorkspaceActionsReq) -> Result<Vec<GetWorkspaceActionsResponse>> {
    Ok(crate::cmd_workspace_actions(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_call_workspace_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallWorkspaceActionReq) -> Result<()> {
    Ok(crate::cmd_call_workspace_action(ctx.window.clone(), req.req, ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_folder_actions<R: Runtime>(ctx: ClientCtx<R>, _req: CmdFolderActionsReq) -> Result<Vec<GetFolderActionsResponse>> {
    Ok(crate::cmd_folder_actions(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_call_folder_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallFolderActionReq) -> Result<()> {
    Ok(crate::cmd_call_folder_action(ctx.window.clone(), req.req, ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_grpc_request_actions<R: Runtime>(ctx: ClientCtx<R>, _req: CmdGrpcRequestActionsReq) -> Result<Vec<GetGrpcRequestActionsResponse>> {
    Ok(crate::cmd_grpc_request_actions(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_template_function_summaries<R: Runtime>(ctx: ClientCtx<R>, _req: CmdTemplateFunctionSummariesReq) -> Result<Vec<GetTemplateFunctionSummaryResponse>> {
    Ok(crate::cmd_template_function_summaries(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_template_function_config<R: Runtime>(ctx: ClientCtx<R>, req: CmdTemplateFunctionConfigReq) -> Result<GetTemplateFunctionConfigResponse> {
    Ok(crate::cmd_template_function_config(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>(), &req.function_name, req.values, req.model, req.environment_id.as_deref()).await?)
}

async fn cmd_get_http_authentication_summaries<R: Runtime>(ctx: ClientCtx<R>, _req: CmdGetHttpAuthenticationSummariesReq) -> Result<Vec<GetHttpAuthenticationSummaryResponse>> {
    Ok(crate::cmd_get_http_authentication_summaries(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_get_http_authentication_config<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetHttpAuthenticationConfigReq) -> Result<GetHttpAuthenticationConfigResponse> {
    Ok(crate::cmd_get_http_authentication_config(ctx.window.clone(), ctx.window.app_handle().clone(), ctx.window.app_handle().state::<PluginManager>(), ctx.window.app_handle().state::<EncryptionManager>(), &req.auth_name, req.values, req.model, req.environment_id.as_deref()).await?)
}

async fn cmd_call_http_request_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallHttpRequestActionReq) -> Result<()> {
    Ok(crate::cmd_call_http_request_action(ctx.window.clone(), req.req, ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_call_grpc_request_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallGrpcRequestActionReq) -> Result<()> {
    Ok(crate::cmd_call_grpc_request_action(ctx.window.clone(), req.req, ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_call_http_authentication_action<R: Runtime>(ctx: ClientCtx<R>, req: CmdCallHttpAuthenticationActionReq) -> Result<()> {
    Ok(crate::cmd_call_http_authentication_action(ctx.window.clone(), ctx.window.app_handle().clone(), ctx.window.app_handle().state::<PluginManager>(), ctx.window.app_handle().state::<EncryptionManager>(), &req.auth_name, req.action_index, req.values, req.model, req.environment_id.as_deref()).await?)
}

async fn cmd_curl_to_request<R: Runtime>(ctx: ClientCtx<R>, req: CmdCurlToRequestReq) -> Result<HttpRequest> {
    Ok(crate::cmd_curl_to_request(ctx.window.clone(), &req.command, ctx.window.app_handle().state::<PluginManager>(), &req.workspace_id).await?)
}

async fn cmd_export_data<R: Runtime>(ctx: ClientCtx<R>, req: CmdExportDataReq) -> Result<()> {
    Ok(crate::cmd_export_data(ctx.window.app_handle().clone(), &req.export_path, req.workspace_ids.iter().map(|s| s.as_str()).collect(), req.include_private_environments).await?)
}

async fn cmd_save_base64_to_binary<R: Runtime>(ctx: ClientCtx<R>, req: CmdSaveBase64ToBinaryReq) -> Result<()> {
    Ok(crate::cmd_save_base64_to_binary(ctx.window.app_handle().clone(), &req.filepath, &req.data).await?)
}

async fn cmd_save_response<R: Runtime>(ctx: ClientCtx<R>, req: CmdSaveResponseReq) -> Result<()> {
    Ok(crate::cmd_save_response(ctx.window.app_handle().clone(), &req.response_id, &req.filepath).await?)
}

async fn cmd_send_http_request<R: Runtime>(ctx: ClientCtx<R>, req: CmdSendHttpRequestReq) -> Result<HttpResponse> {
    Ok(crate::cmd_send_http_request(ctx.window.app_handle().clone(), ctx.window.clone(), req.environment_id.as_deref(), req.cookie_jar_id.as_deref(), req.request_id).await?)
}

async fn cmd_reload_plugins<R: Runtime>(ctx: ClientCtx<R>, _req: CmdReloadPluginsReq) -> Result<Vec<(String, String)>> {
    Ok(crate::cmd_reload_plugins(ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_plugin_info<R: Runtime>(ctx: ClientCtx<R>, req: CmdPluginInfoReq) -> Result<PluginMetadata> {
    Ok(crate::cmd_plugin_info(&req.id, ctx.window.app_handle().clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_delete_all_grpc_connections<R: Runtime>(ctx: ClientCtx<R>, req: CmdDeleteAllGrpcConnectionsReq) -> Result<()> {
    Ok(crate::cmd_delete_all_grpc_connections(&req.request_id, ctx.window.app_handle().clone(), ctx.window.clone()).await?)
}

async fn cmd_delete_send_history<R: Runtime>(ctx: ClientCtx<R>, req: CmdDeleteSendHistoryReq) -> Result<()> {
    Ok(crate::cmd_delete_send_history(&req.workspace_id, ctx.window.app_handle().clone(), ctx.window.clone()).await?)
}

async fn cmd_delete_all_http_responses<R: Runtime>(ctx: ClientCtx<R>, req: CmdDeleteAllHttpResponsesReq) -> Result<()> {
    Ok(crate::cmd_delete_all_http_responses(&req.request_id, ctx.window.app_handle().clone(), ctx.window.clone()).await?)
}

async fn cmd_get_workspace_meta<R: Runtime>(ctx: ClientCtx<R>, req: CmdGetWorkspaceMetaReq) -> Result<WorkspaceMeta> {
    Ok(crate::cmd_get_workspace_meta(ctx.window.app_handle().clone(), &req.workspace_id).await?)
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
    Ok(crate::commands::cmd_decrypt_template(ctx.window.clone(), &req.template).await?)
}

async fn cmd_secure_template<R: Runtime>(ctx: ClientCtx<R>, req: CmdSecureTemplateReq) -> Result<String> {
    Ok(crate::commands::cmd_secure_template(ctx.window.app_handle().clone(), ctx.window.clone(), &req.template).await?)
}

async fn cmd_get_themes<R: Runtime>(ctx: ClientCtx<R>, _req: CmdGetThemesReq) -> Result<Vec<GetThemesResponse>> {
    Ok(crate::commands::cmd_get_themes(ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_enable_encryption<R: Runtime>(ctx: ClientCtx<R>, req: CmdEnableEncryptionReq) -> Result<()> {
    Ok(crate::commands::cmd_enable_encryption(ctx.window.clone(), &req.workspace_id).await?)
}

async fn cmd_reveal_workspace_key<R: Runtime>(ctx: ClientCtx<R>, req: CmdRevealWorkspaceKeyReq) -> Result<String> {
    Ok(crate::commands::cmd_reveal_workspace_key(ctx.window.clone(), &req.workspace_id).await?)
}

async fn cmd_set_workspace_key<R: Runtime>(ctx: ClientCtx<R>, req: CmdSetWorkspaceKeyReq) -> Result<()> {
    Ok(crate::commands::cmd_set_workspace_key(ctx.window.clone(), &req.workspace_id, &req.key).await?)
}

async fn cmd_disable_encryption<R: Runtime>(ctx: ClientCtx<R>, req: CmdDisableEncryptionReq) -> Result<()> {
    Ok(crate::commands::cmd_disable_encryption(ctx.window.clone(), &req.workspace_id).await?)
}

async fn cmd_default_headers<R: Runtime>(_ctx: ClientCtx<R>, _req: CmdDefaultHeadersReq) -> Result<Vec<HttpRequestHeader>> {
    Ok(crate::commands::cmd_default_headers())
}

async fn models_upsert<R: Runtime>(ctx: ClientCtx<R>, req: ModelsUpsertReq) -> Result<String> {
    Ok(crate::models_ext::models_upsert(ctx.window.clone(), req.model)?)
}

async fn models_delete<R: Runtime>(ctx: ClientCtx<R>, req: ModelsDeleteReq) -> Result<String> {
    Ok(crate::models_ext::models_delete(ctx.window.clone(), req.model).await?)
}

async fn models_duplicate<R: Runtime>(ctx: ClientCtx<R>, req: ModelsDuplicateReq) -> Result<String> {
    Ok(crate::models_ext::models_duplicate(ctx.window.clone(), req.model_type, req.model_id)?)
}

async fn models_websocket_events<R: Runtime>(ctx: ClientCtx<R>, req: ModelsWebsocketEventsReq) -> Result<Vec<WebsocketEvent>> {
    Ok(crate::models_ext::models_websocket_events(ctx.window.app_handle().clone(), &req.connection_id)?)
}

async fn models_grpc_events<R: Runtime>(ctx: ClientCtx<R>, req: ModelsGrpcEventsReq) -> Result<Vec<GrpcEvent>> {
    Ok(crate::models_ext::models_grpc_events(ctx.window.app_handle().clone(), &req.connection_id)?)
}

async fn models_get_settings<R: Runtime>(ctx: ClientCtx<R>, _req: ModelsGetSettingsReq) -> Result<Settings> {
    Ok(crate::models_ext::models_get_settings(ctx.window.app_handle().clone())?)
}

async fn models_get_graphql_introspection<R: Runtime>(ctx: ClientCtx<R>, req: ModelsGetGraphqlIntrospectionReq) -> Result<Option<GraphQlIntrospection>> {
    Ok(crate::models_ext::models_get_graphql_introspection(ctx.window.app_handle().clone(), &req.request_id)?)
}

async fn models_upsert_graphql_introspection<R: Runtime>(ctx: ClientCtx<R>, req: ModelsUpsertGraphqlIntrospectionReq) -> Result<GraphQlIntrospection> {
    Ok(crate::models_ext::models_upsert_graphql_introspection(ctx.window.app_handle().clone(), &req.request_id, &req.workspace_id, req.content, ctx.window.clone())?)
}

async fn models_workspace_models<R: Runtime>(ctx: ClientCtx<R>, req: ModelsWorkspaceModelsReq) -> Result<String> {
    Ok(crate::models_ext::models_workspace_models(ctx.window.clone(), req.workspace_id.as_deref(), ctx.window.app_handle().state::<PluginManager>()).await?)
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
    Ok(crate::ws_ext::cmd_ws_delete_connections(&req.request_id, ctx.window.app_handle().clone(), ctx.window.clone()).await?)
}

async fn cmd_ws_send<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsSendReq) -> Result<WebsocketConnection> {
    Ok(crate::ws_ext::cmd_ws_send(&req.connection_id, req.environment_id.as_deref(), ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<Mutex<WebsocketManager>>()).await?)
}

async fn cmd_ws_close<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsCloseReq) -> Result<WebsocketConnection> {
    Ok(crate::ws_ext::cmd_ws_close(&req.connection_id, ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<Mutex<WebsocketManager>>()).await?)
}

async fn cmd_ws_connect<R: Runtime>(ctx: ClientCtx<R>, req: CmdWsConnectReq) -> Result<WebsocketConnection> {
    Ok(crate::ws_ext::cmd_ws_connect(&req.request_id, req.environment_id.as_deref(), req.cookie_jar_id.as_deref(), ctx.window.app_handle().clone(), ctx.window.clone(), ctx.window.app_handle().state::<PluginManager>(), ctx.window.app_handle().state::<Mutex<WebsocketManager>>()).await?)
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

async fn cmd_plugin_init_errors<R: Runtime>(ctx: ClientCtx<R>, _req: CmdPluginInitErrorsReq) -> Result<Vec<(String, String)>> {
    Ok(crate::plugins_ext::cmd_plugin_init_errors(ctx.window.app_handle().state::<PluginManager>()).await?)
}

async fn cmd_plugins_updates<R: Runtime>(ctx: ClientCtx<R>, _req: CmdPluginsUpdatesReq) -> Result<PluginUpdatesResponse> {
    Ok(crate::plugins_ext::cmd_plugins_updates(ctx.window.app_handle().clone()).await?)
}

async fn cmd_plugins_update_all<R: Runtime>(ctx: ClientCtx<R>, _req: CmdPluginsUpdateAllReq) -> Result<Vec<PluginNameVersion>> {
    Ok(crate::plugins_ext::cmd_plugins_update_all(ctx.window.clone()).await?)
}

rpc_commands! {
    cmd_metadata(CmdMetadataReq) -> AppMetaData,
    cmd_template_tokens_to_string(CmdTemplateTokensToStringReq) -> String,
    cmd_render_template(CmdRenderTemplateReq) -> String,
    cmd_send_feedback(CmdSendFeedbackReq) -> (),
    cmd_dismiss_notification(CmdDismissNotificationReq) -> (),
    cmd_grpc_reflect(CmdGrpcReflectReq) -> Vec<ServiceDefinition>,
    cmd_grpc_go(CmdGrpcGoReq) -> String,
    cmd_restart(CmdRestartReq) -> (),
    cmd_send_ephemeral_request(CmdSendEphemeralRequestReq) -> EphemeralHttpResponse,
    cmd_format_json(CmdFormatJsonReq) -> String,
    cmd_format_graphql(CmdFormatGraphqlReq) -> String,
    cmd_http_response_body(CmdHttpResponseBodyReq) -> FilterResponse,
    cmd_http_response_body_path(CmdHttpResponseBodyPathReq) -> Option<String>,
    cmd_http_request_body(CmdHttpRequestBodyReq) -> Option<Vec<u8>>,
    cmd_get_sse_events(CmdGetSseEventsReq) -> Vec<ServerSentEvent>,
    cmd_get_http_response_events(CmdGetHttpResponseEventsReq) -> Vec<HttpResponseEvent>,
    cmd_import_data(CmdImportDataReq) -> BatchUpsertResult,
    cmd_import_url(CmdImportUrlReq) -> BatchUpsertResult,
    cmd_http_request_actions(CmdHttpRequestActionsReq) -> Vec<GetHttpRequestActionsResponse>,
    cmd_websocket_request_actions(CmdWebsocketRequestActionsReq) -> Vec<GetWebsocketRequestActionsResponse>,
    cmd_call_websocket_request_action(CmdCallWebsocketRequestActionReq) -> (),
    cmd_workspace_actions(CmdWorkspaceActionsReq) -> Vec<GetWorkspaceActionsResponse>,
    cmd_call_workspace_action(CmdCallWorkspaceActionReq) -> (),
    cmd_folder_actions(CmdFolderActionsReq) -> Vec<GetFolderActionsResponse>,
    cmd_call_folder_action(CmdCallFolderActionReq) -> (),
    cmd_grpc_request_actions(CmdGrpcRequestActionsReq) -> Vec<GetGrpcRequestActionsResponse>,
    cmd_template_function_summaries(CmdTemplateFunctionSummariesReq) -> Vec<GetTemplateFunctionSummaryResponse>,
    cmd_template_function_config(CmdTemplateFunctionConfigReq) -> GetTemplateFunctionConfigResponse,
    cmd_get_http_authentication_summaries(CmdGetHttpAuthenticationSummariesReq) -> Vec<GetHttpAuthenticationSummaryResponse>,
    cmd_get_http_authentication_config(CmdGetHttpAuthenticationConfigReq) -> GetHttpAuthenticationConfigResponse,
    cmd_call_http_request_action(CmdCallHttpRequestActionReq) -> (),
    cmd_call_grpc_request_action(CmdCallGrpcRequestActionReq) -> (),
    cmd_call_http_authentication_action(CmdCallHttpAuthenticationActionReq) -> (),
    cmd_curl_to_request(CmdCurlToRequestReq) -> HttpRequest,
    cmd_export_data(CmdExportDataReq) -> (),
    cmd_save_base64_to_binary(CmdSaveBase64ToBinaryReq) -> (),
    cmd_save_response(CmdSaveResponseReq) -> (),
    cmd_send_http_request(CmdSendHttpRequestReq) -> HttpResponse,
    cmd_reload_plugins(CmdReloadPluginsReq) -> Vec<(String, String)>,
    cmd_plugin_info(CmdPluginInfoReq) -> PluginMetadata,
    cmd_delete_all_grpc_connections(CmdDeleteAllGrpcConnectionsReq) -> (),
    cmd_delete_send_history(CmdDeleteSendHistoryReq) -> (),
    cmd_delete_all_http_responses(CmdDeleteAllHttpResponsesReq) -> (),
    cmd_get_workspace_meta(CmdGetWorkspaceMetaReq) -> WorkspaceMeta,
    cmd_new_child_window(CmdNewChildWindowReq) -> (),
    cmd_new_main_window(CmdNewMainWindowReq) -> (),
    cmd_check_for_updates(CmdCheckForUpdatesReq) -> bool,
    cmd_decrypt_template(CmdDecryptTemplateReq) -> String,
    cmd_secure_template(CmdSecureTemplateReq) -> String,
    cmd_get_themes(CmdGetThemesReq) -> Vec<GetThemesResponse>,
    cmd_enable_encryption(CmdEnableEncryptionReq) -> (),
    cmd_reveal_workspace_key(CmdRevealWorkspaceKeyReq) -> String,
    cmd_set_workspace_key(CmdSetWorkspaceKeyReq) -> (),
    cmd_disable_encryption(CmdDisableEncryptionReq) -> (),
    cmd_default_headers(CmdDefaultHeadersReq) -> Vec<HttpRequestHeader>,
    models_upsert(ModelsUpsertReq) -> String,
    models_delete(ModelsDeleteReq) -> String,
    models_duplicate(ModelsDuplicateReq) -> String,
    models_websocket_events(ModelsWebsocketEventsReq) -> Vec<WebsocketEvent>,
    models_grpc_events(ModelsGrpcEventsReq) -> Vec<GrpcEvent>,
    models_get_settings(ModelsGetSettingsReq) -> Settings,
    models_get_graphql_introspection(ModelsGetGraphqlIntrospectionReq) -> Option<GraphQlIntrospection>,
    models_upsert_graphql_introspection(ModelsUpsertGraphqlIntrospectionReq) -> GraphQlIntrospection,
    models_workspace_models(ModelsWorkspaceModelsReq) -> String,
    cmd_git_checkout(CmdGitCheckoutReq) -> String,
    cmd_git_branch(CmdGitBranchReq) -> (),
    cmd_git_delete_branch(CmdGitDeleteBranchReq) -> BranchDeleteResult,
    cmd_git_delete_remote_branch(CmdGitDeleteRemoteBranchReq) -> (),
    cmd_git_merge_branch(CmdGitMergeBranchReq) -> (),
    cmd_git_rename_branch(CmdGitRenameBranchReq) -> (),
    cmd_git_status(CmdGitStatusReq) -> GitStatusSummary,
    cmd_git_branch_info(CmdGitBranchInfoReq) -> GitBranchInfo,
    cmd_git_worktree_status(CmdGitWorktreeStatusReq) -> GitWorktreeStatus,
    cmd_git_log(CmdGitLogReq) -> Vec<GitCommit>,
    cmd_git_log_for_file(CmdGitLogForFileReq) -> Vec<GitCommit>,
    cmd_git_file_diff_for_commit(CmdGitFileDiffForCommitReq) -> GitFileDiff,
    cmd_git_initialize(CmdGitInitializeReq) -> (),
    cmd_git_clone(CmdGitCloneReq) -> CloneResult,
    cmd_git_commit(CmdGitCommitReq) -> (),
    cmd_git_fetch_all(CmdGitFetchAllReq) -> (),
    cmd_git_push(CmdGitPushReq) -> PushResult,
    cmd_git_pull(CmdGitPullReq) -> PullResult,
    cmd_git_pull_force_reset(CmdGitPullForceResetReq) -> PullResult,
    cmd_git_pull_merge(CmdGitPullMergeReq) -> PullResult,
    cmd_git_add(CmdGitAddReq) -> (),
    cmd_git_unstage(CmdGitUnstageReq) -> (),
    cmd_git_reset_changes(CmdGitResetChangesReq) -> (),
    cmd_git_restore_files(CmdGitRestoreFilesReq) -> (),
    cmd_git_restore_file_from_commit(CmdGitRestoreFileFromCommitReq) -> (),
    cmd_git_add_credential(CmdGitAddCredentialReq) -> (),
    cmd_git_remotes(CmdGitRemotesReq) -> Vec<GitRemote>,
    cmd_git_add_remote(CmdGitAddRemoteReq) -> GitRemote,
    cmd_git_rm_remote(CmdGitRmRemoteReq) -> (),
    cmd_sync_calculate(CmdSyncCalculateReq) -> Vec<SyncOp>,
    cmd_sync_calculate_fs(CmdSyncCalculateFsReq) -> Vec<SyncOp>,
    cmd_sync_apply(CmdSyncApplyReq) -> (),
    cmd_ws_delete_connections(CmdWsDeleteConnectionsReq) -> (),
    cmd_ws_send(CmdWsSendReq) -> WebsocketConnection,
    cmd_ws_close(CmdWsCloseReq) -> WebsocketConnection,
    cmd_ws_connect(CmdWsConnectReq) -> WebsocketConnection,
    cmd_plugins_search(CmdPluginsSearchReq) -> PluginSearchResponse,
    cmd_plugins_install(CmdPluginsInstallReq) -> (),
    cmd_plugins_install_from_directory(CmdPluginsInstallFromDirectoryReq) -> Plugin,
    cmd_plugins_uninstall(CmdPluginsUninstallReq) -> Plugin,
    cmd_plugin_init_errors(CmdPluginInitErrorsReq) -> Vec<(String, String)>,
    cmd_plugins_updates(CmdPluginsUpdatesReq) -> PluginUpdatesResponse,
    cmd_plugins_update_all(CmdPluginsUpdateAllReq) -> Vec<PluginNameVersion>,
    cmd_git_watch_worktree_status(CmdGitWatchWorktreeStatusReq) -> GitWatchResult,
    cmd_sync_watch(CmdSyncWatchReq) -> WatchResult,
}
