use crate::error::Result;
use crate::models::SyncModel;
use chrono::Utc;
use log::{debug, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use tokio::fs;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use ts_rs::TS;
use yaak_models::models::{SyncState, WorkspaceMeta};
use yaak_models::queries::{
    batch_upsert, delete_environment, delete_folder, delete_grpc_request, delete_http_request,
    delete_sync_state, delete_websocket_request, delete_workspace, get_workspace_export_resources,
    get_workspace_meta, list_sync_states_for_workspace, upsert_sync_state, upsert_workspace_meta,
    UpdateSource,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "gen_sync.ts")]
pub(crate) enum SyncOp {
    FsCreate {
        model: SyncModel,
    },
    FsUpdate {
        model: SyncModel,
        state: SyncState,
    },
    FsDelete {
        state: SyncState,
        fs: Option<FsCandidate>,
    },
    DbCreate {
        fs: FsCandidate,
    },
    DbUpdate {
        state: SyncState,
        fs: FsCandidate,
    },
    DbDelete {
        model: SyncModel,
        state: SyncState,
    },
}

impl SyncOp {
    fn workspace_id(&self) -> String {
        match self {
            SyncOp::FsCreate { model } => model.workspace_id(),
            SyncOp::FsUpdate { state, .. } => state.workspace_id.clone(),
            SyncOp::FsDelete { state, .. } => state.workspace_id.clone(),
            SyncOp::DbCreate { fs } => fs.model.workspace_id(),
            SyncOp::DbUpdate { state, .. } => state.workspace_id.clone(),
            SyncOp::DbDelete { model, .. } => model.workspace_id(),
        }
    }
}

impl Display for SyncOp {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            match self {
                SyncOp::FsCreate { model } => format!("fs_create({})", model.id()),
                SyncOp::FsUpdate { model, .. } => format!("fs_update({})", model.id()),
                SyncOp::FsDelete { state, .. } => format!("fs_delete({})", state.model_id),
                SyncOp::DbCreate { fs } => format!("db_create({})", fs.model.id()),
                SyncOp::DbUpdate { fs, .. } => format!("db_update({})", fs.model.id()),
                SyncOp::DbDelete { model, .. } => format!("db_delete({})", model.id()),
            }
            .as_str(),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DbCandidate {
    Added(SyncModel),
    Modified(SyncModel, SyncState),
    Deleted(SyncState),
    Unmodified(SyncModel, SyncState),
}

impl DbCandidate {
    fn model_id(&self) -> String {
        match &self {
            DbCandidate::Added(m) => m.id(),
            DbCandidate::Modified(m, _) => m.id(),
            DbCandidate::Deleted(s) => s.model_id.clone(),
            DbCandidate::Unmodified(m, _) => m.id(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "gen_sync.ts")]
pub(crate) struct FsCandidate {
    pub(crate) model: SyncModel,
    pub(crate) rel_path: PathBuf,
    pub(crate) checksum: String,
}

pub(crate) async fn get_db_candidates<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<DbCandidate>> {
    let models: HashMap<_, _> = workspace_models(app_handle, workspace_id)
        .await?
        .into_iter()
        .map(|m| (m.id(), m))
        .collect();
    let sync_states: HashMap<_, _> =
        list_sync_states_for_workspace(app_handle, workspace_id, sync_dir)
            .await?
            .into_iter()
            .map(|s| (s.model_id.clone(), s))
            .collect();

    // 1. Add candidates for models (created/modified/unmodified)
    let mut candidates: Vec<DbCandidate> = models
        .values()
        .map(|model| {
            let existing_sync_state = match sync_states.get(&model.id()) {
                Some(s) => s,
                None => {
                    // No sync state yet, so model was just added
                    return DbCandidate::Added(model.to_owned());
                }
            };

            let updated_since_flush = model.updated_at() > existing_sync_state.flushed_at;
            if updated_since_flush {
                DbCandidate::Modified(model.to_owned(), existing_sync_state.to_owned())
            } else {
                DbCandidate::Unmodified(model.to_owned(), existing_sync_state.to_owned())
            }
        })
        .collect();

    // 2. Add SyncState-only candidates (deleted)
    candidates.extend(sync_states.values().filter_map(|sync_state| {
        if models.contains_key(&sync_state.model_id) {
            None
        } else {
            Some(DbCandidate::Deleted(sync_state.to_owned()))
        }
    }));

    Ok(candidates)
}

pub(crate) async fn get_fs_candidates(dir: &Path) -> Result<Vec<FsCandidate>> {
    // Ensure the root directory exists
    fs::create_dir_all(dir).await?;

    let mut candidates = Vec::new();
    let mut entries = fs::read_dir(dir).await?;
    while let Some(dir_entry) = entries.next_entry().await? {
        if !dir_entry.file_type().await?.is_file() {
            continue;
        };

        let path = dir_entry.path();
        let (model, checksum) = match SyncModel::from_file(&path) {
            // TODO: Remove this once we have logic to handle environments. This it to clean
            //  any existing ones from the sync dir that resulted from the 2025.1 betas.
            Ok(Some((SyncModel::Environment(e), _))) => {
                fs::remove_file(path).await?;
                info!("Cleaned up synced environment {}", e.id);
                continue;
            }
            Ok(Some(m)) => m,
            Ok(None) => continue,
            Err(e) => {
                warn!("Failed to read sync file {e}");
                return Err(e);
            }
        };

        let rel_path = Path::new(&dir_entry.file_name()).to_path_buf();
        candidates.push(FsCandidate {
            rel_path,
            model,
            checksum,
        })
    }

    Ok(candidates)
}

pub(crate) fn compute_sync_ops(
    db_candidates: Vec<DbCandidate>,
    fs_candidates: Vec<FsCandidate>,
) -> Vec<SyncOp> {
    let mut db_map: HashMap<String, DbCandidate> = HashMap::new();
    for c in db_candidates {
        db_map.insert(c.model_id(), c);
    }

    let mut fs_map: HashMap<String, FsCandidate> = HashMap::new();
    for c in fs_candidates {
        fs_map.insert(c.model.id(), c);
    }

    // Collect all keys from both maps for the OUTER JOIN
    let keys: std::collections::HashSet<_> = db_map.keys().chain(fs_map.keys()).collect();

    keys.into_iter()
        .filter_map(|k| {
            let op = match (db_map.get(k), fs_map.get(k)) {
                (None, None) => return None, // Can never happen
                (None, Some(fs)) => SyncOp::DbCreate { fs: fs.to_owned() },
                (Some(DbCandidate::Unmodified(model, sync_state)), None) => {
                    // TODO: Remove this once we have logic to handle environments. This it to
                    //  ignore the cleaning we did above of any environments that were written
                    //  to disk in the 2025.1 betas.
                    if let SyncModel::Environment(_) = model {
                        return None;
                    }
                    SyncOp::DbDelete {
                        model: model.to_owned(),
                        state: sync_state.to_owned(),
                    }
                }
                (Some(DbCandidate::Modified(model, sync_state)), None) => SyncOp::FsUpdate {
                    model: model.to_owned(),
                    state: sync_state.to_owned(),
                },
                (Some(DbCandidate::Added(model)), None) => SyncOp::FsCreate {
                    model: model.to_owned(),
                },
                (Some(DbCandidate::Deleted(sync_state)), None) => {
                    // Already deleted on FS, but sending it so the SyncState gets dealt with
                    SyncOp::FsDelete {
                        state: sync_state.to_owned(),
                        fs: None,
                    }
                }
                (Some(DbCandidate::Unmodified(_, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        return None;
                    } else {
                        SyncOp::DbUpdate {
                            state: sync_state.to_owned(),
                            fs: fs_candidate.to_owned(),
                        }
                    }
                }
                (Some(DbCandidate::Modified(model, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        SyncOp::FsUpdate {
                            model: model.to_owned(),
                            state: sync_state.to_owned(),
                        }
                    } else if model.updated_at() < fs_candidate.model.updated_at() {
                        // CONFLICT! Write to DB if fs model is newer
                        SyncOp::DbUpdate {
                            state: sync_state.to_owned(),
                            fs: fs_candidate.to_owned(),
                        }
                    } else {
                        // CONFLICT! Write to FS if db model is newer
                        SyncOp::FsUpdate {
                            model: model.to_owned(),
                            state: sync_state.to_owned(),
                        }
                    }
                }
                (Some(DbCandidate::Added(model)), Some(_)) => {
                    // This would be super rare (impossible?), so let's follow the user's intention
                    SyncOp::FsCreate {
                        model: model.to_owned(),
                    }
                }
                (Some(DbCandidate::Deleted(sync_state)), Some(fs_candidate)) => SyncOp::FsDelete {
                    state: sync_state.to_owned(),
                    fs: Some(fs_candidate.to_owned()),
                },
            };
            Some(op)
        })
        .collect()
}

async fn workspace_models<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
) -> Result<Vec<SyncModel>> {
    let resources =
        get_workspace_export_resources(app_handle, vec![workspace_id], true).await?.resources;
    let workspace = resources.workspaces.iter().find(|w| w.id == workspace_id);

    let workspace = match workspace {
        None => return Ok(Vec::new()),
        Some(w) => w,
    };

    let mut sync_models = vec![SyncModel::Workspace(workspace.to_owned())];

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
    for m in resources.websocket_requests {
        sync_models.push(SyncModel::WebsocketRequest(m));
    }

    Ok(sync_models)
}

pub(crate) async fn apply_sync_ops<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
    sync_ops: Vec<SyncOp>,
) -> Result<Vec<SyncStateOp>> {
    if sync_ops.is_empty() {
        return Ok(Vec::new());
    }

    debug!(
        "Applying sync ops {}",
        sync_ops.iter().map(|op| op.to_string()).collect::<Vec<String>>().join(", ")
    );
    let mut sync_state_ops = Vec::new();
    let mut workspaces_to_upsert = Vec::new();
    let environments_to_upsert = Vec::new();
    let mut folders_to_upsert = Vec::new();
    let mut http_requests_to_upsert = Vec::new();
    let mut grpc_requests_to_upsert = Vec::new();
    let mut websocket_requests_to_upsert = Vec::new();

    for op in sync_ops {
        // Only apply things if workspace ID matches
        if op.workspace_id() != workspace_id {
            continue;
        }

        sync_state_ops.push(match op {
            SyncOp::FsCreate { model } => {
                let rel_path = derive_model_filename(&model);
                let abs_path = sync_dir.join(rel_path.clone());
                let (content, checksum) = model.to_file_contents(&rel_path)?;
                let mut f = File::create(&abs_path).await?;
                f.write_all(&content).await?;
                SyncStateOp::Create {
                    model_id: model.id(),
                    checksum,
                    rel_path,
                }
            }
            SyncOp::FsUpdate { model, state } => {
                // Always write the existing path
                let rel_path = Path::new(&state.rel_path);
                let abs_path = Path::new(&state.sync_dir).join(&rel_path);
                let (content, checksum) = model.to_file_contents(&rel_path)?;
                let mut f = File::create(&abs_path).await?;
                f.write_all(&content).await?;
                SyncStateOp::Update {
                    state: state.to_owned(),
                    checksum,
                    rel_path: rel_path.to_owned(),
                }
            }
            SyncOp::FsDelete {
                state,
                fs: fs_candidate,
            } => match fs_candidate {
                None => SyncStateOp::Delete {
                    state: state.to_owned(),
                },
                Some(_) => {
                    // Always delete the existing path
                    let rel_path = Path::new(&state.rel_path);
                    let abs_path = Path::new(&state.sync_dir).join(&rel_path);
                    fs::remove_file(&abs_path).await?;
                    SyncStateOp::Delete {
                        state: state.to_owned(),
                    }
                }
            },
            SyncOp::DbCreate { fs } => {
                let model_id = fs.model.id();

                // Push updates to arrays so we can do them all in a single
                // batch upsert to make foreign keys happy
                match fs.model {
                    SyncModel::Workspace(m) => workspaces_to_upsert.push(m),
                    SyncModel::Folder(m) => folders_to_upsert.push(m),
                    SyncModel::HttpRequest(m) => http_requests_to_upsert.push(m),
                    SyncModel::GrpcRequest(m) => grpc_requests_to_upsert.push(m),
                    SyncModel::WebsocketRequest(m) => websocket_requests_to_upsert.push(m),

                    // TODO: Handle environments in sync
                    SyncModel::Environment(_) => {}
                };
                SyncStateOp::Create {
                    model_id,
                    checksum: fs.checksum.to_owned(),
                    rel_path: fs.rel_path.to_owned(),
                }
            }
            SyncOp::DbUpdate { state, fs } => {
                // Push updates to arrays so we can do them all in a single
                // batch upsert to make foreign keys happy
                match fs.model {
                    SyncModel::Workspace(m) => workspaces_to_upsert.push(m),
                    SyncModel::Folder(m) => folders_to_upsert.push(m),
                    SyncModel::HttpRequest(m) => http_requests_to_upsert.push(m),
                    SyncModel::GrpcRequest(m) => grpc_requests_to_upsert.push(m),
                    SyncModel::WebsocketRequest(m) => websocket_requests_to_upsert.push(m),

                    // TODO: Handle environments in sync
                    SyncModel::Environment(_) => {}
                }
                SyncStateOp::Update {
                    state: state.to_owned(),
                    checksum: fs.checksum.to_owned(),
                    rel_path: fs.rel_path.to_owned(),
                }
            }
            SyncOp::DbDelete { model, state } => {
                delete_model(app_handle, &model).await?;
                SyncStateOp::Delete {
                    state: state.to_owned(),
                }
            }
        });
    }

    let upserted_models = batch_upsert(
        app_handle,
        workspaces_to_upsert,
        environments_to_upsert,
        folders_to_upsert,
        http_requests_to_upsert,
        grpc_requests_to_upsert,
        websocket_requests_to_upsert,
        &UpdateSource::Sync,
    )
    .await?;

    // Ensure we creat WorkspaceMeta models for each new workspace, with the appropriate sync dir
    let sync_dir_string = sync_dir.to_string_lossy().to_string();
    for workspace in upserted_models.workspaces {
        let r = match get_workspace_meta(app_handle, &workspace).await {
            Ok(Some(m)) => {
                if m.setting_sync_dir == Some(sync_dir_string.clone()) {
                    // We don't need to update if unchanged
                    continue;
                }
                let wm = WorkspaceMeta {
                    setting_sync_dir: Some(sync_dir.to_string_lossy().to_string()),
                    ..m
                };
                upsert_workspace_meta(app_handle, wm, &UpdateSource::Sync).await
            }
            Ok(None) => {
                let wm = WorkspaceMeta {
                    workspace_id: workspace_id.to_string(),
                    setting_sync_dir: Some(sync_dir.to_string_lossy().to_string()),
                    ..Default::default()
                };
                upsert_workspace_meta(app_handle, wm, &UpdateSource::Sync).await
            }
            Err(e) => Err(e),
        };

        if let Err(e) = r {
            warn!("Failed to upsert workspace meta for synced workspace {e:?}");
        }
    }

    Ok(sync_state_ops)
}

#[derive(Debug)]
pub(crate) enum SyncStateOp {
    Create {
        model_id: String,
        checksum: String,
        rel_path: PathBuf,
    },
    Update {
        state: SyncState,
        checksum: String,
        rel_path: PathBuf,
    },
    Delete {
        state: SyncState,
    },
}

pub(crate) async fn apply_sync_state_ops<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
    ops: Vec<SyncStateOp>,
) -> Result<()> {
    for op in ops {
        match op {
            SyncStateOp::Create {
                checksum,
                rel_path,
                model_id,
            } => {
                let sync_state = SyncState {
                    workspace_id: workspace_id.to_string(),
                    model_id,
                    checksum,
                    sync_dir: sync_dir.to_str().unwrap().to_string(),
                    rel_path: rel_path.to_str().unwrap().to_string(),
                    flushed_at: Utc::now().naive_utc(),
                    ..Default::default()
                };
                upsert_sync_state(app_handle, sync_state).await?;
            }
            SyncStateOp::Update {
                state: sync_state,
                checksum,
                rel_path,
            } => {
                let sync_state = SyncState {
                    checksum,
                    sync_dir: sync_dir.to_str().unwrap().to_string(),
                    rel_path: rel_path.to_str().unwrap().to_string(),
                    flushed_at: Utc::now().naive_utc(),
                    ..sync_state
                };
                upsert_sync_state(app_handle, sync_state).await?;
            }
            SyncStateOp::Delete { state } => {
                delete_sync_state(app_handle, state.id.as_str()).await?;
            }
        }
    }
    Ok(())
}

fn derive_model_filename(m: &SyncModel) -> PathBuf {
    let rel = format!("yaak.{}.yaml", m.id());
    Path::new(&rel).to_path_buf()
}

async fn delete_model<R: Runtime>(app_handle: &AppHandle<R>, model: &SyncModel) -> Result<()> {
    match model {
        SyncModel::Workspace(m) => {
            delete_workspace(app_handle, m.id.as_str(), &UpdateSource::Sync).await?;
        }
        SyncModel::Environment(m) => {
            delete_environment(app_handle, m.id.as_str(), &UpdateSource::Sync).await?;
        }
        SyncModel::Folder(m) => {
            delete_folder(app_handle, m.id.as_str(), &UpdateSource::Sync).await?;
        }
        SyncModel::HttpRequest(m) => {
            delete_http_request(app_handle, m.id.as_str(), &UpdateSource::Sync).await?;
        }
        SyncModel::GrpcRequest(m) => {
            delete_grpc_request(app_handle, m.id.as_str(), &UpdateSource::Sync).await?;
        }
        SyncModel::WebsocketRequest(m) => {
            delete_websocket_request(app_handle, m.id.as_str(), &UpdateSource::Sync).await?;
        }
    };
    Ok(())
}
