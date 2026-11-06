use reqwest::StatusCode;
use std::sync::Arc;
use yaak_mcp::{HostResult, McpHost, WorkspaceInfo};
use yaak_models::models::{Folder, HttpRequest, HttpResponse};
use yaak_plugins::events::ShowToastRequest;

struct EmptyHost;

impl McpHost for EmptyHost {
    fn list_workspaces(&self) -> HostResult<Vec<WorkspaceInfo>> {
        Ok(Vec::new())
    }
    fn active_environment_id(&self, _: &str) -> HostResult<Option<String>> {
        Ok(None)
    }
    fn list_http_requests(&self, _: &str) -> HostResult<Vec<HttpRequest>> {
        Ok(Vec::new())
    }
    fn get_http_request(&self, _: &str) -> HostResult<Option<HttpRequest>> {
        Ok(None)
    }
    fn upsert_http_request(&self, r: &HttpRequest) -> HostResult<HttpRequest> {
        Ok(r.clone())
    }
    fn delete_http_request(&self, _: &str) -> HostResult<HttpRequest> {
        Err("missing".into())
    }
    fn list_folders(&self, _: &str) -> HostResult<Vec<Folder>> {
        Ok(Vec::new())
    }
    fn upsert_folder(&self, f: &Folder) -> HostResult<Folder> {
        Ok(f.clone())
    }
    fn delete_folder(&self, _: &str) -> HostResult<Folder> {
        Err("missing".into())
    }
    async fn send_http_request(
        &self,
        _: &str,
        _: HttpRequest,
        _: Option<String>,
    ) -> HostResult<HttpResponse> {
        Err("missing".into())
    }
    fn show_toast(&self, _: ShowToastRequest) -> HostResult<()> {
        Ok(())
    }
}

const INITIALIZE: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}"#;

#[tokio::test]
async fn requires_the_bearer_token() {
    let server = yaak_mcp::http::serve(
        Arc::new(EmptyHost),
        "127.0.0.1:0".parse().unwrap(),
        "secret".to_string(),
    )
    .await
    .unwrap();
    let url = format!("http://{}/mcp", server.addr);
    let client = reqwest::Client::new();
    let post = |url: &str, auth: Option<&str>| {
        let mut request = client
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(INITIALIZE);
        if let Some(auth) = auth {
            request = request.header("Authorization", auth);
        }
        request.send()
    };

    for auth in [
        None,
        Some("Bearer wrong"),
        Some("Bearer secre"),
        Some("secret"),
    ] {
        let response = post(&url, auth).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{auth:?}");
        assert_eq!(response.headers()["www-authenticate"], "Bearer");
    }

    let response = post(&url, Some("Bearer secret")).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().contains_key("mcp-session-id"));
    let body = response.text().await.unwrap();
    assert!(body.contains("yaak-mcp-server"), "{body}");

    let other = format!("http://{}/other", server.addr);
    assert_eq!(post(&other, Some("Bearer secret")).await.unwrap().status(), StatusCode::NOT_FOUND);

    let addr = server.addr;
    server.stop().await;
    assert!(tokio::net::TcpStream::connect(addr).await.is_err());
}
