use crate::error::Error::{InvalidSyncFile, WorkspaceSyncNotConfigured};
use crate::error::Result;
use crate::models::SyncModel;
use chrono::Utc;
use log::{debug, error, warn};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
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
    FsDelete(SyncState, Option<FsCandidate>),
    DbUpdate(Option<SyncState>, FsCandidate),
    DbDelete(SyncModel, SyncState),
}

impl Display for SyncOp {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        f.write_str(
            match self {
                SyncOp::FsWrite(m, _) => format!("FsWrite({})", m.id()),
                SyncOp::FsDelete(s, _) => format!("FsDelete({})", s.model_id),
                SyncOp::DbUpdate(_, c) => format!("DbWrite({})", c.model.id()),
                SyncOp::DbDelete(m, _) => format!("DbDelete({})", m.id()),
            }
            .as_str(),
        )
    }
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
                (None, Some(fs)) => SyncOp::DbUpdate(None, fs.to_owned()),
                (Some(DbCandidate::DbUnmodified(model, sync_state)), None) => {
                    SyncOp::DbDelete(model.to_owned(), sync_state.to_owned())
                }
                (Some(DbCandidate::DbModified(model, sync_state)), None) => {
                    SyncOp::FsWrite(model.to_owned(), Some(sync_state.to_owned()))
                }
                (Some(DbCandidate::DbAdded(model)), None) => {
                    SyncOp::FsWrite(model.to_owned(), None)
                }
                (Some(DbCandidate::DbDeleted(sync_state)), None) => {
                    // Already deleted on FS, but sending it so the SyncState gets dealt with
                    SyncOp::FsDelete(sync_state.to_owned(), None)
                }
                (Some(DbCandidate::DbUnmodified(_, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        return None;
                    } else {
                        error!("UPDATE FROM FS");
                        SyncOp::DbUpdate(Some(sync_state.to_owned()), fs_candidate.to_owned())
                    }
                }
                (Some(DbCandidate::DbModified(model, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        SyncOp::FsWrite(model.to_owned(), Some(sync_state.to_owned()))
                    } else if model.updated_at() < fs_candidate.model.updated_at() {
                        // CONFLICT! Write to DB if fs model is newer
                        error!("UPDATE FROM CONFLICT");
                        SyncOp::DbUpdate(Some(sync_state.to_owned()), fs_candidate.to_owned())
                    } else {
                        // CONFLICT! Write to FS if db model is newer
                        SyncOp::FsWrite(model.to_owned(), Some(sync_state.to_owned()))
                    }
                }
                (Some(DbCandidate::DbAdded(model)), Some(_)) => {
                    // This would be super rare, so let's follow the user's intention
                    SyncOp::FsWrite(model.to_owned(), None)
                }
                (Some(DbCandidate::DbDeleted(sync_state)), Some(fs_candidate)) => {
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
    let mut model = vec![SyncModel::Workspace(workspace.to_owned())];

    let resources =
        get_workspace_export_resources(mgr, vec![workspace.id.as_str()]).await.resources;

    for m in resources.environments {
        model.push(SyncModel::Environment(m));
    }
    for m in resources.folders {
        model.push(SyncModel::Folder(m));
    }
    for m in resources.http_requests {
        model.push(SyncModel::HttpRequest(m));
    }
    for m in resources.grpc_requests {
        model.push(SyncModel::GrpcRequest(m));
    }

    model
}

async fn apply_sync_ops<R: Runtime>(
    window: &WebviewWindow<R>,
    sync_ops: Vec<SyncOp>,
) -> Result<()> {
    if sync_ops.is_empty() {
        return Ok(());
    }

    debug!(
        "Sync ops {}",
        sync_ops.iter().map(|op| op.to_string()).collect::<Vec<String>>().join(", ")
    );
    for op in sync_ops {
        apply_sync_op(window, &op).await?
    }
    Ok(())
}

/// Flush a DB model to the filesystem
async fn apply_sync_op<R: Runtime>(window: &WebviewWindow<R>, op: &SyncOp) -> Result<()> {
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
    let sync_state_op = match op {
        SyncOp::FsWrite(model, sync_state) => {
            let path = prep_model_file_path(window, &model).await?;
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
    };

    println!("SYNC STATE OP {:?}", sync_state_op);
    match sync_state_op {
        SyncStateOp::Create {
            checksum,
            path,
            model_id,
            workspace_id,
        } => {
            upsert_sync_state(
                window,
                SyncState {
                    workspace_id,
                    model_id,
                    checksum,
                    path: path.to_str().unwrap().to_string(),
                    flushed_at: Utc::now().naive_utc(),
                    ..Default::default()
                },
            )
            .await?;
        }
        SyncStateOp::Update {
            sync_state,
            checksum,
            path,
        } => {
            upsert_sync_state(
                window,
                SyncState {
                    checksum,
                    path: path.to_str().unwrap().to_string(),
                    flushed_at: Utc::now().naive_utc(),
                    ..sync_state
                },
            )
            .await?;
        }
        SyncStateOp::Delete(s) => {
            delete_sync_state(window, s.id.as_str()).await?;
        }
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
