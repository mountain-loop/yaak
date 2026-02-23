mod common;

use common::{cli_cmd, parse_created_id, query_manager, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;

#[test]
fn create_list_show_delete_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert = cli_cmd(data_dir)
        .args(["folder", "create", "wk_test", "--name", "Auth"])
        .assert()
        .success();
    let folder_id = parse_created_id(&create_assert.get_output().stdout, "folder create");

    cli_cmd(data_dir)
        .args(["folder", "list", "wk_test"])
        .assert()
        .success()
        .stdout(contains(&folder_id))
        .stdout(contains("Auth"));

    cli_cmd(data_dir)
        .args(["folder", "show", &folder_id])
        .assert()
        .success()
        .stdout(contains(format!("\"id\": \"{folder_id}\"")))
        .stdout(contains("\"workspaceId\": \"wk_test\""));

    cli_cmd(data_dir)
        .args(["folder", "delete", &folder_id, "--yes"])
        .assert()
        .success()
        .stdout(contains(format!("Deleted folder: {folder_id}")));

    assert!(query_manager(data_dir).connect().get_folder(&folder_id).is_err());
}

#[test]
fn json_create_and_update_merge_patch_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert = cli_cmd(data_dir)
        .args([
            "folder",
            "create",
            r#"{"workspaceId":"wk_test","name":"Json Folder"}"#,
        ])
        .assert()
        .success();
    let folder_id = parse_created_id(&create_assert.get_output().stdout, "folder create");

    cli_cmd(data_dir)
        .args([
            "folder",
            "update",
            &format!(r#"{{"id":"{}","description":"Folder Description"}}"#, folder_id),
        ])
        .assert()
        .success()
        .stdout(contains(format!("Updated folder: {folder_id}")));

    cli_cmd(data_dir)
        .args(["folder", "show", &folder_id])
        .assert()
        .success()
        .stdout(contains("\"name\": \"Json Folder\""))
        .stdout(contains("\"description\": \"Folder Description\""));
}

#[test]
fn create_merges_positional_workspace_id_into_json_payload() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert = cli_cmd(data_dir)
        .args([
            "folder",
            "create",
            "wk_test",
            "--json",
            r#"{"name":"Merged Folder"}"#,
        ])
        .assert()
        .success();
    let folder_id = parse_created_id(&create_assert.get_output().stdout, "folder create");

    cli_cmd(data_dir)
        .args(["folder", "show", &folder_id])
        .assert()
        .success()
        .stdout(contains("\"workspaceId\": \"wk_test\""))
        .stdout(contains("\"name\": \"Merged Folder\""));
}

#[test]
fn create_rejects_conflicting_workspace_ids_between_arg_and_json() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    seed_workspace(data_dir, "wk_other");

    cli_cmd(data_dir)
        .args([
            "folder",
            "create",
            "wk_test",
            "--json",
            r#"{"workspaceId":"wk_other","name":"Mismatch"}"#,
        ])
        .assert()
        .failure()
        .stderr(contains(
            "folder create got conflicting workspace_id values between positional arg and JSON payload",
        ));
}
