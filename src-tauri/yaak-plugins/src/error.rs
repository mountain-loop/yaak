use crate::events::InternalEvent;
use thiserror::Error;
use tokio::io;
use tokio::sync::mpsc::error::SendError;

#[derive(Error, Debug)]
pub enum Error {
    #[error(transparent)]
    CryptoErr(#[from] yaak_crypto::error::Error),

    #[error(transparent)]
    TemplateErr(#[from] yaak_templates::error::Error),
    
    #[error("IO error: {0}")]
    IoErr(#[from] io::Error),

    #[error("Tauri error: {0}")]
    TauriErr(#[from] tauri::Error),

    #[error("Tauri shell error: {0}")]
    TauriShellErr(#[from] tauri_plugin_shell::Error),

    #[error("Grpc send error: {0}")]
    GrpcSendErr(#[from] SendError<InternalEvent>),

    #[error("JSON error: {0}")]
    JsonErr(#[from] serde_json::Error),

    #[error("Timeout elapsed: {0}")]
    TimeoutElapsed(#[from] tokio::time::error::Elapsed),

    #[error("Plugin not found: {0}")]
    PluginNotFoundErr(String),

    #[error("Auth plugin not found: {0}")]
    AuthPluginNotFound(String),

    #[error("Plugin error: {0}")]
    PluginErr(String),

    #[error("Client not initialized error")]
    ClientNotInitializedErr,

    #[error("Unknown event received")]
    UnknownEventErr,
}

pub type Result<T> = std::result::Result<T, Error>;
