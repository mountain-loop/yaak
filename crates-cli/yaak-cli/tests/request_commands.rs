mod common;

use common::http_server::TestHttpServer;
use common::{cli_cmd, parse_created_id, query_manager, seed_request, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;
use yaak_models::models::HttpResponseState;

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

    assert!(
        query_manager(data_dir).connect().get_http_request("rq_seed_delete_noninteractive").is_ok()
    );
}

#[test]
fn json_create_and_update_merge_patch_round_trip() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert = cli_cmd(data_dir)
        .args([
            "request",
            "create",
            r#"{"workspaceId":"wk_test","name":"Json Request","url":"https://example.com"}"#,
        ])
        .assert()
        .success();
    let request_id = parse_created_id(&create_assert.get_output().stdout, "request create");

    cli_cmd(data_dir)
        .args([
            "request",
            "update",
            &format!(r#"{{"id":"{}","name":"Renamed Request"}}"#, request_id),
        ])
        .assert()
        .success()
        .stdout(contains(format!("Updated request: {request_id}")));

    cli_cmd(data_dir)
        .args(["request", "show", &request_id])
        .assert()
        .success()
        .stdout(contains("\"name\": \"Renamed Request\""))
        .stdout(contains("\"url\": \"https://example.com\""));
}

#[test]
fn update_requires_id_in_json_payload() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();

    cli_cmd(data_dir)
        .args(["request", "update", r#"{"name":"No ID"}"#])
        .assert()
        .failure()
        .stderr(contains("request update requires a non-empty \"id\" field"));
}

#[test]
fn create_allows_workspace_only_with_empty_defaults() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let create_assert =
        cli_cmd(data_dir).args(["request", "create", "wk_test"]).assert().success();
    let request_id = parse_created_id(&create_assert.get_output().stdout, "request create");

    let request = query_manager(data_dir)
        .connect()
        .get_http_request(&request_id)
        .expect("Failed to load created request");
    assert_eq!(request.workspace_id, "wk_test");
    assert_eq!(request.method, "GET");
    assert_eq!(request.name, "");
    assert_eq!(request.url, "");
}

#[test]
fn request_send_persists_response_body_and_events() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");

    let server = TestHttpServer::spawn_ok("hello from integration test");

    let create_assert = cli_cmd(data_dir)
        .args([
            "request",
            "create",
            "wk_test",
            "--name",
            "Send Test",
            "--url",
            &server.url,
        ])
        .assert()
        .success();
    let request_id = parse_created_id(&create_assert.get_output().stdout, "request create");

    cli_cmd(data_dir)
        .args(["request", "send", &request_id])
        .assert()
        .success()
        .stdout(contains("HTTP 200 OK"))
        .stdout(contains("hello from integration test"));

    let qm = query_manager(data_dir);
    let db = qm.connect();
    let responses =
        db.list_http_responses_for_request(&request_id, None).expect("Failed to load responses");
    assert_eq!(responses.len(), 1, "expected exactly one persisted response");

    let response = &responses[0];
    assert_eq!(response.status, 200);
    assert!(matches!(response.state, HttpResponseState::Closed));
    assert!(response.error.is_none());

    let body_path =
        response.body_path.as_ref().expect("expected persisted response body path").to_string();
    let body = std::fs::read_to_string(&body_path).expect("Failed to read response body file");
    assert_eq!(body, "hello from integration test");

    let events =
        db.list_http_response_events(&response.id).expect("Failed to load response events");
    assert!(!events.is_empty(), "expected at least one persisted response event");
}
