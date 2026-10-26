pub mod actions;
pub mod bodies;
pub mod ca;
pub mod client;
pub mod control;
pub mod convert;
pub mod db;
pub mod flows;
pub mod har;
pub mod macos;
pub mod models;
pub mod save;
pub mod settings;

use crate::actions::{ActionInvocation, ActionMetadata, GlobalAction};
use crate::ca::CaStatus;
use crate::control::{ControlFile, ControlInfo, Owner};
use crate::db::ProxyQueryManager;
use crate::macos::{SystemProxyBackend, SystemProxyStatus};
use crate::models::{Flow, FlowBody, FlowIden, ModelPayload, ProxyHeader, find_header};
use crate::save::{ClientDb, SaveFlowRequest, SaveFlowResponse, WorkspaceSummary};
use crate::settings::ProxySettings;
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use chrono::{DateTime, Utc};
use log::{info, warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use ts_rs::TS;
use yaak_database::{ModelChangeEvent, UpdateSource, UpsertModelInfo};
use yaak_models::blob_manager::{BlobManager, BodyChunkWriter};
use yaak_proxy::{CaStore, ProxyConfig, ProxyEvent, ProxyHandle};
use yaak_rpc::{RpcError, RpcEventEmitter, define_rpc};

// -- Context --

// Cloned once per dispatched command, so shared state lives behind an `Arc`.
#[derive(Clone)]
pub struct ProxyCtx {
    handle: Arc<Mutex<Option<ProxyHandle>>>,
    data_dir: PathBuf,
    owner: Owner,
    client_data_dir: PathBuf,
    control: Arc<Mutex<Option<ControlFile>>>,
    pub db: ProxyQueryManager,
    pub blobs: BlobManager,
    pub events: RpcEventEmitter,
}

impl ProxyCtx {
    /// Opens `proxy.db` and `blobs.sqlite` in `data_dir`, the proxy app's data directory.
    pub fn new(data_dir: &Path, events: RpcEventEmitter) -> Result<Self, String> {
        let db = ProxyQueryManager::new(&data_dir.join("proxy.db"))
            .map_err(|e| format!("Failed to open proxy database: {e}"))?;
        let blobs = yaak_models::init_blob_store(data_dir.join("blobs.sqlite"))
            .map_err(|e| format!("Failed to open proxy blob store: {e}"))?;
        Ok(Self {
            handle: Arc::new(Mutex::new(None)),
            data_dir: data_dir.to_path_buf(),
            owner: Owner::App,
            client_data_dir: save::client_data_dir(),
            control: Arc::new(Mutex::new(None)),
            db,
            blobs,
            events,
        })
    }

    /// The process this runs in, which decides how the system proxy gets admin rights.
    pub fn with_owner(mut self, owner: Owner) -> Self {
        self.owner = owner;
        self
    }

    /// Yaak's data directory, where flows are saved as requests.
    pub fn with_client_data_dir(mut self, dir: impl Into<PathBuf>) -> Self {
        self.client_data_dir = dir.into();
        self
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn owner(&self) -> Owner {
        self.owner
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    pub fn settings(&self) -> Result<ProxySettings, String> {
        ProxySettings::load(&self.settings_path())
    }

    pub fn capture_body_limit(&self) -> Result<usize, String> {
        Ok(self.settings()?.capture_body_limit)
    }

    /// Starts the engine with the current `settings.json`. Does nothing if it is running.
    pub fn start(&self) -> Result<(), String> {
        self.start_on(None)
    }

    /// Starts the engine on `port`, or the one in `settings.json`. Does nothing if it is
    /// running. Points the system proxy at it when the settings ask for that.
    pub fn start_on(&self, port: Option<u16>) -> Result<(), String> {
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        if handle.is_some() {
            return Ok(());
        }

        let settings = self.settings()?;
        let ca = CaStore::load_or_create(&self.ca_dir())
            .map_err(|e| format!("Failed to load proxy CA: {e}"))?;
        let mut config = ProxyConfig::new(port.unwrap_or(settings.port), Arc::new(ca));
        config.capture_body_limit = settings.capture_body_limit;
        let mut proxy_handle = yaak_proxy::start_proxy(config)?;

        if let Some(event_rx) = proxy_handle.take_event_rx() {
            let db = self.db.clone();
            let blobs = self.blobs.clone();
            let events = self.events.clone();
            std::thread::spawn(move || run_event_loop(event_rx, db, blobs, events));
        }

        let bound = proxy_handle.port;
        *handle = Some(proxy_handle);
        drop(handle);
        self.set_control_proxy_port(Some(bound));
        if settings.system_proxy {
            // The password dialog can sit open for a while; the engine is up regardless.
            let backend = self.system_proxy_backend();
            std::thread::spawn(move || {
                if let Err(e) = macos::set(true, bound, backend) {
                    warn!("Failed to turn on the system proxy: {e}");
                }
            });
        }
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Running });
        Ok(())
    }

    /// Stops the engine and turns off a system proxy that points at it.
    pub fn stop(&self) -> Result<(), String> {
        let port = self.take_handle()?;
        if let Some(port) = port {
            let backend = self.system_proxy_backend();
            std::thread::spawn(move || {
                if let Err(e) = macos::set(false, port, backend) {
                    warn!("Failed to turn off the system proxy: {e}");
                }
            });
        }
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Stopped });
        Ok(())
    }

    /// [`Self::stop`] for a process about to exit: waits for the system proxy to be off.
    pub fn shutdown(&self) {
        if let Ok(Some(port)) = self.take_handle()
            && let Err(e) = macos::set(false, port, self.system_proxy_backend())
        {
            warn!("Failed to turn off the system proxy: {e}");
        }
    }

    /// Stops the engine, returning the port it was on.
    fn take_handle(&self) -> Result<Option<u16>, String> {
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        // Dropping the handle stops the listener and joins its thread.
        let port = handle.take().map(|h| h.port);
        drop(handle);
        self.set_control_proxy_port(None);
        Ok(port)
    }

    /// The port the engine is bound to, while it runs.
    pub fn port(&self) -> Option<u16> {
        self.handle.lock().ok()?.as_ref().map(|h| h.port)
    }

    pub fn ca_dir(&self) -> PathBuf {
        self.data_dir.join("ca")
    }

    pub(crate) fn set_control_file(&self, file: Option<ControlFile>) {
        if let Ok(mut control) = self.control.lock() {
            *control = file;
        }
    }

    /// This process's `control.json`, while it serves the control API.
    pub fn control_info(&self) -> Option<ControlInfo> {
        self.control.lock().ok()?.as_ref().map(|c| c.info.clone())
    }

    fn set_control_proxy_port(&self, port: Option<u16>) {
        if let Ok(mut control) = self.control.lock()
            && let Some(control) = control.as_mut()
        {
            control.set_proxy_port(port);
        }
    }

    pub fn system_proxy_backend(&self) -> SystemProxyBackend {
        match self.owner {
            Owner::App => SystemProxyBackend::AdminPrompt,
            Owner::Cli => SystemProxyBackend::Sudo,
        }
    }

    /// Judged against the running engine's port, or the configured one while it is stopped.
    /// Blocks.
    pub fn system_proxy_status(&self) -> Result<SystemProxyStatus, String> {
        let port = self.port().unwrap_or(self.settings()?.port);
        macos::status(port, self.system_proxy_backend())
    }

    /// Turns the system proxy on or off and remembers the choice. Turned on while the engine
    /// is stopped, it waits for the engine to start, so the Mac is never pointed at nothing.
    /// Blocks, through the password dialog.
    pub fn set_system_proxy(&self, enabled: bool) -> Result<SystemProxyStatus, String> {
        let mut settings = self.settings()?;
        let running = self.port();
        if !enabled || running.is_some() {
            macos::set(enabled, running.unwrap_or(settings.port), self.system_proxy_backend())?;
        }
        settings.system_proxy = enabled;
        settings.save(&self.settings_path())?;
        self.system_proxy_status()
    }

    /// Turns off a system proxy left pointing at one of `ports` by an owner that crashed, so
    /// the Mac is not left offline. Leaves it alone when something is serving on the port.
    /// Blocks.
    pub fn reset_stale_system_proxy(&self, ports: &[u16]) -> Result<(), String> {
        let mut ports = ports.to_vec();
        ports.sort_unstable();
        ports.dedup();
        for port in ports {
            if port == 0 || Some(port) == self.port() || is_listening(port) {
                continue;
            }
            let status = macos::status(port, self.system_proxy_backend())?;
            if status.services.iter().any(|s| s.points_at(port)) {
                info!("Turning off a stale system proxy on port {port}");
                macos::set(false, port, self.system_proxy_backend())?;
            }
        }
        Ok(())
    }

    /// Yaak's workspaces and their folders, to save a flow into.
    pub fn workspaces(&self) -> Result<Vec<WorkspaceSummary>, String> {
        ClientDb::open(&self.client_data_dir)?.workspaces()
    }

    /// Saves a flow as a request in Yaak and records the request on the flow.
    pub async fn save_flow(
        &self,
        flow_id: &str,
        req: &SaveFlowRequest,
    ) -> Result<SaveFlowResponse, String> {
        let flow = flows::get(&self.db, flow_id)?;
        let limit = self.capture_body_limit()?;
        let body = bodies::read_body(&self.blobs, &flow, FlowBody::Request, limit).await?;
        let saved = ClientDb::open(&self.client_data_dir)?.save(&flow, &body, req)?;

        let flow = Flow { saved_request_id: Some(saved.request.id.clone()), ..flow };
        let (flow, created) = self
            .db
            .with_tx(|tx| tx.upsert(&flow, &UpdateSource::Background))
            .map_err(|e| format!("Failed to record the saved request on the flow: {e}"))?;
        self.events.emit(
            "model_write",
            &ModelPayload { model: flow, change: ModelChangeEvent::Upsert { created } },
        );
        Ok(saved)
    }
}

/// Something accepts connections on `127.0.0.1:<port>`.
fn is_listening(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

// -- Proxy state --

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum ProxyState {
    Running,
    Stopped,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ProxyStatePayload {
    pub state: ProxyState,
}

// -- Request/response types --

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListActionsRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListActionsResponse {
    pub actions: Vec<(ActionInvocation, ActionMetadata)>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListModelsRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ListModelsResponse {
    pub flows: Vec<Flow>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct GetProxyStateRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetProxyStateResponse {
    pub state: ProxyState,
    /// The port the engine is bound to, while it runs.
    pub port: Option<u16>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetFlowBodyRequest {
    pub flow_id: String,
    pub which: FlowBody,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct GetFlowBodyResponse {
    /// The body decoded with its Content-Encoding, at most the capture limit of it, in base64.
    pub data: String,
    /// The body is incomplete: cut on the wire, or decoded past the capture limit.
    pub truncated: bool,
    /// Bytes stored for the body, as they were on the wire.
    #[ts(type = "number")]
    pub stored_size: usize,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FormatBodyRequest {
    pub text: String,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct FilterBodyRequest {
    pub flow_id: String,
    pub which: FlowBody,
    /// JSONPath, or XPath for an XML or HTML body.
    pub expression: String,
    /// The language the viewer detected from the body. Without it, the Content-Type decides.
    #[ts(optional)]
    pub language: Option<FilterLanguage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "lowercase")]
pub enum FilterLanguage {
    JsonPath,
    XPath,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct FilterBodyResponse {
    pub content: String,
    pub error: Option<String>,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CaStatusRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct CaTrustRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SystemProxyStatusRequest {}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct SystemProxySetRequest {
    pub enabled: bool,
}

// -- Handlers --

fn execute_action(ctx: &ProxyCtx, invocation: ActionInvocation) -> Result<bool, RpcError> {
    match invocation {
        ActionInvocation::Global { action } => match action {
            GlobalAction::ProxyStart => ctx.start().map_err(|message| RpcError { message })?,
            GlobalAction::ProxyStop => ctx.stop().map_err(|message| RpcError { message })?,
        },
    }
    Ok(true)
}

fn get_proxy_state(
    ctx: &ProxyCtx,
    _req: GetProxyStateRequest,
) -> Result<GetProxyStateResponse, RpcError> {
    let port = ctx.port();
    let state = if port.is_some() { ProxyState::Running } else { ProxyState::Stopped };
    Ok(GetProxyStateResponse { state, port })
}

fn format_body(_ctx: &ProxyCtx, req: FormatBodyRequest) -> Result<String, RpcError> {
    Ok(yaak_templates::format_json::format_json(&req.text, "  "))
}

async fn get_flow_body(
    ctx: ProxyCtx,
    req: GetFlowBodyRequest,
) -> Result<GetFlowBodyResponse, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let body = bodies::read_body(&ctx.blobs, &flow, req.which, limit).await.map_err(rpc_error)?;
    Ok(GetFlowBodyResponse {
        data: BASE64.encode(&body.data),
        truncated: body.truncated,
        stored_size: body.stored_size,
    })
}

async fn filter_body(
    ctx: ProxyCtx,
    req: FilterBodyRequest,
) -> Result<FilterBodyResponse, RpcError> {
    let flow = find_flow(&ctx, &req.flow_id)?;
    let limit = settings(&ctx)?.capture_body_limit;
    let body = bodies::read_body(&ctx.blobs, &flow, req.which, limit).await.map_err(rpc_error)?;
    let text = String::from_utf8_lossy(&body.data);
    let language = match req.language {
        Some(FilterLanguage::JsonPath) => yaak_filter::Language::JsonPath,
        Some(FilterLanguage::XPath) => yaak_filter::Language::XPath,
        None => {
            let content_type = find_header(flow.headers(req.which), "content-type");
            yaak_filter::Language::for_content_type(content_type.unwrap_or_default())
        }
    };
    let result = yaak_filter::filter(language, &text, &req.expression);
    Ok(FilterBodyResponse { content: result.content, error: result.error })
}

async fn ca_status(ctx: ProxyCtx, _req: CaStatusRequest) -> Result<CaStatus, RpcError> {
    ca::status(&ctx.ca_dir().join("ca.pem")).await.map_err(rpc_error)
}

async fn ca_trust(ctx: ProxyCtx, _req: CaTrustRequest) -> Result<CaStatus, RpcError> {
    // Creates the CA when the engine has never run, so there is something to trust.
    let ca = CaStore::load_or_create(&ctx.ca_dir())
        .map_err(|e| rpc_error(format!("Failed to load proxy CA: {e}")))?;
    ca::trust(ca.cert_path()).await.map_err(rpc_error)?;
    ca::status(ca.cert_path()).await.map_err(rpc_error)
}

async fn system_proxy_status(
    ctx: ProxyCtx,
    _req: SystemProxyStatusRequest,
) -> Result<SystemProxyStatus, RpcError> {
    blocking(move || ctx.system_proxy_status()).await
}

async fn system_proxy_set(
    ctx: ProxyCtx,
    req: SystemProxySetRequest,
) -> Result<SystemProxyStatus, RpcError> {
    blocking(move || ctx.set_system_proxy(req.enabled)).await
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, RpcError> {
    tokio::task::spawn_blocking(f).await.map_err(rpc_error)?.map_err(rpc_error)
}

fn settings(ctx: &ProxyCtx) -> Result<ProxySettings, RpcError> {
    ctx.settings().map_err(rpc_error)
}

fn find_flow(ctx: &ProxyCtx, flow_id: &str) -> Result<Flow, RpcError> {
    ctx.db.with_conn(|db| db.find_one::<Flow>(FlowIden::Id, flow_id)).map_err(rpc_error)
}

fn rpc_error(e: impl ToString) -> RpcError {
    RpcError { message: e.to_string() }
}

fn list_actions(
    _ctx: &ProxyCtx,
    _req: ListActionsRequest,
) -> Result<ListActionsResponse, RpcError> {
    Ok(ListActionsResponse { actions: crate::actions::all_global_actions() })
}

fn list_models(ctx: &ProxyCtx, _req: ListModelsRequest) -> Result<ListModelsResponse, RpcError> {
    ctx.db.with_conn(|db| {
        Ok(ListModelsResponse {
            flows: db.find_all::<Flow>().map_err(|e| RpcError { message: e.to_string() })?,
        })
    })
}

// -- Event loop --

/// A flow between its `RequestStart` and its end, with its bodies being written as they
/// stream.
struct InFlight {
    flow: Flow,
    request_body: Option<BodyChunkWriter>,
    response_body: Option<BodyChunkWriter>,
}

fn run_event_loop(
    rx: std::sync::mpsc::Receiver<ProxyEvent>,
    db: ProxyQueryManager,
    blobs: BlobManager,
    events: RpcEventEmitter,
) {
    let mut in_flight: HashMap<u64, InFlight> = HashMap::new();

    while let Ok(event) = rx.recv() {
        match event {
            ProxyEvent::RequestStart { id, started_at, method, url, http_version } => {
                let flow_id = Flow::generate_id();
                let request_body = Flow::body_id(&flow_id, FlowBody::Request);
                let response_body = Flow::body_id(&flow_id, FlowBody::Response);
                let flow = Flow {
                    id: flow_id,
                    started_at: DateTime::<Utc>::from(started_at).naive_utc(),
                    method,
                    url,
                    client_http_version: http_version,
                    ..Default::default()
                };
                in_flight.insert(
                    id,
                    InFlight {
                        flow,
                        request_body: Some(BodyChunkWriter::new(blobs.clone(), request_body)),
                        response_body: Some(BodyChunkWriter::new(blobs.clone(), response_body)),
                    },
                );
            }
            ProxyEvent::RequestHeader { id, name, value } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_headers.push(ProxyHeader { name, value });
                }
            }
            // Counted per chunk too: the response can end, and the flow with it, before the
            // upload does.
            ProxyEvent::RequestBodyChunk { id, len, data } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_size += len as i64;
                    f.flow.request_truncated |= data.len() < len;
                    write_body_chunk(&mut f.request_body, &data);
                }
            }
            ProxyEvent::RequestBodyComplete { id, size, truncated } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.request_size = size as i64;
                    f.flow.request_truncated = truncated;
                    finish_body(f.request_body.take());
                }
            }
            ProxyEvent::ResponseStart { id, status, http_version, remote_addr, elapsed_ms } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.status = Some(status as i32);
                    f.flow.upstream_http_version = Some(http_version);
                    f.flow.remote_addr = remote_addr.map(|a| a.to_string());
                    f.flow.elapsed_headers_ms = Some(clamp_ms(elapsed_ms));
                }
            }
            ProxyEvent::ResponseHeader { id, name, value } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    f.flow.response_headers.push(ProxyHeader { name, value });
                }
            }
            ProxyEvent::ResponseBodyChunk { id, data, .. } => {
                if let Some(f) = in_flight.get_mut(&id) {
                    write_body_chunk(&mut f.response_body, &data);
                }
            }
            ProxyEvent::ResponseBodyComplete { id, size, truncated, elapsed_ms, error } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.response_size = size as i64;
                    f.flow.response_truncated = truncated;
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = error;
                    finish_flow(&db, &events, f);
                }
            }
            ProxyEvent::Error { id, error, elapsed_ms } => {
                if let Some(mut f) = in_flight.remove(&id) {
                    f.flow.elapsed_ms = Some(clamp_ms(elapsed_ms));
                    f.flow.error = Some(error);
                    finish_flow(&db, &events, f);
                }
            }
        }
    }
}

fn clamp_ms(ms: u64) -> i32 {
    i32::try_from(ms).unwrap_or(i32::MAX)
}

/// Stops writing a body after its first failed write, keeping the chunks before it.
fn write_body_chunk(writer: &mut Option<BodyChunkWriter>, data: &[u8]) {
    if data.is_empty() {
        return;
    }
    if let Some(w) = writer.as_mut()
        && let Err(e) = w.write(data)
    {
        warn!("Failed to store proxy body chunk: {e}");
        *writer = None;
    }
}

fn finish_body(writer: Option<BodyChunkWriter>) {
    if let Some(w) = writer
        && let Err(e) = w.finish()
    {
        warn!("Failed to store proxy body chunk: {e}");
    }
}

fn finish_flow(db: &ProxyQueryManager, events: &RpcEventEmitter, f: InFlight) {
    finish_body(f.request_body);
    finish_body(f.response_body);

    let mut flow = f.flow;
    flow.content_type = find_header(&flow.response_headers, "content-type").map(String::from);
    match db.with_tx(|ctx| ctx.upsert(&flow, &UpdateSource::Background)) {
        Ok((saved, created)) => {
            events.emit(
                "model_write",
                &ModelPayload { model: saved, change: ModelChangeEvent::Upsert { created } },
            );
        }
        Err(e) => warn!("Failed to write proxy flow: {e}"),
    }
}

// -- Router + Schema --

define_rpc! {
    ProxyCtx;
    commands {
        execute_action(ActionInvocation) -> bool,
        format_body(FormatBodyRequest) -> String,
        get_proxy_state(GetProxyStateRequest) -> GetProxyStateResponse,
        list_actions(ListActionsRequest) -> ListActionsResponse,
        list_models(ListModelsRequest) -> ListModelsResponse,
    }
    async_commands {
        ca_status(CaStatusRequest) -> CaStatus,
        ca_trust(CaTrustRequest) -> CaStatus,
        filter_body(FilterBodyRequest) -> FilterBodyResponse,
        get_flow_body(GetFlowBodyRequest) -> GetFlowBodyResponse,
        system_proxy_set(SystemProxySetRequest) -> SystemProxyStatus,
        system_proxy_status(SystemProxyStatusRequest) -> SystemProxyStatus,
    }
    events {
        model_write(ModelPayload),
        proxy_state_changed(ProxyStatePayload),
    }
}
