use assert_cmd::cargo::cargo_bin_cmd;
use assert_cmd::Command;
use predicates::str::contains;
use std::path::Path;
use tempfile::TempDir;
use yaak_models::models::{HttpRequest, Workspace};
use yaak_models::util::UpdateSource;

fn cli_cmd(data_dir: &Path) -> Command {
    let mut cmd = cargo_bin_cmd!("yaakcli");
    cmd.arg("--data-dir").arg(data_dir);
    cmd
}

fn seed_workspace(data_dir: &Path, workspace_id: &str) {
    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");

    let workspace = Workspace {
        id: workspace_id.to_string(),
        name: "Test Workspace".to_string(),
        description: "Integration test workspace".to_string(),
        ..Default::default()
    };

    query_manager
        .connect()
        .upsert_workspace(&workspace, &UpdateSource::Sync)
        .expect("Failed to seed workspace");
}

fn seed_request(data_dir: &Path, workspace_id: &str, request_id: &str) {
    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");

    let request = HttpRequest {
        id: request_id.to_string(),
        workspace_id: workspace_id.to_string(),
        name: "Seeded Request".to_string(),
        method: "GET".to_string(),
        url: "https://example.com".to_string(),
        ..Default::default()
    };

    query_manager
        .connect()
        .upsert_http_request(&request, &UpdateSource::Sync)
        .expect("Failed to seed request");
}

#[test]
fn request_show_and_delete_yes_round_trip() {
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

    let create_stdout = String::from_utf8_lossy(&create_assert.get_output().stdout).to_string();
    let request_id = create_stdout
        .trim()
        .split_once(": ")
        .map(|(_, id)| id.to_string())
        .expect("Expected request id in create output");

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

    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");
    assert!(query_manager.connect().get_http_request(&request_id).is_err());
}

#[test]
fn request_delete_without_yes_fails_in_non_interactive_mode() {
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

    let db_path = data_dir.join("db.sqlite");
    let blob_path = data_dir.join("blobs.sqlite");
    let (query_manager, _blob_manager, _rx) =
        yaak_models::init_standalone(&db_path, &blob_path).expect("Failed to initialize DB");
    assert!(query_manager.connect().get_http_request("rq_seed_delete_noninteractive").is_ok());
}
