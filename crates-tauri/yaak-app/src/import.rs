use crate::error::Result;
use log::info;
use std::collections::BTreeMap;
use std::fs::read_to_string;
use tauri::{Manager, Runtime, WebviewWindow};
use yaak_models::models::{
    Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace,
};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::{BatchUpsertResult, UpdateSource, maybe_gen_id, maybe_gen_id_opt};
use yaak_plugins::manager::PluginManager;

pub(crate) async fn import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: &str,
) -> Result<BatchUpsertResult> {
    let plugin_manager = window.state::<PluginManager>();
    let file =
        read_to_string(file_path).unwrap_or_else(|_| panic!("Unable to read file {}", file_path));
    let file_contents = file.as_str();
    let import_result = plugin_manager.import_data(window, file_contents).await?;

    let mut id_map: BTreeMap<String, String> = BTreeMap::new();

    let resources = import_result.resources;

    let workspaces: Vec<Workspace> = resources
        .workspaces
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Workspace, R>(window, v.id.as_str(), &mut id_map);
            v
        })
        .collect();

    let environments: Vec<Environment> = resources
        .environments
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Environment, R>(window, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace, R>(window, v.workspace_id.as_str(), &mut id_map);
            match (v.parent_model.as_str(), v.parent_id.clone().as_deref()) {
                ("folder", Some(parent_id)) => {
                    v.parent_id = Some(maybe_gen_id::<Folder, R>(window, &parent_id, &mut id_map));
                }
                ("", _) => {
                    // Fix any empty ones
                    v.parent_model = "workspace".to_string();
                }
                _ => {
                    // Parent ID only required for the folder case
                    v.parent_id = None;
                }
            };
            v
        })
        .collect();

    let folders: Vec<Folder> = resources
        .folders
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Folder, R>(window, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace, R>(window, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder, R>(window, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let http_requests: Vec<HttpRequest> = resources
        .http_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<HttpRequest, R>(window, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace, R>(window, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder, R>(window, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let grpc_requests: Vec<GrpcRequest> = resources
        .grpc_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<GrpcRequest, R>(window, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace, R>(window, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder, R>(window, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let websocket_requests: Vec<WebsocketRequest> = resources
        .websocket_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<WebsocketRequest, R>(window, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace, R>(window, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder, R>(window, v.folder_id, &mut id_map);
            v
        })
        .collect();

    info!("Importing data");

    let upserted = window.with_tx(|tx| {
        tx.batch_upsert(
            workspaces,
            environments,
            folders,
            http_requests,
            grpc_requests,
            websocket_requests,
            &UpdateSource::Import,
        )
    })?;

    Ok(upserted)
}
