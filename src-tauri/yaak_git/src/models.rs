use std::ffi::OsStr;
use crate::error::Error::{InvalidSyncFile, UnknownModel};
use crate::error::Result;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::Path;
use log::debug;
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
    pub fn from_file(file_path: &Path) -> Result<Option<(SyncModel, String)>> {
        let contents = match fs::read(file_path) {
            Ok(c) => c,
            Err(_) => return Ok(None)
        };

        let mut hasher = Sha1::new();
        hasher.update(&contents);
        let checksum = hex::encode(hasher.finalize());

        debug!("Loading SyncModel from {file_path:?}");
        let ext = file_path.extension().unwrap_or_default();
        if ext == "yml" || ext == "yaml" {
            Ok(Some((serde_yaml::from_slice(contents.as_slice())?, checksum)))
        } else if ext == "json" {
            Ok(Some((serde_json::from_reader(contents.as_slice())?, checksum)))
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
