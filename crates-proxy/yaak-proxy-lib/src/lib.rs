pub mod actions;
pub mod bodies;
pub mod db;
pub mod models;
pub mod settings;

use crate::actions::{ActionInvocation, ActionMetadata, GlobalAction};
use crate::db::ProxyQueryManager;
use crate::models::{Flow, FlowBody, ModelPayload, ProxyHeader, find_header};
use crate::settings::ProxySettings;
use chrono::{DateTime, Utc};
use log::warn;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
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
            db,
            blobs,
            events,
        })
    }

    pub fn settings_path(&self) -> PathBuf {
        self.data_dir.join("settings.json")
    }

    /// Starts the engine with the current `settings.json`. Does nothing if it is running.
    pub fn start(&self) -> Result<(), String> {
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        if handle.is_some() {
            return Ok(());
        }

        let settings = ProxySettings::load(&self.settings_path())?;
        let ca = CaStore::load_or_create(&self.data_dir.join("ca"))
            .map_err(|e| format!("Failed to load proxy CA: {e}"))?;
        let mut config = ProxyConfig::new(settings.port, Arc::new(ca));
        config.capture_body_limit = settings.capture_body_limit;
        let mut proxy_handle = yaak_proxy::start_proxy(config)?;

        if let Some(event_rx) = proxy_handle.take_event_rx() {
            let db = self.db.clone();
            let blobs = self.blobs.clone();
            let events = self.events.clone();
            std::thread::spawn(move || run_event_loop(event_rx, db, blobs, events));
        }

        *handle = Some(proxy_handle);
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Running });
        Ok(())
    }

    pub fn stop(&self) -> Result<(), String> {
        let mut handle = self.handle.lock().map_err(|_| "lock poisoned".to_string())?;
        handle.take();
        self.events.emit("proxy_state_changed", &ProxyStatePayload { state: ProxyState::Stopped });
        Ok(())
    }

    /// The port the engine is bound to, while it runs.
    pub fn port(&self) -> Option<u16> {
        self.handle.lock().ok()?.as_ref().map(|h| h.port)
    }
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
pub struct GetProxyStateResponse {
    pub state: ProxyState,
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
    let handle = ctx.handle.lock().map_err(|_| RpcError { message: "lock poisoned".into() })?;
    let state = if handle.is_some() { ProxyState::Running } else { ProxyState::Stopped };
    Ok(GetProxyStateResponse { state })
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
        get_proxy_state(GetProxyStateRequest) -> GetProxyStateResponse,
        list_actions(ListActionsRequest) -> ListActionsResponse,
        list_models(ListModelsRequest) -> ListModelsResponse,
    }
    events {
        model_write(ModelPayload),
        proxy_state_changed(ProxyStatePayload),
    }
}
