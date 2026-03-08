use serde::{Deserialize, Serialize};

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
