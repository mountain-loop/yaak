use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{HttpRequest, HttpResponse, SyncState, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_sync::error::{Error, Result};
use yaak_sync::models::SyncModel;
use yaak_sync::sync::{
    SyncOp, apply_db_sync_ops, apply_fs_sync_ops, apply_sync_ops, apply_sync_state_ops,
    compute_sync_ops, get_db_candidates, get_fs_candidates,
};

struct Fixture {
    db: QueryManager,
    blobs: BlobManager,
    dir: TempDir,
    workspace_id: String,
    request: HttpRequest,
    request_path: PathBuf,
}

impl Fixture {
    fn new(request_filename: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let (db, blobs, _events) = yaak_models::init_standalone(
            dir.path().join(".db/models.sqlite"),
            dir.path().join(".db/blobs.sqlite"),
        )
        .unwrap();
        let workspace = Workspace { id: "wk_sync_test".into(), ..Default::default() };
        let request = HttpRequest {
            id: "rq_sync_test".into(),
            workspace_id: workspace.id.clone(),
            name: "Keep this request".into(),
            ..Default::default()
        };
        let request_path = dir.path().join(request_filename);
        let fixture = Self {
            db,
            blobs,
            dir,
            workspace_id: workspace.id.clone(),
            request: request.clone(),
            request_path,
        };
        for (model, path) in [
            (SyncModel::Workspace(workspace), fixture.dir.path().join("workspace.yaml")),
            (SyncModel::HttpRequest(request), fixture.request_path.clone()),
        ] {
            let (contents, _) = model.to_file_contents(&path).unwrap();
            fs::write(path, contents).unwrap();
        }
        let fs_candidates = get_fs_candidates(fixture.dir.path(), &[]).unwrap();
        fixture.apply(compute_sync_ops(Vec::new(), fs_candidates));
        assert!(fixture.calculate().unwrap().is_empty());
        fixture
    }

    fn calculate(&self) -> Result<Vec<SyncOp>> {
        let db_candidates =
            get_db_candidates(&self.db.connect(), "test", &self.workspace_id, self.dir.path())?;
        let fs_candidates = get_fs_candidates(self.dir.path(), &db_candidates)?
            .into_iter()
            .filter(|candidate| candidate.model.workspace_id() == self.workspace_id)
            .collect();
        Ok(compute_sync_ops(db_candidates, fs_candidates))
    }

    fn apply(&self, ops: Vec<SyncOp>) {
        let pending = apply_fs_sync_ops(&self.workspace_id, self.dir.path(), ops).unwrap();
        let workspace = &self.workspace_id;
        let dir = self.dir.path();
        self.db
            .with_tx::<_, Error>(|tx| {
                let states = apply_db_sync_ops(tx, &self.blobs, workspace, dir, pending)?;
                apply_sync_state_ops(tx, workspace, dir, states)
            })
            .unwrap();
    }

    fn apply_reviewed(&self, ops: Vec<SyncOp>) -> bool {
        apply_sync_ops(&self.db, &self.blobs, "test", &self.workspace_id, self.dir.path(), ops)
            .unwrap()
    }

    fn states(&self) -> Vec<SyncState> {
        let mut states = self
            .db
            .connect()
            .list_sync_states_for_workspace(&self.workspace_id, self.dir.path())
            .unwrap();
        states.sort_by(|a, b| a.id.cmp(&b.id));
        states
    }

    fn db_request(&self) -> HttpRequest {
        self.db.connect().get_http_request(&self.request.id).unwrap()
    }

    fn edit(&self, edit: impl FnOnce(&mut serde_json::Value)) {
        let mut value = serde_json::to_value(SyncModel::HttpRequest(self.request.clone())).unwrap();
        edit(&mut value);
        let content = if self.request_path.extension().unwrap() == "json" {
            serde_json::to_string(&value).unwrap()
        } else {
            serde_yaml::to_string(&value).unwrap()
        };
        fs::write(&self.request_path, content).unwrap();
    }

    fn assert_invalid_file(&self) -> String {
        let before_request = self.db_request();
        let before_states = serde_json::to_value(self.states()).unwrap();
        let error = self.calculate().unwrap_err();
        assert!(matches!(&error, Error::InvalidSyncFile(_)), "{error:?}");
        assert!(error.to_string().contains(self.request_path.to_str().unwrap()));
        assert_eq!(self.db_request(), before_request);
        assert_eq!(serde_json::to_value(self.states()).unwrap(), before_states);
        error.to_string()
    }
}

#[test]
fn tracked_model_type_changes_abort_sync() {
    let fixture = Fixture::new("request.yaml");
    fixture.edit(|value| {
        value["model"] = "websocket_request".into();
    });
    fixture.assert_invalid_file();
}

#[test]
fn invalid_tracked_files_abort_without_changing_data() {
    for (filename, contents) in [
        ("request.yaml", b"model: http_request\nid: [broken\n".as_slice()),
        ("request.json", b"{\"model\":\"http_request\",\"id\":".as_slice()),
        ("custom-request.yml", b"name: half-written\n".as_slice()),
        ("custom-request.yml", b"model: http_request\n".as_slice()),
        ("custom-request.yml", [0xff, 0xfe].as_slice()),
    ] {
        let fixture = Fixture::new(filename);
        fs::write(&fixture.request_path, contents).unwrap();
        fixture.assert_invalid_file();
        assert_eq!(fs::read(&fixture.request_path).unwrap(), contents);
    }
}

#[test]
fn tracked_file_with_git_conflict_markers_aborts_sync() {
    let fixture = Fixture::new("request.yaml");
    let contents = fs::read_to_string(&fixture.request_path).unwrap().replace(
        "name: Keep this request\n",
        "<<<<<<< HEAD\nname: Mine\n=======\nname: Theirs\n>>>>>>> origin/main\n",
    );
    fs::write(&fixture.request_path, contents).unwrap();
    let error = fixture.assert_invalid_file();
    assert!(error.contains("line "), "{error}");
}

#[test]
fn empty_tracked_file_aborts_sync() {
    let fixture = Fixture::new("request.yaml");
    fs::write(&fixture.request_path, "").unwrap();
    fixture.assert_invalid_file();
}

#[cfg(unix)]
#[test]
fn unreadable_tracked_file_aborts_sync() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new("request.yaml");
    fs::set_permissions(&fixture.request_path, fs::Permissions::from_mode(0o000)).unwrap();
    // Root bypasses ordinary POSIX permission checks.
    if fs::read(&fixture.request_path).is_ok() {
        return;
    }
    let error = fixture.assert_invalid_file();
    assert!(error.contains("Permission denied"), "{error}");
}

#[test]
fn mismatched_identities_abort_sync_for_yaml_and_json() {
    for filename in ["request.yaml", "request.json"] {
        for field in ["id", "workspaceId"] {
            let fixture = Fixture::new(filename);
            fixture.edit(|value| value[field] = "different".into());
            fixture.assert_invalid_file();
        }
    }
}

#[test]
fn tracked_path_replaced_by_a_directory_aborts_sync() {
    let fixture = Fixture::new("request.yaml");
    fs::remove_file(&fixture.request_path).unwrap();
    fs::create_dir(&fixture.request_path).unwrap();
    fixture.assert_invalid_file();
}

#[test]
fn deleting_a_tracked_file_still_deletes_the_request() {
    let fixture = Fixture::new("request.yaml");
    fs::remove_file(&fixture.request_path).unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(
        matches!(ops.as_slice(), [SyncOp::DbDelete { model, .. }] if model.id() == fixture.request.id)
    );
    fixture.apply(ops);
    assert!(fixture.db.connect().get_http_request(&fixture.request.id).is_err());
}

#[test]
fn unrelated_files_are_still_ignored() {
    let fixture = Fixture::new("request.yaml");
    for (name, contents) in [
        ("README.md", "model: http_request\nid: [broken\n"),
        ("config.yaml", "model: unrelated\nid: example\n"),
        ("unrelated.json", "{\"model\":\"config\",\"id\":"),
        ("empty.yaml", ""),
    ] {
        fs::write(fixture.dir.path().join(name), contents).unwrap();
    }
    fs::create_dir(fixture.dir.path().join("other-files")).unwrap();
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn restored_file_invalidates_reviewed_deletion_and_preserves_history() {
    let fixture = Fixture::new("request.yaml");
    let response = fixture
        .db
        .with_tx::<_, Error>(|tx| {
            Ok(tx.upsert_http_response(
                &HttpResponse {
                    id: "rs_sync_test".into(),
                    request_id: fixture.request.id.clone(),
                    workspace_id: fixture.workspace_id.clone(),
                    status: 200,
                    ..Default::default()
                },
                &UpdateSource::Background,
                &fixture.blobs,
            )?)
        })
        .unwrap();
    let saved = fs::read(&fixture.request_path).unwrap();
    fs::remove_file(&fixture.request_path).unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(matches!(ops.as_slice(), [SyncOp::DbDelete { .. }]));
    fs::write(&fixture.request_path, &saved).unwrap();
    let before = fixture.states();

    assert!(!fixture.apply_reviewed(ops));
    assert_eq!(fixture.db_request().name, "Keep this request");
    assert_eq!(
        serde_json::to_value(fixture.db.connect().get_http_response(&response.id).unwrap())
            .unwrap(),
        serde_json::to_value(response).unwrap()
    );
    assert_eq!(fixture.states(), before);
    assert_eq!(fs::read(&fixture.request_path).unwrap(), saved);
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn newer_database_edit_invalidates_reviewed_update_even_when_file_timestamp_wins() {
    for file_is_newer in [false, true] {
        let fixture = Fixture::new("request.yaml");
        fixture.edit(|value| {
            value["name"] = "Previously reviewed file version".into();
            if file_is_newer {
                value["updatedAt"] = serde_json::to_value(
                    (chrono::Utc::now() + chrono::Duration::days(1)).naive_utc(),
                )
                .unwrap();
            }
        });
        let ops = fixture.calculate().unwrap();
        assert!(matches!(ops.as_slice(), [SyncOp::DbUpdate { .. }]));
        let before = fixture.states();
        let mut request = fixture.db_request();
        request.name = "New edit from another window".into();
        fixture
            .db
            .with_tx::<_, Error>(|tx| {
                tx.upsert_http_request(&request, &UpdateSource::from_window_label("test"))?;
                Ok(())
            })
            .unwrap();
        if file_is_newer {
            assert!(matches!(fixture.calculate().unwrap().as_slice(), [SyncOp::DbUpdate { .. }]));
        }

        assert!(!fixture.apply_reviewed(ops));
        assert_eq!(fixture.db_request().name, request.name);
        assert_eq!(fixture.states(), before);
    }
}

#[test]
fn changed_file_invalidates_reviewed_update_until_reviewed_again() {
    let fixture = Fixture::new("request.yaml");
    fixture.edit(|value| value["name"] = "Reviewed version".into());
    let ops = fixture.calculate().unwrap();
    fixture.edit(|value| value["name"] = "New file version".into());
    let before = fixture.states();

    assert!(!fixture.apply_reviewed(ops));
    assert_eq!(fixture.db_request().name, "Keep this request");
    assert_eq!(fixture.states(), before);
    assert!(fixture.apply_reviewed(fixture.calculate().unwrap()));
    assert_eq!(fixture.db_request().name, "New file version");
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn unchanged_reviewed_plan_applies_in_any_order_and_cannot_be_replayed() {
    let fixture = Fixture::new("request.yaml");
    fs::remove_file(&fixture.request_path).unwrap();
    let path = fixture.dir.path().join("workspace.yaml");
    let mut workspace = fixture.db.connect().get_workspace(&fixture.workspace_id).unwrap();
    workspace.name = "Reviewed workspace".into();
    let (contents, _) = SyncModel::Workspace(workspace).to_file_contents(&path).unwrap();
    fs::write(path, contents).unwrap();
    let mut ops = fixture.calculate().unwrap();
    assert_eq!(ops.len(), 2);
    ops.reverse();

    assert!(fixture.apply_reviewed(ops.clone()));
    assert!(fixture.db.connect().get_http_request(&fixture.request.id).is_err());
    assert_eq!(
        fixture.db.connect().get_workspace(&fixture.workspace_id).unwrap().name,
        "Reviewed workspace"
    );
    assert!(fixture.calculate().unwrap().is_empty());
    let before = fixture.states();
    assert!(!fixture.apply_reviewed(ops));
    assert_eq!(fixture.states(), before);
}

#[test]
fn changes_while_waiting_for_database_writer_invalidate_reviewed_plan() {
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    for restore_file in [false, true] {
        let fixture = Fixture::new("request.yaml");
        let saved = fs::read(&fixture.request_path).unwrap();
        if restore_file {
            fs::remove_file(&fixture.request_path).unwrap();
        } else {
            fixture.edit(|value| value["name"] = "Incoming file version".into());
        }
        fixture
            .db
            .with_tx::<_, Error>(|tx| {
                let mut workspace = tx.get_workspace(&fixture.workspace_id)?;
                workspace.name = "Outbound workspace version".into();
                tx.upsert_workspace(&workspace, &UpdateSource::from_window_label("test"))?;
                Ok(())
            })
            .unwrap();
        let ops = fixture.calculate().unwrap();
        assert_eq!(ops.len(), 2);
        let before = fixture.states();
        let workspace_path = fixture.dir.path().join("workspace.yaml");
        let (ready_tx, ready_rx) = mpsc::channel();
        let (resume_tx, resume_rx) = mpsc::channel();
        std::thread::scope(|scope| {
            let fixture = &fixture;
            let writer = scope.spawn(move || {
                fixture
                    .db
                    .with_tx::<_, Error>(|tx| {
                        ready_tx.send(()).unwrap();
                        resume_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                        if !restore_file {
                            let mut request = tx.get_http_request(&fixture.request.id)?;
                            request.name = "Concurrent database edit".into();
                            tx.upsert_http_request(
                                &request,
                                &UpdateSource::from_window_label("test"),
                            )?;
                        }
                        Ok(())
                    })
                    .unwrap();
            });
            ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let applying = scope.spawn(move || fixture.apply_reviewed(ops));
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut published = false;
            while Instant::now() < deadline {
                if fs::read_to_string(&workspace_path)
                    .unwrap()
                    .contains("Outbound workspace version")
                {
                    published = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            if restore_file {
                // Restore at a different path to catch ID-based joins as well as the tracked path.
                fs::write(fixture.dir.path().join("restored.yaml"), &saved).unwrap();
            }
            resume_tx.send(()).unwrap();
            writer.join().unwrap();
            assert!(!applying.join().unwrap());
            assert!(published, "filesystem writes should proceed while the DB writer is held");
        });
        assert_eq!(
            fixture.db_request().name,
            if restore_file { "Keep this request" } else { "Concurrent database edit" }
        );
        assert_eq!(fixture.states(), before);
    }
}

#[test]
fn current_outbound_only_plan_still_syncs_automatically() {
    let fixture = Fixture::new("request.yaml");
    fixture
        .db
        .with_tx::<_, Error>(|tx| {
            let mut request = tx.get_http_request(&fixture.request.id)?;
            request.name = "New database version".into();
            tx.upsert_http_request(&request, &UpdateSource::from_window_label("test"))?;
            Ok(())
        })
        .unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(matches!(ops.as_slice(), [SyncOp::FsUpdate { .. }]));
    assert!(fixture.apply_reviewed(ops));
    assert!(fs::read_to_string(&fixture.request_path).unwrap().contains("New database version"));
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn reviewed_import_and_file_deletion_apply_together() {
    let fixture = Fixture::new("request.yaml");
    let mut added = fixture.request.clone();
    added.id = "rq_sync_added".into();
    let path = fixture.dir.path().join("added.yaml");
    let (contents, _) = SyncModel::HttpRequest(added.clone()).to_file_contents(&path).unwrap();
    fs::write(path, contents).unwrap();
    fixture
        .db
        .with_tx::<_, Error>(|tx| {
            let request = tx.get_http_request(&fixture.request.id)?;
            tx.delete_http_request(&request, &UpdateSource::Sync)?;
            Ok(())
        })
        .unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(ops.iter().any(|op| matches!(op, SyncOp::DbCreate { .. })));
    assert!(ops.iter().any(|op| matches!(op, SyncOp::FsDelete { fs: Some(_), .. })));

    assert!(fixture.apply_reviewed(ops));
    assert!(!fixture.request_path.exists());
    assert_eq!(fixture.db.connect().get_http_request(&added.id).unwrap().id, added.id);
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn reviewed_inbound_and_outbound_updates_apply_together() {
    let fixture = Fixture::new("request.yaml");
    fixture.edit(|value| value["name"] = "Incoming request".into());
    fixture
        .db
        .with_tx::<_, Error>(|tx| {
            let mut workspace = tx.get_workspace(&fixture.workspace_id)?;
            workspace.name = "Outgoing workspace".into();
            tx.upsert_workspace(&workspace, &UpdateSource::from_window_label("test"))?;
            Ok(())
        })
        .unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(ops.iter().any(|op| matches!(op, SyncOp::DbUpdate { .. })));
    assert!(ops.iter().any(|op| matches!(op, SyncOp::FsUpdate { .. })));

    assert!(fixture.apply_reviewed(ops));
    assert_eq!(fixture.db_request().name, "Incoming request");
    assert!(
        fs::read_to_string(fixture.dir.path().join("workspace.yaml"))
            .unwrap()
            .contains("Outgoing workspace")
    );
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn later_file_edits_invalidate_reviewed_outbound_operations() {
    for creating in [false, true] {
        for file_present in [true, false] {
            let fixture = Fixture::new("yaak.rq_sync_test.yaml");
            let state = fixture
                .states()
                .into_iter()
                .find(|state| state.model_id == fixture.request.id)
                .unwrap();
            fixture
                .db
                .with_tx::<_, Error>(|tx| {
                    if creating {
                        tx.delete_sync_state(&state)?;
                    }
                    let mut request = tx.get_http_request(&fixture.request.id)?;
                    request.name = "Reviewed outgoing request".into();
                    tx.upsert_http_request(&request, &UpdateSource::from_window_label("test"))?;
                    Ok(())
                })
                .unwrap();
            let workspace_path = fixture.dir.path().join("workspace.yaml");
            let workspace = fixture.db.connect().get_workspace(&fixture.workspace_id).unwrap();
            let mut incoming = workspace.clone();
            incoming.name = "Reviewed incoming workspace".into();
            let (content, _) =
                SyncModel::Workspace(incoming).to_file_contents(&workspace_path).unwrap();
            fs::write(&workspace_path, &content).unwrap();
            if !file_present {
                fs::remove_file(&fixture.request_path).unwrap();
            }
            let ops = fixture.calculate().unwrap();
            assert!(ops.iter().any(|op| matches!(op, SyncOp::DbUpdate { .. })));
            assert!(ops.iter().any(|op| if creating {
                matches!(op, SyncOp::FsCreate { .. })
            } else {
                matches!(op, SyncOp::FsUpdate { .. })
            }));
            let request = fixture.db_request();
            let states = fixture.states();

            // Keep updatedAt older than the DB version, so conflict resolution still writes to FS.
            fixture.edit(|value| value["name"] = "Later external file edit".into());
            let edited = fs::read(&fixture.request_path).unwrap();

            assert!(
                !fixture.apply_reviewed(ops),
                "creating={creating}, file_present={file_present}"
            );
            assert_eq!(fs::read(&fixture.request_path).unwrap(), edited);
            assert_eq!(fs::read(&workspace_path).unwrap(), content);
            assert_eq!(fixture.db_request(), request);
            assert_eq!(
                fixture.db.connect().get_workspace(&fixture.workspace_id).unwrap(),
                workspace
            );
            assert_eq!(fixture.states(), states);
            assert!(fixture.apply_reviewed(fixture.calculate().unwrap()));
            assert!(fixture.calculate().unwrap().is_empty());
        }
    }
}
