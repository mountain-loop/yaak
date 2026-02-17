mod common;

use common::{cli_cmd, parse_created_id, query_manager, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;

#[test]
fn create_list_show_delete_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    cli_cmd(data_dir)
        .args(["environment", "list", "wk_test"])
        .assert()
        .success()
        .stdout(contains("Global Variables"));

    let create_assert = cli_cmd(data_dir)
        .args(["environment", "create", "wk_test", "--name", "Production"])
        .assert()
        .success();
    let environment_id = parse_created_id(&create_assert.get_output().stdout, "environment create");

    cli_cmd(data_dir)
        .args(["environment", "list", "wk_test"])
        .assert()
        .success()
        .stdout(contains(&environment_id))
        .stdout(contains("Production"));

    cli_cmd(data_dir)
        .args(["environment", "show", &environment_id])
        .assert()
        .success()
        .stdout(contains(format!("\"id\": \"{environment_id}\"")))
        .stdout(contains("\"parentModel\": \"environment\""));

    cli_cmd(data_dir)
        .args(["environment", "delete", &environment_id, "--yes"])
        .assert()
        .success()
        .stdout(contains(format!("Deleted environment: {environment_id}")));

    assert!(query_manager(data_dir).connect().get_environment(&environment_id).is_err());
}

#[test]
fn json_create_and_update_merge_patch_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert = cli_cmd(data_dir)
        .args([
            "environment",
            "create",
            r#"{"workspaceId":"wk_test","name":"Json Environment"}"#,
        ])
        .assert()
        .success();
    let environment_id = parse_created_id(&create_assert.get_output().stdout, "environment create");

    cli_cmd(data_dir)
        .args([
            "environment",
            "update",
            &format!(r##"{{"id":"{}","color":"#00ff00"}}"##, environment_id),
        ])
        .assert()
        .success()
        .stdout(contains(format!("Updated environment: {environment_id}")));

    cli_cmd(data_dir)
        .args(["environment", "show", &environment_id])
        .assert()
        .success()
        .stdout(contains("\"name\": \"Json Environment\""))
        .stdout(contains("\"color\": \"#00ff00\""));
}
