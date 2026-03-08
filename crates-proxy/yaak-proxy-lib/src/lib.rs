use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use ts_rs::TS;
use yaak_proxy::ProxyHandle;
use yaak_rpc::{RpcError, define_rpc};

// -- Context shared across all RPC handlers --

pub struct ProxyCtx {
    handle: Mutex<Option<ProxyHandle>>,
}

impl ProxyCtx {
    pub fn new() -> Self {
        Self {
            handle: Mutex::new(None),
        }
    }
}

// -- Request/response types --

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ProxyStartRequest {
    pub port: Option<u16>,
}

#[derive(Serialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
#[serde(rename_all = "camelCase")]
pub struct ProxyStartResponse {
    pub port: u16,
    pub already_running: bool,
}

#[derive(Deserialize, TS)]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ProxyStopRequest {}

// -- Handlers --

fn proxy_start(ctx: &ProxyCtx, req: ProxyStartRequest) -> Result<ProxyStartResponse, RpcError> {
    let mut handle = ctx
        .handle
        .lock()
        .map_err(|_| RpcError { message: "lock poisoned".into() })?;

    if let Some(existing) = handle.as_ref() {
        return Ok(ProxyStartResponse {
            port: existing.port,
            already_running: true,
        });
    }

    let proxy_handle = yaak_proxy::start_proxy(req.port.unwrap_or(0))
        .map_err(|e| RpcError { message: e })?;
    let port = proxy_handle.port;
    *handle = Some(proxy_handle);

    Ok(ProxyStartResponse {
        port,
        already_running: false,
    })
}

fn proxy_stop(ctx: &ProxyCtx, _req: ProxyStopRequest) -> Result<bool, RpcError> {
    let mut handle = ctx
        .handle
        .lock()
        .map_err(|_| RpcError { message: "lock poisoned".into() })?;
    Ok(handle.take().is_some())
}

// -- Router + Schema --

define_rpc! {
    ProxyCtx;
    "proxy_start" => proxy_start(ProxyStartRequest) -> ProxyStartResponse,
    "proxy_stop" => proxy_stop(ProxyStopRequest) -> bool,
}
