use crate::error::{Error, Result};
use crate::file_security::preserve_file_security;
use crate::models::SyncModel;
use chrono::Utc;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt::{Display, Formatter};
use std::fs;
use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use ts_rs::TS;
use yaak_models::blob_manager::BlobManager;
use yaak_models::client_db::{ClientDb, WriteDb};
use yaak_models::models::{
    Environment, Folder, GrpcRequest, HttpRequest, SyncState, WebsocketRequest, Workspace,
    WorkspaceMeta,
};
use yaak_models::util::{UpdateSource, get_workspace_export_resources};

// Keep temporary-file creation and scan exclusion on the same naming scheme.
const SYNC_TEMP_PREFIX: &str = ".yaak-sync-";
const SYNC_TEMP_SUFFIX: &str = ".tmp";

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", tag = "type")]
#[ts(export, export_to = "gen_sync.ts")]
pub enum SyncOp {
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
pub enum DbCandidate {
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
pub struct FsCandidate {
    pub model: SyncModel,
    pub rel_path: PathBuf,
    pub checksum: String,
}

pub fn get_db_candidates(
    db: &ClientDb,
    version: &str,
    workspace_id: &str,
    sync_dir: &Path,
) -> Result<Vec<DbCandidate>> {
    let models: HashMap<_, _> =
        workspace_models(db, version, workspace_id)?.into_iter().map(|m| (m.id(), m)).collect();
    let sync_states: HashMap<_, _> = db
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

/// Read sync files, validating paths tracked by existing database models.
///
/// Workspace sync callers must pass all candidates from [`get_db_candidates`] for
/// the same workspace and directory. An empty slice is for import discovery
/// without database sync state; it does not validate tracked model identities.
/// Temporary files are ignored but never removed: they may belong to another writer.
pub fn get_fs_candidates(dir: &Path, db_candidates: &[DbCandidate]) -> Result<Vec<FsCandidate>> {
    // Ensure the root directory exists
    fs::create_dir_all(dir)?;

    let tracked_paths: HashMap<PathBuf, (&SyncModel, &SyncState)> = db_candidates
        .iter()
        .filter_map(|candidate| match candidate {
            DbCandidate::Added(_) | DbCandidate::Deleted(_) => None,
            DbCandidate::Modified(model, state) | DbCandidate::Unmodified(model, state) => {
                Some((PathBuf::from(&state.rel_path), (model, state)))
            }
        })
        .collect();

    let mut candidates = Vec::new();
    let entries = fs::read_dir(dir)?;
    for dir_entry in entries {
        let dir_entry = dir_entry?;
        let path = dir_entry.path();
        let rel_path = PathBuf::from(dir_entry.file_name());
        let tracked = tracked_paths.get(&rel_path);

        // Our temporary files can be renamed away at any point; do not inspect them.
        if tracked.is_none()
            && rel_path.to_str().is_some_and(|name| {
                name.starts_with(SYNC_TEMP_PREFIX) && name.ends_with(SYNC_TEMP_SUFFIX)
            })
        {
            continue;
        }

        if !dir_entry.file_type()?.is_file() {
            if tracked.is_some() {
                return Err(Error::InvalidSyncFile(format!(
                    "{}: expected a regular sync file",
                    path.display()
                )));
            }
            continue;
        };

        // Read once so identity and completeness checks see the same bytes.
        let content = match fs::read(&path) {
            Ok(content) => content,
            Err(error) if tracked.is_some() => {
                return Err(Error::InvalidSyncFile(format!("{}: {error}", path.display())));
            }
            Err(_) => continue,
        };
        let (model, checksum) = match SyncModel::from_bytes(content.clone(), &path) {
            Ok(Some(m)) => m,
            // A present tracked file must not disappear from the candidates: that
            // would turn a read/parse failure into a database deletion.
            Ok(None) if tracked.is_some() => {
                return Err(Error::InvalidSyncFile(format!(
                    "{}: failed to read or parse tracked sync file",
                    path.display()
                )));
            }
            Ok(None) => continue,
            Err(e) => {
                warn!("Failed to parse sync file {e}");
                return Err(e);
            }
        };

        if let Some((previous, state)) = tracked {
            if model.id() != state.model_id {
                return Err(Error::InvalidSyncFile(format!(
                    "{}: expected model ID {}, found {}",
                    path.display(),
                    state.model_id,
                    model.id()
                )));
            }
            // A wrong/defaulted workspace ID would be filtered out by the caller,
            // making this tracked model look deleted even if its ID is intact.
            if model.workspace_id() != state.workspace_id {
                return Err(Error::InvalidSyncFile(format!(
                    "{}: expected workspace ID {}, found {}",
                    path.display(),
                    state.workspace_id,
                    model.workspace_id()
                )));
            }
            // Unchanged legacy files may lack newly added fields. They cannot
            // overwrite the DB and must remain usable for exporting DB edits.
            if checksum != state.checksum {
                model.validate_tracked_fields(&content, previous, &path)?;
            }
        }

        candidates.push(FsCandidate { rel_path, model, checksum })
    }

    Ok(candidates)
}

pub fn compute_sync_ops(
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
                (Some(DbCandidate::Unmodified(model, sync_state)), None) => {
                    SyncOp::DbDelete { model: model.to_owned(), state: sync_state.to_owned() }
                }

                // DB modified <-> FS missing
                (Some(DbCandidate::Modified(model, sync_state)), None) => {
                    SyncOp::FsUpdate { model: model.to_owned(), state: sync_state.to_owned() }
                }

                // DB added <-> FS missing
                (Some(DbCandidate::Added(model)), None) => {
                    SyncOp::FsCreate { model: model.to_owned() }
                }

                // DB deleted <-> FS missing
                //   Already deleted on FS, but sending it so the SyncState gets dealt with
                (Some(DbCandidate::Deleted(sync_state)), None) => {
                    SyncOp::FsDelete { state: sync_state.to_owned(), fs: None }
                }

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
                        SyncOp::FsUpdate { model: model.to_owned(), state: sync_state.to_owned() }
                    } else if model.updated_at() < fs_candidate.model.updated_at() {
                        // CONFLICT! Write to DB if the fs model is newer
                        SyncOp::DbUpdate {
                            state: sync_state.to_owned(),
                            fs: fs_candidate.to_owned(),
                        }
                    } else {
                        // CONFLICT! Write to FS if the db model is newer
                        SyncOp::FsUpdate { model: model.to_owned(), state: sync_state.to_owned() }
                    }
                }

                // DB added <-> FS anything
                (Some(DbCandidate::Added(model)), Some(_)) => {
                    // This would be super rare (impossible?), so let's follow the user's intention
                    SyncOp::FsCreate { model: model.to_owned() }
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

fn workspace_models(db: &ClientDb, version: &str, workspace_id: &str) -> Result<Vec<SyncModel>> {
    // We want to include private environments here so that we can take them into account during
    // the sync process. Otherwise, they would be treated as deleted.
    let include_private_environments = true;
    let resources = get_workspace_export_resources(
        db,
        version,
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

/// The database half of a sync apply, ready to run once the files are on disk.
pub struct PendingDbSyncOps {
    sync_state_ops: Vec<SyncStateOp>,
    deletes: Vec<SyncModel>,
    workspaces: Vec<Workspace>,
    environments: Vec<Environment>,
    folders: Vec<Folder>,
    http_requests: Vec<HttpRequest>,
    grpc_requests: Vec<GrpcRequest>,
    websocket_requests: Vec<WebsocketRequest>,
}

/// Apply the filesystem half of the sync operations: create, rewrite and
/// delete files. Returns the database half, for [`apply_db_sync_ops`].
///
/// Split this way so the file work, which can be slow, happens before the
/// write transaction is opened rather than inside it.
pub fn apply_fs_sync_ops(
    workspace_id: &str,
    sync_dir: &Path,
    sync_ops: Vec<SyncOp>,
) -> Result<PendingDbSyncOps> {
    let mut pending = PendingDbSyncOps {
        sync_state_ops: Vec::new(),
        deletes: Vec::new(),
        workspaces: Vec::new(),
        environments: Vec::new(),
        folders: Vec::new(),
        http_requests: Vec::new(),
        grpc_requests: Vec::new(),
        websocket_requests: Vec::new(),
    };
    if sync_ops.is_empty() {
        return Ok(pending);
    }

    info!(
        "Applying sync ops {}",
        sync_ops.iter().map(|op| op.to_string()).collect::<Vec<String>>().join(", ")
    );

    for op in sync_ops {
        // Only apply things if workspace ID matches
        if op.workspace_id() != workspace_id {
            continue;
        }

        let state_op = match op {
            SyncOp::FsCreate { model } => {
                let rel_path = derive_model_filename(&model);
                let abs_path = sync_dir.join(rel_path.clone());
                let (content, checksum) = model.to_file_contents(&rel_path)?;
                write_sync_file(&abs_path, |file| file.write_all(&content))?;
                SyncStateOp::Create { model_id: model.id(), checksum, rel_path }
            }
            SyncOp::FsUpdate { model, state } => {
                // Always write the existing path
                let rel_path = Path::new(&state.rel_path);
                let abs_path = Path::new(&state.sync_dir).join(&rel_path);
                let (content, checksum) = model.to_file_contents(&rel_path)?;
                write_sync_file(&abs_path, |file| file.write_all(&content))?;
                SyncStateOp::Update {
                    state: state.to_owned(),
                    checksum,
                    rel_path: rel_path.to_owned(),
                }
            }
            SyncOp::FsDelete { state, fs: fs_candidate } => match fs_candidate {
                None => SyncStateOp::Delete { state: state.to_owned() },
                Some(_) => {
                    // Always delete the existing path
                    let rel_path = Path::new(&state.rel_path);
                    let abs_path = Path::new(&state.sync_dir).join(&rel_path);
                    fs::remove_file(&abs_path)?;
                    SyncStateOp::Delete { state: state.to_owned() }
                }
            },
            SyncOp::DbCreate { fs } => {
                let model_id = fs.model.id();
                pending.push_upsert(fs.model);
                SyncStateOp::Create {
                    model_id,
                    checksum: fs.checksum.to_owned(),
                    rel_path: fs.rel_path.to_owned(),
                }
            }
            SyncOp::DbUpdate { state, fs } => {
                pending.push_upsert(fs.model);
                SyncStateOp::Update {
                    state: state.to_owned(),
                    checksum: fs.checksum.to_owned(),
                    rel_path: fs.rel_path.to_owned(),
                }
            }
            SyncOp::DbDelete { model, state } => {
                pending.deletes.push(model);
                SyncStateOp::Delete { state: state.to_owned() }
            }
            SyncOp::IgnorePrivate { .. } => SyncStateOp::NoOp,
        };
        pending.sync_state_ops.push(state_op);
    }

    Ok(pending)
}

/// Publish a complete file without exposing partial writes to sync readers.
///
/// Existing access controls are preserved before publishing. Opening the existing
/// file for writing also enforces its write restrictions. Metadata-copy failures
/// abort the write and leave the original file in place.
///
/// Atomic replacement protects concurrent readers, without a crash durability guarantee.
/// A crash may leave a temporary file behind. Sync scans ignore it, but Git may
/// report it as untracked; automatic cleanup could interfere with another writer.
fn write_sync_file(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> Result<()> {
    let existing = match fs::OpenOptions::new().write(true).open(path) {
        Ok(file) => Some(file),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    // The unsupported extension keeps the in-progress file out of sync candidates.
    let mut builder = tempfile::Builder::new();
    builder.prefix(SYNC_TEMP_PREFIX).suffix(SYNC_TEMP_SUFFIX);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Match File::create for new files, including the process umask.
        if existing.is_none() {
            builder.permissions(fs::Permissions::from_mode(0o666));
        }
    }
    let mut file = builder.tempfile_in(parent)?;
    if let Some(existing) = &existing {
        // Apply the original policy before putting data in the temporary file.
        preserve_file_security(existing, file.as_file(), file.path()).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!("{}: cannot preserve file access controls: {error}", path.display()),
            )
        })?;
    }
    write(file.as_file_mut())?;
    file.persist(path).map_err(io::Error::from)?;
    Ok(())
}

impl PendingDbSyncOps {
    /// Upserts are collected per model type and written in one batch so
    /// foreign keys are satisfied.
    fn push_upsert(&mut self, model: SyncModel) {
        match model {
            SyncModel::Environment(m) => self.environments.push(m),
            SyncModel::Folder(m) => self.folders.push(m),
            SyncModel::GrpcRequest(m) => self.grpc_requests.push(m),
            SyncModel::HttpRequest(m) => self.http_requests.push(m),
            SyncModel::WebsocketRequest(m) => self.websocket_requests.push(m),
            SyncModel::Workspace(m) => self.workspaces.push(m),
        }
    }
}

/// Apply the database half of the sync operations.
/// Returns a list of SyncStateOps that should be applied afterward.
pub fn apply_db_sync_ops(
    db: &WriteDb,
    blobs: &BlobManager,
    workspace_id: &str,
    sync_dir: &Path,
    pending: PendingDbSyncOps,
) -> Result<Vec<SyncStateOp>> {
    for model in &pending.deletes {
        delete_model(db, blobs, model)?;
    }

    let upserted_models = db.batch_upsert(
        pending.workspaces,
        pending.environments,
        pending.folders,
        pending.http_requests,
        pending.grpc_requests,
        pending.websocket_requests,
        &UpdateSource::Sync,
    )?;

    // Ensure we create WorkspaceMeta models for each new workspace, with the appropriate sync dir
    let sync_dir_string = sync_dir.to_string_lossy().to_string();
    for workspace in upserted_models.workspaces {
        match db.get_workspace_meta(&workspace.id) {
            Some(m) => {
                if m.setting_sync_dir == Some(sync_dir_string.clone()) {
                    // We don't need to update if unchanged
                    continue;
                }
                db.upsert_workspace_meta(
                    &WorkspaceMeta {
                        setting_sync_dir: Some(sync_dir.to_string_lossy().to_string()),
                        ..m
                    },
                    &UpdateSource::Sync,
                )
            }
            None => db.upsert_workspace_meta(
                &WorkspaceMeta {
                    workspace_id: workspace_id.to_string(),
                    setting_sync_dir: Some(sync_dir.to_string_lossy().to_string()),
                    ..Default::default()
                },
                &UpdateSource::Sync,
            ),
        }?;
    }

    Ok(pending.sync_state_ops)
}

#[derive(Debug)]
pub enum SyncStateOp {
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

pub fn apply_sync_state_ops(
    db: &WriteDb,
    workspace_id: &str,
    sync_dir: &Path,
    ops: Vec<SyncStateOp>,
) -> Result<()> {
    for op in ops {
        match op {
            SyncStateOp::Create { checksum, rel_path, model_id } => {
                let sync_state = SyncState {
                    workspace_id: workspace_id.to_string(),
                    model_id,
                    checksum,
                    sync_dir: sync_dir.to_str().unwrap().to_string(),
                    rel_path: rel_path.to_str().unwrap().to_string(),
                    flushed_at: Utc::now().naive_utc(),
                    ..Default::default()
                };
                db.upsert_sync_state(&sync_state)?;
            }
            SyncStateOp::Update { state: sync_state, checksum, rel_path } => {
                let sync_state = SyncState {
                    checksum,
                    sync_dir: sync_dir.to_str().unwrap().to_string(),
                    rel_path: rel_path.to_str().unwrap().to_string(),
                    flushed_at: Utc::now().naive_utc(),
                    ..sync_state
                };
                db.upsert_sync_state(&sync_state)?;
            }
            SyncStateOp::Delete { state } => {
                db.delete_sync_state(&state)?;
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

fn delete_model(db: &WriteDb, blobs: &BlobManager, model: &SyncModel) -> Result<()> {
    match model {
        SyncModel::Workspace(m) => {
            db.delete_workspace(&m, &UpdateSource::Sync, blobs)?;
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

#[cfg(test)]
mod write_tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn failed_security_copy_keeps_the_original_and_never_writes_payload() {
        use std::os::unix::fs::{MetadataExt, symlink};

        // A foreign owner cannot be assigned to our staging file without privileges.
        if unsafe { libc::geteuid() } == fs::metadata("/dev/null").unwrap().uid() {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        symlink("/dev/null", &path).unwrap();
        let result = write_sync_file(&path, |_| {
            panic!("payload must not be written before access controls are preserved")
        });
        assert!(
            matches!(result, Err(Error::IoError(error)) if error.kind() == io::ErrorKind::PermissionDenied)
        );
        assert_eq!(fs::read_link(&path).unwrap(), Path::new("/dev/null"));
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn temporary_file_does_not_keep_extra_inherited_acl_entries() {
        use std::os::unix::fs::PermissionsExt;
        use std::process::Command;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        fs::write(&path, b"old contents").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let output = Command::new("/bin/chmod")
            .args(["+a", "everyone allow read,file_inherit,only_inherit"])
            .arg(dir.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        write_sync_file(&path, |file| {
            let temporary = fs::read_dir(dir.path())
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| {
                    path.file_name().unwrap().to_str().unwrap().starts_with(SYNC_TEMP_PREFIX)
                })
                .unwrap();
            let listing = Command::new("/bin/ls").arg("-le").arg(temporary).output()?;
            assert!(!String::from_utf8_lossy(&listing.stdout).contains("allow read"));
            file.write_all(b"complete new contents")
        })
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"complete new contents");
    }

    #[cfg(unix)]
    #[test]
    fn read_only_file_is_not_replaced() {
        use std::os::unix::fs::PermissionsExt;
        // Root bypasses ordinary POSIX permission checks.
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        fs::write(&path, b"original contents").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        let result = write_sync_file(&path, |file| file.write_all(b"new contents"));
        assert!(
            matches!(result, Err(Error::IoError(error)) if error.kind() == io::ErrorKind::PermissionDenied)
        );
        assert_eq!(fs::read(&path).unwrap(), b"original contents");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_partial_write_keeps_previous_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        fs::write(&path, b"complete previous contents").unwrap();
        let result = write_sync_file(&path, |file| {
            file.write_all(b"partial new contents")?;
            Err(io::Error::new(io::ErrorKind::WriteZero, "simulated write failure"))
        });
        assert!(
            matches!(result, Err(Error::IoError(error)) if error.kind() == io::ErrorKind::WriteZero)
        );
        assert_eq!(fs::read(&path).unwrap(), b"complete previous contents");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_publish_cleans_up_the_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        let result = write_sync_file(&path, |file| {
            file.write_all(b"new contents")?;
            // Make replacement fail after staging has actually been written.
            fs::create_dir(&path)?;
            fs::write(path.join("keep"), b"keep this file")
        });
        assert!(result.is_err());
        assert_eq!(fs::read(path.join("keep")).unwrap(), b"keep this file");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn readers_ignore_the_in_progress_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        let request = HttpRequest {
            id: "rq_write_test".into(),
            workspace_id: "wk_write_test".into(),
            name: "Previous request".into(),
            ..Default::default()
        };
        let model = SyncModel::HttpRequest(request.clone());
        let (old_contents, checksum) = model.to_file_contents(&path).unwrap();
        fs::write(&path, &old_contents).unwrap();
        let db_candidates = vec![DbCandidate::Unmodified(
            model,
            SyncState {
                model_id: request.id.clone(),
                workspace_id: request.workspace_id.clone(),
                rel_path: "request.yaml".into(),
                checksum,
                ..Default::default()
            },
        )];
        let model = SyncModel::HttpRequest(HttpRequest { name: "New request".into(), ..request });
        let (new_contents, _) = model.to_file_contents(&path).unwrap();
        let split = new_contents.len() / 2;
        write_sync_file(&path, |file| {
            file.write_all(&new_contents[..split])?;
            assert_eq!(fs::read(&path).unwrap(), old_contents);
            let fs_candidates = get_fs_candidates(dir.path(), &db_candidates).unwrap();
            assert_eq!(fs_candidates.len(), 1);
            assert!(compute_sync_ops(db_candidates.clone(), fs_candidates).is_empty());
            file.write_all(&new_contents[split..])
        })
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), new_contents);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn writes_preserve_existing_permissions_and_new_file_defaults() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.yaml");
        fs::write(&path, b"old contents").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
        write_sync_file(&path, |file| {
            // Keep unpublished data at least as private as the original file.
            assert_eq!(file.metadata()?.permissions().mode() & 0o777 & !0o640, 0);
            file.write_all(b"new contents")
        })
        .unwrap();
        assert_eq!(fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o640);

        let reference = dir.path().join("reference.yaml");
        File::create(&reference).unwrap();
        let new_path = dir.path().join("new.yaml");
        write_sync_file(&new_path, |file| file.write_all(b"new contents")).unwrap();
        assert_eq!(
            fs::metadata(&new_path).unwrap().permissions().mode() & 0o777,
            fs::metadata(&reference).unwrap().permissions().mode() & 0o777
        );
    }
}
