use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error("Render error: {0}")]
    TemplateError(#[from] yaak_templates::error::Error),

    #[error("Model error: {0}")]
    ModelError(#[from] yaak_models::error::Error),

    #[error("Sync error: {0}")]
    SyncError(#[from] yaak_sync::error::Error),

    #[error("Git error: {0}")]
    GitError(#[from] yaak_git::error::Error),

    #[error("Websocket error: {0}")]
    WebsocketError(#[from] yaak_ws::error::Error),

    #[error("License error: {0}")]
    LicenseError(#[from] yaak_license::error::Error),

    #[error("Plugin error: {0}")]
    PluginError(#[from] yaak_plugins::error::Error),

    #[error("Request error: {0}")]
    RequestError(#[from] reqwest::Error),

    #[error("Generic error: {0}")]
    GenericError(String),
}

impl Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, Error>;
