use crate::error::Result;
use crate::models::SyncModel;
use chrono::Utc;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use ts_rs::TS;
use yaak_models::models::{SyncState, WorkspaceMeta};
use yaak_models::query_manager::QueryManagerExt;
use yaak_models::util::{UpdateSource, get_workspace_export_resources};

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
    IgnorePrivate {
        model: SyncModel,
    },
}

impl SyncOp {
    fn workspace_id(&self) -> String {
        match self {
            SyncOp::DbCreate { fs } => fs.model.workspace_id(),
            SyncOp::DbDelete { model, .. } => model.workspace_id(),
            SyncOp::DbUpdate { state, .. } => state.workspace_id.clone(),
            SyncOp::FsCreate { model } => model.workspace_id(),
            SyncOp::FsDelete { state, .. } => state.workspace_id.clone(),
            SyncOp::FsUpdate { state, .. } => state.workspace_id.clone(),
            SyncOp::IgnorePrivate { model } => model.workspace_id(),
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
                SyncOp::IgnorePrivate { model } => format!("ignore_private({})", model.id()),
            }
            .as_str(),
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DbCandidate {
    Added(SyncModel),
    Deleted(SyncState),
    Modified(SyncModel, SyncState),
    Unmodified(SyncModel, SyncState),
}

impl DbCandidate {
    fn model_id(&self) -> String {
        match &self {
            DbCandidate::Added(m) => m.id(),
            DbCandidate::Deleted(s) => s.model_id.clone(),
            DbCandidate::Modified(m, _) => m.id(),
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

pub(crate) fn get_db_candidates<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<DbCandidate>> {
    let models: HashMap<_, _> =
        workspace_models(app_handle, workspace_id)?.into_iter().map(|m| (m.id(), m)).collect();
    let sync_states: HashMap<_, _> = app_handle
        .db()
        .list_sync_states_for_workspace(workspace_id, sync_dir)?
        .into_iter()
        .map(|s| (s.model_id.clone(), s))
        .collect();

    // 1. Add candidates for models (created/modified/unmodified)
    let mut candidates: Vec<DbCandidate> = models
        .values()
        .filter_map(|model| {
            match sync_states.get(&model.id()) {
                Some(existing_sync_state) => {
                    // If a sync state exists but the model is now private, treat it as a deletion
                    match model {
                        SyncModel::Environment(e) if !e.public => {
                            return Some(DbCandidate::Deleted(existing_sync_state.to_owned()));
                        }
                        _ => {}
                    };

                    let updated_since_flush = model.updated_at() > existing_sync_state.flushed_at;
                    if updated_since_flush {
                        Some(DbCandidate::Modified(
                            model.to_owned(),
                            existing_sync_state.to_owned(),
                        ))
                    } else {
                        Some(DbCandidate::Unmodified(
                            model.to_owned(),
                            existing_sync_state.to_owned(),
                        ))
                    }
                }
                None => {
                    return match model {
                        SyncModel::Environment(e) if !e.public => {
                            // No sync state yet, so ignore the model
                            None
                        }
                        _ => {
                            // No sync state yet, so the model was just added
                            Some(DbCandidate::Added(model.to_owned()))
                        }
                    };
                }
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

pub(crate) fn get_fs_candidates(dir: &Path) -> Result<Vec<FsCandidate>> {
    // Ensure the root directory exists
    fs::create_dir_all(dir)?;

    let mut candidates = Vec::new();
    let entries = fs::read_dir(dir)?;
    for dir_entry in entries {
        let dir_entry = match dir_entry {
            Ok(v) => v,
            Err(_) => continue,
        };

        if !dir_entry.file_type()?.is_file() {
            continue;
        };

        let path = dir_entry.path();
        let (model, checksum) = match SyncModel::from_file(&path) {
            Ok(Some(m)) => m,
            Ok(None) => continue,
            Err(e) => {
                warn!("Failed to parse sync file {e}");
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

                // DB unchanged <-> FS missing
                (Some(DbCandidate::Unmodified(model, sync_state)), None) => SyncOp::DbDelete {
                    model: model.to_owned(),
                    state: sync_state.to_owned(),
                },

                // DB modified <-> FS missing
                (Some(DbCandidate::Modified(model, sync_state)), None) => SyncOp::FsUpdate {
                    model: model.to_owned(),
                    state: sync_state.to_owned(),
                },

                // DB added <-> FS missing
                (Some(DbCandidate::Added(model)), None) => SyncOp::FsCreate {
                    model: model.to_owned(),
                },

                // DB deleted <-> FS missing
                //   Already deleted on FS, but sending it so the SyncState gets dealt with
                (Some(DbCandidate::Deleted(sync_state)), None) => SyncOp::FsDelete {
                    state: sync_state.to_owned(),
                    fs: None,
                },

                // DB unchanged <-> FS exists
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

                // DB modified <-> FS exists
                (Some(DbCandidate::Modified(model, sync_state)), Some(fs_candidate)) => {
                    if sync_state.checksum == fs_candidate.checksum {
                        SyncOp::FsUpdate {
                            model: model.to_owned(),
                            state: sync_state.to_owned(),
                        }
                    } else if model.updated_at() < fs_candidate.model.updated_at() {
                        // CONFLICT! Write to DB if the fs model is newer
                        SyncOp::DbUpdate {
                            state: sync_state.to_owned(),
                            fs: fs_candidate.to_owned(),
                        }
                    } else {
                        // CONFLICT! Write to FS if the db model is newer
                        SyncOp::FsUpdate {
                            model: model.to_owned(),
                            state: sync_state.to_owned(),
                        }
                    }
                }

                // DB added <-> FS anything
                (Some(DbCandidate::Added(model)), Some(_)) => {
                    // This would be super rare (impossible?), so let's follow the user's intention
                    SyncOp::FsCreate {
                        model: model.to_owned(),
                    }
                }

                // DB deleted <-> FS exists
                (Some(DbCandidate::Deleted(sync_state)), Some(fs_candidate)) => SyncOp::FsDelete {
                    state: sync_state.to_owned(),
                    fs: Some(fs_candidate.to_owned()),
                },
            };
            Some(op)
        })
        .collect()
}

fn workspace_models<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
) -> Result<Vec<SyncModel>> {
    // We want to include private environments here so that we can take them into account during
    // the sync process. Otherwise, they would be treated as deleted.
    let include_private_environments = true;
    let resources = get_workspace_export_resources(
        app_handle,
        vec![workspace_id],
        include_private_environments,
    )?
    .resources;
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

pub(crate) fn apply_sync_ops<R: Runtime>(
    app_handle: &AppHandle<R>,
    workspace_id: &str,
    sync_dir: &Path,
    sync_ops: Vec<SyncOp>,
) -> Result<Vec<SyncStateOp>> {
    if sync_ops.is_empty() {
        return Ok(Vec::new());
    }

    info!(
        "Applying sync ops {}",
        sync_ops.iter().map(|op| op.to_string()).collect::<Vec<String>>().join(", ")
    );

    let mut sync_state_ops = Vec::new();
    let mut workspaces_to_upsert = Vec::new();
    let mut environments_to_upsert = Vec::new();
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
                let mut f = File::create(&abs_path)?;
                f.write_all(&content)?;
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
                let mut f = File::create(&abs_path)?;
                f.write_all(&content)?;
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
                    fs::remove_file(&abs_path)?;
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
                    SyncModel::Environment(m) => environments_to_upsert.push(m),
                    SyncModel::Folder(m) => folders_to_upsert.push(m),
                    SyncModel::GrpcRequest(m) => grpc_requests_to_upsert.push(m),
                    SyncModel::HttpRequest(m) => http_requests_to_upsert.push(m),
                    SyncModel::WebsocketRequest(m) => websocket_requests_to_upsert.push(m),
                    SyncModel::Workspace(m) => workspaces_to_upsert.push(m),
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
                    SyncModel::Environment(m) => environments_to_upsert.push(m),
                    SyncModel::Folder(m) => folders_to_upsert.push(m),
                    SyncModel::GrpcRequest(m) => grpc_requests_to_upsert.push(m),
                    SyncModel::HttpRequest(m) => http_requests_to_upsert.push(m),
                    SyncModel::WebsocketRequest(m) => websocket_requests_to_upsert.push(m),
                    SyncModel::Workspace(m) => workspaces_to_upsert.push(m),
                }
                SyncStateOp::Update {
                    state: state.to_owned(),
                    checksum: fs.checksum.to_owned(),
                    rel_path: fs.rel_path.to_owned(),
                }
            }
            SyncOp::DbDelete { model, state } => {
                delete_model(app_handle, &model)?;
                SyncStateOp::Delete {
                    state: state.to_owned(),
                }
            }
            SyncOp::IgnorePrivate { .. } => SyncStateOp::NoOp,
        });
    }

    app_handle.with_tx(|tx| {
        let upserted_models = tx.batch_upsert(
            workspaces_to_upsert,
            environments_to_upsert,
            folders_to_upsert,
            http_requests_to_upsert,
            grpc_requests_to_upsert,
            websocket_requests_to_upsert,
            &UpdateSource::Sync,
        )?;

        // Ensure we create WorkspaceMeta models for each new workspace, with the appropriate sync dir
        let sync_dir_string = sync_dir.to_string_lossy().to_string();
        for workspace in upserted_models.workspaces {
            match tx.get_workspace_meta(&workspace.id) {
                Some(m) => {
                    if m.setting_sync_dir == Some(sync_dir_string.clone()) {
                        // We don't need to update if unchanged
                        continue;
                    }
                    tx.upsert_workspace_meta(
                        &WorkspaceMeta {
                            setting_sync_dir: Some(sync_dir.to_string_lossy().to_string()),
                            ..m
                        },
                        &UpdateSource::Sync,
                    )
                }
                None => tx.upsert_workspace_meta(
                    &WorkspaceMeta {
                        workspace_id: workspace_id.to_string(),
                        setting_sync_dir: Some(sync_dir.to_string_lossy().to_string()),
                        ..Default::default()
                    },
                    &UpdateSource::Sync,
                ),
            }?;
        }
        Ok(())
    })?;

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
    NoOp,
}

pub(crate) fn apply_sync_state_ops<R: Runtime>(
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
                app_handle.db().upsert_sync_state(&sync_state)?;
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
                app_handle.db().upsert_sync_state(&sync_state)?;
            }
            SyncStateOp::Delete { state } => {
                app_handle.db().delete_sync_state(&state)?;
            }
            SyncStateOp::NoOp => {
                // Nothing
            }
        }
    }
    Ok(())
}

fn derive_model_filename(m: &SyncModel) -> PathBuf {
    let rel = format!("yaak.{}.yaml", m.id());
    Path::new(&rel).to_path_buf()
}

fn delete_model<R: Runtime>(app_handle: &AppHandle<R>, model: &SyncModel) -> Result<()> {
    let db = app_handle.db();
    match model {
        SyncModel::Workspace(m) => {
            db.delete_workspace(&m, &UpdateSource::Sync)?;
        }
        SyncModel::Environment(m) => {
            db.delete_environment(&m, &UpdateSource::Sync)?;
        }
        SyncModel::Folder(m) => {
            db.delete_folder(&m, &UpdateSource::Sync)?;
        }
        SyncModel::HttpRequest(m) => {
            db.delete_http_request(&m, &UpdateSource::Sync)?;
        }
        SyncModel::GrpcRequest(m) => {
            db.delete_grpc_request(&m, &UpdateSource::Sync)?;
        }
        SyncModel::WebsocketRequest(m) => {
            db.delete_websocket_request(&m, &UpdateSource::Sync)?;
        }
    };
    Ok(())
}
