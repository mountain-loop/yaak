mod common;

use common::{cli_cmd, query_manager, seed_grpc_request, seed_websocket_request, seed_workspace};
use predicates::str::contains;
use tempfile::TempDir;
use yaak_models::models::{
    GrpcConnection, GrpcEvent, GrpcEventType, WebsocketConnection, WebsocketEvent,
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
