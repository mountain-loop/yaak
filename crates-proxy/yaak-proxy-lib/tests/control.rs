use std::convert::Infallible;
use std::net::SocketAddr;
use std::path::Path;
use std::time::{Duration, Instant};

use bytes::Bytes;
use http_body_util::Full;
use hyper::body::Incoming;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use serde_json::{Value, json};
use tokio::net::TcpListener;
use yaak_models::models::{Folder, Workspace};
use yaak_models::util::UpdateSource;
use yaak_proxy_lib::client::{ControlClient, ProxyConnection};
use yaak_proxy_lib::control::{self, ControlInfo, ControlServer, Owner};
use yaak_proxy_lib::flows::{BodyEncoding, FlowFilter};
use yaak_proxy_lib::models::{Flow, FlowBody};
use yaak_proxy_lib::save::SaveFlowRequest;
use yaak_proxy_lib::settings::ProxySettings;
use yaak_proxy_lib::{ProxyCtx, ProxyState};
use yaak_rpc::RpcEventEmitter;

async fn route(_req: Request<Incoming>) -> Result<Response<Full<Bytes>>, Infallible> {
    Ok(Response::builder()
        .header("content-type", "application/json")
        .body(Full::from(r#"{"id":"ch_1","amount":42}"#))
        .unwrap())
}

async fn spawn_upstream() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            tokio::spawn(
                http1::Builder::new().serve_connection(TokioIo::new(tcp), service_fn(route)),
            );
        }
    });
    addr
}

/// A context over `dir` whose engine picks a free port, saving into Yaak's data in `client`.
fn ctx(dir: &Path, client: &Path) -> ProxyCtx {
    let settings = ProxySettings { port: 0, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.join("settings.json")).unwrap();
    let (events, _rx) = RpcEventEmitter::new();
    ProxyCtx::new(dir, events).unwrap().with_client_data_dir(client)
}

/// Sends one POST through the engine and waits for its flow.
async fn capture_flow(ctx: &ProxyCtx) -> Flow {
    let upstream = spawn_upstream().await;
    let url = format!("http://{upstream}/v1/charges?expand=customer");
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::http(format!("http://127.0.0.1:{}", ctx.port().unwrap())).unwrap())
        .build()
        .unwrap();
    let resp = client
        .post(&url)
        .header("content-type", "application/json")
        .header("authorization", "Bearer sk_test_123")
        .body(r#"{"amount":42}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.text().await.unwrap(), r#"{"id":"ch_1","amount":42}"#);

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let flows = ctx.db.with_conn(|db| db.find_all::<Flow>().unwrap());
        if let Some(flow) = flows.into_iter().find(|f| f.url == url) {
            return flow;
        }
        assert!(Instant::now() < deadline, "no flow for {url}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

/// A process id that is certainly not running.
fn dead_pid() -> u32 {
    let mut child = if cfg!(windows) {
        std::process::Command::new("cmd").args(["/C", "exit"]).spawn().unwrap()
    } else {
        std::process::Command::new("true").spawn().unwrap()
    };
    let pid = child.id();
    child.wait().unwrap();
    pid
}

#[tokio::test(flavor = "multi_thread")]
async fn round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    let server = ControlServer::start(ctx.clone()).unwrap();

    let info = control::read(dir.path()).unwrap();
    assert_eq!(&info, server.info());
    assert_eq!((info.pid, info.owner, info.proxy_port), (std::process::id(), Owner::App, None));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(dir.path().join("control.json")).unwrap().permissions();
        assert_eq!(mode.mode() & 0o777, 0o600);
    }

    // The token is required.
    let http = reqwest::Client::builder().no_proxy().build().unwrap();
    let url = format!("{}/status", info.base_url());
    assert_eq!(http.get(&url).send().await.unwrap().status(), 401);
    let wrong = http.get(&url).bearer_auth("not-the-token").send().await.unwrap();
    assert_eq!(wrong.status(), 401);

    let ProxyConnection::Live(client) = ProxyConnection::connect(dir.path()).unwrap() else {
        panic!("expected the live owner");
    };
    let status = client.status().await.unwrap();
    assert_eq!(
        (status.state, status.proxy_port, status.flow_count),
        (ProxyState::Stopped, None, 0)
    );

    let status = client.start(None).await.unwrap();
    assert_eq!(status.state, ProxyState::Running);
    assert_eq!(status.proxy_port, ctx.port());
    assert_eq!(control::read(dir.path()).unwrap().proxy_port, ctx.port());

    let flow = capture_flow(&ctx).await;

    let flows = client.flows(&FlowFilter::default()).await.unwrap();
    assert_eq!(flows.iter().map(|f| &f.id).collect::<Vec<_>>(), vec![&flow.id]);
    let following = FlowFilter { after: Some(flow.id.clone()), ..Default::default() };
    assert!(client.flows(&following).await.unwrap().is_empty());
    let filter = FlowFilter { status: Some("4xx".into()), ..Default::default() };
    assert!(client.flows(&filter).await.unwrap().is_empty());
    let search = FlowFilter { q: Some("CHARGES post 2xx".into()), ..Default::default() };
    assert_eq!(client.flows(&search).await.unwrap().len(), 1);
    let search = FlowFilter { q: Some("charges get".into()), ..Default::default() };
    assert!(client.flows(&search).await.unwrap().is_empty());

    let detail = client.flow(&flow.id, 8).await.unwrap();
    assert_eq!(detail.flow.method, "POST");
    let request_body = detail.request_body.unwrap();
    assert_eq!((request_body.data.as_str(), request_body.truncated), (r#"{"amount"#, true));
    assert_eq!(request_body.encoding, BodyEncoding::Utf8);
    let response = client.body(&flow.id, FlowBody::Response).await.unwrap();
    assert_eq!(response.data, br#"{"id":"ch_1","amount":42}"#);
    assert!(!response.truncated);

    let missing = client.flow("fl_missing", 8).await.unwrap_err();
    assert_eq!(missing, "No flow fl_missing");

    let har = client.har(&FlowFilter::default()).await.unwrap();
    assert_eq!(har.log.entries.len(), 1);
    assert_eq!(har.log.entries[0].request.post_data.as_ref().unwrap().text, r#"{"amount":42}"#);

    assert!(client.ca_pem().await.unwrap().starts_with("-----BEGIN CERTIFICATE-----"));

    let status = client.stop().await.unwrap();
    assert_eq!(
        (status.state, status.proxy_port, status.flow_count),
        (ProxyState::Stopped, None, 1)
    );
    assert_eq!(control::read(dir.path()).unwrap().proxy_port, None);

    let clear = http
        .post(format!("{}/flows/clear", info.base_url()))
        .bearer_auth(&info.token)
        .send()
        .await
        .unwrap();
    assert_eq!(clear.json::<control::ClearResponse>().await.unwrap().cleared, 1);
    assert!(client.flows(&FlowFilter::default()).await.unwrap().is_empty());
    assert!(client.body(&flow.id, FlowBody::Response).await.is_err());

    drop(server);
    assert!(!dir.path().join("control.json").exists());
    assert!(control::live_owner(dir.path()).is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn one_owner_at_a_time() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    let first = ControlServer::start(ctx.clone()).unwrap();

    let err = ControlServer::start(ctx.clone()).err().unwrap();
    assert!(err.contains("already running in Yaak Proxy"), "{err}");
    assert_eq!(control::read(dir.path()).unwrap(), *first.info());
}

#[tokio::test(flavor = "multi_thread")]
async fn stale_control_file_is_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path()).with_owner(Owner::Cli);

    // A daemon that died without cleaning up, and one whose pid is alive (ours) but whose
    // control port answers nothing, as after the OS reuses a pid.
    let unused_port = TcpListener::bind("127.0.0.1:0").await.unwrap().local_addr().unwrap().port();
    for pid in [dead_pid(), std::process::id()] {
        let stale = ControlInfo {
            pid,
            control_port: unused_port,
            proxy_port: Some(9090),
            token: "stale".into(),
            owner: Owner::Cli,
            started_at: chrono::Utc::now(),
        };
        std::fs::write(dir.path().join("control.json"), serde_json::to_vec(&stale).unwrap())
            .unwrap();
        assert!(control::live_owner(dir.path()).is_none());
        assert!(!dir.path().join("control.json").exists(), "stale file left for pid {pid}");

        std::fs::write(dir.path().join("control.json"), serde_json::to_vec(&stale).unwrap())
            .unwrap();
        let server = ControlServer::start(ctx.clone()).unwrap();
        let info = control::read(dir.path()).unwrap();
        assert_eq!((info.pid, info.owner), (std::process::id(), Owner::Cli));
        assert_ne!(info.token, "stale");
        drop(server);
    }

    // A file that does not parse is never a claim in progress, since claims are published whole.
    std::fs::write(dir.path().join("control.json"), "{\"pid\": 12").unwrap();
    let server = ControlServer::start(ctx.clone()).unwrap();
    assert_eq!(control::read(dir.path()).unwrap(), *server.info());
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_reaches_a_cli_owner() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path()).with_owner(Owner::Cli);
    let mut server = ControlServer::start(ctx.clone()).unwrap();
    let stop_rx = server.take_stop_rx().unwrap();

    // The daemon exits as soon as it hears the stop, and the stop is still answered.
    let daemon = std::thread::spawn(move || {
        stop_rx.recv().unwrap();
        drop(server);
    });
    let client = ControlClient::new(control::read(dir.path()).unwrap());
    client.start(None).await.unwrap();
    let status = client.stop().await.unwrap();
    assert_eq!(status.state, ProxyState::Stopped);
    daemon.join().unwrap();
    assert_eq!(ctx.port(), None);
    assert!(!dir.path().join("control.json").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn offline_reads_proxy_db() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let flow = {
        let ctx = ctx(dir.path(), client_dir.path());
        ctx.start().unwrap();
        let flow = capture_flow(&ctx).await;
        ctx.stop().unwrap();
        flow
    };

    let connection = ProxyConnection::connect(dir.path()).unwrap();
    assert!(matches!(connection, ProxyConnection::Offline(_)));
    let flows = connection.flows(&FlowFilter::default()).await.unwrap();
    assert_eq!(flows.iter().map(|f| &f.id).collect::<Vec<_>>(), vec![&flow.id]);
    let detail = connection.flow(&flow.id, 1024).await.unwrap();
    assert_eq!(detail.response_body.unwrap().data, r#"{"id":"ch_1","amount":42}"#);
    let body = connection.body(&flow.id, FlowBody::Request).await.unwrap();
    assert_eq!(body.data, br#"{"amount":42}"#);
    let posts = FlowFilter { method: Some("post".into()), ..Default::default() };
    assert_eq!(connection.har(&posts).await.unwrap().log.entries.len(), 1);

    let empty = tempfile::tempdir().unwrap();
    let err = ProxyConnection::connect(empty.path()).err().unwrap();
    assert!(err.starts_with("No captured traffic yet"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn save_writes_the_request_into_yaak() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();

    // Yaak's database, with a workspace and a folder in it.
    let (query_manager, _blobs, _rx) = yaak_models::init_standalone(
        client_dir.path().join("db.sqlite"),
        client_dir.path().join("blobs.sqlite"),
    )
    .unwrap();
    let (workspace, folder) = query_manager
        .with_tx(|tx| {
            let workspace = tx.upsert_workspace(
                &Workspace { name: "Payments".into(), ..Default::default() },
                &UpdateSource::Background,
            )?;
            let folder = tx.upsert_folder(
                &Folder {
                    name: "Stripe".into(),
                    workspace_id: workspace.id.clone(),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?;
            Ok::<_, yaak_models::error::Error>((workspace, folder))
        })
        .unwrap();

    let ctx = ctx(dir.path(), client_dir.path());
    let _server = ControlServer::start(ctx.clone()).unwrap();
    ctx.start().unwrap();
    let flow = capture_flow(&ctx).await;
    let client = ControlClient::new(control::read(dir.path()).unwrap());

    let workspaces = client.workspaces().await.unwrap();
    assert_eq!(workspaces.len(), 1);
    assert_eq!(
        (workspaces[0].id.as_str(), workspaces[0].name.as_str()),
        (workspace.id.as_str(), "Payments")
    );
    assert_eq!(workspaces[0].folders[0].id, folder.id);

    let target = SaveFlowRequest {
        workspace_id: workspace.id.clone(),
        folder_id: Some(folder.id.clone()),
        name: Some("Create charge".into()),
    };
    let saved = client.save(&flow.id, &target).await.unwrap();
    let dropped: Vec<&str> = saved.dropped_headers.iter().map(|h| h.name.as_str()).collect();
    assert!(dropped.contains(&"host") && dropped.contains(&"content-length"), "{dropped:?}");
    assert_eq!(
        saved.warnings,
        vec!["The Authorization header is saved as captured, in plain text."]
    );

    // The row is in Yaak's database, written as a sync so a running Yaak picks it up.
    let request = query_manager.connect().get_http_request(&saved.request.id).unwrap();
    assert_eq!(request.name, "Create charge");
    assert_eq!(
        (request.workspace_id, request.folder_id),
        (workspace.id.clone(), Some(folder.id.clone()))
    );
    assert_eq!(request.method, "POST");
    assert!(request.url.ends_with("/v1/charges"), "{}", request.url);
    assert_eq!(request.url_parameters[0].name, "expand");
    assert_eq!(request.body_type.as_deref(), Some("application/json"));
    assert_eq!(request.body["text"], r#"{"amount":42}"#);
    let auth = request.headers.iter().find(|h| h.name == "authorization").unwrap();
    assert_eq!(auth.value, "Bearer sk_test_123");
    let db = rusqlite::Connection::open(client_dir.path().join("db.sqlite")).unwrap();
    let source: String = db
        .query_row(
            "SELECT update_source FROM model_changes WHERE model_id = ?",
            [&saved.request.id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(source.contains("sync"), "{source}");

    // The flow remembers what it was saved as.
    let flow = yaak_proxy_lib::flows::get(&ctx.db, &flow.id).unwrap();
    assert_eq!(flow.saved_request_id, Some(saved.request.id));

    // Without a name, through the control API as the CLI saves, it stays unnamed, as Yaak
    // leaves a new request, so Yaak shows its URL.
    for name in [None, Some("  ".to_string())] {
        let target = SaveFlowRequest { workspace_id: workspace.id.clone(), folder_id: None, name };
        let saved = client.save(&flow.id, &target).await.unwrap();
        let request = query_manager.connect().get_http_request(&saved.request.id).unwrap();
        assert_eq!(request.name, "");
    }

    let wrong = SaveFlowRequest { workspace_id: "wk_missing".into(), ..Default::default() };
    assert!(client.save(&flow.id, &wrong).await.unwrap_err().contains("No workspace"));
}

#[tokio::test(flavor = "multi_thread")]
async fn stale_removal_waits_for_the_claim_lock() {
    let dir = tempfile::tempdir().unwrap();
    let stale = ControlInfo {
        pid: dead_pid(),
        control_port: 1,
        proxy_port: None,
        token: "stale".into(),
        owner: Owner::Cli,
        started_at: chrono::Utc::now(),
    };
    let path = dir.path().join("control.json");
    std::fs::write(&path, serde_json::to_vec(&stale).unwrap()).unwrap();

    // Another process mid-claim holds the lock; it may be about to replace the stale file.
    let lock = std::fs::File::create(dir.path().join("control.lock")).unwrap();
    lock.lock().unwrap();
    let data_dir = dir.path().to_path_buf();
    let cleaner = std::thread::spawn(move || control::live_owner(&data_dir));
    std::thread::sleep(Duration::from_millis(300));
    assert!(path.exists(), "the stale file was removed under another process's claim lock");

    lock.unlock().unwrap();
    assert!(cleaner.join().unwrap().is_none());
    assert!(!path.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn start_is_refused_while_another_process_owns_the_engine() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());

    // A live CLI daemon: a running process, and a control port that answers.
    let mut daemon = if cfg!(windows) {
        std::process::Command::new("ping").args(["-n", "30", "127.0.0.1"]).spawn().unwrap()
    } else {
        std::process::Command::new("sleep").arg("30").spawn().unwrap()
    };
    let control_port = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let owner = ControlInfo {
        pid: daemon.id(),
        control_port: control_port.local_addr().unwrap().port(),
        proxy_port: Some(9090),
        token: "daemon".into(),
        owner: Owner::Cli,
        started_at: chrono::Utc::now(),
    };
    std::fs::write(dir.path().join("control.json"), serde_json::to_vec(&owner).unwrap()).unwrap();

    let err = ctx.start().unwrap_err();
    assert!(err.contains("already running in the yaak CLI"), "{err}");
    assert_eq!(ctx.port(), None);

    daemon.kill().unwrap();
    daemon.wait().unwrap();
}

async fn rpc(ctx: &ProxyCtx, cmd: &str, payload: Value) -> Result<Value, String> {
    yaak_proxy_lib::build_router().dispatch(cmd, payload, ctx).await.map_err(|e| e.message)
}

#[tokio::test(flavor = "multi_thread")]
async fn the_app_takes_over_from_the_cli() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let cli = ctx(dir.path(), client_dir.path()).with_owner(Owner::Cli);
    let mut server = ControlServer::start(cli.clone()).unwrap();
    let stop_rx = server.take_stop_rx().unwrap();
    // The daemon exits as soon as it hears the stop.
    let daemon = std::thread::spawn(move || {
        stop_rx.recv().unwrap();
        drop(server);
    });
    cli.start().unwrap();
    let cli_port = cli.port().unwrap();

    // The app opens onto the CLI's engine and cannot start its own.
    let app = ctx(dir.path(), client_dir.path());
    assert!(app.serve_control_api().unwrap_err().contains("already running in the yaak CLI"));
    let state = rpc(&app, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!(state["state"], "stopped");
    assert_eq!(state["otherOwner"]["owner"], "cli");
    assert_eq!(state["otherOwner"]["proxyPort"], cli_port);
    assert_eq!(state["otherOwner"]["pid"], std::process::id());

    assert_eq!(rpc(&app, "take_over", json!({})).await.unwrap(), json!(true));
    daemon.join().unwrap();
    assert_eq!(cli.port(), None);
    assert!(app.port().is_some());
    let owner = control::read(dir.path()).unwrap();
    assert_eq!((owner.owner, owner.proxy_port), (Owner::App, app.port()));
    let state = rpc(&app, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!((state["state"].as_str(), &state["otherOwner"]), (Some("running"), &Value::Null));

    // Taking over with no one else holding the engine only starts it.
    assert_eq!(rpc(&app, "take_over", json!({})).await.unwrap(), json!(true));
    app.stop().unwrap();
    app.stop_control_api();
    assert!(control::live_owner(dir.path()).is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn the_save_dialog_reads_workspaces_previews_and_saves() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    ctx.start().unwrap();
    let flow = capture_flow(&ctx).await;

    // Before Yaak has ever run there is nothing to save into, and the dialog says so.
    let listed = rpc(&ctx, "list_workspaces", json!({})).await.unwrap();
    assert_eq!(listed, json!({ "yaakFound": false, "workspaces": [] }));

    let (query_manager, _blobs, _rx) = yaak_models::init_standalone(
        client_dir.path().join("db.sqlite"),
        client_dir.path().join("blobs.sqlite"),
    )
    .unwrap();
    let (workspace, folder) = query_manager
        .with_tx(|tx| {
            let workspace = tx.upsert_workspace(
                &Workspace { name: "Payments".into(), ..Default::default() },
                &UpdateSource::Background,
            )?;
            let folder = tx.upsert_folder(
                &Folder {
                    name: "Stripe".into(),
                    workspace_id: workspace.id.clone(),
                    ..Default::default()
                },
                &UpdateSource::Background,
            )?;
            Ok::<_, yaak_models::error::Error>((workspace, folder))
        })
        .unwrap();

    let listed = rpc(&ctx, "list_workspaces", json!({})).await.unwrap();
    assert_eq!(listed["yaakFound"], true);
    assert_eq!(listed["workspaces"][0]["name"], "Payments");
    assert_eq!(listed["workspaces"][0]["folders"][0]["id"], folder.id.as_str());

    let preview = rpc(&ctx, "preview_save", json!({ "flowId": flow.id })).await.unwrap();
    assert_eq!(preview["method"], "POST");
    assert!(preview["requestUrl"].as_str().unwrap().ends_with("/v1/charges"), "{preview}");
    assert_eq!(preview["bodyType"], "application/json");
    assert_eq!(preview["body"], "JSON");
    assert_eq!(preview["authorization"], true);
    let dropped: Vec<&str> = preview["droppedHeaders"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["name"].as_str().unwrap())
        .collect();
    assert!(dropped.iter().any(|h| h.eq_ignore_ascii_case("host")), "{dropped:?}");
    assert!(dropped.iter().any(|h| h.eq_ignore_ascii_case("content-length")), "{dropped:?}");
    assert!(!dropped.iter().any(|h| h.eq_ignore_ascii_case("authorization")), "{dropped:?}");
    assert_eq!(
        preview["keptHeaders"].as_u64().unwrap() as usize + dropped.len(),
        flow.request_headers.len()
    );
    assert!(preview["warnings"][0].as_str().unwrap().contains("Authorization"));

    let saved = rpc(
        &ctx,
        "save_flow",
        json!({
            "flowId": flow.id,
            "workspaceId": workspace.id,
            "folderId": folder.id,
            "name": "Create charge",
        }),
    )
    .await
    .unwrap();
    assert_eq!(saved["name"], "Create charge");
    let request_id = saved["requestId"].as_str().unwrap();
    let request = query_manager.connect().get_http_request(request_id).unwrap();
    assert_eq!(
        (request.workspace_id.as_str(), request.folder_id.as_deref()),
        (workspace.id.as_str(), Some(folder.id.as_str()))
    );
    let stored = ctx
        .db
        .with_conn(|db| db.find_one::<Flow>(yaak_proxy_lib::models::FlowIden::Id, &flow.id))
        .unwrap();
    assert_eq!(stored.saved_request_id.as_deref(), Some(request_id));

    // A workspace that is gone is an error the dialog can show.
    let err = rpc(&ctx, "save_flow", json!({ "flowId": flow.id, "workspaceId": "wk_gone" }))
        .await
        .unwrap_err();
    assert!(err.contains("No workspace wk_gone"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn export_har_writes_the_flows_asked_for() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    ctx.start().unwrap();
    let first = capture_flow(&ctx).await;
    let second = capture_flow(&ctx).await;
    let read =
        |path: &Path| -> Value { serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap() };

    let selected = dir.path().join("selected.har");
    let written =
        rpc(&ctx, "export_har", json!({ "path": selected, "ids": [first.id] })).await.unwrap();
    assert_eq!(written, 1);
    assert_eq!(read(&selected)["log"]["entries"].as_array().unwrap().len(), 1);

    let searched = dir.path().join("searched.har");
    let filter = json!({ "q": "charges", "limit": 1 });
    let written =
        rpc(&ctx, "export_har", json!({ "path": searched, "filter": filter })).await.unwrap();
    // The whole search, not the page the list had loaded.
    assert_eq!(written, 2);
    let entries = read(&searched)["log"]["entries"].as_array().unwrap().len();
    assert_eq!(entries, 2);
    assert_ne!(first.id, second.id);

    let none = dir.path().join("none.har");
    let written =
        rpc(&ctx, "export_har", json!({ "path": none, "filter": { "q": "nothing-matches" } }))
            .await
            .unwrap();
    assert_eq!(written, 0);
}

/// curl, through the engine, shows as the app behind its flow.
#[cfg(target_os = "macos")]
#[tokio::test(flavor = "multi_thread")]
async fn flows_name_the_app_that_sent_them() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    ctx.start().unwrap();
    let upstream = spawn_upstream().await;
    let url = format!("http://{upstream}/attributed");

    let mut curl = std::process::Command::new("/usr/bin/curl")
        .args(["-s", "-o", "/dev/null", "--max-time", "10", "--noproxy", ""])
        .args([
            "-x",
            &format!("http://127.0.0.1:{}", ctx.port().unwrap()),
            &url,
        ])
        .spawn()
        .unwrap();
    let curl_pid = curl.id() as i32;
    assert!(curl.wait().unwrap().success());

    let deadline = Instant::now() + Duration::from_secs(5);
    let flow = loop {
        let flows = ctx.db.with_conn(|db| db.find_all::<Flow>().unwrap());
        if let Some(flow) = flows.into_iter().find(|f| f.url == url) {
            break flow;
        }
        assert!(Instant::now() < deadline, "no flow for {url}");
        tokio::time::sleep(Duration::from_millis(20)).await;
    };
    assert_eq!(flow.client_name.as_deref(), Some("curl"));
    assert_eq!(flow.client_pid, Some(curl_pid));
    assert_eq!(flow.client_bundle_id, None);
    assert_eq!(flow.client_path.as_deref(), Some("/usr/bin/curl"));

    // The search and the sidebar's Apps group find it by its path.
    let filter = FlowFilter { app: Some(vec!["/usr/bin/curl".into()]), ..Default::default() };
    assert_eq!(yaak_proxy_lib::flows::list(&ctx.db, &filter).unwrap().len(), 1);
}

/// Sends one GET through the engine, without waiting for a flow.
async fn send_through(ctx: &ProxyCtx, path: &str) -> String {
    let upstream = spawn_upstream().await;
    let url = format!("http://{upstream}{path}");
    let client = reqwest::Client::builder()
        .proxy(reqwest::Proxy::http(format!("http://127.0.0.1:{}", ctx.port().unwrap())).unwrap())
        .build()
        .unwrap();
    let resp = client.get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 200, "traffic passes through either way");
    url
}

#[tokio::test(flavor = "multi_thread")]
async fn pausing_stores_no_flows_and_resuming_stores_them_again() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    let _server = ControlServer::start(ctx.clone()).unwrap();
    ctx.start().unwrap();
    let client = ControlClient::new(control::read(dir.path()).unwrap());
    assert!(client.status().await.unwrap().recording);

    // Paused from the app.
    assert_eq!(rpc(&ctx, "set_recording", json!({ "enabled": false })).await.unwrap(), false);
    let state = rpc(&ctx, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!((state["state"].as_str(), &state["recording"]), (Some("running"), &json!(false)));
    let paused = send_through(&ctx, "/while-paused").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let flows = ctx.db.with_conn(|db| db.find_all::<Flow>().unwrap());
    assert!(flows.iter().all(|f| f.url != paused), "a flow was stored while paused");
    assert!(ctx.blobs.connect().list_body_ids().unwrap().is_empty(), "a body was stored");

    // Resumed through the control API, as the CLI would.
    let status = client.set_recording(true).await.unwrap();
    assert!(status.recording);
    assert!(ctx.recording());
    let flow = capture_flow(&ctx).await;
    assert_eq!(flow.method, "POST");
    // And the hotkey's toggle pauses again.
    rpc(&ctx, "execute_action", json!({ "scope": "global", "action": "recording_toggle" }))
        .await
        .unwrap();
    assert!(!client.status().await.unwrap().recording);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_failed_start_is_kept_for_the_app_until_the_engine_starts() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());
    // Something else has the port.
    let taken = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = taken.local_addr().unwrap().port();
    let settings = ProxySettings { port, system_proxy_at_launch: false, ..Default::default() };
    settings.save(&dir.path().join("settings.json")).unwrap();

    assert!(ctx.start().is_err());
    let state = rpc(&ctx, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!(state["state"], "stopped");
    assert!(state["startError"].as_str().unwrap().contains(&port.to_string()), "{state}");

    drop(taken);
    ctx.start().unwrap();
    let state = rpc(&ctx, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!((state["state"].as_str(), &state["startError"]), (Some("running"), &Value::Null));
    ctx.stop().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn the_system_proxy_at_launch_setting_is_saved_and_routing_needs_an_engine() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    let ctx = ctx(dir.path(), client_dir.path());

    // Defaults on, like Proxyman.
    assert!(ProxySettings::default().system_proxy_at_launch);
    for enabled in [true, false] {
        rpc(&ctx, "set_system_proxy_at_launch", json!({ "enabled": enabled })).await.unwrap();
        assert_eq!(ctx.settings().unwrap().system_proxy_at_launch, enabled);
        let state = rpc(&ctx, "get_proxy_state", json!({})).await.unwrap();
        assert_eq!(state["systemProxyAtLaunch"], enabled);
    }

    // With no engine there is nothing to point the Mac at.
    let err = rpc(&ctx, "system_proxy_set", json!({ "enabled": true })).await.unwrap_err();
    assert!(err.contains("not running"), "{err}");
}

#[tokio::test(flavor = "multi_thread")]
async fn another_app_owning_the_engine_is_not_taken_over() {
    let dir = tempfile::tempdir().unwrap();
    let client_dir = tempfile::tempdir().unwrap();
    // Another app instance, whose engine a stop would halt without releasing its claim.
    let other = ctx(dir.path(), client_dir.path());
    let _server = ControlServer::start(other.clone()).unwrap();
    other.start().unwrap();

    let app = ctx(dir.path(), client_dir.path());
    let state = rpc(&app, "get_proxy_state", json!({})).await.unwrap();
    assert_eq!(state["otherOwner"]["owner"], "app");
    let err = rpc(&app, "take_over", json!({})).await.unwrap_err();
    assert_eq!(err, yaak_proxy_lib::ANOTHER_APP_OWNS);
    // Refused before touching it: the other app keeps running.
    assert!(other.port().is_some());
    assert_eq!(app.port(), None);
    other.stop().unwrap();
}
