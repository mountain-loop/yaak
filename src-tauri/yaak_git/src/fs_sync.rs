use crate::error::Error::WorkspaceSyncNotConfigured;
use crate::error::Result;
use crate::model_hash::model_hash;
use crate::models::SyncModel;
use chrono::Utc;
use log::{debug, error};
use sha1::{Digest, Sha1};
use std::fs;
use std::fs::{DirEntry, File};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use yaak_models::models::{SyncState, SyncStateFlushState, Workspace};
use yaak_models::queries::{
    delete_environment, delete_folder, delete_grpc_request, delete_http_request, delete_sync_state,
    delete_workspace, get_or_create_sync_state_for_model, get_sync_state_for_model, get_workspace,
    get_workspace_export_resources, list_sync_states_for_workspace, listen_to_model_delete,
    listen_to_model_upsert, upsert_environment, upsert_folder, upsert_grpc_request,
    upsert_http_request, upsert_sync_state, upsert_workspace, UpdateSource,
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
    listen_to_model_upsert(&app_handle.clone(), move |payload| {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let m: Result<SyncModel> = payload.model.try_into();
            if let Ok(m) = m {
                let sync_state = get_sync_state_for_model(
                    &app_handle,
                    m.workspace_id().as_str(),
                    m.id().as_str(),
                )
                .await
                .unwrap()
                .unwrap();
                upsert_sync_state(
                    &app_handle,
                    SyncState {
                        dirty: true,
                        ..sync_state
                    },
                )
                .await
                .unwrap();
            }
        });
    });
}

pub(crate) fn watch_deleted_models<R: Runtime>(app_handle: &AppHandle<R>) {
    let app_handle = app_handle.clone();
    listen_to_model_delete(&app_handle.clone(), move |payload| {
        let app_handle = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let m: Result<SyncModel> = payload.model.try_into();
            if let Ok(m) = m {
                let sync_state = get_sync_state_for_model(
                    &app_handle,
                    m.workspace_id().as_str(),
                    m.id().as_str(),
                )
                .await
                .unwrap()
                .unwrap();
                upsert_sync_state(
                    &app_handle,
                    SyncState {
                        dirty: true,
                        ..sync_state
                    },
                )
                .await
                .unwrap();
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
    let fs_model = SyncModel::from_file(file_path.as_path())?;

    let new_content = serde_yaml::to_string(model)?;
    let mut hasher = Sha1::new();
    hasher.update(&new_content);
    let new_checksum = hex::encode(hasher.finalize());

    #[derive(Debug)]
    enum SyncOp {
        // FsDelete, // Not possible to reach in this function
        FsWrite,
        DbDelete,
        DbWrite { model: SyncModel, checksum: String },
        Conflict,
        Nothing,
    }

    let sync_op = match (sync_state.clone().last_flush, fs_model.clone()) {
        // Hasn't ever been flushed
        // NOTE: this should technically never happen because a SyncState should exist
        (None, None) => SyncOp::FsWrite,
        // Has been flushed, but doesn't exist on FS (deleted)
        (Some(_last_flush), None) => SyncOp::DbDelete,
        // Hasn't been flushed, and doesn't exist in DB (added)
        (None, Some((model, checksum))) => SyncOp::DbWrite { model, checksum },
        // Has been flushed, and exists on FS
        (Some(last_flush), Some((model, checksum))) => {
            if last_flush.checksum != checksum {
                if sync_state.dirty {
                    SyncOp::Conflict
                } else {
                    SyncOp::DbWrite { model, checksum }
                }
            } else {
                if sync_state.dirty {
                    SyncOp::FsWrite
                } else {
                    SyncOp::Nothing
                }
            }
        }
    };

    debug!("Sync op for {:?} {:?}", file_path, sync_op);

    match sync_op {
        SyncOp::Nothing => {}
        SyncOp::FsWrite => {
            fs::write(&file_path, new_content)?;
            upsert_sync_state(
                window,
                SyncState {
                    dirty: false,
                    last_flush: Some(SyncStateFlushState {
                        time: Utc::now().naive_utc(),
                        checksum: new_checksum,
                    }),
                    ..sync_state
                },
            )
            .await?;
        }
        SyncOp::DbDelete => {
            match model {
                SyncModel::Workspace(m) => {
                    delete_workspace(window, m.id.as_str(), &UpdateSource::Sync).await?;
                }
                SyncModel::Environment(m) => {
                    delete_environment(window, m.id.as_str(), &UpdateSource::Sync).await?;
                }
                SyncModel::Folder(m) => {
                    delete_folder(window, m.id.as_str(), &UpdateSource::Sync).await?;
                }
                SyncModel::HttpRequest(m) => {
                    delete_http_request(window, m.id.as_str(), &UpdateSource::Sync).await?;
                }
                SyncModel::GrpcRequest(m) => {
                    delete_grpc_request(window, m.id.as_str(), &UpdateSource::Sync).await?;
                }
            }
            delete_sync_state(
                window,
                sync_state.workspace_id.as_str(),
                sync_state.model_id.as_str(),
                &UpdateSource::Sync,
            )
            .await?;
        }
        SyncOp::DbWrite { model, checksum } => {
            match model {
                SyncModel::Workspace(m) => {
                    upsert_workspace(window, m, &UpdateSource::Sync).await?;
                }
                SyncModel::Environment(m) => {
                    upsert_environment(window, m, &UpdateSource::Sync).await?;
                }
                SyncModel::Folder(m) => {
                    upsert_folder(window, m, &UpdateSource::Sync).await?;
                }
                SyncModel::HttpRequest(m) => {
                    upsert_http_request(window, m, &UpdateSource::Sync).await?;
                }
                SyncModel::GrpcRequest(m) => {
                    upsert_grpc_request(window, &m, &UpdateSource::Sync).await?;
                }
            }
            upsert_sync_state(
                window,
                SyncState {
                    last_flush: Some(SyncStateFlushState {
                        time: Utc::now().naive_utc(),
                        checksum,
                    }),
                    ..sync_state
                },
            )
            .await?;
        }
        SyncOp::Conflict => {
            error!("Got conflict for \n{sync_state:?} \n{fs_model:?}");
            todo!("Implement conflict error type?");
        }
    };

    Ok(())
}

async fn read_fs_state<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace: &Workspace,
) -> Result<Vec<FileState>> {
    let state = Vec::new();

    let sync_states = match list_sync_states_for_workspace(app_handle, &workspace.id).await {
        Ok(s) => s,
        Err(_) => return Ok(state),
    };

    let dir = match workspace.setting_sync_dir.clone() {
        None => return Ok(state),
        Some(d) => d,
    };

    for item in fs::read_dir(dir)? {
        let (fs_model, _fs_checksum) = match model_from_dir_item(item.ok())? {
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
                        let last_flush_checksum = ss.checksum;
                        let status = if fs_hash == last_flush_checksum {
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

    Ok(state)
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

fn model_from_dir_item(dir_entry: Option<DirEntry>) -> Result<Option<(SyncModel, String)>> {
    let dir_entry = match dir_entry {
        None => return Ok(None),
        Some(v) => v,
    };

    match dir_entry.file_type() {
        Ok(t) if t.is_file() => {}
        _ => return Ok(None),
    }

    SyncModel::from_file(dir_entry.path().as_path())
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
