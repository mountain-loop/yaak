mod common;

use common::{cli_cmd, parse_created_id, query_manager, seed_folder, seed_request, seed_workspace};
use predicates::str::contains;
use serde_json::Value;
use tempfile::TempDir;
use yaak_models::util::UpdateSource;

#[test]
fn export_writes_yaak_workspace_file() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("export.json");

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "Export Me"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");
    seed_request(data_dir, &workspace_id, "req_export");

    cli_cmd(data_dir)
        .args([
            "export",
            export_path.to_str().expect("export path is utf-8"),
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Exported 1 workspace(s)"));

    let exported: Value = serde_json::from_str(
        &std::fs::read_to_string(export_path).expect("export file should exist"),
    )
    .expect("export should be JSON");

    assert_eq!(exported["yaakSchema"], 4);
    assert_eq!(exported["resources"]["workspaces"][0]["id"], workspace_id);
    assert_eq!(exported["resources"]["httpRequests"][0]["id"], "req_export");
}

#[test]
fn import_reads_yaak_workspace_file() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("import.json");

    std::fs::write(
        &import_path,
        r#"{
  "yaakVersion": "test",
  "yaakSchema": 4,
  "resources": {
    "workspaces": [
      {
        "model": "workspace",
        "id": "wrk_import",
        "name": "Imported Workspace"
      }
    ],
    "httpRequests": [
      {
        "model": "http_request",
        "id": "req_import",
        "workspaceId": "wrk_import",
        "name": "Imported Request",
        "method": "GET",
        "url": "https://example.com"
      }
    ]
  }
}"#,
    )
    .expect("write import fixture");

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 workspace, 1 HTTP request"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let workspaces = db.list_workspaces().expect("list imported workspaces");
    let workspace = workspaces
        .iter()
        .find(|workspace| workspace.name == "Imported Workspace")
        .expect("workspace imported");
    assert_ne!(workspace.id, "wrk_import");

    let requests = db.list_http_requests(&workspace.id).expect("list imported requests");
    let request = requests
        .iter()
        .find(|request| request.name == "Imported Request")
        .expect("request imported");
    assert_ne!(request.id, "req_import");
    assert_eq!(request.workspace_id, workspace.id);
    assert_eq!(request.url, "https://example.com");
}

fn write_postman_environment_fixture(path: &std::path::Path) {
    std::fs::write(
        path,
        r#"{
  "name": "Local",
  "_postman_variable_scope": "environment",
  "values": [
    {
      "key": "token",
      "value": "abc123",
      "enabled": true
    }
  ]
}"#,
    )
    .expect("write postman environment fixture");
}

#[test]
fn import_postman_environment_requires_workspace_id() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("postman-env.json");

    cli_cmd(data_dir).args(["workspace", "create", "--name", "Env Target"]).assert().success();
    write_postman_environment_fixture(&import_path);

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .failure()
        .stderr(contains("requires a workspace context"))
        .stderr(contains("--workspace-id"));
}

#[test]
fn import_postman_environment_uses_workspace_id() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("postman-env.json");

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "Env Target"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");
    write_postman_environment_fixture(&import_path);

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 environment"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let environments = db.list_environments(&workspace_id).expect("list imported environments");

    let imported_environment =
        environments.iter().find(|e| e.name == "Local").expect("postman environment imported");
    assert_eq!(imported_environment.workspace_id, workspace_id);
}

fn write_linked_fixture(path: &std::path::Path, requests: &[(&str, &str, &str)]) {
    let requests = requests
        .iter()
        .map(|(id, name, url)| {
            format!(
                r#"{{ "model": "http_request", "id": "{id}", "workspaceId": "wrk_link",
                     "name": "{name}", "method": "GET", "url": "{url}" }}"#
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    std::fs::write(
        path,
        format!(
            r#"{{
  "yaakVersion": "test",
  "yaakSchema": 4,
  "resources": {{
    "workspaces": [{{ "model": "workspace", "id": "wrk_link", "name": "Linked Workspace" }}],
    "httpRequests": [{requests}]
  }}
}}"#
        ),
    )
    .expect("write linked fixture");
}

#[test]
fn re_import_merges_into_linked_workspace() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("linked.json");

    write_linked_fixture(
        &import_path,
        &[
            ("req_a", "Request A", "https://example.com/a"),
            ("req_b", "Request B", "https://example.com/b"),
        ],
    );
    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 workspace, 2 HTTP requests"));

    let workspace_id = {
        let query_manager = query_manager(data_dir);
        let db = query_manager.connect();
        db.list_workspaces()
            .expect("list workspaces")
            .into_iter()
            .find(|w| w.name == "Linked Workspace")
            .expect("workspace imported")
            .id
    };

    // The source doc changes A, drops B, and adds C. The default selection applies the
    // update and the create but leaves the removal as an offer.
    write_linked_fixture(
        &import_path,
        &[
            ("req_a", "Request A", "https://example.com/a-v2"),
            ("req_c", "Request C", "https://example.com/c"),
        ],
    );
    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Imported 2 HTTP requests"))
        .stdout(contains("Skipped 1 removed from source"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let requests = db.list_http_requests(&workspace_id).expect("list requests");
    assert_eq!(requests.len(), 3, "merge must not duplicate: {requests:?}");
    assert_eq!(
        requests.iter().find(|r| r.name == "Request A").expect("request A").url,
        "https://example.com/a-v2"
    );
    assert!(requests.iter().any(|r| r.name == "Request B"), "removal must not auto-apply");
    assert!(requests.iter().any(|r| r.name == "Request C"));
}

#[test]
fn re_import_leaves_deleted_resources_alone() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("linked.json");

    write_linked_fixture(
        &import_path,
        &[
            ("req_a", "Request A", "https://example.com/a"),
            ("req_b", "Request B", "https://example.com/b"),
        ],
    );
    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
        ])
        .assert()
        .success();

    let workspace_id = {
        let query_manager = query_manager(data_dir);
        let db = query_manager.connect();
        let workspace_id = db
            .list_workspaces()
            .expect("list workspaces")
            .into_iter()
            .find(|w| w.name == "Linked Workspace")
            .expect("workspace imported")
            .id;
        let request_b = db
            .list_http_requests(&workspace_id)
            .expect("list requests")
            .into_iter()
            .find(|r| r.name == "Request B")
            .expect("request B imported");
        drop(db);
        query_manager
            .with_tx(|tx| tx.delete_http_request_by_id(&request_b.id, &UpdateSource::Sync))
            .expect("delete request B");
        workspace_id
    };

    cli_cmd(data_dir)
        .args([
            "import",
            import_path.to_str().expect("import path is utf-8"),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Skipped 1 ignored"));

    let query_manager = query_manager(data_dir);
    let requests =
        query_manager.connect().list_http_requests(&workspace_id).expect("list requests");
    assert_eq!(requests.len(), 1, "a deleted request must not come back: {requests:?}");
    assert_eq!(requests[0].name, "Request A");
}

fn path_str(path: &std::path::Path) -> &str {
    path.to_str().expect("path is utf-8")
}

fn created_id(data_dir: &std::path::Path, args: &[&str]) -> String {
    let assert = cli_cmd(data_dir).args(args).assert().success();
    parse_created_id(&assert.get_output().stdout, &args.join(" "))
}

/// A workspace made the way the skill describes: base and Staging environments and a request.
/// Returns the workspace, base environment, Staging environment, and request IDs.
fn cli_made_workspace(data_dir: &std::path::Path) -> (String, String, String, String) {
    let workspace_id = created_id(data_dir, &["workspace", "create", "--name", "CI WS"]);
    let list = cli_cmd(data_dir).args(["environment", "list", &workspace_id]).assert().success();
    let base_id = String::from_utf8_lossy(&list.get_output().stdout)
        .lines()
        .find(|l| l.ends_with("(workspace)"))
        .and_then(|l| l.split_whitespace().next())
        .expect("base environment listed")
        .to_string();
    let staging_id =
        created_id(data_dir, &["environment", "create", &workspace_id, "--name", "Staging"]);
    let request_id = created_id(
        data_dir,
        &[
            "request",
            "create",
            &workspace_id,
            "--name",
            "Health",
            "--url",
            "https://example.com",
        ],
    );
    (workspace_id, base_id, staging_id, request_id)
}

fn read_json(path: &std::path::Path) -> Value {
    serde_json::from_str(&std::fs::read_to_string(path).expect("read file")).expect("JSON")
}

/// QA sweep bug 2: `yaak import req_in_existing_folder.json --workspace-id <W>` put requests
/// that name an existing folder of W at the workspace root.
#[test]
fn import_keeps_a_folder_id_that_names_an_existing_folder() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let import_path = temp_dir.path().join("req_in_existing_folder.json");
    seed_workspace(data_dir, "wk_target");
    seed_folder(data_dir, "wk_target", "fl_existing");

    std::fs::write(
        &import_path,
        r#"{"yaakVersion":"test","yaakSchema":4,"resources":{"workspaces":[],"environments":[],"folders":[],
"httpRequests":[{"model":"http_request","id":"rq_newinfold1","workspaceId":"wk_target","folderId":"fl_existing","name":"Into existing","method":"GET","url":"http://127.0.0.1/x"}],
"grpcRequests":[{"model":"grpc_request","id":"gr_newinfold1","workspaceId":"wk_target","folderId":"fl_existing","name":"gRPC into existing","url":"127.0.0.1:50051"}],
"websocketRequests":[]}}"#,
    )
    .expect("write fixture");

    cli_cmd(data_dir)
        .args([
            "import",
            path_str(&import_path),
            "--workspace-id",
            "wk_target",
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 HTTP request, 1 gRPC request"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let http = db.list_http_requests("wk_target").expect("list HTTP");
    let grpc = db.list_grpc_requests("wk_target").expect("list gRPC");
    assert_eq!(http[0].folder_id.as_deref(), Some("fl_existing"), "{http:?}");
    assert_eq!(grpc[0].folder_id.as_deref(), Some("fl_existing"), "{grpc:?}");
}

/// QA sweep bug 3: `yaak export e.json <W>`, edit the file, `yaak import e.json --workspace-id
/// <W>` made copies with new IDs, a second base environment, and "(Imported)" environments.
#[test]
fn re_importing_an_edited_export_updates_the_workspace_in_place() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("exp.json");
    let (workspace_id, base_id, staging_id, request_id) = cli_made_workspace(data_dir);

    cli_cmd(data_dir)
        .args([
            "export",
            path_str(&export_path),
            &workspace_id,
            "--include-private",
        ])
        .assert()
        .success();
    let mut exported = read_json(&export_path);
    exported["resources"]["httpRequests"][0]["name"] = "Health (edited)".into();
    std::fs::write(&export_path, exported.to_string()).expect("write edited export");

    cli_cmd(data_dir)
        .args([
            "import",
            path_str(&export_path),
            "--workspace-id",
            &workspace_id,
        ])
        .assert()
        .success()
        .stdout(contains("Imported 1 HTTP request"));

    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    let requests = db.list_http_requests(&workspace_id).expect("list requests");
    assert_eq!(requests.len(), 1, "no copies: {requests:?}");
    assert_eq!(requests[0].id, request_id);
    assert_eq!(requests[0].name, "Health (edited)");

    let mut environment_ids =
        db.list_environments(&workspace_id).expect("list environments").into_iter().map(|e| e.id);
    let mut expected = vec![base_id.clone(), staging_id];
    expected.sort();
    let mut actual = environment_ids.by_ref().collect::<Vec<_>>();
    actual.sort();
    assert_eq!(actual, expected, "no second base environment and no Imported copies");
    assert_eq!(db.get_base_environment(&workspace_id).expect("base").id, base_id);
}

/// QA sweep bug 7: the skill's CI recipe, `yaak export` then `yaak import` into a fresh
/// `--data-dir`, gave every model a new ID, so the IDs in the recipe no longer worked.
#[test]
fn import_into_a_fresh_data_dir_keeps_the_ids() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path().join("dev");
    let ci_dir = temp_dir.path().join("ci");
    let export_path = temp_dir.path().join("ci-export.json");
    let (workspace_id, base_id, staging_id, request_id) = cli_made_workspace(&data_dir);

    cli_cmd(&data_dir)
        .args([
            "export",
            path_str(&export_path),
            &workspace_id,
            "--include-private",
        ])
        .assert()
        .success();
    cli_cmd(&ci_dir).args(["import", path_str(&export_path)]).assert().success();

    let query_manager = query_manager(&ci_dir);
    let db = query_manager.connect();
    assert_eq!(db.get_workspace(&workspace_id).expect("workspace keeps its ID").name, "CI WS");
    assert_eq!(db.get_http_request(&request_id).expect("request keeps its ID").name, "Health");
    assert_eq!(db.get_base_environment(&workspace_id).expect("base").id, base_id);
    assert_eq!(db.get_environment(&staging_id).expect("Staging keeps its ID").name, "Staging");
}

/// QA sweep bug 8: there was no `--include-private`, so the environments the CLI makes, which
/// are private like the app's, could not be exported without the long flag.
#[test]
fn export_includes_cli_made_environments_only_with_include_private() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("export.json");
    let (workspace_id, base_id, staging_id, _) = cli_made_workspace(data_dir);

    let exported_ids = |args: &[&str]| {
        cli_cmd(data_dir).args(["export", path_str(&export_path)]).args(args).assert().success();
        let mut ids = read_json(&export_path)["resources"]["environments"]
            .as_array()
            .expect("environments")
            .iter()
            .map(|e| e["id"].as_str().expect("id").to_string())
            .collect::<Vec<_>>();
        ids.sort();
        ids
    };

    assert!(exported_ids(&[&workspace_id]).is_empty(), "CLI-made environments are private");

    let mut all = vec![base_id, staging_id];
    all.sort();
    assert_eq!(exported_ids(&[&workspace_id, "--include-private"]), all);
    assert_eq!(exported_ids(&[&workspace_id, "--include-private-environments"]), all);
}

/// QA sweep bug 15: the planner's warnings, such as IDs taken by another workspace, were
/// computed and then never printed.
#[test]
fn import_prints_the_plan_warnings_after_the_counts() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("e9.json");
    let (workspace_id, ..) = cli_made_workspace(data_dir);
    let other_id = created_id(data_dir, &["workspace", "create", "--name", "Other WS"]);
    cli_cmd(data_dir)
        .args([
            "export",
            path_str(&export_path),
            &workspace_id,
            "--include-private",
        ])
        .assert()
        .success();

    cli_cmd(data_dir)
        .args(["import", path_str(&export_path), "--workspace-id", &other_id])
        .assert()
        .success()
        .stdout(contains("Imported 2 environments, 1 HTTP request"))
        .stderr(contains(
            "Warning: New IDs assigned: 3 resources already exist in CI WS, so the imported copies get new IDs",
        ))
        .stderr(contains("Warning: Base environment kept separate:"));

    cli_cmd(data_dir)
        .args(["import", path_str(&export_path)])
        .assert()
        .success()
        .stderr(contains("Warning: New IDs assigned: 4 resources already exist in CI WS"));
}

/// QA sweep bug 16: `yaak import e_two.json --workspace-id <W>` merged both workspaces of the
/// file into W.
#[test]
fn import_with_workspace_id_refuses_a_file_with_several_workspaces() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    let export_path = temp_dir.path().join("e_two.json");
    let first = created_id(data_dir, &["workspace", "create", "--name", "First"]);
    let second = created_id(data_dir, &["workspace", "create", "--name", "Second"]);
    seed_request(data_dir, &first, "rq_first");
    cli_cmd(data_dir).args(["export", path_str(&export_path), &first, &second]).assert().success();
    let target = created_id(data_dir, &["workspace", "create", "--name", "Target"]);

    cli_cmd(data_dir)
        .args(["import", path_str(&export_path), "--workspace-id", &target])
        .assert()
        .failure()
        .stderr(contains("contains 2 workspaces"))
        .stderr(contains("without --workspace-id to import each as its own workspace"));
    let query_manager = query_manager(data_dir);
    assert!(query_manager.connect().list_http_requests(&target).expect("list").is_empty());
}
