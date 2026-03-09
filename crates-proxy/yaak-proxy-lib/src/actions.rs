use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum GlobalAction {
    ProxyStart,
    ProxyStop,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "scope", rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum ActionInvocation {
    Global { action: GlobalAction },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "gen_rpc.ts")]
pub struct ActionMetadata {
    pub label: String,
    pub default_hotkey: Option<String>,
}

fn default_hotkey(mac: &str, other: &str) -> Option<String> {
    if cfg!(target_os = "macos") {
        Some(mac.into())
    } else {
        Some(other.into())
    }
}

/// All global actions with their metadata, used by `list_actions` RPC.
pub fn all_global_actions() -> Vec<(ActionInvocation, ActionMetadata)> {
    vec![
        (
            ActionInvocation::Global { action: GlobalAction::ProxyStart },
            ActionMetadata {
                label: "Start Proxy".into(),
                default_hotkey: default_hotkey("Meta+Shift+P", "Ctrl+Shift+P"),
            },
        ),
        (
            ActionInvocation::Global { action: GlobalAction::ProxyStop },
            ActionMetadata {
                label: "Stop Proxy".into(),
                default_hotkey: default_hotkey("Meta+Shift+S", "Ctrl+Shift+S"),
            },
        ),
    ]
}
