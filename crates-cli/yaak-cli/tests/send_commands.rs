mod common;

use common::http_server::TestHttpServer;
use common::{cli_cmd, query_manager, seed_folder, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;
use yaak_models::models::HttpRequest;
use yaak_models::util::UpdateSource;

#[test]
fn top_level_send_workspace_sends_http_requests_and_prints_summary() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let server = TestHttpServer::spawn_ok("workspace bulk send");
    let request = HttpRequest {
        id: "rq_workspace_send".to_string(),
        workspace_id: "wk_test".to_string(),
        name: "Workspace Send".to_string(),
        method: "GET".to_string(),
        url: server.url.clone(),
        ..Default::default()
    };
    query_manager(data_dir)
        .connect()
        .upsert_http_request(&request, &UpdateSource::Sync)
        .expect("Failed to seed workspace request");

    cli_cmd(data_dir)
        .args(["send", "wk_test"])
        .assert()
        .success()
        .stdout(contains("workspace bulk send"))
        .stdout(contains("Send summary: 1 succeeded, 0 failed"));
}

#[test]
fn top_level_send_folder_sends_http_requests_and_prints_summary() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    seed_folder(data_dir, "wk_test", "fl_test");

    let server = TestHttpServer::spawn_ok("folder bulk send");
    let request = HttpRequest {
        id: "rq_folder_send".to_string(),
        workspace_id: "wk_test".to_string(),
        folder_id: Some("fl_test".to_string()),
        name: "Folder Send".to_string(),
        method: "GET".to_string(),
        url: server.url.clone(),
        ..Default::default()
    };
    query_manager(data_dir)
        .connect()
        .upsert_http_request(&request, &UpdateSource::Sync)
        .expect("Failed to seed folder request");

    cli_cmd(data_dir)
        .args(["send", "fl_test"])
        .assert()
        .success()
        .stdout(contains("folder bulk send"))
        .stdout(contains("Send summary: 1 succeeded, 0 failed"));
}

#[test]
fn top_level_send_unknown_id_fails_with_clear_error() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();

    cli_cmd(data_dir)
        .args(["send", "does_not_exist"])
        .assert()
        .failure()
        .code(1)
        .stderr(contains("Could not resolve ID 'does_not_exist' as request, folder, or workspace"));
}
