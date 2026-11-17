mod common;

use common::http_server::TestHttpServer;
use common::{cli_cmd, query_manager, seed_folder, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;
use yaak_models::models::{GrpcRequest, HttpRequest, WebsocketRequest};
use yaak_models::util::UpdateSource;

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
        .with_tx(|tx| tx.upsert_http_request(&request, &UpdateSource::Sync))
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

/// QA sweep bug 5: `yaak send <folder>` with a gRPC and a WebSocket request in the folder
/// reported them as failures and exited 1, though every HTTP request succeeded.
#[test]
fn folder_send_skips_grpc_and_websocket_requests() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    seed_folder(data_dir, "wk_test", "fl_test");

    let server = TestHttpServer::spawn_ok("mixed folder");
    query_manager(data_dir)
        .with_tx(|tx| {
            let source = &UpdateSource::Sync;
            tx.upsert_http_request(
                &HttpRequest {
                    id: "rq_mixed".to_string(),
                    workspace_id: "wk_test".to_string(),
                    folder_id: Some("fl_test".to_string()),
                    name: "HTTP One".to_string(),
                    url: server.url.clone(),
                    ..Default::default()
                },
                source,
            )?;
            tx.upsert_grpc_request(
                &GrpcRequest {
                    id: "gr_mixed".to_string(),
                    workspace_id: "wk_test".to_string(),
                    folder_id: Some("fl_test".to_string()),
                    name: "Greeter".to_string(),
                    ..Default::default()
                },
                source,
            )?;
            tx.upsert_websocket_request(
                &WebsocketRequest {
                    id: "wr_mixed".to_string(),
                    workspace_id: "wk_test".to_string(),
                    folder_id: Some("fl_test".to_string()),
                    name: "Socket".to_string(),
                    ..Default::default()
                },
                source,
            )
        })
        .expect("Failed to seed folder requests");

    cli_cmd(data_dir)
        .args(["send", "fl_test"])
        .assert()
        .success()
        .stdout(contains("mixed folder"))
        .stdout(contains("Send summary: 1 succeeded, 0 failed, 2 skipped"))
        .stdout(contains("gr_mixed - gRPC Greeter"))
        .stdout(contains("wr_mixed - WebSocket Socket"));
}
