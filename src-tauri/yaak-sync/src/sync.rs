use crate::error::Error::{InvalidSyncFile, WorkspaceSyncNotConfigured};
use crate::error::Result;
use crate::models::SyncModel;
use chrono::Utc;
use log::{debug, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::fs;
use std::fs::create_dir_all;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime, WebviewWindow};
use ts_rs::TS;
use yaak_models::models::{SyncState, Workspace};
use yaak_models::queries::{
    delete_environment, delete_folder, delete_grpc_request, delete_http_request, delete_sync_state,
    delete_workspace, get_workspace, get_workspace_export_resources,
    list_sync_states_for_workspace, upsert_environment, upsert_folder, upsert_grpc_request,
    upsert_http_request, upsert_sync_state, upsert_workspace, UpdateSource,
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "sync.ts")]
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

#[derive(Debug, Clone)]
enum DbCandidate {
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
#[ts(export, export_to = "sync.ts")]
pub(crate) struct FsCandidate {
    model: SyncModel,
    rel_path: PathBuf,
    checksum: String,
}

pub(crate) async fn calculate_sync<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
) -> Result<Vec<SyncOp>> {
    let workspace = get_workspace(window, workspace_id).await?;
    let db_candidates = get_db_candidates(window, &workspace).await?;
    let fs_candidates = get_fs_candidates(&workspace)?;
    let sync_ops = compute_sync_ops(db_candidates, fs_candidates);

    Ok(sync_ops)
}

pub(crate) async fn apply_sync<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let workspace = get_workspace(window, workspace_id).await?;
    let sync_ops = calculate_sync(window, workspace_id).await?;

    let sync_state_ops = apply_sync_ops(window, &workspace, sync_ops).await?;
    let result = apply_sync_state_ops(window, &workspace, sync_state_ops).await;

    result
}

async fn get_db_candidates<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace: &Workspace,
) -> Result<Vec<DbCandidate>> {
    let workspace_id = workspace.id.as_str();
    let models = workspace_models(mgr, workspace).await;
    let sync_dir = get_workspace_sync_dir(workspace)?;
    let sync_states = list_sync_states_for_workspace(mgr, workspace_id, sync_dir).await?;

    // 1. Add candidates for models (created/modified/unmodified)
    let mut candidates: Vec<DbCandidate> = models
        .iter()
        .map(|model| {
            let existing_sync_state = sync_states.iter().find(|ss| ss.model_id == model.id());
            let existing_sync_state = match existing_sync_state {
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
    candidates.extend(sync_states.iter().filter_map(|sync_state| {
        let already_added = models.iter().find(|m| m.id() == sync_state.model_id).is_some();
        if already_added {
            return None;
        }
        Some(DbCandidate::Deleted(sync_state.to_owned()))
    }));

    Ok(candidates)
}

fn get_fs_candidates(workspace: &Workspace) -> Result<Vec<FsCandidate>> {
    let dir = match workspace.setting_sync_dir.clone() {
        None => return Ok(Vec::new()),
        Some(d) => d,
    };

    // Ensure the root directory exists
    create_dir_all(dir.clone())?;

    let candidates = fs::read_dir(dir)?
        .filter_map(|dir_entry| {
            let dir_entry = dir_entry.ok()?;
            if !dir_entry.file_type().ok()?.is_file() {
                return None;
            };

            let path = dir_entry.path();
            let (model, _, checksum) = match SyncModel::from_file(&path) {
                Ok(Some(m)) => m,
                Ok(None) => return None,
                Err(InvalidSyncFile(_)) => return None,
                Err(e) => {
                    warn!("Failed to read sync file {e}");
                    return None;
                }
            };

            // Skip models belonging to different workspace
            if model.workspace_id() != workspace.id.as_str() {
                debug!("Skipping non-workspace file");
                return None;
            }

            let rel_path = Path::new(&dir_entry.file_name()).to_path_buf();
            Some(FsCandidate {
                rel_path,
                model,
                checksum,
            })
        })
        .collect();

    Ok(candidates)
}

fn compute_sync_ops(
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
                (Some(DbCandidate::Unmodified(model, sync_state)), None) => SyncOp::DbDelete {
                    model: model.to_owned(),
                    state: sync_state.to_owned(),
                },
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
                    // This would be super rare, so let's follow the user's intention
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
    mgr: &impl Manager<R>,
    workspace: &Workspace,
) -> Vec<SyncModel> {
    let workspace_id = workspace.id.as_str();
    let resources = get_workspace_export_resources(mgr, vec![workspace_id]).await.resources;

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

    sync_models
}

async fn apply_sync_ops<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: &Workspace,
    sync_ops: Vec<SyncOp>,
) -> Result<Vec<SyncStateOp>> {
    if sync_ops.is_empty() {
        return Ok(Vec::new());
    }

    debug!(
        "Sync ops {}",
        sync_ops.iter().map(|op| op.to_string()).collect::<Vec<String>>().join(", ")
    );
    let mut sync_state_ops = Vec::new();
    for op in sync_ops {
        let op = apply_sync_op(window, workspace, &op).await?;
        sync_state_ops.push(op);
    }
    Ok(sync_state_ops)
}

#[derive(Debug)]
enum SyncStateOp {
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

/// Flush a DB model to the filesystem
async fn apply_sync_op<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: &Workspace,
    op: &SyncOp,
) -> Result<SyncStateOp> {
    let sync_state_op = match op {
        SyncOp::FsCreate { model } => {
            let rel_path = derive_model_filename(&model);
            let abs_path = derive_full_model_path(workspace, &model)?;
            let (content, checksum) = model.to_file_contents(&rel_path)?;
            fs::write(&abs_path, content)?;
            SyncStateOp::Create {
                model_id: model.id(),
                checksum,
                rel_path,
            }
        }
        SyncOp::FsUpdate { model, state } => {
            let rel_path = derive_model_filename(&model);
            let abs_path = derive_full_model_path(workspace, &model)?;
            let (content, checksum) = model.to_file_contents(&rel_path)?;
            fs::write(&abs_path, content)?;
            SyncStateOp::Update {
                state: state.to_owned(),
                checksum,
                rel_path,
            }
        }
        SyncOp::FsDelete {
            state,
            fs: fs_candidate,
        } => match fs_candidate {
            None => SyncStateOp::Delete {
                state: state.to_owned(),
            },
            Some(fs_candidate) => {
                let abs_path = derive_full_model_path(workspace, &fs_candidate.model)?;
                fs::remove_file(&abs_path)?;
                SyncStateOp::Delete {
                    state: state.to_owned(),
                }
            }
        },
        SyncOp::DbCreate { fs } => {
            upsert_model(window, &fs.model).await?;
            SyncStateOp::Create {
                model_id: fs.model.id(),
                checksum: fs.checksum.to_owned(),
                rel_path: fs.rel_path.to_owned(),
            }
        }
        SyncOp::DbUpdate { state, fs } => {
            upsert_model(window, &fs.model).await?;
            SyncStateOp::Update {
                state: state.to_owned(),
                checksum: fs.checksum.to_owned(),
                rel_path: fs.rel_path.to_owned(),
            }
        }
        SyncOp::DbDelete { model, state } => {
            delete_model(window, model).await?;
            SyncStateOp::Delete {
                state: state.to_owned(),
            }
        }
    };

    Ok(sync_state_op)
}
async fn apply_sync_state_ops<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: &Workspace,
    ops: Vec<SyncStateOp>,
) -> Result<()> {
    for op in ops {
        apply_sync_state_op(window, workspace, op).await?
    }
    Ok(())
}

async fn apply_sync_state_op<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: &Workspace,
    op: SyncStateOp,
) -> Result<()> {
    let dir_path = get_workspace_sync_dir(workspace)?;
    match op {
        SyncStateOp::Create {
            checksum,
            rel_path,
            model_id,
        } => {
            let sync_state = SyncState {
                workspace_id: workspace.to_owned().id,
                model_id,
                checksum,
                sync_dir: dir_path.to_str().unwrap().to_string(),
                rel_path: rel_path.to_str().unwrap().to_string(),
                flushed_at: Utc::now().naive_utc(),
                ..Default::default()
            };
            upsert_sync_state(window, sync_state).await?;
        }
        SyncStateOp::Update {
            state: sync_state,
            checksum,
            rel_path,
        } => {
            let sync_state = SyncState {
                checksum,
                sync_dir: dir_path.to_str().unwrap().to_string(),
                rel_path: rel_path.to_str().unwrap().to_string(),
                flushed_at: Utc::now().naive_utc(),
                ..sync_state
            };
            upsert_sync_state(window, sync_state).await?;
        }
        SyncStateOp::Delete { state } => {
            delete_sync_state(window, state.id.as_str()).await?;
        }
    }

    Ok(())
}

fn get_workspace_sync_dir(workspace: &Workspace) -> Result<PathBuf> {
    let workspace_id = workspace.to_owned().id;
    match workspace.setting_sync_dir.to_owned() {
        Some(d) => Ok(Path::new(&d).to_path_buf()),
        None => Err(WorkspaceSyncNotConfigured(workspace_id)),
    }
}

fn derive_full_model_path(workspace: &Workspace, m: &SyncModel) -> Result<PathBuf> {
    let dir = get_workspace_sync_dir(workspace)?;
    Ok(dir.join(derive_model_filename(m)))
}

fn derive_model_filename(m: &SyncModel) -> PathBuf {
    let rel = format!("{}.yaml", m.id());
    let rel = Path::new(&rel).to_path_buf();

    // Ensure parent dir exists
    rel
}

async fn upsert_model<R: Runtime>(window: &WebviewWindow<R>, m: &SyncModel) -> Result<()> {
    match m {
        SyncModel::Workspace(m) => {
            upsert_workspace(window, m.to_owned(), &UpdateSource::Sync).await?;
        }
        SyncModel::Environment(m) => {
            upsert_environment(window, m.to_owned(), &UpdateSource::Sync).await?;
        }
        SyncModel::Folder(m) => {
            upsert_folder(window, m.to_owned(), &UpdateSource::Sync).await?;
        }
        SyncModel::HttpRequest(m) => {
            upsert_http_request(window, m.to_owned(), &UpdateSource::Sync).await?;
        }
        SyncModel::GrpcRequest(m) => {
            upsert_grpc_request(window, m.to_owned(), &UpdateSource::Sync).await?;
        }
    };
    Ok(())
}

async fn delete_model<R: Runtime>(window: &WebviewWindow<R>, model: &SyncModel) -> Result<()> {
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
    };
    Ok(())
}
