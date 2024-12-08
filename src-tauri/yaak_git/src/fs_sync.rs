use log::debug;
use serde_yaml::Value;
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use yaak_models::models::{AnyModel, Workspace};
use yaak_models::queries::{
    get_workspace, get_workspace_export_resources, listen_to_model_delete, listen_to_model_upsert,
};

pub(crate) fn watch_upserted_models<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    listen_to_model_upsert(&app_handle.clone(), move |m| {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            write_model_to_fs(&app_handle, &m).await;
        });
    });
}

pub(crate) fn watch_deleted_models<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    listen_to_model_delete(&app_handle.clone(), move |m| {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            delete_model_from_fs(&app_handle, &m).await;
        });
    });
}

async fn write_model_to_fs<R: Runtime>(app_handle: &AppHandle<R>, m: &AnyModel) {
    let full_path = match prep_model_file_path(app_handle, &m).await {
        None => return,
        Some(p) => p,
    };

    let mut f = File::options().create(true).write(true).truncate(true).open(full_path).unwrap();

    serde_yaml::to_writer(&mut f, &m).unwrap();
}

async fn delete_model_from_fs<R: Runtime>(app_handle: &AppHandle<R>, m: &AnyModel) {
    let full_path = match prep_model_file_path(app_handle, &m).await {
        None => return,
        Some(p) => p,
    };
    fs::remove_file(full_path).unwrap();
}

#[allow(unused)]
async fn sync_all<R: Runtime>(app_handle: &AppHandle<R>, workspace: &Workspace) {
    let resources =
        get_workspace_export_resources(app_handle, vec![workspace.id.as_str()]).await.resources;
    for m in resources.workspaces {
        write_model_to_fs(app_handle, &AnyModel::Workspace(m)).await;
    }
    for m in resources.environments {
        write_model_to_fs(app_handle, &AnyModel::Environment(m)).await;
    }
    for m in resources.folders {
        write_model_to_fs(app_handle, &AnyModel::Folder(m)).await;
    }
    for m in resources.http_requests {
        write_model_to_fs(app_handle, &AnyModel::HttpRequest(m)).await;
    }
    for m in resources.grpc_requests {
        write_model_to_fs(app_handle, &AnyModel::GrpcRequest(m)).await;
    }
}

async fn prep_model_file_path<R: Runtime>(
    app_handle: &AppHandle<R>,
    m: &AnyModel,
) -> Option<PathBuf> {
    let dir = match get_workspace_from_model(app_handle, m).await {
        Some(Workspace {
            setting_sync_dir: Some(d),
            ..
        }) => d,
        r => {
            debug!("Failed to get workspace {r:?}");
            return None;
        }
    };
    let dir = Path::new(&dir);

    let mut value = serde_yaml::to_value(&m).unwrap();
    let value = value.as_mapping_mut().unwrap();
    let id = match value.get("id") {
        None => return None,
        Some(Value::String(v)) => v,
        _ => return None,
    };

    let full_path = dir.join(format!("{id}.yaml"));
    let parent_dir = full_path.parent().unwrap();

    // Ensure parent dir exists
    fs::create_dir_all(parent_dir).unwrap();
    Some(full_path)
}

async fn get_workspace_from_model<R: Runtime>(
    app_handle: &AppHandle<R>,
    m: &AnyModel,
) -> Option<Workspace> {
    if let AnyModel::Workspace(m) = m {
        return Some(m.to_owned());
    }
    
    let mut value = serde_yaml::to_value(&m).unwrap();
    let value = value.as_mapping_mut().unwrap();
    let workspace_id = match value.get("workspaceId") {
        Some(Value::String(v)) => v,
        r => {
            debug!("Failed to get workspace id from {r:?}");
            return None;
        }
    };

    get_workspace(app_handle, workspace_id).await.ok()
}
