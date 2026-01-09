use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[serde(default, rename_all = "camelCase")]
#[ts(export, export_to = "sse.ts")]
pub struct ServerSentEvent {
    pub event_type: String,
    pub data: String,
    pub id: Option<String>,
    pub retry: Option<u64>,
}
