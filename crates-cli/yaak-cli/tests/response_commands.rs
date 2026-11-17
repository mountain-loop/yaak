mod common;

use common::{
    cli_cmd, query_manager, seed_grpc_request, seed_request, seed_websocket_request, seed_workspace,
};
use predicates::prelude::PredicateBooleanExt;
use predicates::str::contains;
use serde_json::json;
use tempfile::TempDir;
use yaak_models::models::{
    GrpcConnection, GrpcEvent, GrpcEventType, HttpResponse, WebsocketConnection, WebsocketEvent,
    WebsocketEventType,
};
use yaak_models::util::UpdateSource;

/// QA sweep bug 4: `response list/show/body/delete` given a `gr_` or `wr_` ID could not
/// find the request, so its connections were unreachable.
#[test]
fn response_commands_handle_grpc_and_websocket_connections() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    seed_grpc_request(data_dir, "wk_test", "gr_conn");
    seed_websocket_request(data_dir, "wk_test", "wr_conn");

    query_manager(data_dir)
        .with_tx(|tx| {
            let source = &UpdateSource::Sync;
            let ws = tx.upsert_websocket_connection(
                &WebsocketConnection {
                    id: "wc_conn".into(),
                    workspace_id: "wk_test".into(),
                    request_id: "wr_conn".into(),
                    url: "wss://example.com/socket".into(),
                    status: 101,
                    ..Default::default()
                },
                source,
            )?;
            for (is_server, message) in [(false, "ping me"), (true, "hello"), (true, "world")] {
                tx.upsert_websocket_event(
                    &WebsocketEvent {
                        workspace_id: "wk_test".into(),
                        request_id: "wr_conn".into(),
                        connection_id: ws.id.clone(),
                        is_server,
                        message: message.as_bytes().to_vec(),
                        message_type: WebsocketEventType::Text,
                        ..Default::default()
                    },
                    source,
                )?;
            }
            let grpc = tx.upsert_grpc_connection(
                &GrpcConnection {
                    id: "gc_conn".into(),
                    workspace_id: "wk_test".into(),
                    request_id: "gr_conn".into(),
                    url: "https://example.com".into(),
                    ..Default::default()
                },
                source,
            )?;
            tx.upsert_grpc_event(
                &GrpcEvent {
                    workspace_id: "wk_test".into(),
                    request_id: "gr_conn".into(),
                    connection_id: grpc.id.clone(),
                    content: "{\"message\":\"hi\"}".into(),
                    event_type: GrpcEventType::ServerMessage,
                    ..Default::default()
                },
                source,
            )
        })
        .expect("seed connections");

    cli_cmd(data_dir)
        .args(["response", "list", "wr_conn"])
        .assert()
        .success()
        .stdout(contains("wc_conn - 101 wss://example.com/socket"));
    cli_cmd(data_dir)
        .args(["response", "list", "gr_conn"])
        .assert()
        .success()
        .stdout(contains("gc_conn - gRPC status 0 https://example.com"));

    cli_cmd(data_dir)
        .args(["response", "show", "wr_conn"])
        .assert()
        .success()
        .stdout(contains("\"model\": \"websocket_connection\""));
    cli_cmd(data_dir)
        .args(["response", "show", "gc_conn"])
        .assert()
        .success()
        .stdout(contains("\"model\": \"grpc_connection\""));

    cli_cmd(data_dir)
        .args(["response", "body", "wr_conn"])
        .assert()
        .success()
        .stdout("hello\nworld\n");
    cli_cmd(data_dir)
        .args(["response", "body", "gr_conn"])
        .assert()
        .success()
        .stdout("{\"message\":\"hi\"}\n");

    cli_cmd(data_dir)
        .args(["response", "delete", "wr_conn", "--yes"])
        .assert()
        .success()
        .stdout(contains("Deleted 1 responses for request wr_conn"));
    cli_cmd(data_dir)
        .args(["response", "delete", "gr_conn", "--yes"])
        .assert()
        .success()
        .stdout(contains("Deleted 1 responses for request gr_conn"));
    let query_manager = query_manager(data_dir);
    assert!(query_manager.connect().get_websocket_connection("wc_conn").is_err());
    assert!(query_manager.connect().get_grpc_connection("gc_conn").is_err());
}

/// `response list <workspace>` and `response delete <workspace>` cover HTTP responses and
/// gRPC and WebSocket connections together, newest first, with `--limit` applied to the
/// merged history.
#[test]
fn workspace_response_commands_cover_every_kind() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    seed_request(data_dir, "wk_test", "rq_mixed");
    seed_grpc_request(data_dir, "wk_test", "gr_mixed");
    seed_websocket_request(data_dir, "wk_test", "wr_mixed");

    let at = |second: u32| format!("2026-01-01T00:00:{second:02}");
    let (seed_db, blob_manager, _rx) =
        yaak_models::init_standalone(data_dir.join("db.sqlite"), data_dir.join("blobs.sqlite"))
            .expect("open database");
    seed_db
        .with_tx(|tx| {
            let source = &UpdateSource::Sync;
            tx.upsert_http_response(
                &serde_json::from_value::<HttpResponse>(json!({
                    "id": "rs_oldest", "workspaceId": "wk_test", "requestId": "rq_mixed",
                    "createdAt": at(1), "updatedAt": at(1), "status": 200,
                    "url": "https://example.com/oldest",
                }))
                .unwrap(),
                source,
                &blob_manager,
            )?;
            tx.upsert_websocket_connection(
                &serde_json::from_value::<WebsocketConnection>(json!({
                    "id": "wc_middle", "workspaceId": "wk_test", "requestId": "wr_mixed",
                    "createdAt": at(2), "updatedAt": at(2), "status": 101,
                    "url": "wss://example.com/socket",
                }))
                .unwrap(),
                source,
            )?;
            tx.upsert_grpc_connection(
                &serde_json::from_value::<GrpcConnection>(json!({
                    "id": "gc_newest", "workspaceId": "wk_test", "requestId": "gr_mixed",
                    "createdAt": at(3), "updatedAt": at(3), "url": "https://example.com",
                }))
                .unwrap(),
                source,
            )?;
            Ok::<_, yaak_models::error::Error>(())
        })
        .expect("seed history");
    drop(seed_db);

    let listed = cli_cmd(data_dir).args(["response", "list", "wk_test"]).assert().success();
    let ids = String::from_utf8_lossy(&listed.get_output().stdout)
        .lines()
        .map(|l| l.split_whitespace().next().unwrap_or_default().to_string())
        .collect::<Vec<_>>();
    assert_eq!(ids, ["gc_newest", "wc_middle", "rs_oldest"]);

    cli_cmd(data_dir)
        .args(["response", "list", "wk_test", "--limit", "2"])
        .assert()
        .success()
        .stdout(contains("gc_newest"))
        .stdout(contains("wc_middle"))
        .stdout(contains("rs_oldest").not());

    cli_cmd(data_dir)
        .args(["response", "delete", "wk_test", "--yes"])
        .assert()
        .success()
        .stdout(contains("Deleted 3 responses for workspace wk_test"));
    let query_manager = query_manager(data_dir);
    let db = query_manager.connect();
    assert!(db.list_http_responses("wk_test", None).unwrap().is_empty());
    assert!(db.list_grpc_connections("wk_test").unwrap().is_empty());
    assert!(db.list_websocket_connections("wk_test").unwrap().is_empty());
}
