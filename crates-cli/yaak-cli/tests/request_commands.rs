mod common;

use common::{cli_cmd, parse_created_id, query_manager, seed_request, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;

#[test]
fn show_and_delete_yes_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert = cli_cmd(data_dir)
        .args([
            "request",
            "create",
            "wk_test",
            "--name",
            "Smoke Test",
            "--url",
            "https://example.com",
        ])
        .assert()
        .success();

    let request_id = parse_created_id(&create_assert.get_output().stdout, "request create");

    cli_cmd(data_dir)
        .args(["request", "show", &request_id])
        .assert()
        .success()
        .stdout(contains(format!("\"id\": \"{request_id}\"")))
        .stdout(contains("\"workspaceId\": \"wk_test\""));

    cli_cmd(data_dir)
        .args(["request", "delete", &request_id, "--yes"])
        .assert()
        .success()
        .stdout(contains(format!("Deleted request: {request_id}")));

    assert!(query_manager(data_dir).connect().get_http_request(&request_id).is_err());
}

#[test]
fn delete_without_yes_fails_in_non_interactive_mode() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    seed_request(data_dir, "wk_test", "rq_seed_delete_noninteractive");

    cli_cmd(data_dir)
        .args(["request", "delete", "rq_seed_delete_noninteractive"])
        .assert()
        .failure()
        .code(1)
        .stderr(contains("Refusing to delete in non-interactive mode without --yes"));

    assert!(query_manager(data_dir)
        .connect()
        .get_http_request("rq_seed_delete_noninteractive")
        .is_ok());
}
