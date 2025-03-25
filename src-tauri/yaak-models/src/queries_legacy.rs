use crate::error::Result;
use crate::manager::QueryManagerExt;
use crate::models::{AnyModel, Environment, Folder, GrpcRequest, HttpRequest, ModelType, WebsocketRequest, Workspace, WorkspaceIden};
use chrono::{NaiveDateTime, Utc};
use log::warn;
use nanoid::nanoid;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Listener, Runtime, WebviewWindow};
use ts_rs::TS;

pub fn generate_model_id(model: ModelType) -> String {
    let id = generate_id();
    format!("{}_{}", model.id_prefix(), id)
}

pub fn generate_id() -> String {
    let alphabet: [char; 57] = [
        '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j',
        'k', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z', 'A', 'B', 'C',
        'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W',
        'X', 'Y', 'Z',
    ];

    nanoid!(10, &alphabet)
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
    Upsert,
    Delete,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_models.ts")]
pub enum UpdateSource {
    Sync,
    Window { label: String },
    Plugin,
    Background,
    Import,
}

impl UpdateSource {
    pub fn from_window<R: Runtime>(window: &WebviewWindow<R>) -> Self {
        Self::Window {
            label: window.label().to_string(),
        }
    }
}

pub fn listen_to_model_delete<F, R>(app_handle: &AppHandle<R>, handler: F)
where
    F: Fn(ModelPayload) + Send + 'static,
    R: Runtime,
{
    app_handle.listen_any("deleted_model", move |e| {
        match serde_json::from_str(e.payload()) {
            Ok(payload) => handler(payload),
            Err(e) => {
                warn!("Failed to deserialize deleted model {}", e);
                return;
            }
        };
    });
}

pub fn listen_to_model_upsert<F, R>(app_handle: &AppHandle<R>, handler: F)
where
    F: Fn(ModelPayload) + Send + 'static,
    R: Runtime,
{
    app_handle.listen_any("upserted_model", move |e| {
        match serde_json::from_str(e.payload()) {
            Ok(payload) => handler(payload),
            Err(e) => {
                warn!("Failed to deserialize upserted model {}", e);
                return;
            }
        };
    });
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceExport {
    pub yaak_version: String,
    pub yaak_schema: i64,
    pub timestamp: NaiveDateTime,
    pub resources: BatchUpsertResult,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct BatchUpsertResult {
    pub workspaces: Vec<Workspace>,
    pub environments: Vec<Environment>,
    pub folders: Vec<Folder>,
    pub http_requests: Vec<HttpRequest>,
    pub grpc_requests: Vec<GrpcRequest>,
    pub websocket_requests: Vec<WebsocketRequest>,
}

pub async fn get_workspace_export_resources<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_ids: Vec<&str>,
    include_environments: bool,
) -> Result<WorkspaceExport> {
    let mut data = WorkspaceExport {
        yaak_version: app_handle.package_info().version.clone().to_string(),
        yaak_schema: 3,
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

    let db = app_handle.queries().connect().await?;
    for workspace_id in workspace_ids {
        data.resources.workspaces.push(db.find_one(WorkspaceIden::Id, workspace_id)?);
        data.resources.environments.append(&mut db.list_environments(workspace_id)?);
        data.resources.folders.append(&mut db.list_folders(workspace_id)?);
        data.resources.http_requests.append(&mut db.list_http_requests(workspace_id)?);
        data.resources.grpc_requests.append(&mut db.list_grpc_requests(workspace_id)?);
        data.resources.websocket_requests.append(&mut db.list_websocket_requests(workspace_id)?);
    }

    // Nuke environments if we don't want them
    if !include_environments {
        data.resources.environments.clear();
    }

    Ok(data)
}
