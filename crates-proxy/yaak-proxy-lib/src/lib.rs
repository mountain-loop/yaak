pub mod actions;
pub mod db;
pub mod models;

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use log::warn;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use yaak_database::{ModelChangeEvent, UpdateSource};
use yaak_proxy::{CapturedRequest, ProxyEvent, ProxyHandle, RequestState};
use yaak_rpc::{RpcError, RpcEventEmitter, define_rpc};
use crate::actions::{ActionInvocation, GlobalAction};
use crate::db::ProxyQueryManager;
use crate::models::{HttpExchange, ModelPayload, ProxyHeader};

// -- Context --

pub struct ProxyCtx {
    handle: Mutex<Option<ProxyHandle>>,
    pub db: ProxyQueryManager,
    pub events: RpcEventEmitter,
}

impl ProxyCtx {
    pub fn new(db_path: &Path, events: RpcEventEmitter) -> Self {
        Self {
            handle: Mutex::new(None),
            db: ProxyQueryManager::new(db_path),
            events,
        }
    }
}

// -- Request/response types --

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ListModelsRequest {}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ListModelsResponse {
    pub http_exchanges: Vec<HttpExchange>,
}

// -- Handlers --

fn execute_action(ctx: &ProxyCtx, invocation: ActionInvocation) -> Result<bool, RpcError> {
    match invocation {
        ActionInvocation::Global { action } => match action {
            GlobalAction::ProxyStart => {
                let mut handle = ctx
                    .handle
                    .lock()
                    .map_err(|_| RpcError { message: "lock poisoned".into() })?;

                if handle.is_some() {
                    return Ok(true); // already running
                }

                let mut proxy_handle = yaak_proxy::start_proxy(9090)
                    .map_err(|e| RpcError { message: e })?;

                if let Some(event_rx) = proxy_handle.take_event_rx() {
                    let db = ctx.db.clone();
                    let events = ctx.events.clone();
                    std::thread::spawn(move || run_event_loop(event_rx, db, events));
                }

                *handle = Some(proxy_handle);
                Ok(true)
            }
            GlobalAction::ProxyStop => {
                let mut handle = ctx
                    .handle
                    .lock()
                    .map_err(|_| RpcError { message: "lock poisoned".into() })?;
                handle.take();
                Ok(true)
            }
        },
    }
}

fn list_models(ctx: &ProxyCtx, _req: ListModelsRequest) -> Result<ListModelsResponse, RpcError> {
    ctx.db.with_conn(|db| {
        Ok(ListModelsResponse {
            http_exchanges: db.find_all::<HttpExchange>()
                .map_err(|e| RpcError { message: e.to_string() })?,
        })
    })
}

// -- Event loop --

fn run_event_loop(rx: std::sync::mpsc::Receiver<ProxyEvent>, db: ProxyQueryManager, events: RpcEventEmitter) {
    let mut in_flight: HashMap<u64, CapturedRequest> = HashMap::new();

    while let Ok(event) = rx.recv() {
        match event {
            ProxyEvent::RequestStart { id, method, url, http_version } => {
                in_flight.insert(id, CapturedRequest {
                    id,
                    method,
                    url,
                    http_version,
                    status: None,
                    elapsed_ms: None,
                    remote_http_version: None,
                    request_headers: vec![],
                    request_body: None,
                    response_headers: vec![],
                    response_body: None,
                    response_body_size: 0,
                    state: RequestState::Sending,
                    error: None,
                });
            }
            ProxyEvent::RequestHeader { id, name, value } => {
                if let Some(r) = in_flight.get_mut(&id) {
                    r.request_headers.push((name, value));
                }
            }
            ProxyEvent::RequestBody { id, body } => {
                if let Some(r) = in_flight.get_mut(&id) {
                    r.request_body = Some(body);
                }
            }
            ProxyEvent::ResponseStart { id, status, http_version, elapsed_ms } => {
                if let Some(r) = in_flight.get_mut(&id) {
                    r.status = Some(status);
                    r.remote_http_version = Some(http_version);
                    r.elapsed_ms = Some(elapsed_ms);
                    r.state = RequestState::Receiving;
                }
            }
            ProxyEvent::ResponseHeader { id, name, value } => {
                if let Some(r) = in_flight.get_mut(&id) {
                    r.response_headers.push((name, value));
                }
            }
            ProxyEvent::ResponseBodyChunk { .. } => {
                // Progress only — no action needed
            }
            ProxyEvent::ResponseBodyComplete { id, body, size, elapsed_ms } => {
                if let Some(mut r) = in_flight.remove(&id) {
                    r.response_body = body;
                    r.response_body_size = size;
                    r.elapsed_ms = r.elapsed_ms.or(Some(elapsed_ms));
                    r.state = RequestState::Complete;
                    write_entry(&db, &events, &r);
                }
            }
            ProxyEvent::Error { id, error } => {
                if let Some(mut r) = in_flight.remove(&id) {
                    r.error = Some(error);
                    r.state = RequestState::Error;
                    write_entry(&db, &events, &r);
                }
            }
        }
    }
}

fn write_entry(db: &ProxyQueryManager, events: &RpcEventEmitter, r: &CapturedRequest) {
    let entry = HttpExchange {
        url: r.url.clone(),
        method: r.method.clone(),
        req_headers: r.request_headers.iter()
            .map(|(n, v)| ProxyHeader { name: n.clone(), value: v.clone() })
            .collect(),
        req_body: r.request_body.clone(),
        res_status: r.status.map(|s| s as i32),
        res_headers: r.response_headers.iter()
            .map(|(n, v)| ProxyHeader { name: n.clone(), value: v.clone() })
            .collect(),
        res_body: r.response_body.clone(),
        error: r.error.clone(),
        ..Default::default()
    };
    db.with_conn(|ctx| {
        match ctx.upsert(&entry, &UpdateSource::Background) {
            Ok((saved, created)) => {
                events.emit("model_write", &ModelPayload {
                    model: saved,
                    change: ModelChangeEvent::Upsert { created },
                });
            }
            Err(e) => warn!("Failed to write proxy entry: {e}"),
        }
    });
}

// -- Router + Schema --

define_rpc! {
    ProxyCtx;
    commands {
        execute_action(ActionInvocation) -> bool,
        list_models(ListModelsRequest) -> ListModelsResponse,
    }
    events {
        model_write(ModelPayload),
    }
}
