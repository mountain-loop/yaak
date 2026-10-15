use crate::cli::McpArgs;
use crate::context::{CliContext, CliExecutionContext};
use crate::plugin_events::SendContexts;
use rand::Rng;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use yaak::send::{SendHttpRequestWithPluginsParams, send_http_request_with_plugins};
use yaak_crypto::manager::EncryptionManager;
use yaak_http::manager::HttpConnectionManager;
use yaak_mcp::{HostResult, McpHost, WorkspaceInfo};
use yaak_models::blob_manager::BlobManager;
use yaak_models::models::{Folder, HttpRequest, HttpResponse};
use yaak_models::query_manager::QueryManager;
use yaak_models::util::UpdateSource;
use yaak_plugins::events::{PluginContext, ShowToastRequest};
use yaak_plugins::manager::PluginManager;

enum Transport {
    Stdio,
    Http { port: u16, token: Option<String> },
}

impl From<McpArgs> for Transport {
    fn from(args: McpArgs) -> Self {
        if args.http {
            Transport::Http { port: args.port, token: args.token }
        } else {
            Transport::Stdio
        }
    }
}

pub async fn run(
    ctx: &CliContext,
    args: McpArgs,
    environment: Option<&str>,
    cookie_jar_id: Option<&str>,
) -> i32 {
    let host = CliMcpHost {
        query_manager: ctx.query_manager().clone(),
        blob_manager: ctx.blob_manager().clone(),
        plugin_manager: ctx.plugin_manager(),
        encryption_manager: ctx.encryption_manager.clone(),
        connection_manager: ctx.connection_manager().clone(),
        response_dir: ctx.data_dir().join("responses"),
        send_contexts: ctx.send_contexts().await,
        environment_id: environment.map(str::to_string),
        cookie_jar_id: cookie_jar_id.map(str::to_string),
    };
    let result = match Transport::from(args) {
        Transport::Stdio => yaak_mcp::serve_stdio(host).await,
        Transport::Http { port, token } => serve_http(host, port, token).await,
    };
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

async fn serve_http(host: CliMcpHost, port: u16, token: Option<String>) -> Result<(), String> {
    let token = token.unwrap_or_else(generate_token);
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let server = yaak_mcp::http::serve(Arc::new(host), addr, token.clone())
        .await
        .map_err(|e| format!("Failed to start MCP server on {addr}: {e}"))?;
    eprintln!("Yaak MCP server listening on http://{}{}", server.addr, yaak_mcp::http::PATH);
    eprintln!("Token: {token}");
    eprintln!("Clients must send it as \"Authorization: Bearer <token>\". Press Ctrl+C to stop.");
    tokio::signal::ctrl_c().await.map_err(|e| format!("Failed to wait for Ctrl+C: {e}"))?;
    server.stop().await;
    Ok(())
}

fn generate_token() -> String {
    hex::encode(rand::thread_rng().r#gen::<[u8; 32]>())
}

/// Every workspace in the database is "open", and the global `--environment`
/// and `--cookie-jar` flags stand in for a window's selection.
struct CliMcpHost {
    query_manager: QueryManager,
    blob_manager: BlobManager,
    plugin_manager: Arc<PluginManager>,
    encryption_manager: Arc<EncryptionManager>,
    connection_manager: Arc<HttpConnectionManager>,
    response_dir: PathBuf,
    send_contexts: SendContexts,
    environment_id: Option<String>,
    cookie_jar_id: Option<String>,
}

/// Registers a send's execution context for as long as the send runs.
struct SendContextGuard<'a> {
    send_contexts: &'a SendContexts,
    id: String,
}

impl<'a> SendContextGuard<'a> {
    fn new(send_contexts: &'a SendContexts, id: &str, context: CliExecutionContext) -> Self {
        send_contexts.lock().expect("send contexts lock").insert(id.to_string(), context);
        Self { send_contexts, id: id.to_string() }
    }
}

impl Drop for SendContextGuard<'_> {
    fn drop(&mut self) {
        self.send_contexts.lock().expect("send contexts lock").remove(&self.id);
    }
}

impl McpHost for CliMcpHost {
    fn list_workspaces(&self) -> HostResult<Vec<WorkspaceInfo>> {
        let workspaces =
            self.query_manager.connect().list_workspaces().map_err(|e| e.to_string())?;
        Ok(workspaces.into_iter().map(|w| WorkspaceInfo { id: w.id, name: w.name }).collect())
    }

    fn active_environment_id(&self, workspace_id: &str) -> HostResult<Option<String>> {
        let Some(environment_id) = &self.environment_id else {
            return Ok(None);
        };
        Ok(self
            .query_manager
            .connect()
            .get_environment_for_workspace(workspace_id, environment_id)
            .ok()
            .map(|e| e.id))
    }

    fn list_http_requests(&self, workspace_id: &str) -> HostResult<Vec<HttpRequest>> {
        self.query_manager.connect().list_http_requests(workspace_id).map_err(|e| e.to_string())
    }

    fn get_http_request(&self, id: &str) -> HostResult<Option<HttpRequest>> {
        Ok(self.query_manager.connect().get_http_request(id).ok())
    }

    fn upsert_http_request(&self, request: &HttpRequest) -> HostResult<HttpRequest> {
        self.query_manager
            .with_tx(|tx| tx.upsert_http_request(request, &UpdateSource::Sync))
            .map_err(|e| format!("Failed to upsert HTTP request: {e}"))
    }

    fn delete_http_request(&self, id: &str) -> HostResult<HttpRequest> {
        self.query_manager
            .with_tx(|tx| tx.delete_http_request_by_id(id, &UpdateSource::Sync))
            .map_err(|e| format!("Failed to delete HTTP request: {e}"))
    }

    fn list_folders(&self, workspace_id: &str) -> HostResult<Vec<Folder>> {
        self.query_manager.connect().list_folders(workspace_id).map_err(|e| e.to_string())
    }

    fn upsert_folder(&self, folder: &Folder) -> HostResult<Folder> {
        self.query_manager
            .with_tx(|tx| tx.upsert_folder(folder, &UpdateSource::Sync))
            .map_err(|e| format!("Failed to upsert folder: {e}"))
    }

    fn delete_folder(&self, id: &str) -> HostResult<Folder> {
        self.query_manager
            .with_tx(|tx| tx.delete_folder_by_id(id, &UpdateSource::Sync))
            .map_err(|e| format!("Failed to delete folder: {e}"))
    }

    async fn send_http_request(
        &self,
        workspace_id: &str,
        request: HttpRequest,
        environment_id: Option<String>,
    ) -> HostResult<HttpResponse> {
        let environment_id = match environment_id {
            Some(environment_id) => {
                if request.workspace_id != workspace_id {
                    return Err("HTTP request does not belong to the selected workspace".into());
                }
                let environment = self
                    .query_manager
                    .connect()
                    .get_environment_for_workspace(&request.workspace_id, &environment_id)
                    .map_err(|e| e.to_string())?;
                Some(environment.id)
            }
            None => self.active_environment_id(&request.workspace_id)?,
        };
        let cookie_jar_id = match &self.cookie_jar_id {
            Some(id) => Some(id.clone()),
            None => self
                .query_manager
                .connect()
                .list_cookie_jars(&request.workspace_id)
                .map_err(|e| format!("Failed to list cookie jars: {e}"))?
                .into_iter()
                .min_by_key(|jar| jar.created_at)
                .map(|jar| jar.id),
        };
        let plugin_context =
            PluginContext::new(Some("cli".to_string()), Some(request.workspace_id.clone()));
        let _send_context = SendContextGuard::new(
            &self.send_contexts,
            &plugin_context.id,
            CliExecutionContext {
                request_id: Some(request.id.clone()),
                workspace_id: Some(request.workspace_id.clone()),
                environment_id: environment_id.clone(),
                cookie_jar_id: cookie_jar_id.clone(),
            },
        );

        let result = send_http_request_with_plugins(SendHttpRequestWithPluginsParams {
            query_manager: &self.query_manager,
            blob_manager: &self.blob_manager,
            request,
            environment_id: environment_id.as_deref(),
            update_source: UpdateSource::Sync,
            cookie_jar_id,
            response_dir: &self.response_dir,
            emit_events_to: None,
            emit_response_body_chunks_to: None,
            existing_response: None,
            plugin_manager: self.plugin_manager.clone(),
            encryption_manager: self.encryption_manager.clone(),
            plugin_context: &plugin_context,
            cancelled_rx: None,
            connection_manager: &self.connection_manager,
        })
        .await
        .map_err(|e| e.to_string())?;
        Ok(result.response)
    }

    fn show_toast(&self, toast: ShowToastRequest) -> HostResult<()> {
        // stdout carries the protocol
        eprintln!("[mcp] {}", toast.message);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::model::{CallToolRequestParams, CallToolResult};
    use rmcp::service::RunningService;
    use rmcp::{RoleClient, ServiceExt};
    use serde_json::{Value, json};
    use tempfile::TempDir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc::UnboundedReceiver;
    use yaak_mcp::YaakMcpServer;
    use yaak_models::models::{Environment, EnvironmentVariable, HttpRequestHeader, Workspace};

    struct Fixture {
        client: RunningService<RoleClient, ()>,
        query_manager: QueryManager,
        plugin_manager: Arc<PluginManager>,
        workspace_id: String,
        request_id: String,
        environments: [String; 3],
        received: UnboundedReceiver<String>,
        _dir: TempDir,
    }

    impl Fixture {
        async fn new(active_environment: Option<&str>) -> Self {
            let dir = TempDir::new().unwrap();
            let (query_manager, blob_manager, _rx) = yaak_models::init_standalone(
                dir.path().join("db.sqlite"),
                dir.path().join("blobs.sqlite"),
            )
            .unwrap();
            let (url, received) = echo_server().await;
            let (workspace_id, request_id, environments) = seed(&query_manager, &url);

            let plugin_dir = dir.path().join("plugins");
            std::fs::create_dir_all(&plugin_dir).unwrap();
            let plugin_manager = Arc::new(
                PluginManager::new(
                    plugin_dir.clone(),
                    plugin_dir,
                    PathBuf::from("node"),
                    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(
                        "../../crates-tauri/yaak-app-client/vendored/plugin-runtime/index.cjs",
                    ),
                    &query_manager,
                    &PluginContext::new_empty(),
                    false,
                )
                .await
                .unwrap(),
            );
            let environment_id = active_environment.map(|name| match name {
                "a" => environments[1].clone(),
                other => other.to_string(),
            });
            let host = CliMcpHost {
                encryption_manager: Arc::new(EncryptionManager::new(
                    query_manager.clone(),
                    "yaak-test",
                )),
                query_manager: query_manager.clone(),
                blob_manager,
                plugin_manager: plugin_manager.clone(),
                connection_manager: Arc::new(HttpConnectionManager::new()),
                response_dir: dir.path().join("responses"),
                send_contexts: SendContexts::default(),
                environment_id,
                cookie_jar_id: None,
            };

            let (client_io, server_io) = tokio::io::duplex(64 * 1024);
            tokio::spawn(async move {
                let server = YaakMcpServer::new(host).serve(server_io).await.unwrap();
                let _ = server.waiting().await;
            });
            let client = ().serve(client_io).await.unwrap();

            Self {
                client,
                query_manager,
                plugin_manager,
                workspace_id,
                request_id,
                environments,
                received,
                _dir: dir,
            }
        }

        async fn call(&self, name: &'static str, arguments: Value) -> CallToolResult {
            let Value::Object(arguments) = arguments else {
                panic!("arguments must be an object")
            };
            self.client
                .call_tool(CallToolRequestParams::new(name).with_arguments(arguments))
                .await
                .unwrap()
        }

        async fn ok(&self, name: &'static str, arguments: Value) -> String {
            let result = self.call(name, arguments).await;
            assert_ne!(result.is_error, Some(true), "{name} failed: {}", text(&result));
            text(&result)
        }

        async fn err(&self, name: &'static str, arguments: Value) -> String {
            let result = self.call(name, arguments).await;
            assert_eq!(result.is_error, Some(true), "{name} should fail: {}", text(&result));
            text(&result)
        }

        async fn json(&self, name: &'static str, arguments: Value) -> Value {
            serde_json::from_str(&self.ok(name, arguments).await).unwrap()
        }

        async fn next_marker(&mut self) -> String {
            let request = self.received.recv().await.unwrap().to_lowercase();
            let line = request.lines().find(|l| l.starts_with("x-environment:")).unwrap();
            line["x-environment:".len()..].trim().to_string()
        }

        async fn finish(self) {
            assert!(self.received.is_empty(), "unexpected requests reached the server");
            self.client.cancel().await.unwrap();
            self.plugin_manager.terminate().await;
        }
    }

    fn text(result: &CallToolResult) -> String {
        result.content.iter().filter_map(|c| c.as_text()).map(|t| t.text.clone()).collect()
    }

    async fn echo_server() -> (String, UnboundedReceiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/echo", listener.local_addr().unwrap());
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    let mut chunk = [0u8; 1024];
                    let n = socket.read(&mut chunk).await.unwrap();
                    if n == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..n]);
                }
                tx.send(String::from_utf8(request).unwrap()).unwrap();
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    )
                    .await
                    .unwrap();
            }
        });
        (url, rx)
    }

    /// A workspace with base environment "global", sub-environments "a" and
    /// "b", and a request that echoes its environment's marker in a header.
    fn seed(query_manager: &QueryManager, url: &str) -> (String, String, [String; 3]) {
        query_manager
            .with_tx(|db| {
                let source = &UpdateSource::Background;
                let workspace = db.upsert_workspace(
                    &Workspace { name: "Test".into(), ..Default::default() },
                    source,
                )?;
                let vars = |value: &str| {
                    vec![EnvironmentVariable {
                        enabled: true,
                        name: "marker".into(),
                        value: value.into(),
                        ..Default::default()
                    }]
                };
                let base = db.ensure_base_environment(&workspace.id)?;
                let base = db.upsert_environment(
                    &Environment { variables: vars("global"), ..base },
                    source,
                )?;
                let sub = |name: &str| {
                    db.upsert_environment(
                        &Environment {
                            name: name.into(),
                            workspace_id: workspace.id.clone(),
                            parent_model: "environment".into(),
                            parent_id: Some(base.id.clone()),
                            variables: vars(name),
                            ..Default::default()
                        },
                        source,
                    )
                };
                let a = sub("a")?;
                let b = sub("b")?;
                let request = db.upsert_http_request(
                    &HttpRequest {
                        workspace_id: workspace.id.clone(),
                        name: "Echo".into(),
                        url: url.to_string(),
                        method: "GET".into(),
                        headers: vec![HttpRequestHeader {
                            enabled: true,
                            name: "X-Environment".into(),
                            value: "${[ marker ]}".into(),
                            ..Default::default()
                        }],
                        ..Default::default()
                    },
                    source,
                )?;
                Ok::<_, yaak_models::error::Error>((
                    workspace.id,
                    request.id,
                    [base.id, a.id, b.id],
                ))
            })
            .unwrap()
    }

    #[tokio::test]
    async fn advertises_the_plugin_tools() {
        let fx = Fixture::new(None).await;
        let tools = fx.client.list_all_tools().await.unwrap();
        let mut names = tools.iter().map(|t| t.name.to_string()).collect::<Vec<_>>();
        names.sort();
        assert_eq!(
            names,
            [
                "create_folder",
                "create_http_request",
                "delete_folder",
                "delete_http_request",
                "get_environment_id",
                "get_folder",
                "get_http_request",
                "get_workspace_id",
                "list_folders",
                "list_http_requests",
                "list_workspaces",
                "send_http_request",
                "show_toast",
                "update_folder",
                "update_http_request",
            ]
        );
        let send = tools.iter().find(|t| t.name == "send_http_request").unwrap();
        let properties = send.input_schema["properties"].as_object().unwrap();
        assert!(properties.contains_key("environmentId"), "{properties:?}");
        assert_eq!(send.input_schema["required"], json!(["id"]));
        fx.finish().await;
    }

    #[tokio::test]
    async fn send_uses_the_given_environment() {
        let mut fx = Fixture::new(Some("a")).await;
        let response = fx
            .json(
                "send_http_request",
                json!({ "id": fx.request_id, "workspaceId": fx.workspace_id, "environmentId": fx.environments[2] }),
            )
            .await;
        assert_eq!(response["status"], 200);
        assert!(response.get("bodyPath").is_none(), "{response}");
        assert_eq!(fx.next_marker().await, "b");
        fx.finish().await;
    }

    #[tokio::test]
    async fn send_without_an_environment_uses_the_active_one() {
        let mut fx = Fixture::new(Some("a")).await;
        fx.ok("send_http_request", json!({ "id": fx.request_id })).await;
        assert_eq!(fx.next_marker().await, "a");
        fx.finish().await;

        let mut fx = Fixture::new(None).await;
        fx.ok("send_http_request", json!({ "id": fx.request_id })).await;
        assert_eq!(fx.next_marker().await, "global");
        fx.finish().await;
    }

    #[tokio::test]
    async fn send_does_not_send_a_missing_request() {
        let fx = Fixture::new(None).await;
        let error = fx.err("send_http_request", json!({ "id": "rq_missing" })).await;
        assert_eq!(error, "HTTP request with ID rq_missing not found");
        fx.finish().await;
    }

    #[tokio::test]
    async fn send_returns_host_environment_errors() {
        let fx = Fixture::new(None).await;
        let expected = fx
            .query_manager
            .connect()
            .get_environment_for_workspace(&fx.workspace_id, "ev_missing")
            .unwrap_err()
            .to_string();
        let error = fx
            .err("send_http_request", json!({ "id": fx.request_id, "environmentId": "ev_missing" }))
            .await;
        assert_eq!(error, expected);
        fx.finish().await;
    }

    #[tokio::test]
    async fn concurrent_sends_keep_their_environments() {
        let mut fx = Fixture::new(None).await;
        let (a, b) = (fx.environments[1].clone(), fx.environments[2].clone());
        tokio::join!(
            fx.ok("send_http_request", json!({ "id": fx.request_id, "environmentId": a })),
            fx.ok("send_http_request", json!({ "id": fx.request_id, "environmentId": b })),
        );
        let mut markers = vec![fx.next_marker().await, fx.next_marker().await];
        markers.sort();
        assert_eq!(markers, ["a", "b"]);
        let responses =
            fx.query_manager.connect().list_http_responses_for_request(&fx.request_id, None);
        assert_eq!(responses.unwrap().len(), 2);
        fx.finish().await;
    }

    #[tokio::test]
    async fn workspace_and_environment_tools() {
        let fx = Fixture::new(Some("a")).await;
        assert_eq!(
            fx.json("list_workspaces", json!({})).await,
            json!([{ "id": fx.workspace_id, "name": "Test" }])
        );
        assert_eq!(fx.ok("get_workspace_id", json!({})).await, fx.workspace_id);
        assert_eq!(fx.ok("get_environment_id", json!({})).await, fx.environments[1]);

        let error = fx.err("list_http_requests", json!({ "workspaceId": "wk_missing" })).await;
        assert!(error.starts_with("Workspace with ID \"wk_missing\" not found."), "{error}");

        fx.query_manager
            .with_tx(|db| {
                db.upsert_workspace(
                    &Workspace { name: "Other".into(), ..Default::default() },
                    &UpdateSource::Background,
                )
            })
            .unwrap();
        let error = fx.err("get_workspace_id", json!({})).await;
        assert!(error.starts_with("Multiple workspaces are open."), "{error}");
        let error = fx.err("list_http_requests", json!({})).await;
        assert!(error.contains(&format!("Test (ID: {})", fx.workspace_id)), "{error}");
        let requests =
            fx.json("list_http_requests", json!({ "workspaceId": fx.workspace_id })).await;
        assert_eq!(requests.as_array().unwrap().len(), 1);
        fx.finish().await;

        let fx = Fixture::new(None).await;
        assert_eq!(fx.ok("get_environment_id", json!({})).await, "No environment selected");
        fx.finish().await;
    }

    #[tokio::test]
    async fn http_request_tools() {
        let fx = Fixture::new(None).await;
        let created = fx
            .json(
                "create_http_request",
                json!({
                    "name": "Created",
                    "url": "https://example.com/items",
                    "headers": [{ "name": "Accept", "value": "application/json" }],
                    "bodyType": "application/json",
                    "body": { "text": "{}" },
                }),
            )
            .await;
        let id = created["id"].as_str().unwrap().to_string();
        assert!(id.starts_with("rq_"), "{created}");
        assert_eq!(created["workspaceId"], fx.workspace_id);
        assert_eq!(created["method"], "GET");
        assert_eq!(created["headers"][0]["enabled"], true);
        assert_eq!(fx.json("get_http_request", json!({ "id": id })).await, created);

        let updated = fx
            .json(
                "update_http_request",
                json!({ "id": id, "url": "https://example.com/v2", "method": "POST" }),
            )
            .await;
        assert_eq!(updated["id"], id);
        assert_eq!(updated["url"], "https://example.com/v2");
        assert_eq!(updated["method"], "POST");
        assert_eq!(updated["name"], "Created");
        assert_eq!(updated["body"], json!({ "text": "{}" }));

        let error = fx.err("update_http_request", json!({ "id": "rq_missing", "name": "x" })).await;
        assert_eq!(error, "HTTP request with ID rq_missing not found");

        let listed = fx.json("list_http_requests", json!({})).await;
        assert_eq!(listed.as_array().unwrap().len(), 2);

        assert_eq!(
            fx.ok("delete_http_request", json!({ "id": id })).await,
            format!("Deleted: Created ({id})")
        );
        assert_eq!(fx.json("get_http_request", json!({ "id": id })).await, Value::Null);
        fx.finish().await;
    }

    #[tokio::test]
    async fn folder_tools() {
        let fx = Fixture::new(None).await;
        let parent = fx.json("create_folder", json!({ "name": "Parent" })).await;
        let parent_id = parent["id"].as_str().unwrap().to_string();
        assert!(parent_id.starts_with("fl_"), "{parent}");
        let child = fx
            .json(
                "create_folder",
                json!({
                    "name": "Child",
                    "folderId": parent_id,
                    "sortPriority": 2.5,
                    "authenticationType": "bearer",
                    "authentication": { "token": "abc" },
                }),
            )
            .await;
        let child_id = child["id"].as_str().unwrap().to_string();
        assert_eq!(child["folderId"], parent_id);
        assert_eq!(child["authentication"]["token"], "abc");
        assert_eq!(fx.json("get_folder", json!({ "id": child_id })).await, child);
        assert_eq!(fx.json("list_folders", json!({})).await.as_array().unwrap().len(), 2);

        let updated =
            fx.json("update_folder", json!({ "id": child_id, "description": "Nested" })).await;
        assert_eq!(updated["description"], "Nested");
        assert_eq!(updated["name"], "Child");
        assert_eq!(updated["folderId"], parent_id);

        let error = fx.err("update_folder", json!({ "id": "fl_missing" })).await;
        assert_eq!(error, "Folder with ID fl_missing not found");

        assert_eq!(
            fx.ok("delete_folder", json!({ "id": child_id })).await,
            format!("Deleted: Child ({child_id})")
        );
        assert_eq!(fx.json("get_folder", json!({ "id": child_id })).await, Value::Null);
        fx.finish().await;
    }

    #[tokio::test]
    async fn show_toast_reports_the_message() {
        let fx = Fixture::new(None).await;
        assert_eq!(
            fx.ok("show_toast", json!({ "message": "Hello", "icon": "info", "color": "success" }))
                .await,
            "✓ Toast shown: \"Hello\""
        );
        fx.finish().await;
    }
}
