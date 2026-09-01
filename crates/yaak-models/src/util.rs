use crate::client_db::ClientDb;
use crate::error::Result;
use crate::models::{
    AnyModel, Environment, Folder, GrpcRequest, HttpRequest, UpsertModelInfo, WebsocketRequest,
    Workspace, WorkspaceIden,
};
use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
use yaak_core::WorkspaceContext;

pub use yaak_database::{
    ModelChangeEvent, generate_id, generate_id_of_length, generate_prefixed_id,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_models.ts")]
pub struct ModelPayload {
    pub model: AnyModel,
    pub update_source: UpdateSource,
    pub change: ModelChangeEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_models.ts")]
pub enum UpdateSource {
    Background,
    Import,
    Plugin,
    Sync,
    Window { label: String },
}

impl UpdateSource {
    pub fn from_window_label(label: impl Into<String>) -> Self {
        Self::Window { label: label.into() }
    }

    pub fn to_db(&self) -> yaak_database::UpdateSource {
        match self {
            UpdateSource::Background => yaak_database::UpdateSource::Background,
            UpdateSource::Import => yaak_database::UpdateSource::Import,
            UpdateSource::Plugin => yaak_database::UpdateSource::Plugin,
            UpdateSource::Sync => yaak_database::UpdateSource::Sync,
            UpdateSource::Window { label } => {
                yaak_database::UpdateSource::Window { label: label.clone() }
            }
        }
    }
}

impl From<yaak_database::UpdateSource> for UpdateSource {
    fn from(source: yaak_database::UpdateSource) -> Self {
        match source {
            yaak_database::UpdateSource::Background => UpdateSource::Background,
            yaak_database::UpdateSource::Import => UpdateSource::Import,
            yaak_database::UpdateSource::Plugin => UpdateSource::Plugin,
            yaak_database::UpdateSource::Sync => UpdateSource::Sync,
            yaak_database::UpdateSource::Window { label } => UpdateSource::Window { label },
        }
    }
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceExport {
    pub yaak_version: String,
    pub yaak_schema: i64,
    pub timestamp: NaiveDateTime,
    pub resources: BatchUpsertResult,
}

#[derive(Default, Debug, Deserialize, Serialize, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "gen_util.ts")]
pub struct BatchUpsertResult {
    pub workspaces: Vec<Workspace>,
    pub environments: Vec<Environment>,
    pub folders: Vec<Folder>,
    pub http_requests: Vec<HttpRequest>,
    pub grpc_requests: Vec<GrpcRequest>,
    pub websocket_requests: Vec<WebsocketRequest>,
}

/// Where a staged import will be committed.
///
/// The destination workspace and optional folder IDs are captured in the plan so the preview describes
/// the exact destination that confirmation will use.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_util.ts")]
pub enum ImportDestination {
    NewWorkspace,
    ExistingWorkspace {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "folderId")]
        #[ts(optional)]
        folder_id: Option<String>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_util.ts")]
pub struct ImportPlanWarning {
    pub title: String,
    pub detail: String,
}

/// Where an import's contents came from, used to link the committed workspace back to it.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_util.ts")]
pub struct ImportOrigin {
    /// The absolute file path or URL the contents were read from.
    pub origin: String,
    pub label: String,
}

/// The model types an import plan can contain.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_util.ts")]
pub enum ImportResourceType {
    Environment,
    Folder,
    GrpcRequest,
    HttpRequest,
    WebsocketRequest,
    Workspace,
}

impl ImportResourceType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ImportResourceType::Environment => "environment",
            ImportResourceType::Folder => "folder",
            ImportResourceType::GrpcRequest => "grpc_request",
            ImportResourceType::HttpRequest => "http_request",
            ImportResourceType::WebsocketRequest => "websocket_request",
            ImportResourceType::Workspace => "workspace",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "environment" => Some(ImportResourceType::Environment),
            "folder" => Some(ImportResourceType::Folder),
            "grpc_request" => Some(ImportResourceType::GrpcRequest),
            "http_request" => Some(ImportResourceType::HttpRequest),
            "websocket_request" => Some(ImportResourceType::WebsocketRequest),
            "workspace" => Some(ImportResourceType::Workspace),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_util.ts")]
pub enum ImportPlanAction {
    Create,
    Update,
    Delete,
    Unchanged,
    KeepLocal,
    Conflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_util.ts")]
pub enum ImportConflictResolution {
    KeepMine,
    TakeSource,
}

#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_util.ts")]
pub struct ImportPlanItem {
    pub action: ImportPlanAction,
    pub model: ImportResourceType,
    pub model_id: String,
    pub name: String,
    /// Planned parent folder ID for incoming resources; current parent for deletions.
    #[ts(optional)]
    pub parent_id: Option<String>,
    pub selected: bool,
    #[ts(optional)]
    pub resolution: Option<ImportConflictResolution>,
}

#[derive(Debug, Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_util.ts")]
pub struct ImportPlan {
    pub importer: String,
    pub destination: ImportDestination,
    pub resources: BatchUpsertResult,
    pub warnings: Vec<ImportPlanWarning>,

    /// Stable source key for every model in `resources`, keyed by its planned ID.
    pub source_keys: BTreeMap<String, String>,

    /// One entry per plannable resource; commit applies only the selected ones.
    #[serde(default)]
    pub items: Vec<ImportPlanItem>,

    #[serde(default)]
    #[ts(optional)]
    pub origin: Option<ImportOrigin>,
}

pub fn get_workspace_export_resources(
    db: &ClientDb,
    yaak_version: &str,
    workspace_ids: Vec<&str>,
    include_private_environments: bool,
) -> Result<WorkspaceExport> {
    let mut data = WorkspaceExport {
        yaak_version: yaak_version.to_string(),
        yaak_schema: 4,
        timestamp: Utc::now().naive_utc(),
        resources: BatchUpsertResult {
            workspaces: Vec::new(),
            environments: Vec::new(),
            folders: Vec::new(),
            http_requests: Vec::new(),
            grpc_requests: Vec::new(),
            websocket_requests: Vec::new(),
        },
    };

    for workspace_id in workspace_ids {
        data.resources.workspaces.push(db.find_one(WorkspaceIden::Id, workspace_id)?);
        data.resources.environments.append(
            &mut db
                .list_environments_ensure_base(workspace_id)?
                .into_iter()
                .filter(|e| include_private_environments || e.public)
                .collect(),
        );
        data.resources.folders.append(&mut db.list_folders(workspace_id)?);
        data.resources.http_requests.append(&mut db.list_http_requests(workspace_id)?);
        data.resources.grpc_requests.append(&mut db.list_grpc_requests(workspace_id)?);
        data.resources.websocket_requests.append(&mut db.list_websocket_requests(workspace_id)?);
    }

    Ok(data)
}

pub fn maybe_gen_id<M: UpsertModelInfo>(
    ctx: &WorkspaceContext,
    id: &str,
    ids: &mut BTreeMap<String, String>,
) -> String {
    if id == "CURRENT_WORKSPACE" {
        if let Some(wid) = &ctx.workspace_id {
            return wid.to_string();
        }
    }

    if !id.starts_with("GENERATE_ID::") {
        return id.to_string();
    }

    let unique_key = id.replace("GENERATE_ID", "");
    if let Some(existing) = ids.get(unique_key.as_str()) {
        existing.to_string()
    } else {
        let new_id = M::generate_id();
        ids.insert(unique_key, new_id.clone());
        new_id
    }
}

pub fn maybe_gen_id_opt<M: UpsertModelInfo>(
    ctx: &WorkspaceContext,
    id: Option<String>,
    ids: &mut BTreeMap<String, String>,
) -> Option<String> {
    match id {
        Some(id) => Some(maybe_gen_id::<M>(ctx, id.as_str(), ids)),
        None => None,
    }
}
