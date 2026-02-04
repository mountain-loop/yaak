use crate::db_context::DbContext;
use crate::error::Result;
use crate::models::{Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace};
use crate::util::{BatchUpsertResult, UpdateSource};
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
            for v in workspaces {
                let x = self.upsert_workspace(&v, source)?;
                imported_resources.workspaces.push(x.clone());
            }
            info!("Upserted {} workspaces", imported_resources.workspaces.len());
        }

        if http_requests.len() > 0 {
            for v in http_requests {
                let x = self.upsert_http_request(&v, source)?;
                imported_resources.http_requests.push(x.clone());
            }
            info!("Upserted Imported {} http_requests", imported_resources.http_requests.len());
        }

        if grpc_requests.len() > 0 {
            for v in grpc_requests {
                let x = self.upsert_grpc_request(&v, source)?;
                imported_resources.grpc_requests.push(x.clone());
            }
            info!("Upserted {} grpc_requests", imported_resources.grpc_requests.len());
        }

        if websocket_requests.len() > 0 {
            for v in websocket_requests {
                let x = self.upsert_websocket_request(&v, source)?;
                imported_resources.websocket_requests.push(x.clone());
            }
            info!("Upserted {} websocket_requests", imported_resources.websocket_requests.len());
        }

        // Do folders after their children so the UI doesn't render empty folders before populating
        // immediately after.
        if folders.len() > 0 {
            for v in folders {
                let x = self.upsert_folder(&v, source)?;
                imported_resources.folders.push(x.clone());
            }
            info!("Upserted {} folders", imported_resources.folders.len());
        }

        // Do environments last because they can depend on many models (requests, folders, etc)
        if environments.len() > 0 {
            for x in environments {
                let x = self.upsert_environment(&x, source)?;
                imported_resources.environments.push(x.clone());
            }
            info!("Upserted {} environments", imported_resources.environments.len());
        }

        Ok(imported_resources)
    }
}
