use crate::error::Error::{InvalidSyncFile, UnknownModel};
use crate::error::Result;
use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::Path;
use tokio::fs;
use ts_rs::TS;
use yaak_models::models::{
    AnyModel, Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
#[ts(export, export_to = "gen_models.ts")]
pub enum SyncModel {
    Workspace(Workspace),
    Environment(Environment),
    Folder(Folder),
    HttpRequest(HttpRequest),
    GrpcRequest(GrpcRequest),
    WebsocketRequest(WebsocketRequest),
}

impl SyncModel {
    pub async fn from_file(file_path: &Path) -> Result<Option<(SyncModel, Vec<u8>, String)>> {
        let content = match fs::read(file_path).await {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };

        let mut hasher = Sha1::new();
        hasher.update(&content);
        let checksum = hex::encode(hasher.finalize());

        let ext = file_path.extension().unwrap_or_default();
        if ext == "yml" || ext == "yaml" {
            Ok(Some((serde_yaml::from_slice(content.as_slice())?, content, checksum)))
        } else if ext == "json" {
            Ok(Some((serde_json::from_reader(content.as_slice())?, content, checksum)))
        } else {
            Err(InvalidSyncFile(file_path.to_str().unwrap().to_string()))
        }
    }

    pub fn to_file_contents(&self, rel_path: &Path) -> Result<(Vec<u8>, String)> {
        let ext = rel_path.extension().unwrap_or_default();
        let content = if ext == "yaml" || ext == "yml" {
            serde_yaml::to_string(self)?
        } else {
            serde_json::to_string(self)?
        };

        let mut hasher = Sha1::new();
        hasher.update(&content);
        let checksum = hex::encode(hasher.finalize());

        Ok((content.into_bytes(), checksum))
    }

    pub fn id(&self) -> String {
        match self.clone() {
            SyncModel::Workspace(m) => m.id,
            SyncModel::Environment(m) => m.id,
            SyncModel::Folder(m) => m.id,
            SyncModel::HttpRequest(m) => m.id,
            SyncModel::GrpcRequest(m) => m.id,
            SyncModel::WebsocketRequest(m) => m.id,
        }
    }

    pub fn workspace_id(&self) -> String {
        match self.clone() {
            SyncModel::Workspace(m) => m.id,
            SyncModel::Environment(m) => m.workspace_id,
            SyncModel::Folder(m) => m.workspace_id,
            SyncModel::HttpRequest(m) => m.workspace_id,
            SyncModel::GrpcRequest(m) => m.workspace_id,
            SyncModel::WebsocketRequest(m) => m.workspace_id,
        }
    }

    pub fn updated_at(&self) -> NaiveDateTime {
        match self.clone() {
            SyncModel::Workspace(m) => m.updated_at,
            SyncModel::Environment(m) => m.updated_at,
            SyncModel::Folder(m) => m.updated_at,
            SyncModel::HttpRequest(m) => m.updated_at,
            SyncModel::GrpcRequest(m) => m.updated_at,
            SyncModel::WebsocketRequest(m) => m.updated_at,
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
            AnyModel::WebsocketRequest(m) => SyncModel::WebsocketRequest(m),
            AnyModel::Workspace(m) => SyncModel::Workspace(m),

            // Non-sync models
            AnyModel::CookieJar(m) => return Err(UnknownModel(m.model)),
            AnyModel::GrpcConnection(m) => return Err(UnknownModel(m.model)),
            AnyModel::GrpcEvent(m) => return Err(UnknownModel(m.model)),
            AnyModel::HttpResponse(m) => return Err(UnknownModel(m.model)),
            AnyModel::KeyValue(m) => return Err(UnknownModel(m.model)),
            AnyModel::Plugin(m) => return Err(UnknownModel(m.model)),
            AnyModel::Settings(m) => return Err(UnknownModel(m.model)),
            AnyModel::WebsocketConnection(m) => return Err(UnknownModel(m.model)),
            AnyModel::WebsocketEvent(m) => return Err(UnknownModel(m.model)),
            AnyModel::WorkspaceMeta(m) => return Err(UnknownModel(m.model)),
        };
        Ok(m)
    }
}
