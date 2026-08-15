//! The bridge's RPC surface.
//!
//! Same envelope, same command names, same request and response types as the
//! desktop — all of that comes from `yaak_rpc_schema` — dispatched through the
//! same `RpcRouter`. Only the adapters differ: the desktop's take a Tauri
//! window and read the workspace off its URL, while these take a `BridgeCtx`
//! carrying the connected tab's reported URL. The bodies underneath call the
//! same engine functions in `yaak`, `yaak-models` and `yaak-plugins`.
//!
//! The router is built from the schema's full command list, so every command
//! the frontend knows has an adapter here — the ones this host doesn't
//! implement return a structured error naming the command and the host, and
//! the frontend surfaces "not supported by the Yaak Bridge" instead of a bare
//! failure. Enough is implemented to boot, edit, send and inspect.

mod commands;

pub use commands::implemented_commands;

use crate::session::SessionContext;
use crate::state::BridgeState;
use std::sync::Arc;
use yaak_plugins::events::PluginContext;
use yaak_rpc::{RpcError, RpcRouter};

/// Per-call context. The tab's identity and location, plus the engine.
///
/// Mirrors the desktop's `ClientCtx { window }`: the window there answers both
/// "who is calling" and "what are they looking at", and those are exactly the
/// two things a bridge call needs that the payload doesn't carry.
#[derive(Clone)]
pub struct BridgeCtx {
    pub state: Arc<BridgeState>,
    pub session: SessionContext,
}

impl BridgeCtx {
    pub fn plugin_context(&self) -> PluginContext {
        PluginContext::new(Some(self.session.label.clone()), self.session.workspace_id())
    }

    pub fn update_source(&self) -> yaak_models::util::UpdateSource {
        yaak_models::util::UpdateSource::from_window_label(&self.session.label)
    }

    /// The plugin runtime, or an error naming the reason it isn't there.
    pub fn plugins(&self) -> Result<Arc<yaak_plugins::manager::PluginManager>, RpcError> {
        self.state.plugin_manager().ok_or_else(|| RpcError {
            message: "The plugin runtime failed to start, so this command is unavailable"
                .to_string(),
        })
    }
}

pub fn build_router() -> RpcRouter<BridgeCtx> {
    commands::build_router()
}

pub fn unsupported_command(cmd: &str) -> RpcError {
    RpcError {
        message: format!("`{cmd}` is not supported on this host (Yaak Bridge)"),
    }
}
