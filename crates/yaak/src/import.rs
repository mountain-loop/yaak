use crate::Result;
use log::info;
use std::collections::BTreeMap;
use yaak_core::WorkspaceContext;
use yaak_models::models::{
    Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace,
};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::{BatchUpsertResult, UpdateSource, maybe_gen_id, maybe_gen_id_opt};
use yaak_plugins::events::{ImportResources, PluginContext};
use yaak_plugins::manager::PluginManager;

pub struct ImportDataParams<'a> {
    pub query_manager: &'a QueryManager,
    pub plugin_manager: &'a PluginManager,
    pub plugin_context: &'a PluginContext,
    pub workspace_context: WorkspaceContext,
    pub contents: &'a str,
}

pub async fn import_data(params: ImportDataParams<'_>) -> Result<BatchUpsertResult> {
    let import_result =
        params.plugin_manager.import_data(params.plugin_context, params.contents).await?;

    import_resources(params.query_manager, params.workspace_context, import_result.resources)
}

pub fn import_resources(
    query_manager: &QueryManager,
    workspace_context: WorkspaceContext,
    resources: ImportResources,
) -> Result<BatchUpsertResult> {
    let mut id_map: BTreeMap<String, String> = BTreeMap::new();

    let workspaces: Vec<Workspace> = resources
        .workspaces
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Workspace>(&workspace_context, v.id.as_str(), &mut id_map);
            v
        })
        .collect();

    let environments: Vec<Environment> = resources
        .environments
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Environment>(&workspace_context, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace>(&workspace_context, v.workspace_id.as_str(), &mut id_map);
            match (v.parent_model.as_str(), v.parent_id.clone().as_deref()) {
                ("folder", Some(parent_id)) => {
                    v.parent_id =
                        Some(maybe_gen_id::<Folder>(&workspace_context, parent_id, &mut id_map));
                }
                ("", _) => {
                    v.parent_model = "workspace".to_string();
                }
                _ => {
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
            v.id = maybe_gen_id::<Folder>(&workspace_context, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace>(&workspace_context, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&workspace_context, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let http_requests: Vec<HttpRequest> = resources
        .http_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<HttpRequest>(&workspace_context, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace>(&workspace_context, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&workspace_context, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let grpc_requests: Vec<GrpcRequest> = resources
        .grpc_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<GrpcRequest>(&workspace_context, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace>(&workspace_context, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&workspace_context, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let websocket_requests: Vec<WebsocketRequest> = resources
        .websocket_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<WebsocketRequest>(&workspace_context, v.id.as_str(), &mut id_map);
            v.workspace_id =
                maybe_gen_id::<Workspace>(&workspace_context, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&workspace_context, v.folder_id, &mut id_map);
            v
        })
        .collect();

    info!("Importing data");

    query_manager.with_tx(|tx| {
        tx.batch_upsert(
            workspaces,
            environments,
            folders,
            http_requests,
            grpc_requests,
            websocket_requests,
            &UpdateSource::Import,
        )
        .map_err(crate::Error::from)
    })
}
