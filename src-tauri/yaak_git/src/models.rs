use crate::error::Error::{InvalidSyncFile, UnknownModel};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use ts_rs::TS;
use yaak_models::models::{AnyModel, Environment, Folder, GrpcRequest, HttpRequest, Workspace};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "models.ts")]
pub enum SyncModel {
    Workspace(Workspace),
    Environment(Environment),
    Folder(Folder),
    HttpRequest(HttpRequest),
    GrpcRequest(GrpcRequest),
}

impl SyncModel {
    pub fn from_file(file_path: &Path) -> Result<SyncModel> {
        let f = File::open(file_path)?;
        if file_path.ends_with(".yaml") || file_path.ends_with(".yml") {
            Ok(serde_yaml::from_reader(f)?)
        } else if file_path.ends_with(".json") {
            Ok(serde_json::from_reader(f)?)
        } else {
            Err(InvalidSyncFile(file_path.to_str().unwrap().to_string()))
        }
    }

    pub fn id(&self) -> String {
        match self.clone() {
            SyncModel::Workspace(m) => m.id,
            SyncModel::Environment(m) => m.id,
            SyncModel::Folder(m) => m.id,
            SyncModel::HttpRequest(m) => m.id,
            SyncModel::GrpcRequest(m) => m.id,
        }
    }

    pub fn workspace_id(&self) -> String {
        match self.clone() {
            SyncModel::Workspace(m) => m.id,
            SyncModel::Environment(m) => m.workspace_id,
            SyncModel::Folder(m) => m.workspace_id,
            SyncModel::HttpRequest(m) => m.workspace_id,
            SyncModel::GrpcRequest(m) => m.workspace_id,
        }
    }
}

impl TryFrom<AnyModel> for SyncModel {
    type Error = crate::error::Error;

    fn try_from(value: AnyModel) -> Result<Self> {
        let m = match value {
            AnyModel::Environment(m) => SyncModel::Environment(m),
            AnyModel::Folder(m) => SyncModel::Folder(m),
            AnyModel::GrpcRequest(m) => SyncModel::GrpcRequest(m),
            AnyModel::HttpRequest(m) => SyncModel::HttpRequest(m),
            AnyModel::Workspace(m) => SyncModel::Workspace(m),
            AnyModel::CookieJar(m) => return Err(UnknownModel(m.model)),
            AnyModel::GrpcConnection(m) => return Err(UnknownModel(m.model)),
            AnyModel::GrpcEvent(m) => return Err(UnknownModel(m.model)),
            AnyModel::HttpResponse(m) => return Err(UnknownModel(m.model)),
            AnyModel::Plugin(m) => return Err(UnknownModel(m.model)),
            AnyModel::Settings(m) => return Err(UnknownModel(m.model)),
            AnyModel::KeyValue(m) => return Err(UnknownModel(m.model)),
            AnyModel::SyncState(m) => return Err(UnknownModel(m.model)),
        };
        Ok(m)
    }
}
