//! The control API: how the CLI, MCP tools and a second app launch reach the process that owns
//! the engine. The owner serves JSON on `127.0.0.1:<random>` behind a bearer token and writes
//! where to find it to `control.json` in the proxy data directory (mode 0600). One owner at a
//! time: a file whose process is gone, or whose port no longer answers, is stale and replaced.

use crate::ca::{self, CaStatus};
use crate::flows::{self, FlowFilter};
use crate::har;
use crate::macos::SystemProxyStatus;
use crate::models::{FlowBody, find_header};
use crate::save::SaveFlowRequest;
use crate::{ProxyCtx, ProxyState, bodies};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use http_body_util::{BodyExt, Full, Limited};
use hyper::body::Incoming;
use hyper::header::{AUTHORIZATION, CONTENT_TYPE};
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use hyper_util::server::graceful::GracefulShutdown;
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tokio::net::TcpListener;
use ts_rs::TS;
use yaak_proxy::CaStore;

pub const CONTROL_FILE: &str = "control.json";
const LOCK_FILE: &str = "control.lock";
/// Body bytes `GET /flows/{id}` returns per side unless `bodyLimit` says otherwise.
pub const DEFAULT_BODY_PREVIEW_LIMIT: usize = 1024 * 1024;
const MAX_REQUEST_BODY: usize = 64 * 1024;
const LIVENESS_TIMEOUT: Duration = Duration::from_millis(500);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(5);

/// The process that runs the engine.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum Owner {
    App,
    Cli,
}

/// `control.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ControlInfo {
    pub pid: u32,
    pub control_port: u16,
    /// The engine's port while it runs.
    pub proxy_port: Option<u16>,
    pub token: String,
    pub owner: Owner,
    pub started_at: DateTime<Utc>,
}

impl ControlInfo {
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.control_port)
    }
}

pub fn control_path(data_dir: &Path) -> PathBuf {
    data_dir.join(CONTROL_FILE)
}

/// `control.json` as it is, live or stale. `None` when there is none or it does not parse.
pub fn read(data_dir: &Path) -> Option<ControlInfo> {
    let contents = std::fs::read_to_string(control_path(data_dir)).ok()?;
    serde_json::from_str(&contents).ok()
}

/// Held while `control.json` is checked and then removed or claimed, across processes, so two
/// of them cleaning up a stale file cannot delete each other's fresh claim. Released on drop.
fn claim_lock(data_dir: &Path) -> std::io::Result<std::fs::File> {
    std::fs::create_dir_all(data_dir)?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(data_dir.join(LOCK_FILE))?;
    file.lock()?;
    Ok(file)
}

/// The owner running the engine now. A stale `control.json` is removed on the way, as is one
/// that does not parse: it is only ever published whole, so that is never a claim in progress.
pub fn live_owner(data_dir: &Path) -> Option<ControlInfo> {
    let _lock = claim_lock(data_dir)
        .inspect_err(|e| warn!("Failed to lock {LOCK_FILE}, checking without it: {e}"))
        .ok();
    live_owner_locked(data_dir)
}

/// [`live_owner`] for a caller holding the claim lock.
fn live_owner_locked(data_dir: &Path) -> Option<ControlInfo> {
    let path = control_path(data_dir);
    let contents = std::fs::read_to_string(&path).ok()?;
    let Ok(info) = serde_json::from_str::<ControlInfo>(&contents) else {
        warn!("Removing unreadable {}", path.display());
        let _ = std::fs::remove_file(&path);
        return None;
    };
    if is_live(&info) {
        return Some(info);
    }
    info!("Removing stale {CONTROL_FILE} of {:?} pid {}", info.owner, info.pid);
    remove_if_token(data_dir, &info.token);
    None
}

/// The process is alive and its control port answers. The port check catches a pid the OS
/// has handed to some other process since the owner died.
fn is_live(info: &ControlInfo) -> bool {
    pid_alive(info.pid)
        && TcpStream::connect_timeout(
            &SocketAddr::from(([127, 0, 0, 1], info.control_port)),
            LIVENESS_TIMEOUT,
        )
        .is_ok()
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };
    // Signal 0 checks the process exists without signalling it; EPERM means it exists but is
    // someone else's.
    let alive = unsafe { libc::kill(pid, 0) } == 0;
    alive || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(not(unix))]
fn pid_alive(_pid: u32) -> bool {
    // The control port check decides.
    true
}

/// Removes `control.json` if it is still the one with `token`, so an owner never removes its
/// successor's file. The caller holds the claim lock.
fn remove_if_token(data_dir: &Path, token: &str) {
    if read(data_dir).is_some_and(|info| info.token == token) {
        let _ = std::fs::remove_file(control_path(data_dir));
    }
}

/// Writes `info` to `path`, readable by its owner alone and never seen half-written. With
/// `create_new`, fails when a file is already there, so two processes cannot both claim the
/// engine.
fn write_file(path: &Path, info: &ControlInfo, create_new: bool) -> std::io::Result<()> {
    let contents = serde_json::to_vec_pretty(info)?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    let _ = std::fs::remove_file(&tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(&tmp)?.write_all(&contents)?;
    let published = if create_new {
        // A link, unlike a rename, refuses to replace an existing file.
        std::fs::hard_link(&tmp, path).and_then(|_| std::fs::remove_file(&tmp))
    } else {
        std::fs::rename(&tmp, path)
    };
    if published.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    published
}

/// The owner's `control.json`, rewritten as the engine starts and stops.
pub(crate) struct ControlFile {
    path: PathBuf,
    pub(crate) info: ControlInfo,
}

impl ControlFile {
    pub(crate) fn set_proxy_port(&mut self, port: Option<u16>) {
        if self.info.proxy_port == port {
            return;
        }
        self.info.proxy_port = port;
        if let Err(e) = write_file(&self.path, &self.info, false) {
            warn!("Failed to update {}: {e}", self.path.display());
        }
    }
}

// -- Responses --

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStatus {
    pub owner: Owner,
    pub pid: u32,
    pub started_at: DateTime<Utc>,
    pub state: ProxyState,
    /// The engine's port while it runs.
    pub proxy_port: Option<u16>,
    /// The port the engine starts on.
    pub configured_port: u16,
    pub flow_count: usize,
    pub ca: CaStatus,
    /// `None` when it could not be read.
    pub system_proxy: Option<SystemProxyStatus>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct StartRequest {
    /// For this run only; `settings.json` keeps its port.
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemProxyRequest {
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorBody {
    pub error: String,
}

/// Raw body headers: whether the body is cut short, at the capture limit or on the wire.
pub const TRUNCATED_HEADER: &str = "x-yaak-truncated";

// -- Server --

/// The control server of the process that owns the engine. Dropping it stops serving and
/// removes `control.json`.
pub struct ControlServer {
    info: ControlInfo,
    data_dir: PathBuf,
    ctx: ProxyCtx,
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
    stop_rx: Option<std_mpsc::Receiver<()>>,
}

impl ControlServer {
    /// Claims the engine for this process and serves the control API for `ctx`. Fails when
    /// another live owner has it.
    pub fn start(ctx: ProxyCtx) -> Result<Self, String> {
        let data_dir = ctx.data_dir().to_path_buf();
        let path = control_path(&data_dir);
        if let Some(owner) = live_owner(&data_dir) {
            return Err(already_owned(&owner));
        }

        let (ready_tx, ready_rx) = std_mpsc::channel();
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let (stop_tx, stop_rx) = std_mpsc::channel();
        let token = yaak_database::generate_id_of_length(40);
        let state = Arc::new(ServerState { ctx: ctx.clone(), token: token.clone(), stop_tx });

        let thread = std::thread::spawn(move || {
            let rt = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .thread_name("yaak-proxy-control")
                .build()
            {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = ready_tx.send(Err(format!("Failed to create runtime: {e}")));
                    return;
                }
            };
            rt.block_on(async move {
                let listener = match TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0))).await
                {
                    Ok(l) => l,
                    Err(e) => {
                        let _ = ready_tx.send(Err(format!("Failed to bind control port: {e}")));
                        return;
                    }
                };
                let _ = ready_tx
                    .send(listener.local_addr().map(|a| a.port()).map_err(|e| e.to_string()));
                serve(listener, state, shutdown_rx).await;
            });
        });

        let control_port = match ready_rx.recv() {
            Ok(Ok(port)) => port,
            Ok(Err(e)) => return Err(e),
            Err(_) => return Err("Control thread died before binding".into()),
        };
        let info = ControlInfo {
            pid: std::process::id(),
            control_port,
            proxy_port: ctx.port(),
            token,
            owner: ctx.owner(),
            started_at: Utc::now(),
        };
        let mut server = Self {
            info: info.clone(),
            data_dir: data_dir.clone(),
            ctx: ctx.clone(),
            shutdown_tx: Some(shutdown_tx),
            thread: Some(thread),
            stop_rx: Some(stop_rx),
        };

        // Checked again under the lock: another process may have claimed it since.
        let claimed = claim_lock(&data_dir)
            .map_err(|e| format!("Failed to lock {LOCK_FILE}: {e}"))
            .and_then(|_lock| match live_owner_locked(&data_dir) {
                Some(owner) => Err(already_owned(&owner)),
                None => write_file(&path, &info, true)
                    .map_err(|e| format!("Failed to write {}: {e}", path.display())),
            });
        if let Err(e) = claimed {
            // Nothing of this server's to remove.
            server.info.token.clear();
            return Err(e);
        }
        ctx.set_control_file(Some(ControlFile { path, info }));
        info!("Control API listening on 127.0.0.1:{control_port}");
        Ok(server)
    }

    pub fn info(&self) -> &ControlInfo {
        &self.info
    }

    /// Receives once per `POST /stop`. A CLI daemon exits on it; the app only stops its engine.
    pub fn take_stop_rx(&mut self) -> Option<std_mpsc::Receiver<()>> {
        self.stop_rx.take()
    }
}

pub(crate) fn already_owned(owner: &ControlInfo) -> String {
    let who = match owner.owner {
        Owner::App => "Yaak Proxy",
        Owner::Cli => "the yaak CLI",
    };
    format!("The proxy is already running in {who} (pid {})", owner.pid)
}

impl Drop for ControlServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        if !self.info.token.is_empty() {
            self.ctx.set_control_file(None);
            let _lock = claim_lock(&self.data_dir).ok();
            remove_if_token(&self.data_dir, &self.info.token);
        }
    }
}

struct ServerState {
    ctx: ProxyCtx,
    token: String,
    stop_tx: std_mpsc::Sender<()>,
}

async fn serve(
    listener: TcpListener,
    state: Arc<ServerState>,
    mut shutdown_rx: tokio::sync::oneshot::Receiver<()>,
) {
    // Lets a request in flight at shutdown finish, such as the `POST /stop` a daemon exits on.
    let graceful = GracefulShutdown::new();
    loop {
        tokio::select! {
            result = listener.accept() => match result {
                Ok((stream, _)) => {
                    let state = state.clone();
                    let service = hyper::service::service_fn(move |req| {
                        let state = state.clone();
                        async move { Ok::<_, std::convert::Infallible>(handle(&state, req).await) }
                    });
                    let conn = hyper::server::conn::http1::Builder::new()
                        .serve_connection(TokioIo::new(stream), service);
                    let conn = graceful.watch(conn);
                    tokio::spawn(async move {
                        let _ = conn.await;
                    });
                }
                Err(e) => warn!("Control accept error: {e}"),
            },
            _ = &mut shutdown_rx => break,
        }
    }
    drop(listener);
    if tokio::time::timeout(SHUTDOWN_GRACE, graceful.shutdown()).await.is_err() {
        warn!("Control connections were still open after {SHUTDOWN_GRACE:?}");
    }
}

type ControlResponse = Response<Full<Bytes>>;

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

impl From<String> for ApiError {
    fn from(message: String) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

async fn handle(state: &ServerState, req: Request<Incoming>) -> ControlResponse {
    if !authorized(&req, &state.token) {
        return error_response(ApiError::new(
            StatusCode::UNAUTHORIZED,
            "Missing or wrong bearer token; it is in control.json",
        ));
    }
    match route(state, req).await {
        Ok(resp) => resp,
        Err(e) => error_response(e),
    }
}

fn authorized(req: &Request<Incoming>, token: &str) -> bool {
    let Some(given) = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
    else {
        return false;
    };
    // Compares every byte, so the time taken says nothing about how much matched.
    given.len() == token.len()
        && given.bytes().zip(token.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

async fn route(state: &ServerState, req: Request<Incoming>) -> Result<ControlResponse, ApiError> {
    let ctx = &state.ctx;
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let query = req.uri().query().unwrap_or_default().to_string();
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    match (&method, segments.as_slice()) {
        (&Method::GET, ["status"]) => json(&status(ctx).await?),
        (&Method::POST, ["start"]) => {
            let body: StartRequest = read_json(req).await?;
            ctx.start_on(body.port)?;
            json(&status(ctx).await?)
        }
        (&Method::POST, ["stop"]) => {
            ctx.stop()?;
            let _ = state.stop_tx.send(());
            json(&status(ctx).await?)
        }
        (&Method::GET, ["flows"]) => {
            let filter = FlowFilter::from_query(&query).map_err(bad_request)?;
            json(&flows::list(&ctx.db, &filter)?)
        }
        (&Method::GET, ["flows", id]) => {
            found(ctx, id)?;
            let limit = body_limit(&query)?;
            json(&flows::detail(&ctx.db, &ctx.blobs, id, limit).await?)
        }
        (&Method::GET, ["flows", id, "request-body"]) => raw_body(ctx, id, FlowBody::Request).await,
        (&Method::GET, ["flows", id, "response-body"]) => {
            raw_body(ctx, id, FlowBody::Response).await
        }
        (&Method::POST, ["flows", id, "save"]) => {
            found(ctx, id)?;
            let id = id.to_string();
            let body: SaveFlowRequest = read_json(req).await?;
            json(&ctx.save_flow(&id, &body).await.map_err(bad_request)?)
        }
        (&Method::GET, ["har"]) => {
            let filter = FlowFilter::from_query(&query).map_err(bad_request)?;
            let flows = flows::list(&ctx.db, &filter)?;
            json(&har::export(&ctx.blobs, &flows, ctx.capture_body_limit()?).await?)
        }
        (&Method::GET, ["ca"]) => {
            let ca = CaStore::load_or_create(&ctx.ca_dir())
                .map_err(|e| format!("Failed to load proxy CA: {e}"))?;
            Ok(response(StatusCode::OK, "application/x-pem-file", ca.pem().to_string()))
        }
        (&Method::POST, ["ca", "trust"]) => {
            let ca = CaStore::load_or_create(&ctx.ca_dir())
                .map_err(|e| format!("Failed to load proxy CA: {e}"))?;
            ca::trust(ca.cert_path()).await.map_err(bad_request)?;
            json(&ca::status(ca.cert_path()).await?)
        }
        (&Method::GET, ["system-proxy"]) => {
            let ctx = ctx.clone();
            json(&blocking(move || ctx.system_proxy_status()).await?)
        }
        (&Method::POST, ["system-proxy"]) => {
            let body: SystemProxyRequest = read_json(req).await?;
            let ctx = ctx.clone();
            json(&blocking(move || ctx.set_system_proxy(body.enabled)).await.map_err(bad_request)?)
        }
        (&Method::GET, ["workspaces"]) => json(&ctx.workspaces().map_err(bad_request)?),
        _ => Err(ApiError::new(StatusCode::NOT_FOUND, format!("No route {method} {path}"))),
    }
}

async fn status(ctx: &ProxyCtx) -> Result<ControlStatus, ApiError> {
    let control =
        ctx.control_info().ok_or_else(|| "The control API is shutting down".to_string())?;
    let proxy_port = ctx.port();
    let ca = ca::status(&ctx.ca_dir().join("ca.pem")).await?;
    let system_proxy = {
        let ctx = ctx.clone();
        blocking(move || ctx.system_proxy_status()).await.ok()
    };
    Ok(ControlStatus {
        owner: control.owner,
        pid: control.pid,
        started_at: control.started_at,
        state: if proxy_port.is_some() { ProxyState::Running } else { ProxyState::Stopped },
        proxy_port,
        configured_port: ctx.settings()?.port,
        flow_count: flows::count(&ctx.db)?,
        ca,
        system_proxy,
    })
}

fn found(ctx: &ProxyCtx, id: &str) -> Result<(), ApiError> {
    match flows::find(&ctx.db, id) {
        Some(_) => Ok(()),
        None => Err(ApiError::new(StatusCode::NOT_FOUND, format!("No flow {id}"))),
    }
}

async fn raw_body(ctx: &ProxyCtx, id: &str, which: FlowBody) -> Result<ControlResponse, ApiError> {
    let flow = flows::find(&ctx.db, id)
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, format!("No flow {id}")))?;
    let body = bodies::read_body(&ctx.blobs, &flow, which, ctx.capture_body_limit()?).await?;
    let content_type =
        find_header(flow.headers(which), "content-type").unwrap_or("application/octet-stream");
    let mut resp = response(StatusCode::OK, content_type, body.data);
    resp.headers_mut().insert(TRUNCATED_HEADER, body.truncated.to_string().parse().unwrap());
    Ok(resp)
}

fn body_limit(query: &str) -> Result<usize, ApiError> {
    for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
        if key == "bodyLimit" {
            return value.parse().map_err(|_| bad_request(format!("Invalid bodyLimit {value:?}")));
        }
    }
    Ok(DEFAULT_BODY_PREVIEW_LIMIT)
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The JSON request body; an empty one reads as `{}`.
async fn read_json<T: serde::de::DeserializeOwned>(req: Request<Incoming>) -> Result<T, ApiError> {
    let bytes = Limited::new(req.into_body(), MAX_REQUEST_BODY)
        .collect()
        .await
        .map_err(|e| bad_request(format!("Failed to read the request body: {e}")))?
        .to_bytes();
    let bytes: &[u8] = if bytes.iter().all(u8::is_ascii_whitespace) { b"{}" } else { &bytes };
    serde_json::from_slice(bytes).map_err(|e| bad_request(format!("Invalid JSON body: {e}")))
}

fn bad_request(message: String) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, message)
}

fn json<T: Serialize>(value: &T) -> Result<ControlResponse, ApiError> {
    let body = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    Ok(response(StatusCode::OK, "application/json", body))
}

fn error_response(e: ApiError) -> ControlResponse {
    let body = serde_json::to_vec(&ErrorBody { error: e.message }).unwrap_or_default();
    response(e.status, "application/json", body)
}

fn response(status: StatusCode, content_type: &str, body: impl Into<Bytes>) -> ControlResponse {
    let mut resp = Response::new(Full::new(body.into()));
    *resp.status_mut() = status;
    if let Ok(value) = content_type.parse() {
        resp.headers_mut().insert(CONTENT_TYPE, value);
    }
    resp
}
