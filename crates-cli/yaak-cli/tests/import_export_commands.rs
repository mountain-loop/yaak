mod common;

use common::{cli_cmd, parse_created_id, query_manager, seed_request};
use predicates::str::contains;
use serde_json::Value;
use tempfile::TempDir;

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
    assert_eq!(
        db.get_workspace("wrk_import").expect("workspace imported").name,
        "Imported Workspace"
    );
    assert_eq!(
        db.get_http_request("req_import").expect("request imported").url,
        "https://example.com"
    );
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
    let environments =
        db.list_environments_ensure_base(&workspace_id).expect("list imported environments");

    let imported_environment =
        environments.iter().find(|e| e.name == "Local").expect("postman environment imported");
    assert_eq!(imported_environment.workspace_id, workspace_id);
}
