//! The wire schema for the app's RPC surface: every command name, its request
//! payload, and its response type.
//!
//! This is the one place the frontend contract is declared. Each host — the
//! desktop app, the bridge, anything that comes later — imports these types and
//! implements the commands against them, so the shape of a request cannot
//! drift between hosts and the TypeScript bindings are generated once.
//!
//! Nothing here depends on Tauri or on any host. Request structs are plain data
//! and the few response types declared here (rather than in an engine crate)
//! are too. Command *bodies* live with the host that runs them.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use ts_rs::TS;
use yaak_git::{
    BranchDeleteResult, CloneResult, GitBranchInfo, GitCommit, GitFileDiff, GitRemote,
    GitStatusSummary, GitWorktreeStatus, PullResult, PushResult,
};
use yaak_grpc::ServiceDefinition;
use yaak_models::models::{
    AnyModel, GraphQlIntrospection, GrpcEvent, HttpRequest, HttpRequestHeader, HttpResponse,
    HttpResponseEvent, ImportSource, Plugin, Settings, WebsocketConnection, WebsocketEvent,
    WorkspaceMeta,
};
use yaak_models::util::{BatchUpsertResult, ImportDestination, ImportPlan};
use yaak_plugins::api::{PluginNameVersion, PluginSearchResponse, PluginUpdatesResponse};
use yaak_plugins::events::{
    CallFolderActionRequest, CallGrpcRequestActionRequest, CallHttpRequestActionRequest,
    CallWebsocketRequestActionRequest, CallWorkspaceActionRequest, FilterResponse,
    GetFolderActionsResponse, GetGrpcRequestActionsResponse,
    GetHttpAuthenticationConfigResponse, GetHttpAuthenticationSummaryResponse,
    GetHttpRequestActionsResponse, GetTemplateFunctionConfigResponse,
    GetTemplateFunctionSummaryResponse, GetThemesResponse, GetWebsocketRequestActionsResponse,
    GetWorkspaceActionsResponse, JsonPrimitive, RenderPurpose,
};
use yaak_plugins::plugin_meta::PluginMetadata;
use yaak_sse::sse::ServerSentEvent;
use yaak_sync::sync::SyncOp;
use yaak_templates::Tokens;

// -- Response types that belong to the schema rather than to an engine crate --

/// What the frontend learns about the host it is talking to.
#[derive(Debug, Default, Serialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct AppMetaData {
    pub is_dev: bool,
    pub version: String,
    pub cli_version: Option<String>,
    pub name: String,
    pub app_data_dir: String,
    pub app_log_dir: String,
    pub vendored_plugin_dir: String,
    pub default_project_dir: String,
    pub feature_updater: bool,
    pub feature_license: bool,
}

/// Returned by the two watch commands: the name of the event to emit to stop
/// the watcher.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GitWatchResult {
    pub unlisten_event: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct WatchResult {
    pub unlisten_event: String,
}

// -- Request payloads --

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitWatchWorktreeStatusReq {
    pub dir: PathBuf,
    pub stream_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSyncWatchReq {
    pub sync_dir: PathBuf,
    pub workspace_id: String,
    pub stream_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdMetadataReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdTemplateTokensToStringReq {
    pub tokens: Tokens,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdRenderTemplateReq {
    pub template: String,
    pub workspace_id: String,
    pub environment_id: Option<String>,
    pub purpose: Option<RenderPurpose>,
    pub ignore_error: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSendFeedbackReq {
    pub feature: String,
    pub text: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDismissNotificationReq {
    pub notification_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGrpcReflectReq {
    pub request_id: String,
    pub environment_id: Option<String>,
    pub proto_files: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGrpcGoReq {
    pub request_id: String,
    pub environment_id: Option<String>,
    pub proto_files: Vec<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdRestartReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSendEphemeralRequestReq {
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
pub struct CmdFormatJsonReq {
    pub text: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdFormatGraphqlReq {
    pub text: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdHttpResponseBodyReq {
    pub response_id: String,
    pub filter: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdHttpResponseBodyPathReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdHttpRequestBodyReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGetSseEventsReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGetHttpResponseEventsReq {
    pub response_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdImportDataReq {
    pub file_path: String,
    pub destination: ImportDestination,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdImportUrlReq {
    pub url: String,
    pub destination: ImportDestination,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCommitImportReq {
    pub plan: ImportPlan,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdListImportSourcesReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdImportSourcesForOriginReq {
    #[ts(optional)]
    pub file_path: Option<String>,
    #[ts(optional)]
    pub url: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdHttpRequestActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdWebsocketRequestActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCallWebsocketRequestActionReq {
    pub req: CallWebsocketRequestActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdWorkspaceActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCallWorkspaceActionReq {
    pub req: CallWorkspaceActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdFolderActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCallFolderActionReq {
    pub req: CallFolderActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGrpcRequestActionsReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdTemplateFunctionSummariesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdTemplateFunctionConfigReq {
    pub function_name: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGetHttpAuthenticationSummariesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGetHttpAuthenticationConfigReq {
    pub auth_name: String,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCallHttpRequestActionReq {
    pub req: CallHttpRequestActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCallGrpcRequestActionReq {
    pub req: CallGrpcRequestActionRequest,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCallHttpAuthenticationActionReq {
    pub auth_name: String,
    pub action_index: i32,
    pub values: HashMap<String, JsonPrimitive>,
    pub model: AnyModel,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCurlToRequestReq {
    pub command: String,
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdExportDataReq {
    pub export_path: String,
    pub workspace_ids: Vec<String>,
    pub include_private_environments: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSaveBase64ToBinaryReq {
    pub filepath: String,
    pub data: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSaveResponseReq {
    pub response_id: String,
    pub filepath: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSendHttpRequestReq {
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdReloadPluginsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginInfoReq {
    pub id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDeleteAllGrpcConnectionsReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDeleteSendHistoryReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDeleteAllHttpResponsesReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGetWorkspaceMetaReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdNewChildWindowReq {
    pub url: String,
    pub label: String,
    pub title: String,
    pub inner_size: (f64, f64),
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdNewMainWindowReq {
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdCheckForUpdatesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDecryptTemplateReq {
    pub template: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSecureTemplateReq {
    pub template: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGetThemesReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdEnableEncryptionReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdRevealWorkspaceKeyReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSetWorkspaceKeyReq {
    pub workspace_id: String,
    pub key: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDisableEncryptionReq {
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdDefaultHeadersReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsUpsertReq {
    pub model: AnyModel,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsDeleteReq {
    pub model: AnyModel,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsDuplicateReq {
    pub model_type: String,
    pub model_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsWebsocketEventsReq {
    pub connection_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsGrpcEventsReq {
    pub connection_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsGetSettingsReq {}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsGetGraphqlIntrospectionReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsUpsertGraphqlIntrospectionReq {
    pub request_id: String,
    pub workspace_id: String,
    pub content: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ModelsWorkspaceModelsReq {
    pub workspace_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitCheckoutReq {
    pub dir: PathBuf,
    pub branch: String,
    pub force: bool,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitBranchReq {
    pub dir: PathBuf,
    pub branch: String,
    pub base: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitDeleteBranchReq {
    pub dir: PathBuf,
    pub branch: String,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitDeleteRemoteBranchReq {
    pub dir: PathBuf,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitMergeBranchReq {
    pub dir: PathBuf,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitRenameBranchReq {
    pub dir: PathBuf,
    pub old_name: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitStatusReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitBranchInfoReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitWorktreeStatusReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitLogReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitLogForFileReq {
    pub dir: PathBuf,
    pub rela_path: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitFileDiffForCommitReq {
    pub dir: PathBuf,
    pub commit_oid: String,
    pub rela_path: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitInitializeReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitCloneReq {
    pub url: String,
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitCommitReq {
    pub dir: PathBuf,
    pub message: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitFetchAllReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitPushReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitPullReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitPullForceResetReq {
    pub dir: PathBuf,
    pub remote: String,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitPullMergeReq {
    pub dir: PathBuf,
    pub remote: String,
    pub branch: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitAddReq {
    pub dir: PathBuf,
    pub rela_paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitUnstageReq {
    pub dir: PathBuf,
    pub rela_paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitResetChangesReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitRestoreFilesReq {
    pub dir: PathBuf,
    pub rela_paths: Vec<PathBuf>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitRestoreFileFromCommitReq {
    pub dir: PathBuf,
    pub commit_oid: String,
    pub rela_path: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitAddCredentialReq {
    pub remote_url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitRemotesReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitAddRemoteReq {
    pub dir: PathBuf,
    pub name: String,
    pub url: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdGitRmRemoteReq {
    pub dir: PathBuf,
    pub name: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSyncCalculateReq {
    pub workspace_id: String,
    pub sync_dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSyncCalculateFsReq {
    pub dir: PathBuf,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdSyncApplyReq {
    pub sync_ops: Vec<SyncOp>,
    pub sync_dir: PathBuf,
    pub workspace_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdWsDeleteConnectionsReq {
    pub request_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdWsSendReq {
    pub connection_id: String,
    pub environment_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdWsCloseReq {
    pub connection_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdWsConnectReq {
    pub request_id: String,
    pub environment_id: Option<String>,
    pub cookie_jar_id: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginsSearchReq {
    pub query: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginsInstallReq {
    pub name: String,
    pub version: Option<String>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginsInstallFromDirectoryReq {
    pub directory: String,
}

#[derive(Debug, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginsUninstallReq {
    pub plugin_id: String,
}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginInitErrorsReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginsUpdatesReq {}

#[derive(Debug, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CmdPluginsUpdateAllReq {}

// -- The command list --

/// Declare the command list once, then hand it to a host.
///
/// Every host builds its router from the same list by passing a macro of its
/// own that receives `name(ReqType) -> ResType` triples: the schema stays the
/// single source of truth for *what* commands exist, and each host decides
/// *how* — which handler runs, or whether the command is unsupported there.
///
/// ```ignore
/// macro_rules! register { ( $( $name:ident ( $req:ty ) -> $res:ty ),* $(,)? ) => { ... } }
/// yaak_rpc_schema::with_commands!(register);
/// ```
#[macro_export]
macro_rules! with_commands {
    ($callback:ident) => {
        $callback! {
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
    cmd_import_data(CmdImportDataReq) -> ImportPlan,
    cmd_import_url(CmdImportUrlReq) -> ImportPlan,
    cmd_commit_import(CmdCommitImportReq) -> BatchUpsertResult,
    cmd_list_import_sources(CmdListImportSourcesReq) -> Vec<ImportSource>,
    cmd_import_sources_for_origin(CmdImportSourcesForOriginReq) -> Vec<ImportSource>,
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
    };
}

// The TypeScript export: field name = command name, tuple = (request, response).
// Generated from the same list the hosts build their routers from.
macro_rules! declare_schema {
    ( $( $name:ident ( $req:ty ) -> $res:ty ),* $(,)? ) => {
        #[derive(TS)]
        #[ts(export, export_to = "gen_rpc.ts")]
        #[allow(non_snake_case, unused)]
        pub struct RpcSchema {
            $( pub $name: ($req, $res), )*
        }
    };
}
with_commands!(declare_schema);
