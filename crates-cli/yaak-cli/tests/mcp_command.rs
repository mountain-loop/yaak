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

/// Answers each request with its `X-Environment` header and reports the
/// headers it received.
fn marker_server() -> (String, std::sync::mpsc::Receiver<String>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { break };
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                match stream.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => request.extend_from_slice(&chunk[..n]),
                }
            }
            let request = String::from_utf8_lossy(&request).to_lowercase();
            let marker = request
                .lines()
                .find_map(|l| l.strip_prefix("x-environment:"))
                .map(|v| v.trim().to_string())
                .unwrap_or_default();
            let _ = tx.send(request);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{marker}",
                marker.len()
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    (url, rx)
}

#[tokio::test]
async fn mcp_send_settings_reach_template_functions() {
    use yaak_models::models::{
        Cookie, CookieDomain, CookieExpires, CookieJar, Environment, EnvironmentVariable,
        HttpRequestHeader,
    };

    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path();
    seed_workspace(data_dir, "wk_test");
    let (url, received) = marker_server();
    let header = |name: &str, value: &str| HttpRequestHeader {
        enabled: true,
        name: name.into(),
        value: value.into(),
        ..Default::default()
    };
    let override_id = query_manager(data_dir)
        .with_tx(|db| {
            let source = &UpdateSource::Sync;
            let vars = |value: &str| {
                vec![EnvironmentVariable {
                    enabled: true,
                    name: "marker".into(),
                    value: value.into(),
                    ..Default::default()
                }]
            };
            let base = db.ensure_base_environment("wk_test")?;
            let base =
                db.upsert_environment(&Environment { variables: vars("global"), ..base }, source)?;
            let chosen = db.upsert_environment(
                &Environment {
                    name: "chosen".into(),
                    workspace_id: "wk_test".into(),
                    parent_model: "environment".into(),
                    parent_id: Some(base.id.clone()),
                    variables: vars("chosen"),
                    ..Default::default()
                },
                source,
            )?;
            db.upsert_cookie_jar(
                &CookieJar {
                    workspace_id: "wk_test".into(),
                    name: "Default".into(),
                    cookies: vec![Cookie {
                        name: "session".into(),
                        value: "from-jar".into(),
                        domain: CookieDomain::HostOnly("127.0.0.1".into()),
                        expires: CookieExpires::SessionEnd,
                        path: "/".into(),
                        secure: false,
                        http_only: false,
                        same_site: None,
                    }],
                    ..Default::default()
                },
                source,
            )?;
            db.upsert_http_request(
                &HttpRequest {
                    id: "rq_inner".into(),
                    workspace_id: "wk_test".into(),
                    method: "GET".into(),
                    url: format!("{url}/inner"),
                    headers: vec![header("X-Environment", "${[ marker ]}")],
                    ..Default::default()
                },
                source,
            )?;
            db.upsert_http_request(
                &HttpRequest {
                    id: "rq_outer".into(),
                    workspace_id: "wk_test".into(),
                    method: "GET".into(),
                    url: format!("{url}/outer"),
                    headers: vec![
                        header(
                            "X-Nested",
                            "${[ response.body.raw(request='rq_inner', behavior='always') ]}",
                        ),
                        header("X-Cookie", "${[ cookie.value(name='session') ]}"),
                    ],
                    ..Default::default()
                },
                source,
            )?;
            Ok::<_, yaak_models::error::Error>(chosen.id)
        })
        .unwrap();

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

    let Value::Object(arguments) = json!({ "id": "rq_outer", "environmentId": override_id }) else {
        unreachable!()
    };
    let result = client
        .call_tool(CallToolRequestParams::new("send_http_request").with_arguments(arguments))
        .await
        .unwrap();
    assert_ne!(result.is_error, Some(true), "{result:?}");

    let outer = received.iter().find(|r| r.starts_with("get /outer")).unwrap();
    assert!(outer.contains("x-nested: chosen\r\n"), "{outer}");
    assert!(outer.contains("x-cookie: from-jar\r\n"), "{outer}");

    client.cancel().await.unwrap();
    assert!(child.wait().await.unwrap().success());
}
