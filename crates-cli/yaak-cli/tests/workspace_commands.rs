mod common;

use common::{cli_cmd, parse_created_id, query_manager};
use predicates::str::contains;
use tempfile::TempDir;

#[test]
fn create_show_delete_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();

    let create_assert =
        cli_cmd(data_dir).args(["workspace", "create", "--name", "WS One"]).assert().success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");

    cli_cmd(data_dir)
        .args(["workspace", "show", &workspace_id])
        .assert()
        .success()
        .stdout(contains(format!("\"id\": \"{workspace_id}\"")))
        .stdout(contains("\"name\": \"WS One\""));

    cli_cmd(data_dir)
        .args(["workspace", "delete", &workspace_id, "--yes"])
        .assert()
        .success()
        .stdout(contains(format!("Deleted workspace: {workspace_id}")));

    assert!(query_manager(data_dir).connect().get_workspace(&workspace_id).is_err());
}

#[test]
fn json_create_and_update_merge_patch_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();

    let create_assert = cli_cmd(data_dir)
        .args(["workspace", "create", r#"{"name":"Json Workspace"}"#])
        .assert()
        .success();
    let workspace_id = parse_created_id(&create_assert.get_output().stdout, "workspace create");

    cli_cmd(data_dir)
        .args([
            "workspace",
            "update",
            &format!(r#"{{"id":"{}","description":"Updated via JSON"}}"#, workspace_id),
        ])
        .assert()
        .success()
        .stdout(contains(format!("Updated workspace: {workspace_id}")));

    cli_cmd(data_dir)
        .args(["workspace", "show", &workspace_id])
        .assert()
        .success()
        .stdout(contains("\"name\": \"Json Workspace\""))
        .stdout(contains("\"description\": \"Updated via JSON\""));
}
