use crate::error::Error::UnknownModel;
use crate::error::Result;
use chrono::NaiveDateTime;
use log::{debug, warn};
use serde::{Deserialize, Deserializer, Serialize};
use serde_yaml::{Mapping, Value};
use sha1::{Digest, Sha1};
use std::fs;
use std::path::Path;
use ts_rs::TS;
use yaak_models::models::{
    AnyModel, Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace,
};

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
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

impl<'de> Deserialize<'de> for SyncModel {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        use serde_path_to_error as spte;
        let mut v = Value::deserialize(deserializer)?;
        let model = match v.get("model") {
            Some(Value::String(model)) => model.clone(),
            _ => "".to_string(),
        };
        let model = model.as_str();

        let obj = v
            .as_mapping_mut()
            .ok_or_else(|| serde::de::Error::custom("expected object for SyncModel"))?;

        // Dispatch to CHILD types (no recursion)
        match model {
            "workspace" => {
                let x: Workspace = spte::deserialize(v).map_err(serde::de::Error::custom)?;
                Ok(SyncModel::Workspace(x))
            }
            "environment" => {
                migrate_environment(obj);
                let x: Environment = spte::deserialize(v).map_err(serde::de::Error::custom)?;
                Ok(SyncModel::Environment(x))
            }
            "folder" => {
                let x: Folder = spte::deserialize(v).map_err(serde::de::Error::custom)?;
                Ok(SyncModel::Folder(x))
            }
            "http_request" => {
                let x: HttpRequest = spte::deserialize(v).map_err(serde::de::Error::custom)?;
                Ok(SyncModel::HttpRequest(x))
            }
            "grpc_request" => {
                let x: GrpcRequest = spte::deserialize(v).map_err(serde::de::Error::custom)?;
                Ok(SyncModel::GrpcRequest(x))
            }
            "websocket_request" => {
                let x: WebsocketRequest = spte::deserialize(v).map_err(serde::de::Error::custom)?;
                Ok(SyncModel::WebsocketRequest(x))
            }
            other => Err(serde::de::Error::unknown_variant(
                other,
                &[
                    "workspace",
                    "environment",
                    "folder",
                    "http_request",
                    "grpc_request",
                    "websocket_request",
                ],
            )),
        }
    }
}

fn migrate_environment(obj: &mut Mapping) {
    match (obj.get("base"), obj.get("parentModel")) {
        (Some(Value::Bool(base)), None) => {
            debug!("Migrating legacy environment {:?}", obj.get("id"));
            if *base {
                obj.insert("parentModel".into(), "workspace".into());
            } else {
                obj.insert("parentModel".into(), "environment".into());
            }
        }
        _ => {}
    }
}

impl SyncModel {
    pub fn from_bytes(content: Vec<u8>, file_path: &Path) -> Result<Option<(SyncModel, String)>> {
        let mut hasher = Sha1::new();
        hasher.update(&content);
        let checksum = hex::encode(hasher.finalize());
        let content_str = String::from_utf8(content.clone()).unwrap_or_default();

        // Check for some strings that will be in a model file for sure. If these strings
        // don't exist, then it's probably not a Yaak file.
        if !content_str.contains("model") || !content_str.contains("id") {
            return Ok(None);
        }

        let ext = file_path.extension().unwrap_or_default();
        if ext == "yml" || ext == "yaml" {
            Ok(match serde_yaml::from_str::<SyncModel>(&content_str) {
                Ok(m) => Some((m, checksum)),
                Err(e) => {
                    warn!("Error parsing {:?} {:?}", file_path.file_name(), e);
                    None
                }
            })
        } else if ext == "json" {
            Ok(match serde_json::from_str::<SyncModel>(&content_str) {
                Ok(m) => Some((m, checksum)),
                Err(e) => {
                    warn!("Error parsing {:?} {:?}", file_path.file_name(), e);
                    None
                }
            })
        } else {
            Ok(None)
        }
    }

    pub fn from_file(file_path: &Path) -> Result<Option<(SyncModel, String)>> {
        let content = match fs::read(file_path) {
            Ok(c) => c,
            Err(_) => return Ok(None),
        };

        Self::from_bytes(content, file_path)
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
            AnyModel::GraphQlIntrospection(m) => return Err(UnknownModel(m.model)),
            AnyModel::GrpcConnection(m) => return Err(UnknownModel(m.model)),
            AnyModel::GrpcEvent(m) => return Err(UnknownModel(m.model)),
            AnyModel::HttpResponse(m) => return Err(UnknownModel(m.model)),
            AnyModel::KeyValue(m) => return Err(UnknownModel(m.model)),
            AnyModel::Plugin(m) => return Err(UnknownModel(m.model)),
            AnyModel::Settings(m) => return Err(UnknownModel(m.model)),
            AnyModel::WebsocketConnection(m) => return Err(UnknownModel(m.model)),
            AnyModel::WebsocketEvent(m) => return Err(UnknownModel(m.model)),
            AnyModel::WorkspaceMeta(m) => return Err(UnknownModel(m.model)),
            AnyModel::SyncState(m) => return Err(UnknownModel(m.model)),
        };
        Ok(m)
    }
}

#[cfg(test)]
mod migration_tests {
    use crate::error::Result;
    use crate::models::SyncModel;

    #[test]
    fn deserializes_environment_via_syncmodel_with_fixups() -> Result<()> {
        let raw = r#"
type: environment
model: environment
id: ev_fAUS49FUN2
workspaceId: wk_kfSI3JDHd7
createdAt: 2025-01-11T17:02:58.012792
updatedAt: 2025-07-23T20:00:46.049649
name: Global Variables
public: true
base: true
variables: []
color: null
"#;

        let m: SyncModel = serde_yaml::from_str(raw)?;
        match m {
            SyncModel::Environment(env) => {
                assert_eq!(env.parent_model, "workspace".to_string());
                assert_eq!(env.parent_id, None);
            }
            _ => panic!("expected base environment"),
        }

        let raw = r#"
type: environment
model: environment
id: ev_fAUS49FUN2
workspaceId: wk_kfSI3JDHd7
createdAt: 2025-01-11T17:02:58.012792
updatedAt: 2025-07-23T20:00:46.049649
name: Global Variables
public: true
base: false
variables: []
color: null
"#;
        let m: SyncModel = serde_yaml::from_str(raw)?;
        match m {
            SyncModel::Environment(env) => {
                assert_eq!(env.parent_model, "environment".to_string());
                assert_eq!(env.parent_id, None);
            }
            _ => panic!("expected sub environment"),
        }

        let raw = r#"
type: environment
model: environment
id: ev_fAUS49FUN2
parentId: fld_123
parentModel: folder
workspaceId: wk_kfSI3JDHd7
createdAt: 2025-01-11T17:02:58.012792
updatedAt: 2025-07-23T20:00:46.049649
name: Folder Environment
public: true
base: false
variables: []
color: null
"#;
        let m: SyncModel = serde_yaml::from_str(raw)?;
        match m {
            SyncModel::Environment(env) => {
                assert_eq!(env.parent_model, "folder".to_string());
                assert_eq!(env.parent_id, Some("fld_123".to_string()));
            }
            _ => panic!("expected folder environment"),
        }

        Ok(())
    }
}
