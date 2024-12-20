use chrono::NaiveDateTime;
use serde::{Deserialize, Serialize};
use tauri::{Manager, WebviewWindow};
use yaak_models::models::{Environment, Folder, GrpcRequest, HttpRequest, Workspace};

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceExport {
    pub yaak_version: String,
    pub yaak_schema: i64,
    pub timestamp: NaiveDateTime,
    pub resources: WorkspaceExportResources,
}

#[derive(Default, Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WorkspaceExportResources {
    pub workspaces: Vec<Workspace>,
    pub environments: Vec<Environment>,
    pub folders: Vec<Folder>,
    pub http_requests: Vec<HttpRequest>,
    pub grpc_requests: Vec<GrpcRequest>,
}

#[derive(Default, Debug, Deserialize, Serialize)]
pub struct ImportResult {
    pub resources: WorkspaceExportResources,
}

pub async fn get_workspace_export_resources(
    window: &WebviewWindow,
    workspace_ids: Vec<&str>,
) -> WorkspaceExport {
    let app_handle = window.app_handle();
    let mut data = WorkspaceExport {
        yaak_version: app_handle.package_info().version.clone().to_string(),
        yaak_schema: 3,
        timestamp: chrono::Utc::now().naive_utc(),
        resources: WorkspaceExportResources {
            workspaces: Vec::new(),
            environments: Vec::new(),
            folders: Vec::new(),
            http_requests: Vec::new(),
            grpc_requests: Vec::new(),
        },
    };

    for workspace_id in workspace_ids {
        data.resources.workspaces.push(
            yaak_models::queries::get_workspace(window, workspace_id)
                .await
                .expect("Failed to get workspace"),
        );
        data.resources.environments.append(
            &mut yaak_models::queries::list_environments(window, workspace_id)
                .await
                .expect("Failed to get environments"),
        );
        data.resources.folders.append(
            &mut yaak_models::queries::list_folders(window, workspace_id)
                .await
                .expect("Failed to get folders"),
        );
        data.resources.http_requests.append(
            &mut yaak_models::queries::list_http_requests(window, workspace_id)
                .await
                .expect("Failed to get http requests"),
        );
        data.resources.grpc_requests.append(
            &mut yaak_models::queries::list_grpc_requests(window, workspace_id)
                .await
                .expect("Failed to get grpc requests"),
        );
    }

    return data;
}
