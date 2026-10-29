use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, export_to = "gen_rpc.ts")]
pub enum GlobalAction {
    /// Pauses or resumes storing flows.
    RecordingToggle,
    FlowsClear,
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
    if cfg!(target_os = "macos") { Some(mac.into()) } else { Some(other.into()) }
}

/// All global actions with their metadata, used by `list_actions` RPC.
pub fn all_global_actions() -> Vec<(ActionInvocation, ActionMetadata)> {
    vec![
        (
            ActionInvocation::Global { action: GlobalAction::RecordingToggle },
            ActionMetadata {
                label: "Pause or Resume Recording".into(),
                // Not Cmd+Shift+R, which reloads the window in development builds.
                default_hotkey: default_hotkey("Meta+R", "Ctrl+Shift+R"),
            },
        ),
        (
            ActionInvocation::Global { action: GlobalAction::FlowsClear },
            ActionMetadata {
                label: "Clear Flows".into(),
                default_hotkey: default_hotkey("Meta+K", "Ctrl+K"),
            },
        ),
    ]
}
