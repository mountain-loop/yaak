use std::fs;
use std::io::Read;
use std::path::PathBuf;
use tempfile::TempDir;
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{HttpRequest, HttpRequestHeader, SyncState, Workspace};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
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
        Self::with_request(request_filename, |_| {})
    }

    fn with_request(request_filename: &str, configure: impl FnOnce(&mut HttpRequest)) -> Self {
        let (db, blobs, _events) = yaak_models::init_in_memory().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace { id: "wk_sync_test".into(), ..Default::default() };
        let mut request = HttpRequest {
            id: "rq_sync_test".into(),
            workspace_id: workspace.id.clone(),
            name: "Keep this request".into(),
            ..Default::default()
        };
        configure(&mut request);
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

    fn state(&self) -> SyncState {
        self.states().into_iter().find(|s| s.model_id == self.request.id).unwrap()
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

    fn publish(&self, name: &str, create: bool) -> Vec<u8> {
        let model =
            SyncModel::HttpRequest(HttpRequest { name: name.into(), ..self.request.clone() });
        let (content, _) = model.to_file_contents(&self.request_path).unwrap();
        let op = if create {
            SyncOp::FsCreate { model }
        } else {
            SyncOp::FsUpdate { model, state: self.state() }
        };
        apply_fs_sync_ops(&self.workspace_id, self.dir.path(), vec![op]).unwrap();
        content
    }

    fn assert_invalid_file(&self) {
        let before_request = self.db_request();
        let before_states = serde_json::to_value(self.states()).unwrap();
        let error = self.calculate().unwrap_err();
        assert!(matches!(&error, Error::InvalidSyncFile(_)), "{error:?}");
        assert!(error.to_string().contains(self.request_path.to_str().unwrap()));
        assert_eq!(self.db_request(), before_request);
        assert_eq!(serde_json::to_value(self.states()).unwrap(), before_states);
    }
}

fn populate_request(request: &mut HttpRequest) {
    request.url = "https://example.invalid/probe".into();
    request.method = "POST".into();
    request.authentication_type = Some("bearer".into());
    request.authentication.insert("token".into(), serde_json::json!("fixture-token"));
    request.body_type = Some("raw".into());
    request.body.insert("text".into(), serde_json::json!("fixture-payload"));
    request.headers.push(HttpRequestHeader {
        enabled: true,
        name: "X-Probe".into(),
        value: "preserve-me".into(),
        id: None,
    });
}

#[test]
fn truncation_after_complete_ids_cannot_erase_request_fields() {
    let fixture = Fixture::with_request("request.yaml", populate_request);
    let contents = fs::read_to_string(&fixture.request_path).unwrap();
    let mut prefix = String::new();
    for line in contents.lines() {
        prefix.push_str(line);
        prefix.push('\n');
        if line.starts_with("workspaceId:") {
            break;
        }
    }
    let (parsed, _) =
        SyncModel::from_bytes(prefix.as_bytes().to_vec(), &fixture.request_path).unwrap().unwrap();
    assert_eq!(parsed.id(), fixture.request.id);
    assert_eq!(parsed.workspace_id(), fixture.workspace_id);
    fs::write(&fixture.request_path, prefix).unwrap();
    fixture.assert_invalid_file();
}

#[test]
fn omitted_populated_fields_abort_sync_for_yaml_and_json() {
    for filename in ["request.yaml", "request.json"] {
        for field in [
            "authentication",
            "authenticationType",
            "body",
            "bodyType",
            "headers",
            "name",
            "url",
            "method",
        ] {
            let fixture = Fixture::with_request(filename, populate_request);
            fixture.edit(|value| {
                value.as_object_mut().unwrap().remove(field);
            });
            fixture.assert_invalid_file();
        }
    }
}

#[test]
fn explicit_empty_fields_can_still_clear_request_data() {
    for filename in ["request.yaml", "request.json"] {
        let fixture = Fixture::with_request(filename, populate_request);
        fixture.edit(|value| {
            value["authentication"] = serde_json::json!({});
            value["authenticationType"] = serde_json::Value::Null;
            value["body"] = serde_json::json!({});
            value["bodyType"] = serde_json::Value::Null;
            value["headers"] = serde_json::json!([]);
        });
        let ops = fixture.calculate().unwrap();
        assert!(matches!(ops.as_slice(), [SyncOp::DbUpdate { .. }]));
        fixture.apply(ops);
        let request = fixture.db_request();
        assert!(request.authentication.is_empty());
        assert!(request.authentication_type.is_none());
        assert!(request.body.is_empty());
        assert!(request.body_type.is_none());
        assert!(request.headers.is_empty());
    }
}

#[test]
fn omitted_nested_header_fields_cannot_default_away_data() {
    let fixture = Fixture::with_request("request.yaml", populate_request);
    fixture.edit(|value| {
        value["headers"][0].as_object_mut().unwrap().remove("value");
    });
    fixture.assert_invalid_file();
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
fn unchanged_legacy_file_does_not_block_outbound_db_edits() {
    let fixture = Fixture::new("request.yaml");
    fixture.edit(|value| {
        value.as_object_mut().unwrap().remove("bodyType");
    });
    fixture.apply(fixture.calculate().unwrap());
    let mut request = fixture.db_request();
    request.body_type = Some("raw".into());
    request.updated_at = chrono::Utc::now().naive_utc() + chrono::Duration::seconds(1);
    fixture
        .db
        .with_tx::<_, yaak_models::error::Error>(|tx| {
            tx.upsert_http_request(&request, &UpdateSource::Background).map(|_| ())
        })
        .unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(matches!(ops.as_slice(), [SyncOp::FsUpdate { .. }]));
    fixture.apply(ops);
    let (model, _) = SyncModel::from_file(&fixture.request_path).unwrap().unwrap();
    assert!(
        matches!(model, SyncModel::HttpRequest(request) if request.body_type.as_deref() == Some("raw"))
    );
}

#[test]
fn valid_edits_and_legacy_defaults_are_still_imported() {
    for filename in ["request.yaml", "request.json"] {
        for legacy in [false, true] {
            let fixture = Fixture::new(filename);
            fixture.edit(|value| {
                if legacy {
                    value.as_object_mut().unwrap().remove("settingHttpVersion");
                }
                value["name"] = "Updated on disk".into();
            });
            let ops = fixture.calculate().unwrap();
            assert!(
                matches!(ops.as_slice(), [SyncOp::DbUpdate { fs, .. }] if fs.model.id() == fixture.request.id)
            );
            fixture.apply(ops);
            assert_eq!(fixture.db_request().name, "Updated on disk");
            assert!(fixture.calculate().unwrap().is_empty());
        }
    }
}

#[cfg(any(target_os = "macos", windows))]
fn set_read_denial(path: &std::path::Path, deny: bool) {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/bin/chmod");
        let args: &[&str] = if deny { &["+a", "everyone deny read"] } else { &["-N"] };
        command.args(args).arg(path);
        command
    };
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("icacls");
        let args = if deny { ["/deny", "*S-1-1-0:(RD)"] } else { ["/remove:d", "*S-1-1-0"] };
        command.arg(path).args(args);
        command
    };
    let output = command.output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn atomic_replacement_preserves_read_denial_acl() {
    let fixture = Fixture::new("request.yaml");
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&fixture.request_path, fs::Permissions::from_mode(0o644)).unwrap();
    }
    set_read_denial(&fixture.request_path, true);
    assert_eq!(
        fs::read(&fixture.request_path).unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    fixture.publish("Complete replacement", false);
    assert_eq!(
        fs::read(&fixture.request_path).unwrap_err().kind(),
        std::io::ErrorKind::PermissionDenied
    );
    #[cfg(target_os = "macos")]
    {
        use std::{os::unix::fs::PermissionsExt, process::Command};
        let listing =
            Command::new("/bin/ls").arg("-le").arg(&fixture.request_path).output().unwrap();
        assert!(String::from_utf8_lossy(&listing.stdout).contains("everyone deny read"));
        assert_eq!(
            fs::metadata(&fixture.request_path).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }
    // Remove only the fixture ACL to verify that the complete new content was published.
    set_read_denial(&fixture.request_path, false);
    let (model, _) = SyncModel::from_file(&fixture.request_path).unwrap().unwrap();
    assert!(
        matches!(model, SyncModel::HttpRequest(request) if request.name == "Complete replacement")
    );
}

#[cfg(target_os = "linux")]
#[test]
fn atomic_replacement_preserves_posix_acl_bytes() {
    use std::os::fd::AsRawFd;
    // Linux's ACL xattr: version followed by little-endian tag/permissions/ID entries.
    let mut acl = 2u32.to_le_bytes().to_vec();
    for (tag, permissions, id) in [
        (1u16, 6u16, u32::MAX),
        (2, 0, 65534),
        (4, 4, u32::MAX),
        (16, 4, u32::MAX),
        (32, 0, u32::MAX),
    ] {
        acl.extend_from_slice(&tag.to_le_bytes());
        acl.extend_from_slice(&permissions.to_le_bytes());
        acl.extend_from_slice(&id.to_le_bytes());
    }
    let fixture = Fixture::new("request.yaml");
    let file = fs::OpenOptions::new().write(true).open(&fixture.request_path).unwrap();
    // SAFETY: the descriptor, attribute name and buffer are valid and live.
    let result = unsafe {
        libc::fsetxattr(
            file.as_raw_fd(),
            c"system.posix_acl_access".as_ptr(),
            acl.as_ptr().cast(),
            acl.len(),
            0,
        )
    };
    if result != 0 {
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(libc::ENOTSUP) {
            return;
        }
        panic!("setting fixture ACL failed: {error}");
    }
    fixture.publish("Complete replacement", false);
    let file = fs::File::open(&fixture.request_path).unwrap();
    let mut copied = vec![0u8; acl.len()];
    // SAFETY: the descriptor, attribute name and writable buffer are valid.
    let length = unsafe {
        libc::fgetxattr(
            file.as_raw_fd(),
            c"system.posix_acl_access".as_ptr(),
            copied.as_mut_ptr().cast(),
            copied.len(),
        )
    };
    assert_eq!(length, acl.len() as isize);
    assert_eq!(copied, acl);
}

#[test]
fn invalid_tracked_files_abort_without_changing_data() {
    for (filename, contents) in [
        ("request.yaml", b"model: http_request\nid: [broken\n".as_slice()),
        ("request.json", b"{\"model\":\"http_request\",\"id\":".as_slice()),
        ("custom-request.yml", b"".as_slice()),
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
fn valid_yaml_with_incomplete_identity_aborts_sync() {
    for id in ["rq_sync_te", "rq_sync_test"] {
        let fixture = Fixture::new("request.yaml");
        let contents = format!("type: http_request\nmodel: http_request\nid: {id}");
        let (model, _) = SyncModel::from_bytes(contents.as_bytes().to_vec(), &fixture.request_path)
            .unwrap()
            .unwrap();
        assert_eq!(model.id(), id);
        assert_eq!(model.workspace_id(), "");
        fs::write(&fixture.request_path, contents).unwrap();
        fixture.assert_invalid_file();
    }
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
fn invalid_file_for_a_deleted_model_does_not_block_state_cleanup() {
    let fixture = Fixture::new("request.yaml");
    fixture
        .db
        .with_tx::<_, yaak_models::error::Error>(|tx| {
            tx.delete_http_request(&fixture.request, &UpdateSource::Background)
        })
        .unwrap();
    fs::write(&fixture.request_path, "model: http_request\nid: [broken\n").unwrap();
    let ops = fixture.calculate().unwrap();
    assert!(
        matches!(ops.as_slice(), [SyncOp::FsDelete { state, fs: None }] if state.model_id == fixture.request.id)
    );
    fixture.apply(ops);
    let states = fixture.states();
    assert!(states.iter().all(|state| state.model_id != fixture.request.id));
    assert!(fixture.calculate().unwrap().is_empty());
}

#[test]
fn tracked_path_replaced_by_a_directory_aborts_sync() {
    let fixture = Fixture::new("request.yaml");
    fs::remove_file(&fixture.request_path).unwrap();
    fs::create_dir(&fixture.request_path).unwrap();
    fixture.assert_invalid_file();
}

#[cfg(unix)]
#[test]
fn unreadable_tracked_symlink_aborts_sync() {
    let fixture = Fixture::new("request.yaml");
    fs::remove_file(&fixture.request_path).unwrap();
    std::os::unix::fs::symlink(fixture.dir.path().join("missing"), &fixture.request_path).unwrap();
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
fn fs_create_and_update_do_not_modify_an_already_open_reader() {
    for create in [true, false] {
        let fixture = Fixture::new("yaak.rq_sync_test.yaml");
        let old_contents = fs::read(&fixture.request_path).unwrap();
        let mut reader = fs::File::open(&fixture.request_path).unwrap();
        let new_contents = fixture.publish("Complete replacement", create);
        let mut observed = Vec::new();
        reader.read_to_end(&mut observed).unwrap();
        assert_eq!(observed, old_contents, "open reader was modified (create={create})");
        assert_eq!(fs::read(&fixture.request_path).unwrap(), new_contents);
    }
}
