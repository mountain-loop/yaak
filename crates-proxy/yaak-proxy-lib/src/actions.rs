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
