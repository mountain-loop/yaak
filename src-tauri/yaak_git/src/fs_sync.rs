use crate::error::Error::WorkspaceSyncNotConfigured;
use crate::error::Result;
use crate::model_hash::model_hash;
use crate::models::SyncModel;
use log::{debug, warn};
use sha1::{Digest, Sha1};
use std::fs;
use std::fs::{DirEntry, File};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use yaak_models::models::{SyncState, SyncStateFlushState, Workspace};
use yaak_models::queries::{
    get_or_create_settings, get_or_create_sync_state_for_model, get_sync_state_for_model,
    get_workspace, get_workspace_export_resources, list_sync_states_for_workspace,
    listen_to_model_delete, listen_to_model_upsert, upsert_sync_state,
};

pub(crate) async fn sync_fs<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let workspace = get_workspace(window, workspace_id).await?;
    flush_db_models(window, &workspace).await?;

    // let fs_state = read_fs_state(window, &workspace).await;
    // let db_state = read_db_state(app_handle, &workspace).await;

    // 1. Find models deleted on the FS

    Ok(())
}

pub(crate) fn watch_upserted_models<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    listen_to_model_upsert(&app_handle.clone(), move |m| {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(m) = m.try_into() {
                write_model_to_fs(&app_handle, &m).await.unwrap();
            }
        });
    });
}

pub(crate) fn watch_deleted_models<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    listen_to_model_delete(&app_handle.clone(), move |m| {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if let Ok(m) = m.try_into() {
                delete_model_from_fs(&app_handle, &m).await.unwrap();
            }
        });
    });
}

async fn write_model_to_fs<R: Runtime>(app_handle: &AppHandle<R>, m: &SyncModel) -> Result<()> {
    let full_path = prep_model_file_path(app_handle, &m).await?;
    let mut f = File::options().create(true).write(true).truncate(true).open(full_path).unwrap();
    serde_yaml::to_writer(&mut f, &m)?;
    Ok(())
}

async fn delete_model_from_fs<R: Runtime>(app_handle: &AppHandle<R>, m: &SyncModel) -> Result<()> {
    let full_path = prep_model_file_path(app_handle, &m).await?;
    fs::remove_file(full_path)?;
    Ok(())
}

async fn workspace_models<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace: &Workspace,
) -> Vec<SyncModel> {
    let mut sync_models = vec![SyncModel::Workspace(workspace.to_owned())];

    let resources =
        get_workspace_export_resources(app_handle, vec![workspace.id.as_str()]).await.resources;

    for m in resources.environments {
        sync_models.push(SyncModel::Environment(m));
    }
    for m in resources.folders {
        sync_models.push(SyncModel::Folder(m));
    }
    for m in resources.http_requests {
        sync_models.push(SyncModel::HttpRequest(m));
    }
    for m in resources.grpc_requests {
        sync_models.push(SyncModel::GrpcRequest(m));
    }

    sync_models
}

enum FileStateStatus {
    FsAdded,
    DbAdded,
    FsModified,
    DbModified,
    FsDeleted,
    DbDeleted,
    Unchanged,
}

struct FileState {
    model: SyncModel,
    status: FileStateStatus,
}

async fn flush_db_models<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: &Workspace,
) -> Result<()> {
    debug!("Flushing DB models for {}", workspace.id);
    for model in workspace_models(window.app_handle(), workspace).await {
        flush_db_model(window, &model).await?;
    }
    Ok(())
}

/// Flush a DB model to the filesystem
async fn flush_db_model<R: Runtime>(window: &WebviewWindow<R>, model: &SyncModel) -> Result<()> {
    let file_path = prep_model_file_path(window.app_handle(), &model).await?;
    let sync_state = get_or_create_sync_state_for_model(
        window,
        model.workspace_id().as_str(),
        model.id().as_str(),
        file_path.to_str().unwrap(),
    )
    .await?;

    debug!("Reading model from {:?}", file_path);
    let fs_checksum = match fs::read(file_path.clone()) {
        Ok(c) => {
            let mut hasher = Sha1::new();
            hasher.update(&c);
            Some(hex::encode(hasher.finalize()))
        }
        Err(_) => None,
    };

    let new_content = serde_yaml::to_string(model)?;
    let mut hasher = Sha1::new();
    hasher.update(&new_content);
    let new_checksum = hex::encode(hasher.finalize());

    let should_write = match (sync_state.clone().last_flush, fs_checksum) {
        // Hasn't ever been synced
        (None, None) => true,
        // Has been synced, but doesn't exist on FS (deleted)
        (Some(_last_flush), None) => false,
        // Hasn't been synced, and doesn't exist in DB (added)
        (None, Some(_fs_checksum)) => true,
        // Has been synced, but the destination changed (conflict
        (Some(last_flush), Some(fs_checksum)) if last_flush.checksum != fs_checksum => todo!("Handle conflict"),
        // Has been synced and the destination is unchanged
        (Some(_last_flush), Some(_fs_checksum)) => true,
    };

    if should_write {
        fs::write(&file_path, new_content)?;
        let mut sync_state = sync_state.clone();
        sync_state.dirty = false;
        sync_state.last_flush = Some(SyncStateFlushState {
            time: Default::default(),
            hash: "".to_string(),
            checksum: new_checksum,
        });
        upsert_sync_state(window, sync_state).await?;
    }

    Ok(())
}

async fn read_fs_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace: &Workspace,
) -> Vec<FileState> {
    let state = Vec::new();

    let sync_states = match list_sync_states_for_workspace(app_handle, &workspace.id).await {
        Ok(s) => s,
        Err(_) => return state,
    };

    let dir = match workspace.setting_sync_dir.clone() {
        None => return state,
        Some(d) => d,
    };

    let dir_items = fs::read_dir(dir.clone());
    if let Err(e) = dir_items {
        warn!("Failed to read dir {dir} {e:?}");
        return state;
    }

    for item in fs::read_dir(dir).unwrap() {
        let fs_model = match model_from_dir_item(item.ok()) {
            None => continue, // We don't care about this file
            Some(m) => m,
        };

        let _file_state = match sync_states.iter().find(|ss| ss.id == fs_model.id()) {
            None => {
                // Doesn't yet exist in the DB
                FileState {
                    model: fs_model,
                    status: FileStateStatus::FsAdded,
                }
            }
            Some(sync_state) => {
                match sync_state.clone().last_flush {
                    None => {
                        // Exists in DB, but hasn't been flushed to FS yet
                        todo!("Implement Me");
                    }
                    Some(ss) => {
                        // Exists in DB, and has been flushed to FS before
                        let fs_hash = model_hash(&fs_model);
                        let last_flush_hash = ss.hash;
                        let status = if fs_hash == last_flush_hash {
                            FileStateStatus::Unchanged
                        } else {
                            FileStateStatus::FsModified
                        };

                        FileState {
                            model: fs_model,
                            status,
                        }
                    }
                }
            }
        };

        todo!();
    }

    state
}

// async fn read_db_state<R: Runtime>(
//     app_handle: &AppHandle<R>,
//     workspace: &Workspace,
// ) -> Vec<FileState> {
//     let mut state = Vec::new();
//
//     for model in workspace_models(app_handle, workspace).await {
//         let id = model.id();
//         let hash = model_hash(&model);
//
//         state.push(FileState { model, status: FileStateStatus::DbAdded });
//     }
//
//     state
// }

fn model_from_dir_item(dir_entry: Option<DirEntry>) -> Option<SyncModel> {
    let dir_entry = dir_entry?;

    match dir_entry.file_type() {
        Ok(t) if t.is_file() => {}
        _ => return None,
    }

    SyncModel::from_file(dir_entry.path().as_path()).ok()
}

async fn prep_model_file_path<R: Runtime>(
    app_handle: &AppHandle<R>,
    m: &SyncModel,
) -> Result<PathBuf> {
    let workspace = get_workspace_from_model(app_handle, m).await?;
    let dir = match workspace.setting_sync_dir {
        Some(d) => d,
        None => {
            return Err(WorkspaceSyncNotConfigured(m.workspace_id()));
        }
    };

    let dir = Path::new(&dir);
    let full_path = dir.join(format!("{}.yaml", m.id()));
    let parent_dir = full_path.parent().unwrap();

    // Ensure parent dir exists
    fs::create_dir_all(parent_dir)?;
    Ok(full_path)
}

async fn get_workspace_from_model<R: Runtime>(
    app_handle: &AppHandle<R>,
    m: &SyncModel,
) -> Result<Workspace> {
    Ok(get_workspace(app_handle, &m.workspace_id()).await?)
}
