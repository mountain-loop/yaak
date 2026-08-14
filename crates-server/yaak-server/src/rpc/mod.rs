//! The bridge's RPC surface.
//!
//! Same envelope and same command names as the desktop, dispatched through the
//! same `RpcRouter`. Only the adapters differ: the desktop's take a Tauri
//! window and read the workspace off its URL, while these take a `BridgeCtx`
//! carrying the connected tab's reported URL. The bodies underneath call the
//! same engine functions in `yaak`, `yaak-models` and `yaak-plugins`.
//!
//! This is a subset — enough to boot, edit, send and inspect. Anything not
//! registered here still gets a well-formed answer: `unsupported_command`
//! turns it into an RPC error naming the command and this host, so the frontend
//! surfaces "not supported by the Yaak Bridge" instead of a bare failure.

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

/// Every command the desktop has that the bridge does not implement.
///
/// Registered explicitly rather than left to fall through to "unknown command",
/// so the message says *why* — the frontend can tell a host that will never
/// support git from one that is simply out of date.
pub const UNSUPPORTED_COMMANDS: &[&str] = &[
    // Multi-window. A tab is one window; Settings opens through this on the
    // desktop and is therefore unreachable in the browser today.
    "cmd_new_child_window",
    "cmd_new_main_window",
    // gRPC and WebSocket sending.
    "cmd_grpc_reflect",
    "cmd_grpc_go",
    "cmd_grpc_request_actions",
    "cmd_call_grpc_request_action",
    "cmd_delete_all_grpc_connections",
    "cmd_ws_connect",
    "cmd_ws_send",
    "cmd_ws_close",
    "cmd_ws_delete_connections",
    "cmd_websocket_request_actions",
    "cmd_call_websocket_request_action",
    // Git-backed workspaces.
    "cmd_git_checkout",
    "cmd_git_branch",
    "cmd_git_delete_branch",
    "cmd_git_delete_remote_branch",
    "cmd_git_merge_branch",
    "cmd_git_rename_branch",
    "cmd_git_status",
    "cmd_git_branch_info",
    "cmd_git_worktree_status",
    "cmd_git_log",
    "cmd_git_log_for_file",
    "cmd_git_file_diff_for_commit",
    "cmd_git_initialize",
    "cmd_git_clone",
    "cmd_git_commit",
    "cmd_git_fetch_all",
    "cmd_git_push",
    "cmd_git_pull",
    "cmd_git_pull_force_reset",
    "cmd_git_pull_merge",
    "cmd_git_add",
    "cmd_git_unstage",
    "cmd_git_reset_changes",
    "cmd_git_restore_files",
    "cmd_git_restore_file_from_commit",
    "cmd_git_add_credential",
    "cmd_git_remotes",
    "cmd_git_add_remote",
    "cmd_git_rm_remote",
    "cmd_git_watch_worktree_status",
    // Filesystem sync.
    "cmd_sync_calculate",
    "cmd_sync_calculate_fs",
    "cmd_sync_apply",
    "cmd_sync_watch",
    // Workspace encryption.
    "cmd_enable_encryption",
    "cmd_disable_encryption",
    "cmd_reveal_workspace_key",
    "cmd_set_workspace_key",
    // Things that need a local filesystem the tab can point at.
    "cmd_export_data",
    "cmd_save_response",
    "cmd_save_base64_to_binary",
    "cmd_plugins_install_from_directory",
    // Desktop application management.
    "cmd_restart",
    "cmd_check_for_updates",
    "cmd_dismiss_notification",
    "cmd_send_feedback",
    "cmd_plugins_search",
    "cmd_plugins_install",
    "cmd_plugins_uninstall",
    "cmd_plugins_updates",
    "cmd_plugins_update_all",
    "cmd_reload_plugins",
];

pub fn unsupported_command(cmd: &str) -> RpcError {
    RpcError {
        message: format!("`{cmd}` is not supported on this host (Yaak Bridge)"),
    }
}
