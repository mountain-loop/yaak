use crate::error::Error::{InvalidSyncFile, WorkspaceSyncNotConfigured};
use crate::error::Result;
use crate::models::SyncModel;
use chrono::Utc;
use log::{debug, warn};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{Manager, Runtime, WebviewWindow};
use yaak_models::models::{SyncState, Workspace};
use yaak_models::queries::{
    delete_environment, delete_folder, delete_grpc_request, delete_http_request, delete_sync_state,
    delete_workspace, get_sync_state_for_model, get_workspace, get_workspace_export_resources,
    list_sync_states_for_workspace, upsert_environment, upsert_folder, upsert_grpc_request,
    upsert_http_request, upsert_sync_state, upsert_workspace, UpdateSource,
};

pub(crate) async fn sync_fs<R: Runtime>(
    window: &WebviewWindow<R>,
    workspace_id: &str,
) -> Result<()> {
    let workspace = get_workspace(window, workspace_id).await?;
    let db_candidates = get_db_candidates(window, &workspace).await?;
    let fs_candidates = get_fs_candidates(&workspace)?;
    let sync_ops = compute_sync_ops(db_candidates, fs_candidates);
    apply_sync_ops(window, sync_ops).await?;

    Ok(())
}

#[derive(Debug, Clone)]
enum SyncOp {
    FsWrite(SyncModel, Option<SyncState>),
    FsDelete(SyncState, FsCandidate),
    DbWrite(Option<SyncState>, FsCandidate),
    DbDelete(SyncModel, SyncState),
    Conflict(SyncModel, SyncState, FsCandidate),
    Unchanged,
}

#[derive(Debug, Clone)]
enum DbCandidate {
    DbAdded(SyncModel),
    DbModified(SyncModel, SyncState),
    DbDeleted(SyncState),
    DbUnmodified(SyncModel, SyncState),
}

impl DbCandidate {
    fn model_id(&self) -> String {
        match &self {
            DbCandidate::DbAdded(m) => m.id(),
            DbCandidate::DbModified(m, _) => m.id(),
            DbCandidate::DbDeleted(s) => s.model_id.clone(),
            DbCandidate::DbUnmodified(m, _) => m.id(),
        }
    }
}

#[derive(Debug, Clone)]
struct FsCandidate {
    model: SyncModel,
    path: PathBuf,
    checksum: String,
}

async fn get_db_candidates<R: Runtime>(
    mgr: &impl Manager<R>,
    workspace: &Workspace,
) -> Result<Vec<DbCandidate>> {
    let mut candidates = Vec::new();
    let models = workspace_models(mgr, workspace).await;

    // 1. Add candidates for models (created/modified/unmodified)
    for model in models.clone() {
        let sync_state =
            get_sync_state_for_model(mgr, workspace.id.as_str(), model.id().as_str()).await?;
        let sync_state = match sync_state {
            None => {
                candidates.push(DbCandidate::DbAdded(model));
                continue;
            }
            Some(s) => s,
        };

        if model.updated_at() > sync_state.flushed_at {
            candidates.push(DbCandidate::DbModified(model, sync_state));
        } else {
            candidates.push(DbCandidate::DbUnmodified(model, sync_state));
        }
    }

    // Add SyncState-only candidates (deleted)
    let sync_states = list_sync_states_for_workspace(mgr, workspace.id.as_str()).await?;
    for sync_state in sync_states {
        let already_added = models.iter().find(|m| m.id() == sync_state.model_id).is_some();
        if already_added {
            continue;
        }
        candidates.push(DbCandidate::DbDeleted(sync_state));
    }

    Ok(candidates)
}

fn get_fs_candidates(workspace: &Workspace) -> Result<Vec<FsCandidate>> {
    let dir = match workspace.setting_sync_dir.clone() {
        None => return Ok(Vec::new()),
        Some(d) => d,
    };

    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Ok(Vec::new()),
    };

    let mut candidates = Vec::new();
    for dir_entry in entries {
        let dir_entry = match dir_entry {
            Ok(e) if e.file_type()?.is_file() => e,
            _ => continue,
        };

        let path = dir_entry.path();
        let (model, _, checksum) = match SyncModel::from_file(&path) {
            Ok(Some(m)) => m,
            Ok(None) => continue,
            Err(InvalidSyncFile(_)) => continue,
            Err(e) => {
                warn!("Failed to read sync file {e}");
                continue;
            }
        };
        candidates.push(FsCandidate {
            path,
            model,
            checksum,
        });
    }

    Ok(candidates)
}

fn compute_sync_ops(
    db_candidates: Vec<DbCandidate>,
    fs_candidates: Vec<FsCandidate>,
) -> Vec<SyncOp> {
    let mut db_map: HashMap<String, DbCandidate> = HashMap::new();
    for v in db_candidates {
        db_map.insert(v.model_id(), v);
    }

    let mut fs_map: HashMap<String, FsCandidate> = HashMap::new();
    for v in fs_candidates {
        fs_map.insert(v.model.id(), v);
    }

    // Collect all keys from both maps for the OUTER JOIN
    let keys: std::collections::HashSet<_> = db_map.keys().chain(fs_map.keys()).collect();

    keys.into_iter()
        .filter_map(|k| {
            let op = match (db_map.get(k), fs_map.get(k)) {
                (None, None) => return None, // Can never happen
                (None, Some(fs)) => SyncOp::DbWrite(None, fs.to_owned()),
                (Some(DbCandidate::DbUnmodified(model, sync_state)), None) => {
                    SyncOp::DbDelete(model.to_owned(), sync_state.to_owned())
                }
                (Some(DbCandidate::DbModified(model, sync_state)), None) => {
                    SyncOp::FsWrite(model.to_owned(), Some(sync_state.to_owned()))
                }
                (Some(DbCandidate::DbAdded(model)), None) => {
                    SyncOp::FsWrite(model.to_owned(), None)
                }
                (Some(DbCandidate::DbDeleted(_)), None) => SyncOp::Unchanged,
                (Some(DbCandidate::DbUnmodified(_, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        SyncOp::Unchanged
                    } else {
                        SyncOp::DbWrite(Some(sync_state.to_owned()), fs_candidate.to_owned())
                    }
                }
                (Some(DbCandidate::DbModified(model, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        SyncOp::FsWrite(model.to_owned(), Some(sync_state.to_owned()))
                    } else {
                        SyncOp::Conflict(
                            model.to_owned(),
                            sync_state.to_owned(),
                            fs_candidate.to_owned(),
                        )
                    }
                }
                (Some(DbCandidate::DbAdded(model)), Some(_)) => {
                    // This would be super rare, so let's follow the user's intention
                    SyncOp::FsWrite(model.to_owned(), None)
                }
                (Some(DbCandidate::DbDeleted(sync_state)), Some(fs_state)) => {
                    SyncOp::FsDelete(sync_state.to_owned(), fs_state.to_owned())
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
    let mut sync_models = vec![SyncModel::Workspace(workspace.to_owned())];

    let resources =
        get_workspace_export_resources(mgr, vec![workspace.id.as_str()]).await.resources;

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
    sync_ops: Vec<SyncOp>,
) -> Result<()> {
    for op in sync_ops {
        do_sync_candidate(window, &op).await?
    }
    Ok(())
}

/// Flush a DB model to the filesystem
async fn do_sync_candidate<R: Runtime>(window: &WebviewWindow<R>, op: &SyncOp) -> Result<()> {
    debug!("Sync op for {:?}", op);
    #[derive(Debug)]
    enum SyncStateOp {
        Upsert(SyncState),
        Delete(SyncState),
        Nothing,
    }
    let sync_state_op = match op {
        SyncOp::FsWrite(sync_model, sync_state) => {
            let file_path = prep_model_file_path(window, &sync_model).await?;
            let (content, checksum) = sync_model.to_file_contents(&file_path)?;
            fs::write(&file_path, content)?;
            SyncStateOp::Upsert(SyncState {
                workspace_id: sync_model.workspace_id(),
                model_id: sync_model.id(),
                path: file_path.to_str().unwrap().to_string(),
                flushed_at: Utc::now().naive_utc(),
                checksum,
                ..sync_state.to_owned().unwrap_or_default()
            })
        }
        SyncOp::FsDelete(sync_state, fs_candidate) => {
            fs::remove_file(&fs_candidate.path)?;
            SyncStateOp::Delete(sync_state.to_owned())
        }
        SyncOp::DbWrite(sync_state, fs_candidate) => {
            match fs_candidate.to_owned().model {
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
            };
            SyncStateOp::Upsert(SyncState {
                workspace_id: fs_candidate.model.workspace_id(),
                model_id: fs_candidate.model.id(),
                path: fs_candidate.path.to_str().unwrap().to_string(),
                flushed_at: Utc::now().naive_utc(),
                checksum: fs_candidate.checksum.clone(),
                ..sync_state.to_owned().unwrap_or_default()
            })
        }
        SyncOp::DbDelete(db_model, sync_state) => {
            match db_model.to_owned() {
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
            SyncStateOp::Delete(sync_state.to_owned())
        }
        SyncOp::Conflict(_, _, _) => SyncStateOp::Nothing,
        SyncOp::Unchanged => SyncStateOp::Nothing,
    };

    match sync_state_op {
        SyncStateOp::Upsert(s) => {
            upsert_sync_state(window, s).await?;
        }
        SyncStateOp::Delete(s) => {
            delete_sync_state(window, s.id.as_str()).await?;
        }
        SyncStateOp::Nothing => {}
    }

    Ok(())
}

async fn prep_model_file_path<R: Runtime>(mgr: &impl Manager<R>, m: &SyncModel) -> Result<PathBuf> {
    let workspace = get_workspace_from_model(mgr, m).await?;
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
    mgr: &impl Manager<R>,
    m: &SyncModel,
) -> Result<Workspace> {
    Ok(get_workspace(mgr, &m.workspace_id()).await?)
}
