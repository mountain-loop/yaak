use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{
    AnyModel, Environment, Folder, GrpcRequest, HttpRequest, UpsertModelInfo, WebsocketRequest,
    Workspace, WorkspaceIden,
};
use chrono::{NaiveDateTime, Utc};
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use ts_rs::TS;
use yaak_core::WorkspaceContext;

pub fn generate_prefixed_id(prefix: &str) -> String {
    format!("{prefix}_{}", generate_id())
}

pub fn generate_id() -> String {
    generate_id_of_length(10)
}

pub fn generate_id_of_length(n: usize) -> String {
    let alphabet: [char; 57] = [
        '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
        'k', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C',
        'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W',
        'X', 'Y', 'Z',
    ];

    nanoid!(n, &alphabet)
}

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
pub enum ModelChangeEvent {
    Upsert { created: bool },
    Delete,
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

pub fn get_workspace_export_resources(
    db: &DbContext,
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
