use crate::PluginContextExt;
use crate::error::{Error, Result};
use crate::models_ext::QueryManagerExt;
use chrono::Utc;
use log::info;
use std::collections::{BTreeMap, HashMap};
use std::fs::read_to_string;
use tauri::{Manager, Runtime, WebviewWindow};
use url::Url;
use yaak_api::{ApiClientKind, yaak_api_client};
use yaak_core::WorkspaceContext;
use yaak_models::models::{
    Environment, Folder, GrpcRequest, HttpRequest, WebsocketRequest, Workspace, WorkspaceMeta,
};
use yaak_models::util::{BatchUpsertResult, UpdateSource, maybe_gen_id, maybe_gen_id_opt};
use yaak_plugins::events::ImportResources;
use yaak_plugins::manager::PluginManager;
use yaak_tauri_utils::window::WorkspaceWindowTrait;

#[derive(Debug, Clone, Eq, PartialEq, Hash)]
struct RequestMatchKey {
    folder_path: Vec<String>,
    method: String,
    url_path: String,
}

pub(crate) async fn import_data<R: Runtime>(
    window: &WebviewWindow<R>,
    file_path: &str,
) -> Result<BatchUpsertResult> {
    let file_contents = read_to_string(file_path)?;
    let resources = import_resources(window, file_contents.as_str()).await?;
    upsert_import_resources(window, resources)
}

pub(crate) async fn import_openapi_url<R: Runtime>(
    window: &WebviewWindow<R>,
    url: &str,
    target_workspace_id: Option<&str>,
) -> Result<BatchUpsertResult> {
    let contents = fetch_url(window, url).await?;
    let resources = import_resources(window, contents.as_str()).await?;
    let resources = match target_workspace_id {
        Some(workspace_id) => retarget_import_resources(
            resources,
            workspace_id,
            &window.db().list_folders(workspace_id)?,
            &window.db().list_http_requests(workspace_id)?,
        ),
        None => resources,
    };
    let upserted = upsert_import_resources(window, resources)?;

    let workspace_id = target_workspace_id
        .map(str::to_string)
        .or_else(|| upserted.workspaces.first().map(|w| w.id.clone()))
        .ok_or_else(|| Error::GenericError("OpenAPI import did not create a workspace".to_string()))?;

    upsert_openapi_workspace_meta(window, workspace_id.as_str(), url)?;

    Ok(upserted)
}

async fn fetch_url<R: Runtime>(window: &WebviewWindow<R>, url: &str) -> Result<String> {
    let app_version = window.app_handle().package_info().version.to_string();
    let response = yaak_api_client(ApiClientKind::App, &app_version)?
        .get(url)
        .send()
        .await?
        .error_for_status()?;
    Ok(response.text().await?)
}

async fn import_resources<R: Runtime>(
    window: &WebviewWindow<R>,
    contents: &str,
) -> Result<ImportResources> {
    let plugin_manager = window.state::<PluginManager>();
    let import_result = plugin_manager.import_data(&window.plugin_context(), contents).await?;
    Ok(import_result.resources)
}

fn upsert_openapi_workspace_meta<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
    url: &str,
) -> Result<()> {
    let db = window.db();
    let workspace_meta = db.get_or_create_workspace_meta(workspace_id)?;
    db.upsert_workspace_meta(
        &WorkspaceMeta {
            openapi_import_url: Some(url.to_string()),
            openapi_last_synced_at: Some(Utc::now().naive_utc()),
            ..workspace_meta
        },
        &UpdateSource::Import,
    )?;
    Ok(())
}

fn upsert_import_resources<R: Runtime>(
    window: &WebviewWindow<R>,
    resources: ImportResources,
) -> Result<BatchUpsertResult> {
    let mut id_map: BTreeMap<String, String> = BTreeMap::new();
    let ctx = WorkspaceContext {
        workspace_id: window.workspace_id(),
        environment_id: window.environment_id(),
        cookie_jar_id: window.cookie_jar_id(),
        request_id: None,
    };

    let workspaces: Vec<Workspace> = resources
        .workspaces
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Workspace>(&ctx, v.id.as_str(), &mut id_map);
            v
        })
        .collect();

    let environments: Vec<Environment> = resources
        .environments
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<Environment>(&ctx, v.id.as_str(), &mut id_map);
            v.workspace_id = maybe_gen_id::<Workspace>(&ctx, v.workspace_id.as_str(), &mut id_map);
            match (v.parent_model.as_str(), v.parent_id.clone().as_deref()) {
                ("folder", Some(parent_id)) => {
                    v.parent_id = Some(maybe_gen_id::<Folder>(&ctx, parent_id, &mut id_map));
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
            v.id = maybe_gen_id::<Folder>(&ctx, v.id.as_str(), &mut id_map);
            v.workspace_id = maybe_gen_id::<Workspace>(&ctx, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&ctx, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let http_requests: Vec<HttpRequest> = resources
        .http_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<HttpRequest>(&ctx, v.id.as_str(), &mut id_map);
            v.workspace_id = maybe_gen_id::<Workspace>(&ctx, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&ctx, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let grpc_requests: Vec<GrpcRequest> = resources
        .grpc_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<GrpcRequest>(&ctx, v.id.as_str(), &mut id_map);
            v.workspace_id = maybe_gen_id::<Workspace>(&ctx, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&ctx, v.folder_id, &mut id_map);
            v
        })
        .collect();

    let websocket_requests: Vec<WebsocketRequest> = resources
        .websocket_requests
        .into_iter()
        .map(|mut v| {
            v.id = maybe_gen_id::<WebsocketRequest>(&ctx, v.id.as_str(), &mut id_map);
            v.workspace_id = maybe_gen_id::<Workspace>(&ctx, v.workspace_id.as_str(), &mut id_map);
            v.folder_id = maybe_gen_id_opt::<Folder>(&ctx, v.folder_id, &mut id_map);
            v
        })
        .collect();

    info!("Importing data");

    Ok(window.with_tx(|tx| {
        tx.batch_upsert(
            workspaces,
            environments,
            folders,
            http_requests,
            grpc_requests,
            websocket_requests,
            &UpdateSource::Import,
        )
    })?)
}

fn retarget_import_resources(
    mut resources: ImportResources,
    target_workspace_id: &str,
    existing_folders: &[Folder],
    existing_http_requests: &[HttpRequest],
) -> ImportResources {
    let imported_folder_paths = build_folder_paths(&resources.folders);
    let existing_folder_paths = build_folder_paths(existing_folders);
    let existing_folders_by_path: HashMap<Vec<String>, Folder> = existing_folders
        .iter()
        .filter_map(|folder| {
            existing_folder_paths
                .get(folder.id.as_str())
                .map(|path| (path.clone(), folder.clone()))
        })
        .collect();
    let existing_http_requests_by_key = build_http_request_map(
        existing_http_requests,
        &existing_folder_paths,
    );

    let mut folder_id_map: HashMap<String, String> = HashMap::new();
    let mut folders = Vec::new();
    for mut folder in std::mem::take(&mut resources.folders) {
        let original_id = folder.id.clone();
        let path = imported_folder_paths.get(original_id.as_str()).cloned().unwrap_or_default();

        if let Some(existing_folder) = existing_folders_by_path.get(&path) {
            folder_id_map.insert(original_id, existing_folder.id.clone());
            continue;
        }

        folder.workspace_id = target_workspace_id.to_string();
        folder.folder_id = folder
            .folder_id
            .as_ref()
            .and_then(|id| folder_id_map.get(id))
            .cloned();
        folder_id_map.insert(original_id, folder.id.clone());
        folders.push(folder);
    }

    let mut http_requests = Vec::new();
    for mut request in std::mem::take(&mut resources.http_requests) {
        let folder_path = request
            .folder_id
            .as_ref()
            .and_then(|id| imported_folder_paths.get(id))
            .cloned()
            .unwrap_or_default();
        let key = RequestMatchKey {
            folder_path,
            method: request.method.to_ascii_uppercase(),
            url_path: normalize_url_path(request.url.as_str()),
        };

        request.workspace_id = target_workspace_id.to_string();

        if let Some(existing_request) = existing_http_requests_by_key.get(&key) {
            request.id = existing_request.id.clone();
            request.folder_id = existing_request.folder_id.clone();
            request.name = existing_request.name.clone();
            request.headers = existing_request.headers.clone();
            request.body = existing_request.body.clone();
            request.body_type = existing_request.body_type.clone();
            request.authentication = existing_request.authentication.clone();
            request.authentication_type = existing_request.authentication_type.clone();
            request.sort_priority = existing_request.sort_priority;
        } else {
            request.folder_id = request
                .folder_id
                .as_ref()
                .and_then(|id| folder_id_map.get(id))
                .cloned();
        }

        http_requests.push(request);
    }

    for request in &mut resources.grpc_requests {
        request.workspace_id = target_workspace_id.to_string();
        request.folder_id = request
            .folder_id
            .as_ref()
            .and_then(|id| folder_id_map.get(id))
            .cloned();
    }

    for request in &mut resources.websocket_requests {
        request.workspace_id = target_workspace_id.to_string();
        request.folder_id = request
            .folder_id
            .as_ref()
            .and_then(|id| folder_id_map.get(id))
            .cloned();
    }

    resources.workspaces.clear();
    resources.environments.clear();
    resources.folders = folders;
    resources.http_requests = http_requests;
    resources
}

fn build_http_request_map(
    requests: &[HttpRequest],
    folder_paths: &HashMap<String, Vec<String>>,
) -> HashMap<RequestMatchKey, HttpRequest> {
    let mut map = HashMap::new();

    for request in requests {
        let folder_path = request
            .folder_id
            .as_ref()
            .and_then(|id| folder_paths.get(id))
            .cloned()
            .unwrap_or_default();
        let key = RequestMatchKey {
            folder_path,
            method: request.method.to_ascii_uppercase(),
            url_path: normalize_url_path(request.url.as_str()),
        };
        map.entry(key).or_insert_with(|| request.clone());
    }

    map
}

fn build_folder_paths(folders: &[Folder]) -> HashMap<String, Vec<String>> {
    let folders_by_id: HashMap<&str, &Folder> =
        folders.iter().map(|folder| (folder.id.as_str(), folder)).collect();
    let mut paths = HashMap::new();

    for folder in folders {
        let _ = build_folder_path(folder.id.as_str(), &folders_by_id, &mut paths);
    }

    paths
}

fn build_folder_path(
    folder_id: &str,
    folders_by_id: &HashMap<&str, &Folder>,
    paths: &mut HashMap<String, Vec<String>>,
) -> Vec<String> {
    if let Some(path) = paths.get(folder_id) {
        return path.clone();
    }

    let Some(folder) = folders_by_id.get(folder_id) else {
        return Vec::new();
    };

    let mut path = folder
        .folder_id
        .as_deref()
        .map(|parent_id| build_folder_path(parent_id, folders_by_id, paths))
        .unwrap_or_default();
    path.push(folder.name.clone());
    paths.insert(folder_id.to_string(), path.clone());
    path
}

fn normalize_url_path(url: &str) -> String {
    let without_fragment = url.split_once('#').map(|(v, _)| v).unwrap_or(url);
    let base = without_fragment
        .split_once('?')
        .map(|(v, _)| v)
        .unwrap_or(without_fragment);

    let path = Url::parse(base)
        .ok()
        .map(|u| u.path().to_string())
        .or_else(|| extract_path(base))
        .unwrap_or_else(|| "/".to_string());

    let normalized_segments: Vec<String> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(normalize_path_segment)
        .collect();

    if normalized_segments.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", normalized_segments.join("/"))
    }
}

fn extract_path(url: &str) -> Option<String> {
    if url.starts_with('/') {
        return Some(url.to_string());
    }

    let after_scheme = url
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(url);
    let slash_idx = after_scheme.find('/')?;
    Some(after_scheme[slash_idx..].to_string())
}

fn normalize_path_segment(segment: &str) -> String {
    if segment.starts_with(':') {
        return "{param}".to_string();
    }

    if segment.starts_with('{') && segment.ends_with('}') {
        return "{param}".to_string();
    }

    let lower = segment.to_ascii_lowercase();
    if lower.starts_with("%7b") && lower.ends_with("%7d") {
        return "{param}".to_string();
    }

    segment.to_string()
}

#[cfg(test)]
mod tests {
    use super::{normalize_url_path, retarget_import_resources};
    use yaak_models::models::{Folder, HttpRequest};
    use yaak_plugins::events::ImportResources;

    #[test]
    fn normalizes_openapi_path_templates() {
        assert_eq!(
            normalize_url_path("https://api.example.com/pets/{id}?include=owner"),
            "/pets/{param}"
        );
        assert_eq!(normalize_url_path("${[baseUrl]}/pets/:id"), "/pets/{param}");
        assert_eq!(normalize_url_path("/pets/{id}"), "/pets/{param}");
    }

    #[test]
    fn resync_reuses_existing_ids_and_only_keeps_new_resources() {
        let target_workspace_id = "wk_existing";
        let existing_folders = vec![Folder {
            id: "fl_pets".to_string(),
            workspace_id: target_workspace_id.to_string(),
            name: "Pets".to_string(),
            ..Default::default()
        }];
        let existing_http_requests = vec![HttpRequest {
            id: "rq_list_pets".to_string(),
            workspace_id: target_workspace_id.to_string(),
            folder_id: Some("fl_pets".to_string()),
            name: "Custom list pets".to_string(),
            method: "GET".to_string(),
            url: "https://api.example.com/pets".to_string(),
            description: "old".to_string(),
            headers: vec![Default::default()],
            body_type: Some("application/json".to_string()),
            sort_priority: 9.0,
            ..Default::default()
        }];
        let resources = ImportResources {
            workspaces: vec![Default::default()],
            environments: vec![Default::default()],
            folders: vec![
                Folder {
                    id: "GENERATE_ID::FOLDER_0".to_string(),
                    workspace_id: "GENERATE_ID::WORKSPACE_0".to_string(),
                    name: "Pets".to_string(),
                    ..Default::default()
                },
                Folder {
                    id: "GENERATE_ID::FOLDER_1".to_string(),
                    workspace_id: "GENERATE_ID::WORKSPACE_0".to_string(),
                    name: "Admin".to_string(),
                    ..Default::default()
                },
            ],
            http_requests: vec![
                HttpRequest {
                    id: "GENERATE_ID::HTTP_REQUEST_0".to_string(),
                    workspace_id: "GENERATE_ID::WORKSPACE_0".to_string(),
                    folder_id: Some("GENERATE_ID::FOLDER_0".to_string()),
                    name: "List pets".to_string(),
                    method: "GET".to_string(),
                    url: "https://api.example.com/pets".to_string(),
                    description: "fresh".to_string(),
                    ..Default::default()
                },
                HttpRequest {
                    id: "GENERATE_ID::HTTP_REQUEST_1".to_string(),
                    workspace_id: "GENERATE_ID::WORKSPACE_0".to_string(),
                    folder_id: Some("GENERATE_ID::FOLDER_1".to_string()),
                    name: "List admins".to_string(),
                    method: "GET".to_string(),
                    url: "https://api.example.com/admins".to_string(),
                    description: "new".to_string(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };

        let retargeted = retarget_import_resources(
            resources,
            target_workspace_id,
            &existing_folders,
            &existing_http_requests,
        );

        assert!(retargeted.workspaces.is_empty());
        assert!(retargeted.environments.is_empty());
        assert_eq!(retargeted.folders.len(), 1);
        assert_eq!(retargeted.folders[0].name, "Admin");
        assert_eq!(retargeted.folders[0].workspace_id, target_workspace_id);

        assert_eq!(retargeted.http_requests.len(), 2);

        let updated_request = retargeted
            .http_requests
            .iter()
            .find(|r| r.id == "rq_list_pets")
            .expect("expected existing request to be reused");
        assert_eq!(updated_request.description, "fresh");
        assert_eq!(updated_request.name, "Custom list pets");
        assert_eq!(updated_request.headers.len(), 1);
        assert_eq!(updated_request.body_type.as_deref(), Some("application/json"));
        assert_eq!(updated_request.sort_priority, 9.0);

        let new_request = retargeted
            .http_requests
            .iter()
            .find(|r| r.name == "List admins")
            .expect("expected new request to be kept");
        assert_eq!(new_request.workspace_id, target_workspace_id);
        assert_eq!(new_request.folder_id.as_deref(), Some("GENERATE_ID::FOLDER_1"));
    }
}
