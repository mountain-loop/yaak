use crate::error::Error::{InvalidSyncFile, WorkspaceSyncNotConfigured};
use crate::error::Result;
use crate::models::SyncModel;
use chrono::Utc;
use log::{debug, warn};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime, WebviewWindow};
use yaak_models::models::{SyncState, Workspace};
use yaak_models::queries::{
    delete_environment, delete_folder, delete_grpc_request, delete_http_request, delete_sync_state,
    delete_workspace, get_workspace, get_workspace_export_resources,
    list_sync_states_for_workspace, upsert_environment, upsert_folder, upsert_grpc_request,
    upsert_http_request, upsert_sync_state, upsert_workspace, UpdateSource,
};

#[derive(Debug, Clone)]
enum SyncOp {
    FsUpdate(SyncModel, Option<SyncState>),
    FsDelete(SyncState, Option<FsCandidate>),
    DbUpdate(Option<SyncState>, FsCandidate),
    DbDelete(SyncModel, SyncState),
}

impl Display for SyncOp {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            match self {
                SyncOp::FsUpdate(m, _) => format!("DstUpdate({})", m.id()),
                SyncOp::FsDelete(s, _) => format!("DstDelete({})", s.model_id),
                SyncOp::DbUpdate(_, c) => format!("SrcUpdate({})", c.model.id()),
                SyncOp::DbDelete(m, _) => format!("SrcDelete({})", m.id()),
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

#[derive(Debug, Clone)]
struct FsCandidate {
    model: SyncModel,
    path: PathBuf,
    checksum: String,
}

pub(crate) async fn sync_fs<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let workspace = get_workspace(window, workspace_id).await?;
    let db_candidates = get_db_candidates(window, &workspace).await?;
    let fs_candidates = get_fs_candidates(&workspace)?;
    let sync_ops = compute_sync_ops(db_candidates, fs_candidates);
    let sync_state_ops = apply_sync_ops(window, &workspace, sync_ops).await?;
    let result = apply_sync_state_ops(window, sync_state_ops).await;

    result
}

async fn get_db_candidates<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace: &Workspace,
) -> Result<Vec<DbCandidate>> {
    let workspace_id = workspace.id.as_str();
    let models = workspace_models(mgr, workspace).await;
    let sync_states = list_sync_states_for_workspace(mgr, workspace_id).await?;

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

            Some(FsCandidate {
                path,
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
                (None, Some(fs)) => SyncOp::DbUpdate(None, fs.to_owned()),
                (Some(DbCandidate::Unmodified(model, sync_state)), None) => {
                    SyncOp::DbDelete(model.to_owned(), sync_state.to_owned())
                }
                (Some(DbCandidate::Modified(model, sync_state)), None) => {
                    SyncOp::FsUpdate(model.to_owned(), Some(sync_state.to_owned()))
                }
                (Some(DbCandidate::Added(model)), None) => SyncOp::FsUpdate(model.to_owned(), None),
                (Some(DbCandidate::Deleted(sync_state)), None) => {
                    // Already deleted on FS, but sending it so the SyncState gets dealt with
                    SyncOp::FsDelete(sync_state.to_owned(), None)
                }
                (Some(DbCandidate::Unmodified(_, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        return None;
                    } else {
                        SyncOp::DbUpdate(Some(sync_state.to_owned()), fs_candidate.to_owned())
                    }
                }
                (Some(DbCandidate::Modified(model, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        SyncOp::FsUpdate(model.to_owned(), Some(sync_state.to_owned()))
                    } else if model.updated_at() < fs_candidate.model.updated_at() {
                        // CONFLICT! Write to DB if fs model is newer
                        SyncOp::DbUpdate(Some(sync_state.to_owned()), fs_candidate.to_owned())
                    } else {
                        // CONFLICT! Write to FS if db model is newer
                        SyncOp::FsUpdate(model.to_owned(), Some(sync_state.to_owned()))
                    }
                }
                (Some(DbCandidate::Added(model)), Some(_)) => {
                    // This would be super rare, so let's follow the user's intention
                    SyncOp::FsUpdate(model.to_owned(), None)
                }
                (Some(DbCandidate::Deleted(sync_state)), Some(fs_candidate)) => {
                    SyncOp::FsDelete(sync_state.to_owned(), Some(fs_candidate.to_owned()))
                }
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
        workspace_id: String,
        checksum: String,
        path: PathBuf,
    },
    Update {
        sync_state: SyncState,
        checksum: String,
        path: PathBuf,
    },
    Delete(SyncState),
}

/// Flush a DB model to the filesystem
async fn apply_sync_op<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace: &Workspace,
    op: &SyncOp,
) -> Result<SyncStateOp> {
    let sync_state_op = match op {
        SyncOp::FsUpdate(model, sync_state) => {
            let path = prep_model_file_path(workspace, &model)?;
            let (content, checksum) = model.to_file_contents(&path)?;
            fs::write(&path, content)?;
            match sync_state.to_owned() {
                None => SyncStateOp::Create {
                    workspace_id: model.workspace_id(),
                    model_id: model.id(),
                    checksum,
                    path,
                },
                Some(sync_state) => SyncStateOp::Update {
                    sync_state,
                    checksum,
                    path,
                },
            }
        }
        SyncOp::FsDelete(sync_state, Some(fs_candidate)) => {
            fs::remove_file(&fs_candidate.path)?;
            SyncStateOp::Delete(sync_state.to_owned())
        }
        SyncOp::FsDelete(sync_state, None) => SyncStateOp::Delete(sync_state.to_owned()),
        SyncOp::DbUpdate(sync_state, fs_candidate) => {
            upsert_model(window, &fs_candidate.model).await?;
            match sync_state.to_owned() {
                None => SyncStateOp::Create {
                    workspace_id: fs_candidate.model.workspace_id(),
                    model_id: fs_candidate.model.id(),
                    checksum: fs_candidate.checksum.to_owned(),
                    path: fs_candidate.path.to_owned(),
                },
                Some(sync_state) => SyncStateOp::Update {
                    sync_state,
                    checksum: fs_candidate.checksum.to_owned(),
                    path: fs_candidate.path.to_owned(),
                },
            }
        }
        SyncOp::DbDelete(model, sync_state) => {
            delete_model(window, model).await?;
            SyncStateOp::Delete(sync_state.to_owned())
        }
    };

    Ok(sync_state_op)
}
async fn apply_sync_state_ops<R: Runtime>(
    window: &WebviewWindow<R>,
    ops: Vec<SyncStateOp>,
) -> Result<()> {
    for op in ops {
        apply_sync_state_op(window, op).await?
    }
    Ok(())
}

async fn apply_sync_state_op<R: Runtime>(window: &WebviewWindow<R>, op: SyncStateOp) -> Result<()> {
    match op {
        SyncStateOp::Create {
            checksum,
            path,
            model_id,
            workspace_id,
        } => {
            let sync_state = SyncState {
                workspace_id,
                model_id,
                checksum,
                path: path.to_str().unwrap().to_string(),
                flushed_at: Utc::now().naive_utc(),
                ..Default::default()
            };
            upsert_sync_state(window, sync_state).await?;
        }
        SyncStateOp::Update {
            sync_state,
            checksum,
            path,
        } => {
            let sync_state = SyncState {
                checksum,
                path: path.to_str().unwrap().to_string(),
                flushed_at: Utc::now().naive_utc(),
                ..sync_state
            };
            upsert_sync_state(window, sync_state).await?;
        }
        SyncStateOp::Delete(s) => {
            delete_sync_state(window, s.id.as_str()).await?;
        }
    }

    Ok(())
}

fn prep_model_file_path(workspace: &Workspace, m: &SyncModel) -> Result<PathBuf> {
    let dir = match workspace.setting_sync_dir.to_owned() {
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
            upsert_grpc_request(window, &m, &UpdateSource::Sync).await?;
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
