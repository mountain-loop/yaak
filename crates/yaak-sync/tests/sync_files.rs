use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{HttpRequest, SyncState, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_sync::error::{Error, Result};
use yaak_sync::models::SyncModel;
use yaak_sync::sync::{
    SyncOp, apply_db_sync_ops, apply_fs_sync_ops, apply_sync_state_ops, compute_sync_ops,
    get_db_candidates, get_fs_candidates,
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
        let (db, blobs, _events) = yaak_models::init_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
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
