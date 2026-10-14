mod common;

use common::http_server::TestHttpServer;
use common::{query_manager, seed_workspace};
use rmcp::ServiceExt;
use rmcp::model::CallToolRequestParams;
use serde_json::{Value, json};
use std::process::Stdio;
use tempfile::TempDir;
use tokio::process::Command;
use yaak_models::models::HttpRequest;
use yaak_models::util::UpdateSource;

#[tokio::test]
async fn mcp_serves_tools_over_stdio() {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    let server = TestHttpServer::spawn_ok("hello from mcp");
    let request = HttpRequest {
        id: "rq_mcp".to_string(),
        workspace_id: "wk_test".to_string(),
        name: "MCP Send".to_string(),
        method: "GET".to_string(),
        url: server.url.clone(),
        ..Default::default()
    };
    query_manager(data_dir)
        .with_tx(|tx| tx.upsert_http_request(&request, &UpdateSource::Sync))
        .expect("Failed to seed request");

    let mut child = Command::new(env!("CARGO_BIN_EXE_yaak"))
        .arg("--data-dir")
        .arg(data_dir)
        .arg("mcp")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let io = (child.stdout.take().unwrap(), child.stdin.take().unwrap());
    let client = ().serve(io).await.unwrap();

    let call = async |name: &'static str, arguments: Value| {
        let Value::Object(arguments) = arguments else {
            unreachable!()
        };
        let result = client
            .call_tool(CallToolRequestParams::new(name).with_arguments(arguments))
            .await
            .unwrap();
        assert_ne!(result.is_error, Some(true), "{result:?}");
        let text = result.content[0].as_text().unwrap().text.clone();
        serde_json::from_str::<Value>(&text).unwrap()
    };

    assert_eq!(client.list_all_tools().await.unwrap().len(), 15);
    assert_eq!(
        call("list_workspaces", json!({})).await,
        json!([{ "id": "wk_test", "name": "Seed Workspace" }])
    );
    let response = call("send_http_request", json!({ "id": "rq_mcp" })).await;
    assert_eq!(response["status"], 200);
    assert_eq!(response["requestId"], "rq_mcp");

    client.cancel().await.unwrap();
    assert!(child.wait().await.unwrap().success());
}
