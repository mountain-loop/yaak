use serde::{Serialize, Serializer};
use thiserror::Error;
use tokio_tungstenite::tungstenite;

#[derive(Error, Debug)]
pub enum Error {
    #[error("WebSocket error: {0}")]
    WebSocketErr(#[from] tungstenite::Error),

    #[error(transparent)]
    ModelError(#[from] yaak_models::error::Error),

    #[error(transparent)]
    PluginError(#[from] yaak_plugins::error::Error),

    #[error(transparent)]
    TemplateError(#[from] yaak_templates::error::Error),

    #[error("WebSocket error: {0}")]
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
