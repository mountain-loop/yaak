//! Saving a flow into the Yaak client's database. It is opened as a lifecycle guest, as the CLI
//! opens it, since Yaak may have it open too, and the request is written with
//! `UpdateSource::Sync` so a running Yaak picks it up from its model-change poller.

use crate::bodies::DecodedBody;
use crate::convert::{self, DroppedHeader};
use crate::models::Flow;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use yaak_models::models::HttpRequest;
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;

/// Yaak's data directory, where its `db.sqlite` is. A debug build pairs with a debug Yaak.
pub fn client_data_dir() -> PathBuf {
    let app_id = if cfg!(debug_assertions) { "app.yaak.desktop.dev" } else { "app.yaak.desktop" };
    yaak_common::data_dir::resolve_data_dir(app_id)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSummary {
    pub id: String,
    pub name: String,
    pub folders: Vec<FolderSummary>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSummary {
    pub id: String,
    pub name: String,
    /// The folder this one is in, if any.
    pub folder_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFlowRequest {
    pub workspace_id: String,
    pub folder_id: Option<String>,
    /// Defaults to the URL's path.
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveFlowResponse {
    pub request: HttpRequest,
    pub dropped_headers: Vec<DroppedHeader>,
    pub warnings: Vec<String>,
}

pub struct ClientDb {
    query_manager: QueryManager,
}

impl ClientDb {
    /// Opens `db.sqlite` in Yaak's data directory `data_dir`. Fails when there is none, rather
    /// than creating a database for a Yaak that has never run.
    pub fn open(data_dir: &Path) -> Result<Self, String> {
        let db_path = data_dir.join("db.sqlite");
        if !db_path.exists() {
            return Err(format!(
                "Yaak's database was not found at {}. Install Yaak and open it once.",
                db_path.display()
            ));
        }
        let (query_manager, blob_manager, _rx) =
            yaak_models::init_standalone(&db_path, data_dir.join("blobs.sqlite"))
                .map_err(|e| format!("Failed to open Yaak's database: {e}"))?;
        query_manager
            .with_tx(|tx| {
                yaak_lifecycle::on_launch(&yaak_lifecycle::Host::guest(), tx, &blob_manager)
            })
            .map_err(|e| format!("Failed to open Yaak's database: {e}"))?;
        Ok(Self { query_manager })
    }

    pub fn workspaces(&self) -> Result<Vec<WorkspaceSummary>, String> {
        let db = self.query_manager.connect();
        let workspaces = db.list_workspaces().map_err(|e| e.to_string())?;
        workspaces
            .into_iter()
            .map(|w| {
                let folders = db.list_folders(&w.id).map_err(|e| e.to_string())?;
                Ok(WorkspaceSummary {
                    id: w.id,
                    name: w.name,
                    folders: folders
                        .into_iter()
                        .map(|f| FolderSummary { id: f.id, name: f.name, folder_id: f.folder_id })
                        .collect(),
                })
            })
            .collect()
    }

    /// Writes `flow`, with `body` its decoded request body, as a new request.
    pub fn save(
        &self,
        flow: &Flow,
        body: &DecodedBody,
        target: &SaveFlowRequest,
    ) -> Result<SaveFlowResponse, String> {
        let db = self.query_manager.connect();
        db.get_workspace(&target.workspace_id)
            .map_err(|_| format!("No workspace {} in Yaak", target.workspace_id))?;
        if let Some(folder_id) = &target.folder_id {
            let folder =
                db.get_folder(folder_id).map_err(|_| format!("No folder {folder_id} in Yaak"))?;
            if folder.workspace_id != target.workspace_id {
                return Err(format!(
                    "Folder {folder_id} is not in workspace {}",
                    target.workspace_id
                ));
            }
        }

        let conversion = convert::flow_to_request(flow, body);
        let mut request = conversion.request;
        request.workspace_id = target.workspace_id.clone();
        request.folder_id = target.folder_id.clone();
        if let Some(name) = target.name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
            request.name = name.to_string();
        }
        // First in its folder, as the client places a new request.
        request.sort_priority = -(chrono::Utc::now().timestamp_millis() as f64);

        let request = self
            .query_manager
            .with_tx(|tx| tx.upsert_http_request(&request, &UpdateSource::Sync))
            .map_err(|e| format!("Failed to save the request to Yaak: {e}"))?;
        Ok(SaveFlowResponse {
            request,
            dropped_headers: conversion.dropped_headers,
            warnings: conversion.warnings,
        })
    }
}
