use crate::error::Result;
use crate::manager::DbContext;
use crate::models::{Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace};
use crate::queries_legacy::{BatchUpsertResult, UpdateSource};
use log::info;

impl<'a> DbContext<'a> {
    pub fn batch_upsert(
        &self,
        workspaces: Vec<Workspace>,
        environments: Vec<Environment>,
        folders: Vec<Folder>,
        http_requests: Vec<HttpRequest>,
        grpc_requests: Vec<GrpcRequest>,
        websocket_requests: Vec<WebsocketRequest>,
        source: &UpdateSource,
    ) -> Result<BatchUpsertResult> {
        let mut imported_resources = BatchUpsertResult::default();

        if workspaces.len() > 0 {
            info!("Batch inserting {} workspaces", workspaces.len());
            for v in workspaces {
                let x = self.upsert_workspace(&v, source)?;
                imported_resources.workspaces.push(x.clone());
            }
        }

        if environments.len() > 0 {
            while imported_resources.environments.len() < environments.len() {
                for v in environments.clone() {
                    if let Some(id) = v.environment_id.clone() {
                        let has_parent_to_import =
                            environments.iter().find(|m| m.id == id).is_some();
                        let imported_parent =
                            imported_resources.environments.iter().find(|m| m.id == id);
                        // If there's also a parent to upsert, wait for that one
                        if imported_parent.is_none() && has_parent_to_import {
                            continue;
                        }
                    }
                    if let Some(_) = imported_resources.environments.iter().find(|f| f.id == v.id) {
                        continue;
                    }
                    let x = self.upsert_environment(&v, source)?;
                    imported_resources.environments.push(x.clone());
                }
            }
            info!("Imported {} environments", imported_resources.environments.len());
        }

        if folders.len() > 0 {
            while imported_resources.folders.len() < folders.len() {
                for v in folders.clone() {
                    if let Some(id) = v.folder_id.clone() {
                        let has_parent_to_import = folders.iter().find(|m| m.id == id).is_some();
                        let imported_parent =
                            imported_resources.folders.iter().find(|m| m.id == id);
                        // If there's also a parent to upsert, wait for that one
                        if imported_parent.is_none() && has_parent_to_import {
                            continue;
                        }
                    }
                    if let Some(_) = imported_resources.folders.iter().find(|f| f.id == v.id) {
                        continue;
                    }
                    let x = self.upsert_folder(&v, source)?;
                    imported_resources.folders.push(x.clone());
                }
            }
            info!("Imported {} folders", imported_resources.folders.len());
        }

        if http_requests.len() > 0 {
            for v in http_requests {
                let x = self.upsert(&v, source)?;
                imported_resources.http_requests.push(x.clone());
            }
            info!("Imported {} http_requests", imported_resources.http_requests.len());
        }

        if grpc_requests.len() > 0 {
            for v in grpc_requests {
                let x = self.upsert_grpc_request(&v, source)?;
                imported_resources.grpc_requests.push(x.clone());
            }
            info!("Imported {} grpc_requests", imported_resources.grpc_requests.len());
        }

        if websocket_requests.len() > 0 {
            for v in websocket_requests {
                let x = self.upsert_websocket_request(&v, source)?;
                imported_resources.websocket_requests.push(x.clone());
            }
            info!("Imported {} websocket_requests", imported_resources.websocket_requests.len());
        }

        Ok(imported_resources)
    }
}
