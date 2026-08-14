use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum UpdateSource {
    Background,
    Import,
    Plugin,
    Sync,
    Window { label: String },
}

impl UpdateSource {
    pub fn from_window_label(label: impl Into<String>) -> Self {
        Self::Window { label: label.into() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ModelChangeEvent {
    Upsert { created: bool },
    /// A delete for a workspace implies deletion of every model in that
    /// workspace — children are bulk-deleted without their own change rows or
    /// events, and consumers must prune the subtree themselves (the frontend
    /// model store does this centrally).
    Delete,
}
