use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    TemplateError(#[from] yaak_templates::error::Error),

    #[error(transparent)]
    ModelError(#[from] yaak_models::error::Error),

    #[error(transparent)]
    SyncError(#[from] yaak_sync::error::Error),

    #[error(transparent)]
    GitError(#[from] yaak_git::error::Error),

    #[error(transparent)]
    WebsocketError(#[from] yaak_ws::error::Error),

    #[error(transparent)]
    LicenseError(#[from] yaak_license::error::Error),

    #[error(transparent)]
    PluginError(#[from] yaak_plugins::error::Error),

    #[error("Updater error: {0}")]
    UpdaterError(#[from] tauri_plugin_updater::Error),

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
